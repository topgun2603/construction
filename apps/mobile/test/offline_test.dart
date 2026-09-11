import 'dart:convert';
import 'dart:io';

import 'package:buildr_mobile/core/api_client.dart';
import 'package:buildr_mobile/core/db/database.dart';
import 'package:buildr_mobile/core/db/offline_repository.dart';
import 'package:buildr_mobile/core/db/photo_queue.dart';
import 'package:buildr_mobile/core/db/sync.dart';
import 'package:buildr_mobile/core/session.dart';
import 'package:dio/dio.dart';
import 'package:drift/native.dart';
import 'package:flutter_test/flutter_test.dart';

/// A session store that never reaches the keystore, so these run on the Dart VM with no device.
class _NoSession extends SessionStore {
  @override
  Future<TokenPair?> readTokens() async => null;

  @override
  Future<void> writeTokens(TokenPair tokens) async {}

  @override
  Future<Map<String, dynamic>?> readMe() async => null;

  @override
  Future<void> writeMe(Map<String, dynamic> me) async {}

  @override
  Future<String> deviceId() async => 'test-device';

  @override
  Future<void> clear() async {}
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  late AppDatabase db;
  final engines = <SyncEngine>[];

  setUp(() {
    db = AppDatabase.forTesting(NativeDatabase.memory());
  });

  tearDown(() async {
    // Enqueuing kicks off a send. Closing the database while one is in flight is the test harness
    // pulling the floor out, not a bug in the engine — wait for it the way shutdown does.
    for (final engine in engines) {
      await engine.settled;
    }
    engines.clear();
    await db.close();
  });

  /// A repository over the shared database, with its engine registered for teardown.
  OfflineRepository repositoryOn(ApiClient api) {
    final engine = SyncEngine(db: db, api: api);
    engines.add(engine);
    return OfflineRepository(db: db, api: api, sync: engine);
  }

  /// The API, with the network taken away — every request fails the way it does in a basement.
  ApiClient offlineApi() {
    final dio = Dio();
    dio.httpClientAdapter = _DeadAdapter();
    return ApiClient(store: _NoSession(), dio: dio);
  }

  /// The API, accepting everything.
  ApiClient workingApi(List<String> seen) {
    final dio = Dio();
    dio.httpClientAdapter = _RecordingAdapter(seen);
    return ApiClient(store: _NoSession(), dio: dio);
  }

  group('the roll call is for one site', () {
    test('lists the crew assigned to it, not the whole firm', () async {
      final repository = repositoryOn(offlineApi());

      await db.batch((batch) {
        batch.insertAll(db.mirroredWorkers, [
          MirroredWorkersCompanion.insert(id: 'w1', name: 'Arun V'),
          MirroredWorkersCompanion.insert(id: 'w2', name: 'Selvam P'),
          MirroredWorkersCompanion.insert(id: 'w3', name: 'Ganesh T'),
        ]);
        // w1 and w2 are on this site; w3 is at the other job.
        batch.insertAll(db.mirroredWorkerSites, [
          MirroredWorkerSitesCompanion.insert(workerId: 'w1', projectId: 'site-1'),
          MirroredWorkerSitesCompanion.insert(workerId: 'w2', projectId: 'site-1'),
          MirroredWorkerSitesCompanion.insert(workerId: 'w3', projectId: 'site-2'),
        ]);
      });

      final crew = await repository.rollCall(projectId: 'site-1', date: '2026-09-10');

      // Marking the whole firm present from one site is somebody at another job being paid for a
      // day they did not work.
      expect(crew.map((worker) => worker.id), ['w1', 'w2']);
    });

    test('keeps somebody already marked here, even before the crew list arrives', () async {
      final repository = repositoryOn(offlineApi());
      await db
          .into(db.mirroredWorkers)
          .insert(MirroredWorkersCompanion.insert(id: 'w9', name: 'Mani S'));

      await repository.saveRollCall(
        projectId: 'site-1',
        date: '2026-09-10',
        marks: {'w9': 'present'},
      );

      // No assignment row has ever reached this phone, but a supervisor marked them here — which
      // is itself the statement that they are on this site.
      final crew = await repository.rollCall(projectId: 'site-1', date: '2026-09-10');
      expect(crew.single.id, 'w9');
      expect(crew.single.status, 'present');
    });
  });

  group('the roll call with no signal', () {
    test('is saved on the phone and queued to send', () async {
      final api = offlineApi();
      final repository = repositoryOn(api);

      await db
          .into(db.mirroredProjects)
          .insert(MirroredProjectsCompanion.insert(id: 'site-1', name: 'Lakeview Tower'));
      await db
          .into(db.mirroredWorkers)
          .insert(MirroredWorkersCompanion.insert(id: 'w1', name: 'Arun V'));

      await repository.saveRollCall(
        projectId: 'site-1',
        date: '2026-09-10',
        marks: {'w1': 'present'},
      );

      // On screen immediately, marked as not yet sent.
      final crew = await repository.rollCall(projectId: 'site-1', date: '2026-09-10');
      expect(crew, hasLength(1));
      expect(crew.single.status, 'present');
      expect(crew.single.unsent, isTrue);

      // And still in the queue, because nothing could send it.
      final queued = await db.select(db.outbox).get();
      expect(queued, hasLength(1));
      expect(queued.single.kind, 'attendance');
      expect(queued.single.blocked, isFalse, reason: 'a dead network is temporary, not a refusal');
    });

    test('survives the app being closed and reopened', () async {
      final api = offlineApi();
      final repository = repositoryOn(api);
      await db
          .into(db.mirroredWorkers)
          .insert(MirroredWorkersCompanion.insert(id: 'w1', name: 'Arun V'));
      await repository.saveRollCall(
        projectId: 'site-1',
        date: '2026-09-10',
        marks: {'w1': 'half_day'},
      );

      // A new engine and repository over the same file is what a cold start looks like.
      final second = repositoryOn(api);
      final crew = await second.rollCall(projectId: 'site-1', date: '2026-09-10');
      expect(crew.single.status, 'half_day');
      expect(await db.select(db.outbox).get(), hasLength(1));
    });

    test('carries a client id per worker, so a retry cannot double-mark anybody', () async {
      final api = offlineApi();
      final repository = repositoryOn(api);
      await repository.saveRollCall(
        projectId: 'site-1',
        date: '2026-09-10',
        marks: {'w1': 'present', 'w2': 'absent'},
      );

      final entry = (await db.select(db.outbox).get()).single;
      final rows = (jsonDecode(entry.payload) as Map)['rows'] as List<dynamic>;
      final ids = rows.map((row) => (row as Map)['client_id']).toSet();
      expect(ids, hasLength(2), reason: 'two workers, two keys');
      expect(ids.every((id) => id != null && (id as String).length == 36), isTrue);
    });
  });

  group('the queue', () {
    test('empties when the network comes back', () async {
      final offline = offlineApi();
      final repository = repositoryOn(offline);
      await repository.saveRollCall(
        projectId: 'site-1',
        date: '2026-09-10',
        marks: {'w1': 'present'},
      );
      expect(await db.select(db.outbox).get(), hasLength(1));

      final seen = <String>[];
      final engine = SyncEngine(db: db, api: workingApi(seen));
      engines.add(engine);
      await engine.drain();

      expect(await db.select(db.outbox).get(), isEmpty, reason: 'accepted work leaves the queue');
      expect(seen, contains('/attendance'));
    });

    test('keeps a refusal instead of dropping it', () async {
      final dio = Dio();
      dio.httpClientAdapter = _RefusingAdapter(422, 'attendance_date is in the future');
      final api = ApiClient(store: _NoSession(), dio: dio);
      final engine = SyncEngine(db: db, api: api);
      engines.add(engine);
      final repository = OfflineRepository(db: db, api: api, sync: engine);

      await repository.saveRollCall(
        projectId: 'site-1',
        date: '2099-01-01',
        marks: {'w1': 'present'},
      );
      await engine.drain();

      final entry = (await db.select(db.outbox).get()).single;
      // Still here, flagged, with the reason — a person has to fix this, and nothing they marked
      // has been thrown away in the meantime.
      expect(entry.blocked, isTrue);
      expect(entry.lastError, contains('future'));
      expect(engine.state.blocked, 1);
    });

    test('waits rather than blocking when the server is simply unreachable', () async {
      final api = offlineApi();
      final engine = SyncEngine(db: db, api: api);
      engines.add(engine);
      final repository = OfflineRepository(db: db, api: api, sync: engine);

      await repository.saveRollCall(
        projectId: 'site-1',
        date: '2026-09-10',
        marks: {'w1': 'present'},
      );
      await engine.drain();

      final entry = (await db.select(db.outbox).get()).single;
      expect(entry.blocked, isFalse);
      expect(entry.attempts, greaterThan(0));
    });

    test('sending one batch does not mark a later one as sent', () async {
      // The bug this exists for: mark some people, mark more before the first batch leaves, and the
      // second batch must keep showing as unsent until it actually goes. Attendance is what wages
      // are worked out from, so "looks sent but is not" is the worst possible state.
      final offline = offlineApi();
      final first = repositoryOn(offline);
      for (final id in ['w1', 'w2']) {
        await db
            .into(db.mirroredWorkers)
            .insert(MirroredWorkersCompanion.insert(id: id, name: 'Worker $id'));
      }

      await first.saveRollCall(projectId: 'site-1', date: '2026-09-10', marks: {'w1': 'present'});
      await first.saveRollCall(projectId: 'site-1', date: '2026-09-10', marks: {'w2': 'present'});
      expect(await db.select(db.outbox).get(), hasLength(2));

      // A network that accepts exactly one request and then dies, so only the first entry goes.
      final flaky = ApiClient(store: _NoSession(), dio: Dio()..httpClientAdapter = _OnceAdapter());
      final engine = SyncEngine(db: db, api: flaky);
      engines.add(engine);
      await engine.drain();

      expect(await db.select(db.outbox).get(), hasLength(1), reason: 'one sent, one still waiting');

      final crew = await repositoryOn(offline).rollCall(projectId: 'site-1', date: '2026-09-10');
      final w1 = crew.firstWhere((worker) => worker.id == 'w1');
      final w2 = crew.firstWhere((worker) => worker.id == 'w2');
      expect(w1.unsent, isFalse, reason: 'this one reached the server');
      expect(w2.unsent, isTrue, reason: 'this one is still queued and must still say so');
    });
  });

  test('a report queued with photos uploads them before it sends', () async {
    // A real file, because the queue copies bytes and the uploader reads them back.
    final scratch = await Directory.systemTemp.createTemp('buildr-photo');
    final kept = await Directory('${scratch.path}/kept').create();
    PhotoQueue.storageDirectory = () async => kept;
    final photo = File('${scratch.path}/site.jpg')..writeAsBytesSync(List.filled(64, 7));

    final api = offlineApi();
    final repository = repositoryOn(api);
    await repository.fileReport(
      projectId: 'site-1',
      date: '2026-09-10',
      workDone: 'Slab poured',
      photoPaths: [photo.path],
    );

    final queued = (await db.select(db.outbox).get()).single;
    final payload = jsonDecode(queued.payload) as Map<String, dynamic>;
    // Filing did not need the network, and the photo is on the entry rather than lost.
    expect((payload['pending_photos'] as List).single, isNot(photo.path));
    expect(
      File((payload['pending_photos'] as List).single as String).existsSync(),
      isTrue,
      reason: 'copied somewhere the OS will not reclaim overnight',
    );

    // With a network, the photo goes up first and the report follows.
    final seen = <String>[];
    final engine = SyncEngine(db: db, api: workingApi(seen));
    engines.add(engine);
    await engine.drain();

    expect(
      seen.indexOf('/uploads/presign') < seen.indexOf('/dpr'),
      isTrue,
      reason: 'a report must never reference a photo that is not in storage yet',
    );
    expect(seen, contains('/dpr'));
    expect(await db.select(db.outbox).get(), isEmpty);

    await scratch.delete(recursive: true);
  });

  test('a report filed offline is queued whole', () async {
    final api = offlineApi();
    final repository = repositoryOn(api);
    await db
        .into(db.mirroredProjects)
        .insert(MirroredProjectsCompanion.insert(id: 'site-1', name: 'Lakeview Tower'));

    await repository.fileReport(
      projectId: 'site-1',
      date: '2026-09-10',
      workDone: 'Second floor slab poured',
      issues: 'Drizzle stopped work for an hour',
      headcount: 24,
    );

    final entry = (await db.select(db.outbox).get()).single;
    expect(entry.kind, 'dpr');
    expect(entry.label, contains('Lakeview Tower'));
    final payload = jsonDecode(entry.payload) as Map<String, dynamic>;
    expect(payload['work_done'], 'Second floor slab poured');
    expect(payload['pending_photos'], isEmpty);
    expect((payload['manpower'] as List).single, {'trade': 'On site', 'count': 24});
    expect(payload['client_id'], isNotNull);
  });
}

/// Accepts the first request and then behaves like the signal dropped again.
class _OnceAdapter implements HttpClientAdapter {
  int _served = 0;

  @override
  void close({bool force = false}) {}

  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<List<int>>? stream,
    Future<void>? cancelFuture,
  ) async {
    if (_served++ > 0) {
      throw DioException.connectionError(requestOptions: options, reason: 'signal gone');
    }
    return ResponseBody.fromString(
      jsonEncode({'ok': true}),
      200,
      headers: {
        Headers.contentTypeHeader: [Headers.jsonContentType],
      },
    );
  }
}

/// Every request fails at the socket, the way it does with no signal.
class _DeadAdapter implements HttpClientAdapter {
  @override
  void close({bool force = false}) {}

  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<List<int>>? stream,
    Future<void>? cancelFuture,
  ) {
    throw DioException.connectionError(requestOptions: options, reason: 'no route to host');
  }
}

/// Accepts everything and remembers what it was asked for.
class _RecordingAdapter implements HttpClientAdapter {
  _RecordingAdapter(this.seen);

  final List<String> seen;

  @override
  void close({bool force = false}) {}

  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<List<int>>? stream,
    Future<void>? cancelFuture,
  ) async {
    seen.add(options.path);
    // A presign answers with somewhere to put the bytes; everything else just succeeds.
    final body = options.path.endsWith('/uploads/presign')
        ? {
            'url': 'https://storage.example/put/object',
            's3_key': 'tenant/dpr_photo/p/site-1/202609/one.jpg',
            'headers': {'Content-Type': 'image/jpeg'},
          }
        : {'id': 'created-1'};
    return ResponseBody.fromString(
      jsonEncode(body),
      200,
      headers: {
        Headers.contentTypeHeader: [Headers.jsonContentType],
      },
    );
  }
}

/// Refuses everything with the given status, the way a validation error does.
class _RefusingAdapter implements HttpClientAdapter {
  _RefusingAdapter(this.status, this.message);

  final int status;
  final String message;

  @override
  void close({bool force = false}) {}

  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<List<int>>? stream,
    Future<void>? cancelFuture,
  ) async {
    return ResponseBody.fromString(
      jsonEncode({'message': message}),
      status,
      headers: {
        Headers.contentTypeHeader: [Headers.jsonContentType],
      },
    );
  }
}
