import 'dart:async';
import 'dart:convert';
import 'dart:math';

import 'package:connectivity_plus/connectivity_plus.dart';
import 'package:drift/drift.dart';
import 'package:flutter/widgets.dart';

import '../api_client.dart';
import 'database.dart';
import 'photo_queue.dart';

/// What the queue is doing, for the banner at the top of the app.
class SyncState {
  const SyncState({
    this.pending = 0,
    this.blocked = 0,
    this.sending = false,
    this.online = true,
    this.lastError,
  });

  /// Entries waiting to go out.
  final int pending;

  /// Entries the server refused for a reason retrying will not fix.
  final int blocked;

  final bool sending;
  final bool online;
  final String? lastError;

  bool get idle => pending == 0 && blocked == 0;

  SyncState copyWith({
    int? pending,
    int? blocked,
    bool? sending,
    bool? online,
    String? lastError,
    bool clearError = false,
  }) => SyncState(
    pending: pending ?? this.pending,
    blocked: blocked ?? this.blocked,
    sending: sending ?? this.sending,
    online: online ?? this.online,
    lastError: clearError ? null : (lastError ?? this.lastError),
  );
}

/// Gets what this phone has done to the server, eventually.
///
/// The rules it works to:
///
///   * **In order.** A roll call and then a correction to it must arrive that way round.
///   * **Once.** Every entry carries a client id the API deduplicates on, so a request that
///     succeeded but whose response was lost is safely retried.
///   * **Never silently dropped.** A refusal the server will keep refusing — a validation error, a
///     missing permission — marks the entry blocked and leaves it visible rather than deleting it.
///     A network failure just waits.
///   * **Backs off.** Retrying every second on a train tunnel flattens the battery for nothing.
class SyncEngine with WidgetsBindingObserver {
  SyncEngine({required AppDatabase db, required ApiClient api}) : _db = db, _api = api;

  final AppDatabase _db;
  final ApiClient _api;

  final _controller = StreamController<SyncState>.broadcast();
  Stream<SyncState> get changes => _controller.stream;
  SyncState state = const SyncState();

  StreamSubscription<List<ConnectivityResult>>? _connectivity;
  Timer? _retry;
  Future<void>? _inflight;

  /// Resolves when nothing is being sent. Shutdown waits on it, and so do tests: tearing the
  /// database out from under a drain that is halfway through an entry is how work gets lost.
  Future<void> get settled => _inflight ?? Future<void>.value();

  Future<void> start() async {
    WidgetsBinding.instance.addObserver(this);
    // Coming back into signal is the moment that matters most: somebody has walked out of a
    // basement and the day's work should leave the phone without them thinking about it.
    _connectivity = Connectivity().onConnectivityChanged.listen((results) {
      final online = !results.contains(ConnectivityResult.none) && results.isNotEmpty;
      _emit(state.copyWith(online: online));
      if (online) unawaited(drain());
    });
    await refreshCounts();
    unawaited(drain());
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    // A phone that was asleep in a pocket all afternoon gets a chance the moment it is opened.
    if (state == AppLifecycleState.resumed) unawaited(drain());
  }

  Future<void> dispose() async {
    WidgetsBinding.instance.removeObserver(this);
    await _connectivity?.cancel();
    _retry?.cancel();
    await settled;
    await _controller.close();
  }

  void _emit(SyncState next) {
    state = next;
    if (!_controller.isClosed) _controller.add(next);
  }

  Future<void> refreshCounts() async {
    final pending = await (_db.select(_db.outbox)..where((row) => row.blocked.equals(false))).get();
    final blocked = await (_db.select(_db.outbox)..where((row) => row.blocked.equals(true))).get();
    _emit(state.copyWith(pending: pending.length, blocked: blocked.length));
  }

  /// Queue one thing to send. Returns once it is safely on disk, not once it is sent.
  Future<void> enqueue({
    required String kind,
    required String clientId,
    required Map<String, dynamic> payload,
    required String label,
  }) async {
    await _db
        .into(_db.outbox)
        .insert(
          OutboxCompanion.insert(
            kind: kind,
            clientId: clientId,
            payload: jsonEncode(payload),
            label: label,
          ),
        );
    await refreshCounts();
    unawaited(drain());
  }

  /// Send everything waiting, oldest first, stopping at the first thing that cannot go yet.
  ///
  /// One at a time: a second caller gets the drain already running rather than a second pass over
  /// the same rows, which would send the front entry twice.
  Future<void> drain() {
    final running = _inflight;
    if (running != null) return running;
    final attempt = _drain();
    _inflight = attempt;
    return attempt.whenComplete(() => _inflight = null);
  }

  Future<void> _drain() async {
    _retry?.cancel();

    try {
      while (true) {
        final entry =
            await (_db.select(_db.outbox)
                  ..where((row) => row.blocked.equals(false))
                  ..orderBy([(row) => OrderingTerm.asc(row.id)])
                  ..limit(1))
                .getSingleOrNull();
        if (entry == null) break;

        _emit(state.copyWith(sending: true, clearError: true));

        try {
          await _send(entry);
          await (_db.delete(_db.outbox)..where((row) => row.id.equals(entry.id))).go();
          await refreshCounts();
        } on ApiException catch (error) {
          final permanent = error.status != null && error.status! >= 400 && error.status! < 500;
          await (_db.update(_db.outbox)..where((row) => row.id.equals(entry.id))).write(
            OutboxCompanion(
              attempts: Value(entry.attempts + 1),
              lastError: Value(error.message),
              // A 4xx will be refused again however many times it is sent. Anything else is the
              // network or the server having a bad minute, and waiting is the right answer.
              blocked: Value(permanent),
            ),
          );
          await refreshCounts();
          _emit(state.copyWith(sending: false, lastError: error.message));
          if (!permanent) {
            _scheduleRetry(entry.attempts + 1);
            return;
          }
        }
      }
      _emit(state.copyWith(sending: false, clearError: true));
    } finally {
      _emit(state.copyWith(sending: false));
    }
  }

  void _scheduleRetry(int attempts) {
    // 5s, 10s, 20s … capped at five minutes.
    final seconds = min(300, 5 * pow(2, min(attempts, 6)).toInt());
    _retry?.cancel();
    _retry = Timer(Duration(seconds: seconds), () => unawaited(drain()));
  }

  Future<void> _send(OutboxEntry entry) async {
    final payload = jsonDecode(entry.payload) as Map<String, dynamic>;
    switch (entry.kind) {
      case 'attendance':
        await _api.post('/attendance', body: payload);

        /*
         * Only the workers this entry carried.
         *
         * Clearing the whole day was wrong in a way that matters: mark five people with no signal,
         * mark three more before it sends, and sending the first batch would stop the other three
         * showing as unsent while they were still sitting in the queue. Somebody would believe a
         * day was recorded that had not been — and attendance is what wages are worked out from.
         */
        final projectId = payload['project_id'] as String;
        final date = payload['attendance_date'] as String;
        final sentWorkers = [
          for (final row in (payload['rows'] as List<dynamic>? ?? const []))
            (row as Map)['worker_id'] as String,
        ];
        if (sentWorkers.isNotEmpty) {
          await (_db.update(_db.mirroredAttendance)..where(
                (row) =>
                    row.projectId.equals(projectId) &
                    row.date.equals(date) &
                    row.workerId.isIn(sentWorkers),
              ))
              .write(const MirroredAttendanceCompanion(pending: Value(false)));
        }
      case 'dpr':
        final ready = await _uploadPhotosFor(entry, payload);
        final created = await _api.post('/dpr', body: ready);
        final id = (created as Map)['id'] as String;
        // Filing is a draft and then a submit. If the submit is the half that fails, the draft is
        // already saved on the server — the report is not lost, it is unsent, and the retry of this
        // entry will find the same draft by its client id rather than making a second one.
        await _api.post('/dpr/$id/submit');
        for (final path in (payload['pending_photos'] as List<dynamic>? ?? const [])) {
          await PhotoQueue.discard(path as String);
        }
      default:
        throw ApiException('Nothing knows how to send a ${entry.kind}');
    }
  }

  /// Gets the report's photographs into storage before the report itself goes.
  ///
  /// Each key is written back into the queued entry the moment it is earned. That is what makes a
  /// half-finished upload safe to retry: the second attempt starts from the photo that failed
  /// rather than sending the first three again, and a report can never end up referencing the same
  /// photograph twice.
  Future<Map<String, dynamic>> _uploadPhotosFor(
    OutboxEntry entry,
    Map<String, dynamic> payload,
  ) async {
    final pending = List<String>.from(
      (payload['pending_photos'] as List<dynamic>? ?? const []).cast<String>(),
    );
    if (pending.isEmpty) return payload;

    final photos = List<Map<String, dynamic>>.from(
      (payload['photos'] as List<dynamic>? ?? const []).map(
        (row) => Map<String, dynamic>.from(row as Map),
      ),
    );
    final queue = PhotoQueue(_api);

    while (pending.isNotEmpty) {
      final path = pending.first;
      try {
        final key = await queue.upload(path, projectId: payload['project_id'] as String);
        photos.add({'s3_key': key});
      } on MissingPhoto {
        // The file is gone. Filing the report without it beats never filing it at all.
      }
      pending.removeAt(0);

      payload['photos'] = photos;
      payload['pending_photos'] = pending;
      await (_db.update(_db.outbox)..where((row) => row.id.equals(entry.id))).write(
        OutboxCompanion(payload: Value(jsonEncode(payload))),
      );
    }
    return payload;
  }
}
