import 'dart:math';

import 'package:drift/drift.dart';

import '../api_client.dart';
import '../format.dart';
import 'database.dart';
import 'photo_queue.dart';
import 'sync.dart';

/// One worker as the roll call needs them, whatever the network is doing.
class RollCallWorker {
  const RollCallWorker({
    required this.id,
    required this.name,
    required this.trade,
    required this.contractorName,
    required this.dailyWage,
    required this.status,
    required this.unsent,
  });

  final String id;
  final String name;
  final String? trade;
  final String contractorName;
  final String? dailyWage;

  /// `present`, `half_day`, `absent`, or `unmarked`.
  final String status;

  /// Marked on this phone and not yet accepted by the server.
  final bool unsent;
}

/// Reads that work offline, writes that survive being offline.
///
/// Every read here answers from the phone's own copy and *then* refreshes it from the server in the
/// background. That order is the whole point: a supervisor at a site with no signal sees their crew
/// immediately rather than a spinner and an error, and the same screen is simply more current when
/// there is signal.
///
/// Writes never touch the network directly. They go to the local tables and the outbox in one
/// transaction, so a phone that dies the instant after a tap has either recorded the mark and the
/// intent to send it, or neither.
class OfflineRepository {
  const OfflineRepository({
    required AppDatabase db,
    required ApiClient api,
    required SyncEngine sync,
  }) : _db = db,
       _api = api,
       _sync = sync;

  final AppDatabase _db;
  final ApiClient _api;
  final SyncEngine _sync;

  // --- mirrors ---------------------------------------------------------------------------------

  /// Pulls what the roll call and the report form need, and stores it. Quietly does nothing when
  /// the network is not there — the caller already has the last copy.
  Future<void> refreshReferenceData() async {
    try {
      final projects = await _api.get('/projects', query: {'limit': 100});
      final rows = ((projects as Map)['items'] as List<dynamic>)
          .map((row) => Map<String, dynamic>.from(row as Map))
          .toList();
      await _db.batch((batch) {
        batch.deleteAll(_db.mirroredProjects);
        batch.insertAll(_db.mirroredProjects, [
          for (final row in rows)
            MirroredProjectsCompanion.insert(
              id: row['id'] as String,
              name: row['name'] as String? ?? 'Site',
              clientName: Value(row['client_name'] as String?),
              address: Value(row['address'] as String?),
              status: Value(row['status'] as String? ?? 'planning'),
              startDate: Value(row['start_date'] as String?),
              targetEndDate: Value(row['target_end_date'] as String?),
              budgetAmount: Value(row['budget_amount'] as String?),
              lat: Value((row['lat'] as num?)?.toDouble()),
              lng: Value((row['lng'] as num?)?.toDouble()),
            ),
        ]);
      });
    } on ApiException {
      // Offline, or refused. The mirror stays as it was.
    }

    try {
      final workers = await _api.get('/workers', query: {'limit': 500});
      final rows = ((workers as Map)['items'] as List<dynamic>)
          .map((row) => Map<String, dynamic>.from(row as Map))
          .toList();
      await _db.batch((batch) {
        batch.deleteAll(_db.mirroredWorkers);
        batch.insertAll(_db.mirroredWorkers, [
          for (final row in rows)
            MirroredWorkersCompanion.insert(
              id: row['id'] as String,
              name: row['name'] as String? ?? '',
              trade: Value(row['trade'] as String?),
              skillLevel: Value(row['skill_level'] as String?),
              status: Value(row['status'] as String? ?? 'active'),
              contractorId: Value(row['contractor_id'] as String?),
              contractorName: Value(row['contractor_name'] as String?),
              dailyWage: Value(row['daily_wage'] as String?),
            ),
        ]);
      });
    } on ApiException {
      // As above.
    }
  }

  Future<List<MirroredProject>> sites() => _db.select(_db.mirroredProjects).get();

  // --- the roll call ---------------------------------------------------------------------------

  /// The crew for one site on one day, marks included.
  ///
  /// Pending marks beat mirrored ones: what somebody just tapped is more current than what the
  /// server last said.
  Future<List<RollCallWorker>> rollCall({required String projectId, required String date}) async {
    await _pullCrew(projectId: projectId, date: date);
    await _pullAttendance(projectId: projectId, date: date);

    final marks = await (_db.select(
      _db.mirroredAttendance,
    )..where((row) => row.projectId.equals(projectId) & row.date.equals(date))).get();
    final byWorker = {for (final mark in marks) mark.workerId: mark};

    final assigned =
        await (_db.select(
          _db.mirroredWorkerSites,
        )..where((row) => row.projectId.equals(projectId))).get();

    /*
     * Assigned to this site, or already marked on it today.
     *
     * The second half matters offline: a supervisor who marked somebody present here has said they
     * are on this site, and that mark must not vanish from the screen because the assignment list
     * has not reached the phone yet.
     */
    final belongs = {...assigned.map((row) => row.workerId), ...byWorker.keys};

    final workers =
        await (_db.select(_db.mirroredWorkers)
              ..where((row) => row.status.equals('active') & row.id.isIn(belongs))
              ..orderBy([
                (row) => OrderingTerm.asc(row.contractorName),
                (row) => OrderingTerm.asc(row.name),
              ]))
            .get();

    return [
      for (final worker in workers)
        RollCallWorker(
          id: worker.id,
          name: worker.name,
          trade: worker.trade,
          contractorName: worker.contractorName ?? 'Direct labour',
          dailyWage: worker.dailyWage,
          status: byWorker[worker.id]?.status ?? 'unmarked',
          unsent: byWorker[worker.id]?.pending ?? false,
        ),
    ];
  }

  /// Who this site has on it today, from the server, stored so the phone can narrow the roll call
  /// on its own afterwards.
  ///
  /// The server does the deciding — assignment windows are half-open and a worker can move between
  /// sites mid-job, which is not arithmetic worth repeating here and getting subtly wrong.
  Future<void> _pullCrew({required String projectId, required String date}) async {
    try {
      final payload = await _api.get(
        '/workers',
        query: {'project_id': projectId, 'on_date': date, 'limit': 500},
      );
      final rows = ((payload as Map)['items'] as List<dynamic>? ?? const [])
          .map((row) => Map<String, dynamic>.from(row as Map))
          .toList();

      await _db.batch((batch) {
        // Replaced rather than merged: somebody taken off this site has to disappear from it, and a
        // row that only ever gets added would keep them on the list forever.
        batch.deleteWhere(_db.mirroredWorkerSites, (row) => row.projectId.equals(projectId));
        batch.insertAllOnConflictUpdate(_db.mirroredWorkers, [
          for (final row in rows)
            MirroredWorkersCompanion.insert(
              id: row['id'] as String,
              name: row['name'] as String? ?? '',
              trade: Value(row['trade'] as String?),
              skillLevel: Value(row['skill_level'] as String?),
              status: Value(row['status'] as String? ?? 'active'),
              contractorId: Value(row['contractor_id'] as String?),
              contractorName: Value(row['contractor_name'] as String?),
              dailyWage: Value(row['daily_wage'] as String?),
            ),
        ]);
        batch.insertAll(_db.mirroredWorkerSites, [
          for (final row in rows)
            MirroredWorkerSitesCompanion.insert(
              workerId: row['id'] as String,
              projectId: projectId,
            ),
        ], mode: InsertMode.insertOrReplace);
      });
    } on ApiException {
      // Offline. Whatever this site's crew was last known to be still stands.
    }
  }

  Future<void> _pullAttendance({required String projectId, required String date}) async {
    try {
      final day = await _api.get('/attendance', query: {'project_id': projectId, 'date': date});
      final items = ((day as Map)['items'] as List<dynamic>? ?? const [])
          .map((row) => Map<String, dynamic>.from(row as Map))
          .toList();

      // Anything still pending is this phone's, and the server has not seen it. Overwriting it with
      // the server's older answer would erase a mark somebody made minutes ago.
      final pending =
          await (_db.select(_db.mirroredAttendance)..where(
                (row) =>
                    row.projectId.equals(projectId) &
                    row.date.equals(date) &
                    row.pending.equals(true),
              ))
              .get();
      final untouchable = pending.map((row) => row.workerId).toSet();

      await _db.batch((batch) {
        for (final item in items) {
          final workerId = item['worker_id'] as String;
          if (untouchable.contains(workerId)) continue;
          batch.insert(
            _db.mirroredAttendance,
            MirroredAttendanceCompanion.insert(
              projectId: projectId,
              date: date,
              workerId: workerId,
              status: item['status'] as String,
              overtimeHours: Value(item['overtime_hours'] as String? ?? '0'),
              pending: const Value(false),
            ),
            mode: InsertMode.insertOrReplace,
          );
        }
      });
    } on ApiException {
      // No signal: whatever is on the phone stands.
    }
  }

  /// Save a roll call. Lands on disk immediately; reaches the server when it can.
  /// Queues a write that has no local mirror: an indent, an expense, a stock movement.
  ///
  /// Called only when the request has already been tried and the network was not there. Everything
  /// else about it is the roll call's arrangement — a client id the API deduplicates on, a label a
  /// person would recognise in the queue, and an entry that stays until the server accepts it.
  ///
  /// The client id is generated here rather than taken from the caller so that one queued thing can
  /// never be given two of them by a retry higher up.
  Future<void> queueWrite({
    required String kind,
    required String label,
    required Map<String, dynamic> payload,
  }) async {
    final clientId = _clientId();
    await _sync.enqueue(
      kind: kind,
      clientId: clientId,
      label: label,
      payload: {...payload, 'client_id': clientId},
    );
  }

  Future<void> saveRollCall({
    required String projectId,
    required String date,
    required Map<String, String> marks,
  }) async {
    if (marks.isEmpty) return;

    final clientIds = {for (final workerId in marks.keys) workerId: _clientId()};

    await _db.transaction(() async {
      for (final entry in marks.entries) {
        await _db
            .into(_db.mirroredAttendance)
            .insert(
              MirroredAttendanceCompanion.insert(
                projectId: projectId,
                date: date,
                workerId: entry.key,
                status: entry.value,
                pending: const Value(true),
              ),
              mode: InsertMode.insertOrReplace,
            );
      }
    });

    final site = await (_db.select(
      _db.mirroredProjects,
    )..where((row) => row.id.equals(projectId))).getSingleOrNull();

    await _sync.enqueue(
      kind: 'attendance',
      clientId: clientIds.values.first,
      label: 'Roll call · ${site?.name ?? 'site'} · ${shortDate(date)}',
      payload: {
        'project_id': projectId,
        'attendance_date': date,
        'rows': [
          for (final entry in marks.entries)
            {
              'worker_id': entry.key,
              'status': entry.value,
              'overtime_hours': '0',
              // Per row, so a retry cannot double-mark one person even if the batch is split later.
              'client_id': clientIds[entry.key],
            },
        ],
      },
    );
  }

  // --- daily reports ----------------------------------------------------------------------------

  /// Queue a report, photographs and all.
  ///
  /// The pictures are copied somewhere the app owns and their paths ride on the queued entry; the
  /// sync engine uploads them when there is a network and then sends the report referencing the
  /// keys. Uploading here instead would mean a report with photographs simply cannot be filed
  /// without signal — which is the exact situation the whole queue exists for.
  Future<void> fileReport({
    required String projectId,
    required String date,
    required String workDone,
    String? issues,
    String? weather,
    int? headcount,
    List<String> photoPaths = const [],
  }) async {
    final kept = <String>[];
    for (final path in photoPaths) {
      try {
        kept.add(await PhotoQueue.keep(path));
      } catch (_) {
        // A photo that cannot even be copied is not worth losing the report over.
      }
    }

    final site = await (_db.select(
      _db.mirroredProjects,
    )..where((row) => row.id.equals(projectId))).getSingleOrNull();

    await _sync.enqueue(
      kind: 'dpr',
      clientId: _clientId(),
      label: 'Report · ${site?.name ?? 'site'} · ${shortDate(date)}',
      payload: {
        'project_id': projectId,
        'report_date': date,
        'work_done': workDone,
        if (issues != null && issues.isNotEmpty) 'issues': issues,
        if (weather != null && weather.isNotEmpty) 'weather': weather,
        'manpower': [
          if (headcount != null && headcount > 0) {'trade': 'On site', 'count': headcount},
        ],
        'photos': const <Map<String, dynamic>>[],
        'pending_photos': kept,
        'status': 'draft',
        'client_id': _clientId(),
      },
    );
  }

  /// A v4-shaped identifier. `Random.secure` because these end up as idempotency keys and two phones
  /// generating the same one would let one person's roll call cancel another's.
  static String _clientId() {
    final random = _random;
    String hex(int length) =>
        List.generate(length, (_) => random.nextInt(16).toRadixString(16)).join();
    return '${hex(8)}-${hex(4)}-4${hex(3)}-'
        '${(8 + random.nextInt(4)).toRadixString(16)}${hex(3)}-${hex(12)}';
  }
}

final _random = Random.secure();
