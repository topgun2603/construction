import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'api_client.dart';
import 'auth_controller.dart';
import 'db/database.dart';
import 'db/offline_repository.dart';
import 'db/sync.dart';
import 'format.dart';

/// Every read the app makes, in one place.
///
/// They are `autoDispose` so leaving a screen stops holding its data, and refetch on return — a
/// supervisor coming back to the roll call after ten minutes on another screen must not be marking
/// attendance against a stale list of workers.
///
/// Nothing here decides who may see what. The API scopes every one of these to the caller, and the
/// screens gate their *controls* on the same permissions the API enforces, so the two can only
/// disagree by someone editing both.

List<Map<String, dynamic>> _items(dynamic payload) {
  final list = (payload as Map)['items'] as List<dynamic>? ?? const [];
  return list.map((row) => Map<String, dynamic>.from(row as Map)).toList(growable: false);
}

Map<String, dynamic> _object(dynamic payload) => Map<String, dynamic>.from(payload as Map);

/// The phone's own database. One for the life of the process.
final databaseProvider = Provider<AppDatabase>((ref) {
  final db = AppDatabase();
  ref.onDispose(db.close);
  return db;
});

/// The outbox drain. Started once, when the app first asks for it.
final syncEngineProvider = Provider<SyncEngine>((ref) {
  final engine = SyncEngine(db: ref.watch(databaseProvider), api: ref.watch(apiClientProvider));
  unawaited(engine.start());
  ref.onDispose(() => unawaited(engine.dispose()));
  return engine;
});

/// What the queue is doing, for the banner.
final syncStateProvider = StreamProvider<SyncState>((ref) async* {
  final engine = ref.watch(syncEngineProvider);
  // The value it holds right now first: a bare stream leaves the banner blank until the queue
  // happens to change, which on a working phone might be never.
  yield engine.state;
  yield* engine.changes;
});

final offlineRepositoryProvider = Provider<OfflineRepository>(
  (ref) => OfflineRepository(
    db: ref.watch(databaseProvider),
    api: ref.watch(apiClientProvider),
    sync: ref.watch(syncEngineProvider),
  ),
);

/// The crew for one site on one day, answered from the phone.
final rollCallProvider = FutureProvider.autoDispose.family<List<RollCallWorker>, RollCallKey>((
  ref,
  key,
) async {
  final repository = ref.watch(offlineRepositoryProvider);
  return repository.rollCall(projectId: key.projectId, date: key.date);
});

/// The sites the phone knows about, refreshed in the background.
final offlineSitesProvider = FutureProvider.autoDispose<List<MirroredProject>>((ref) async {
  final repository = ref.watch(offlineRepositoryProvider);
  final cached = await repository.sites();
  if (cached.isEmpty) {
    // Nothing on disk yet: this is a first run, and waiting for the network is the only option.
    await repository.refreshReferenceData();
    return repository.sites();
  }
  // Show what we have, then bring it up to date for next time.
  unawaited(repository.refreshReferenceData());
  return cached;
});

/// `GET /dashboard/overview` — the numbers the home screen leads with.
final overviewProvider = FutureProvider.autoDispose<Map<String, dynamic>>((ref) async {
  final api = ref.watch(apiClientProvider);
  return _object(await api.get('/dashboard/overview'));
});

/// `GET /dashboard/today` — today's reports and what is waiting on somebody.
final todayProvider = FutureProvider.autoDispose<Map<String, dynamic>>((ref) async {
  final api = ref.watch(apiClientProvider);
  return _object(await api.get('/dashboard/today'));
});

final sitesProvider = FutureProvider.autoDispose<List<Map<String, dynamic>>>((ref) async {
  final api = ref.watch(apiClientProvider);
  return _items(await api.get('/projects', query: {'limit': 100}));
});

final siteProvider = FutureProvider.autoDispose.family<Map<String, dynamic>, String>((
  ref,
  id,
) async {
  final api = ref.watch(apiClientProvider);
  return _object(await api.get('/projects/$id'));
});

final milestonesProvider = FutureProvider.autoDispose.family<List<Map<String, dynamic>>, String>((
  ref,
  id,
) async {
  final api = ref.watch(apiClientProvider);
  final rows = await api.get('/projects/$id/milestones') as List<dynamic>;
  return rows.map((row) => Map<String, dynamic>.from(row as Map)).toList(growable: false);
});

final siteMembersProvider = FutureProvider.autoDispose.family<List<Map<String, dynamic>>, String>((
  ref,
  id,
) async {
  final api = ref.watch(apiClientProvider);
  final rows = await api.get('/projects/$id/members') as List<dynamic>;
  return rows.map((row) => Map<String, dynamic>.from(row as Map)).toList(growable: false);
});

final workersProvider = FutureProvider.autoDispose<List<Map<String, dynamic>>>((ref) async {
  final api = ref.watch(apiClientProvider);
  return _items(await api.get('/workers', query: {'limit': 200}));
});

/// The roll call for one site on one day.
class RollCallKey {
  const RollCallKey(this.projectId, this.date);

  final String projectId;
  final String date;

  @override
  bool operator ==(Object other) =>
      other is RollCallKey && other.projectId == projectId && other.date == date;

  @override
  int get hashCode => Object.hash(projectId, date);
}

/// Everyone who supplies labour. Gangs are how a site thinks about people, so this sits beside the
/// worker list rather than in a settings corner.
final contractorsProvider = FutureProvider.autoDispose<List<Map<String, dynamic>>>((ref) async {
  final api = ref.watch(apiClientProvider);
  return _items(await api.get('/contractors', query: {'limit': 200}));
});

/// Money paid to labour — advances, wages, bonuses — newest first.
final paymentsProvider = FutureProvider.autoDispose<List<Map<String, dynamic>>>((ref) async {
  final api = ref.watch(apiClientProvider);
  return _items(await api.get('/labour-payments', query: {'limit': 100}));
});

/// One worker's account: what they have earned, what they have drawn, what is left.
final workerLedgerProvider = FutureProvider.autoDispose.family<Map<String, dynamic>, String>((
  ref,
  workerId,
) async {
  final api = ref.watch(apiClientProvider);
  return _object(await api.get('/workers/$workerId/ledger'));
});

/// Thirty days of spend, grouped by category — the figures the expenses tiles are drawn from.
final expenseSummaryProvider = FutureProvider.autoDispose<Map<String, dynamic>>((ref) async {
  final api = ref.watch(apiClientProvider);
  return _object(await api.get('/expenses/summary'));
});

final attendanceProvider = FutureProvider.autoDispose.family<Map<String, dynamic>, RollCallKey>((
  ref,
  key,
) async {
  final api = ref.watch(apiClientProvider);
  return _object(
    await api.get('/attendance', query: {'project_id': key.projectId, 'date': key.date}),
  );
});

final dprProvider = FutureProvider.autoDispose<List<Map<String, dynamic>>>((ref) async {
  final api = ref.watch(apiClientProvider);
  return _items(await api.get('/dpr', query: {'limit': 30}));
});

final indentsProvider = FutureProvider.autoDispose<List<Map<String, dynamic>>>((ref) async {
  final api = ref.watch(apiClientProvider);
  return _items(await api.get('/indents', query: {'limit': 50}));
});

final expensesProvider = FutureProvider.autoDispose<List<Map<String, dynamic>>>((ref) async {
  final api = ref.watch(apiClientProvider);
  return _items(await api.get('/expenses', query: {'limit': 50}));
});

final materialsProvider = FutureProvider.autoDispose<List<Map<String, dynamic>>>((ref) async {
  final api = ref.watch(apiClientProvider);
  return _items(await api.get('/materials', query: {'limit': 200}));
});

final stockProvider = FutureProvider.autoDispose.family<Map<String, dynamic>, String>((
  ref,
  projectId,
) async {
  final api = ref.watch(apiClientProvider);
  return _object(await api.get('/stock', query: {'project_id': projectId}));
});

/// The photos and videos on a site, in the order somebody arranged them.
final siteMediaProvider = FutureProvider.autoDispose.family<List<Map<String, dynamic>>, String>((
  ref,
  id,
) async {
  final api = ref.watch(apiClientProvider);
  final rows = await api.get('/projects/$id/media') as List<dynamic>;
  return rows.map((row) => Map<String, dynamic>.from(row as Map)).toList(growable: false);
});

/// A short-lived URL for one stored object.
///
/// Signed on demand rather than baked into the list response: the objects are private, the URL
/// expires, and a link that leaks stops working instead of becoming a permanent window into
/// somebody's site. Kept alive for the session so scrolling a gallery back and forth does not
/// re-sign the same photo every time it comes on screen.
final viewUrlProvider = FutureProvider.family<String, String>((ref, s3Key) async {
  final api = ref.watch(apiClientProvider);
  final payload = await api.post('/uploads/view', body: {'s3_key': s3Key});
  return _object(payload)['url'] as String;
});

/// The conversation on one site.
///
/// The API answers newest first so it can page backwards; the screen reverses it, because that is
/// what a thread reads as. What comes back is already filtered — a client is never sent the team's
/// notes, so there is nothing here for the phone to hide.
final siteMessagesProvider = FutureProvider.autoDispose
    .family<SiteThread, String>((ref, projectId) async {
      final api = ref.watch(apiClientProvider);
      final payload = _object(
        await api.get('/projects/$projectId/messages', query: {'limit': 100}),
      );
      return SiteThread(
        messages: _items(payload),
        unread: (payload['unread_count'] as num?)?.toInt() ?? 0,
      );
    });

/// One site's conversation, and how much of it this person has not seen.
class SiteThread {
  const SiteThread({required this.messages, required this.unread});

  final List<Map<String, dynamic>> messages;
  final int unread;
}

/// Who can be written to privately on this site.
///
/// The people on the job, plus the owners and accounts staff who see every job without being
/// assigned to one — a supervisor wanting a word with the owner should not first have to be told
/// to add them to the site.
final messageRecipientsProvider = FutureProvider.autoDispose
    .family<List<Map<String, dynamic>>, String>((ref, projectId) async {
      final api = ref.watch(apiClientProvider);
      return _items(await api.get('/projects/$projectId/messages/recipients'));
    });

/// Drawings, contracts and approvals — one site's, or every site this person is on.
///
/// The newest revision of each, which is what "the slab drawing" means. A client gets only what
/// somebody deliberately shared; that filter lives in the API and must not be re-stated here.
final documentsProvider = FutureProvider.autoDispose
    .family<List<Map<String, dynamic>>, String?>((ref, projectId) async {
      final api = ref.watch(apiClientProvider);
      return _items(
        await api.get('/documents', query: {'project_id': ?projectId}),
      );
    });

final notificationsProvider = FutureProvider.autoDispose<List<Map<String, dynamic>>>((ref) async {
  final api = ref.watch(apiClientProvider);
  return _items(await api.get('/notifications', query: {'limit': 50}));
});

/// The unread count on the bell.
///
/// Read from `/me`, which the app already refreshes, rather than polling a count endpoint — a badge
/// is not worth a request of its own every thirty seconds on a site with one bar of signal.
final unreadCountProvider = Provider.autoDispose<int>((ref) {
  return ref.watch(authControllerProvider).me?.unreadNotifications ?? 0;
});

/// Writes.
///
/// Deliberately plain functions rather than a controller each: every one of them is "post this, then
/// invalidate what it changed", and wrapping that in a notifier per feature would be ceremony.
class Api {
  const Api(this._ref);

  final Ref _ref;

  ApiClient get _client => _ref.read(apiClientProvider);

  /// Starts a site. Returns its id, so the caller can open what it just made.
  ///
  /// Only the name is required. A job is often entered the day it is won, when the budget is still
  /// being argued over and the handover date is a hope — demanding those up front is how a site ends
  /// up recorded with invented figures, or not recorded at all.
  Future<String> createSite({
    required String name,
    String? clientName,
    String? address,
    String? budgetPaise,
    String? startDate,
    String? targetEndDate,
    String status = 'planning',
    double? lat,
    double? lng,
  }) async {
    final payload = await _client.post(
      '/projects',
      body: {
        'name': name,
        'status': status,
        if (clientName != null && clientName.isNotEmpty) 'client_name': clientName,
        if (address != null && address.isNotEmpty) 'address': address,
        if (budgetPaise != null && budgetPaise.isNotEmpty) 'budget_amount': budgetPaise,
        'start_date': ?startDate,
        'target_end_date': ?targetEndDate,
        // Both or neither: a latitude without a longitude is not half a location, it is a point in
        // the sea off West Africa — which is exactly what the map would then show.
        if (lat != null && lng != null) ...{'lat': lat, 'lng': lng},
      },
    );
    _ref.invalidate(sitesProvider);
    _ref.invalidate(overviewProvider);
    _ref.invalidate(todayProvider);
    return _object(payload)['id'] as String;
  }

  /// Everyone who brings labour to site. Used by the worker form and the contractor admin.
  Future<String> createWorker({
    required String name,
    required String dailyWage,
    String? phone,
    String? trade,
    String? contractorId,
    String skillLevel = 'unskilled',
    String? overtimeRate,
    String? projectId,
  }) async {
    final payload = await _client.post(
      '/workers',
      body: {
        'name': name,
        'daily_wage': dailyWage,
        'skill_level': skillLevel,
        if (phone != null && phone.isNotEmpty) 'phone': phone,
        if (trade != null && trade.isNotEmpty) 'trade': trade,
        'contractor_id': ?contractorId,
        if (overtimeRate != null && overtimeRate.isNotEmpty)
          'overtime_rate_per_hour': overtimeRate,
        // Assigned as they are created, so the roll call at the site they were hired for has them
        // the same morning rather than the next time somebody remembers.
        if (projectId != null) ...{'project_id': projectId, 'from_date': todayIso()},
      },
    );
    _invalidateLabour();
    return _object(payload)['id'] as String;
  }

  Future<void> updateWorker(String id, Map<String, dynamic> changes) async {
    await _client.patch('/workers/$id', body: changes);
    _invalidateLabour();
  }

  /// Takes somebody off the books. The server soft-deletes, so past attendance and wages stand.
  Future<void> removeWorker(String id) async {
    await _client.delete('/workers/$id');
    _invalidateLabour();
  }

  /// Puts a worker on a site from today, which is what makes them appear in its roll call.
  Future<void> assignWorker({
    required String workerId,
    required String projectId,
    String? fromDate,
  }) async {
    await _client.post(
      '/workers/$workerId/assign',
      body: {'project_id': projectId, 'from_date': fromDate ?? todayIso()},
    );
    _invalidateLabour();
  }

  /// Cash handed over on site: an advance against wages, a bonus, a deduction.
  ///
  /// The wage runs themselves are generated and finalised on the web — this is the money that
  /// changes hands between them, which is the half that happens standing in a site office.
  Future<void> recordPayment({
    required String type,
    required String amountPaise,
    required String paidOn,
    String mode = 'cash',
    String? workerId,
    String? contractorId,
    String? projectId,
    String? reference,
    String? note,
  }) async {
    await _client.post(
      '/labour-payments',
      body: {
        'type': type,
        'amount': amountPaise,
        'paid_on': paidOn,
        'mode': mode,
        'worker_id': ?workerId,
        'contractor_id': ?contractorId,
        'project_id': ?projectId,
        if (reference != null && reference.isNotEmpty) 'reference': reference,
        if (note != null && note.isNotEmpty) 'note': note,
      },
    );
    _ref.invalidate(paymentsProvider);
    _ref.invalidate(workerLedgerProvider);
    _ref.invalidate(overviewProvider);
  }

  Future<void> createContractor({
    required String name,
    String? trade,
    String? phone,
    String paymentTerms = 'weekly',
  }) async {
    await _client.post(
      '/contractors',
      body: {
        'name': name,
        'payment_terms': paymentTerms,
        if (trade != null && trade.isNotEmpty) 'trade': trade,
        if (phone != null && phone.isNotEmpty) 'phone': phone,
      },
    );
    _invalidateLabour();
  }

  Future<void> updateContractor(String id, Map<String, dynamic> changes) async {
    await _client.patch('/contractors/$id', body: changes);
    _invalidateLabour();
  }

  Future<void> removeContractor(String id) async {
    await _client.delete('/contractors/$id');
    _invalidateLabour();
  }

  /// Workers, contractors and the numbers drawn from them all move together: a worker added to a
  /// gang changes the gang's headcount and the day's wage bill in the same instant.
  void _invalidateLabour() {
    _ref.invalidate(workersProvider);
    _ref.invalidate(contractorsProvider);
    _ref.invalidate(rollCallProvider);
    _ref.invalidate(overviewProvider);
    _ref.invalidate(todayProvider);
  }

  /// Material in or out of a site store.
  Future<void> recordStockMovement({
    required String projectId,
    required String materialId,
    required String type,
    required String quantity,
    required String movedOn,
    String? reference,
    String? note,
  }) async {
    await _client.post(
      '/stock/movements',
      body: {
        'project_id': projectId,
        'material_id': materialId,
        'type': type,
        'quantity': quantity,
        'moved_on': movedOn,
        if (reference != null && reference.isNotEmpty) 'ref': reference,
        if (note != null && note.isNotEmpty) 'note': note,
      },
    );
    _ref.invalidate(stockProvider);
    _ref.invalidate(overviewProvider);
  }

  /// Corrects a bill already recorded. Only what somebody can still change: the server refuses
  /// once it has been approved, because an approved figure is one an owner has already seen.
  Future<void> updateExpense(String id, Map<String, dynamic> changes) async {
    await _client.patch('/expenses/$id', body: changes);
    _ref.invalidate(expensesProvider);
    _ref.invalidate(overviewProvider);
  }

  Future<void> removeExpense(String id) async {
    await _client.delete('/expenses/$id');
    _ref.invalidate(expensesProvider);
    _ref.invalidate(overviewProvider);
    _ref.invalidate(todayProvider);
  }

  /// Withdraws a request that has not been decided yet.
  Future<void> removeIndent(String id) async {
    await _client.delete('/indents/$id');
    _ref.invalidate(indentsProvider);
    _ref.invalidate(overviewProvider);
    _ref.invalidate(todayProvider);
  }

  /// What actually turned up against an indent.
  ///
  /// This is the moment stock exists: the receipt books the material into the site store, so a
  /// quantity entered here is a quantity the yard is then believed to hold.
  Future<void> receiveIndent(
    String id, {
    required List<Map<String, dynamic>> items,
    String? note,
  }) async {
    await _client.patch(
      '/indents/$id/receipt',
      body: {
        'items': items,
        if (note != null && note.isNotEmpty) 'note': note,
      },
    );
    _ref.invalidate(indentsProvider);
    _ref.invalidate(stockProvider);
    _ref.invalidate(overviewProvider);
  }

  /// A place name to coordinates, for the map picker.
  ///
  /// Goes through the API rather than straight to the geocoder: it is a free public service that
  /// asks for at most one request a second, and the server is where that budget is shared out.
  Future<List<Map<String, dynamic>>> geocode(String query) async {
    final payload = await _client.get('/geocode', query: {'q': query});
    final results = (payload as Map)['results'] as List<dynamic>? ?? const [];
    return results.map((row) => Map<String, dynamic>.from(row as Map)).toList(growable: false);
  }

  /// Records that a photo or video of the site exists, once its bytes are already in storage.
  ///
  /// Written after the upload rather than before, so a PUT that fails on a bad connection leaves
  /// nothing behind — an album row pointing at an object that was never stored is a permanently
  /// broken thumbnail nobody can delete from the phone.
  Future<void> addSiteMedia({
    required String projectId,
    required String s3Key,
    required String contentType,
    required int sizeBytes,
    String? caption,
  }) async {
    await _client.post(
      '/projects/$projectId/media',
      body: {
        'kind': contentType.startsWith('video/') ? 'video' : 'photo',
        's3_key': s3Key,
        'content_type': contentType,
        'size_bytes': sizeBytes,
        if (caption != null && caption.isNotEmpty) 'caption': caption,
      },
    );
    _ref.invalidate(siteMediaProvider);
    _ref.invalidate(sitesProvider);
  }

  Future<void> saveRollCall({
    required String projectId,
    required String date,
    required List<Map<String, dynamic>> rows,
  }) async {
    await _client.post(
      '/attendance',
      body: {'project_id': projectId, 'attendance_date': date, 'rows': rows},
    );
    _ref.invalidate(attendanceProvider);
    _ref.invalidate(overviewProvider);
    _ref.invalidate(todayProvider);
  }

  Future<void> fileReport({
    required String projectId,
    required String date,
    String? workDone,
    String? issues,
    String? weather,
    required List<Map<String, dynamic>> manpower,
    List<Map<String, dynamic>> photos = const [],
    bool submit = true,
  }) async {
    final created = await _client.post(
      '/dpr',
      body: {
        'project_id': projectId,
        'report_date': date,
        if (workDone != null && workDone.isNotEmpty) 'work_done': workDone,
        if (issues != null && issues.isNotEmpty) 'issues': issues,
        if (weather != null && weather.isNotEmpty) 'weather': weather,
        'manpower': manpower,
        'photos': photos,
        'status': 'draft',
      },
    );
    if (submit) {
      // Filing is two calls on purpose: the draft exists even if the second one never lands, so a
      // phone that dies mid-send has not lost the day's report.
      await _client.post('/dpr/${_object(created)['id']}/submit');
    }
    _ref.invalidate(dprProvider);
    _ref.invalidate(todayProvider);
    _ref.invalidate(overviewProvider);
  }

  Future<void> raiseIndent({
    required String projectId,
    required String urgency,
    String? notes,
    String? requiredBy,
    required List<Map<String, dynamic>> items,
  }) async {
    await _client.post(
      '/indents',
      body: {
        'project_id': projectId,
        'urgency': urgency,
        if (notes != null && notes.isNotEmpty) 'notes': notes,
        'required_by': ?requiredBy,
        'items': items,
      },
    );
    _ref.invalidate(indentsProvider);
    _ref.invalidate(overviewProvider);
  }

  Future<void> decideIndent(String id, String status, {String? note}) async {
    await _client.patch(
      '/indents/$id/status',
      body: {'status': status, if (note != null && note.isNotEmpty) 'note': note},
    );
    _ref.invalidate(indentsProvider);
    _ref.invalidate(overviewProvider);
    _ref.invalidate(todayProvider);
  }

  Future<void> recordExpense({
    required String projectId,
    required String amountPaise,
    required String category,
    required String spentOn,
    String? note,
  }) async {
    await _client.post(
      '/expenses',
      body: {
        'project_id': projectId,
        'amount': amountPaise,
        'category': category,
        'spent_on': spentOn,
        if (note != null && note.isNotEmpty) 'note': note,
      },
    );
    _ref.invalidate(expensesProvider);
    _ref.invalidate(overviewProvider);
  }

  Future<void> decideExpense(String id, String status) async {
    await _client.patch('/expenses/$id/decision', body: {'status': status});
    _ref.invalidate(expensesProvider);
    _ref.invalidate(overviewProvider);
    _ref.invalidate(todayProvider);
  }

  /// Says something on a site.
  ///
  /// [audience] is `everyone` or `team`. The API refuses `team` to anybody without
  /// `messages.internal` rather than quietly making it public, so the screen offers the choice only
  /// to people who have it — a note written believing it was private and then delivered to the
  /// client is the one failure this feature must not have.
  Future<void> postSiteMessage({
    required String projectId,
    required String body,
    String audience = 'everyone',
    String? recipientId,
    List<Map<String, dynamic>> attachments = const [],
    String? clientId,
  }) async {
    await _client.post(
      '/projects/$projectId/messages',
      body: {
        'body': body,
        'audience': audience,
        // Required for `direct` and refused on anything else; the API enforces both halves, so a
        // recipient left over from a previous send cannot turn a broadcast into a private message
        // or the other way round.
        'recipient_id': ?(audience == 'direct' ? recipientId : null),
        'attachments': attachments,
        'client_id': ?clientId,
      },
    );
    _ref.invalidate(siteMessagesProvider(projectId));
  }

  /// Marks this site's conversation read up to now.
  ///
  /// Failure is swallowed on purpose. This runs when somebody opens a thread, and an error toast
  /// about a receipt — over a message they are already reading — is noise about something they
  /// cannot act on. The watermark only moves forwards, so the next open sets it right.
  Future<void> markConversationRead(String projectId) async {
    try {
      await _client.post('/projects/$projectId/messages/read', body: const <String, dynamic>{});
      _ref.invalidate(siteMessagesProvider(projectId));
    } catch (_) {
      // Nothing to tell anybody about.
    }
  }

  /// Takes back something you said.
  ///
  /// The API allows your own, and a moderator anybody's — but either way only within half an hour
  /// of it being sent. Whether to offer the control at all comes from the message's own
  /// `can_delete`, never from comparing timestamps on the phone.
  Future<void> deleteSiteMessage({required String projectId, required String messageId}) async {
    await _client.delete('/messages/$messageId');
    _ref.invalidate(siteMessagesProvider(projectId));
  }

  /// Records a document once its bytes are already in storage.
  ///
  /// [supersedesId] files it as the next revision of an existing one, which then takes that
  /// document's name, category and sharing with it — a revision must not be able to rename a
  /// drawing into a contract, or quietly stop being shared with the client building to it.
  Future<void> addDocument({
    required String title,
    required String category,
    required String s3Key,
    required String contentType,
    required int sizeBytes,
    String? projectId,
    bool visibleToClient = false,
    String? supersedesId,
  }) async {
    await _client.post(
      '/documents',
      body: {
        'title': title,
        'category': category,
        's3_key': s3Key,
        'content_type': contentType,
        'size_bytes': sizeBytes,
        'visible_to_client': visibleToClient,
        'project_id': ?projectId,
        'supersedes_id': ?supersedesId,
      },
    );
    _invalidateDocuments(projectId);
  }

  /// Shares a document with the client, or stops sharing it.
  Future<void> setDocumentShared(String id, {required bool shared, String? projectId}) async {
    await _client.patch('/documents/$id', body: {'visible_to_client': shared});
    _invalidateDocuments(projectId);
  }

  /// Removes one revision. The stored file is kept — a drawing deleted by mistake is
  /// unrecoverable once the bytes are gone, and storage is cheap beside a document somebody signed.
  Future<void> removeDocument(String id, {String? projectId}) async {
    await _client.delete('/documents/$id');
    _invalidateDocuments(projectId);
  }

  void _invalidateDocuments(String? projectId) {
    _ref.invalidate(documentsProvider(null));
    if (projectId != null) _ref.invalidate(documentsProvider(projectId));
  }

  Future<void> markNotificationRead(String id) async {
    await _client.patch('/notifications/$id/read');
    _ref.invalidate(notificationsProvider);
    await _ref.read(authControllerProvider.notifier).refreshMe();
  }

  Future<void> markAllNotificationsRead() async {
    await _client.post('/notifications/read-all');
    _ref.invalidate(notificationsProvider);
    await _ref.read(authControllerProvider.notifier).refreshMe();
  }
}

final apiProvider = Provider<Api>(Api.new);

/// The date the app is working on — today, unless somebody picks another.
///
/// Shared between the roll call and the report form: a supervisor filing yesterday's paperwork
/// should not have to set the date twice and must not end up with attendance on one day and the
/// report on another.
final workingDateProvider = StateProvider<String>((ref) => todayIso());
