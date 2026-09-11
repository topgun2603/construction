import 'package:drift/drift.dart';
import 'package:drift_flutter/drift_flutter.dart';

part 'database.g.dart';

/// The phone's own copy of what it needs to work with no signal.
///
/// Two different kinds of table live here and it matters which is which:
///
///   * **Mirrors** — `MirroredProjects`, `MirroredWorkers`, `MirroredAttendance`. Copies of what
///     the server said, refreshed whenever a request succeeds. They are disposable: deleting them
///     loses nothing, because the server is the truth.
///
///   * **The outbox** — work this phone has done that the server has not accepted yet. This is
///     *not* disposable. A day's roll call marked in a basement exists only here until it sends,
///     and losing it means a worker is not paid for a day they worked.
///
/// Everything the outbox holds carries a `clientId`. The API treats that as an idempotency key, so
/// a request that succeeded on the server but whose response never came back can be retried without
/// marking anybody present twice.
@DataClassName('MirroredProject')
class MirroredProjects extends Table {
  TextColumn get id => text()();
  TextColumn get name => text()();
  TextColumn get clientName => text().nullable()();
  TextColumn get address => text().nullable()();
  TextColumn get status => text().withDefault(const Constant('planning'))();
  TextColumn get startDate => text().nullable()();
  TextColumn get targetEndDate => text().nullable()();
  TextColumn get budgetAmount => text().nullable()();
  RealColumn get lat => real().nullable()();
  RealColumn get lng => real().nullable()();

  @override
  Set<Column> get primaryKey => {id};
}

@DataClassName('MirroredWorker')
class MirroredWorkers extends Table {
  TextColumn get id => text()();
  TextColumn get name => text()();
  TextColumn get trade => text().nullable()();
  TextColumn get skillLevel => text().nullable()();
  TextColumn get status => text().withDefault(const Constant('active'))();
  TextColumn get contractorId => text().nullable()();
  TextColumn get contractorName => text().nullable()();
  TextColumn get dailyWage => text().nullable()();

  @override
  Set<Column> get primaryKey => {id};
}

/// Who is on which site.
///
/// The roll call is for a site, not for the company: a supervisor at Lakeview marking the whole
/// firm present is how somebody at another job gets a day's wage they did not earn. The server
/// answers this per site, and this is where that answer is kept so the phone can still narrow the
/// list with no signal.
@DataClassName('MirroredWorkerSite')
class MirroredWorkerSites extends Table {
  TextColumn get workerId => text()();
  TextColumn get projectId => text()();

  @override
  Set<Column> get primaryKey => {workerId, projectId};
}

/// One worker's mark for one site on one day.
///
/// Rows arrive two ways: mirrored from the server, or written here by the person holding the phone.
/// `pending` is which. A pending row wins on screen — the mark somebody just made is more current
/// than the one the server last told us about — and stays pending until its outbox entry is
/// accepted.
@DataClassName('MirroredAttendanceRow')
class MirroredAttendance extends Table {
  TextColumn get projectId => text()();
  TextColumn get date => text()();
  TextColumn get workerId => text()();
  TextColumn get status => text()();
  TextColumn get overtimeHours => text().withDefault(const Constant('0'))();
  BoolColumn get pending => boolean().withDefault(const Constant(false))();

  @override
  Set<Column> get primaryKey => {projectId, date, workerId};
}

/// Work waiting to reach the server.
@DataClassName('OutboxEntry')
class Outbox extends Table {
  IntColumn get id => integer().autoIncrement()();

  /// What kind of thing this is: `attendance`, `dpr`.
  TextColumn get kind => text()();

  /// The idempotency key the API deduplicates on.
  TextColumn get clientId => text()();

  /// The request body, as JSON.
  TextColumn get payload => text()();

  /// Something a person would recognise in a queue: "Roll call, Lakeview Tower, 10 Sep".
  TextColumn get label => text()();

  DateTimeColumn get createdAt => dateTime().withDefault(currentDateAndTime)();
  IntColumn get attempts => integer().withDefault(const Constant(0))();

  /// Why the last attempt failed, kept so the queue can explain itself rather than just sitting there.
  TextColumn get lastError => text().nullable()();

  /// Set when the server refused it in a way retrying cannot fix — a validation error, a permission
  /// it does not have. Those need a person, so they stop being retried and start being shown.
  BoolColumn get blocked => boolean().withDefault(const Constant(false))();
}

@DriftDatabase(
  tables: [MirroredProjects, MirroredWorkers, MirroredWorkerSites, MirroredAttendance, Outbox],
)
class AppDatabase extends _$AppDatabase {
  AppDatabase() : super(driftDatabase(name: 'buildr'));

  /// Only for tests, which pass an in-memory connection.
  AppDatabase.forTesting(super.executor);

  @override
  int get schemaVersion => 2;

  /// Mirrors may be rebuilt from the server, but the outbox may not — so upgrades add to the
  /// schema and never drop anything. A phone that upgrades holding an unsent roll call must still
  /// be holding it afterwards.
  @override
  MigrationStrategy get migration => MigrationStrategy(
    onCreate: (m) => m.createAll(),
    onUpgrade: (m, from, to) async {
      if (from < 2) await m.createTable(mirroredWorkerSites);
    },
  );
}
