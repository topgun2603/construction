import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api_client.dart';
import '../../core/api_providers.dart';
import '../../core/auth_controller.dart';
import '../../core/format.dart';
import '../../core/theme.dart';
import '../../shared/widgets.dart';

/// The labour on the books, grouped by who brings them.
///
/// Contractor first because that is how a site thinks about people: Kannan's steel gang arrives
/// together, is marked together, and is paid as one bill.
class WorkersScreen extends ConsumerStatefulWidget {
  const WorkersScreen({super.key});

  @override
  ConsumerState<WorkersScreen> createState() => _WorkersScreenState();
}

class _WorkersScreenState extends ConsumerState<WorkersScreen> {
  String _query = '';

  @override
  Widget build(BuildContext context) {
    final workers = ref.watch(workersProvider);
    final contractors = ref.watch(contractorsProvider);
    final me = ref.watch(authControllerProvider).me;
    final canSeeWages = me?.can('wages.view') ?? false;
    final canManage = me?.can('workers.manage') ?? false;

    return Scaffold(
      backgroundColor: Palette.canvas,
      floatingActionButton: canManage
          ? Padding(
              padding: EdgeInsets.only(bottom: fabInset(context)),
              child: FloatingActionButton.extended(
                backgroundColor: Palette.accent,
                foregroundColor: Colors.white,
                onPressed: () => _sheet(context, const _WorkerForm()),
                icon: const Icon(Icons.person_add_alt),
                label: const Text('Add worker'),
              ),
            )
          : null,
      body: Column(
      children: [
        const SizedBox(height: 12),
        _WorkerKpis(
          workers: workers.value ?? const [],
          contractors: contractors.value ?? const [],
          showMoney: canSeeWages,
        ),
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 12, 16, 8),
          child: TextField(
            onChanged: (value) => setState(() => _query = value.trim().toLowerCase()),
            decoration: const InputDecoration(
              hintText: 'Search by name, trade or contractor',
              prefixIcon: Icon(Icons.search, size: 20),
              contentPadding: EdgeInsets.symmetric(horizontal: 16, vertical: 14),
            ),
          ),
        ),
        Expanded(
          child: RefreshIndicator(
            onRefresh: () async {
              ref.invalidate(workersProvider);
              await ref.read(workersProvider.future);
            },
            child: AsyncSection<List<Map<String, dynamic>>>(
              value: workers,
              onRetry: () => ref.invalidate(workersProvider),
              builder: (rows) {
                final visible =
                    rows.where((worker) {
                      if (_query.isEmpty) return true;
                      final haystack = [
                        worker['name'],
                        worker['trade'],
                        worker['contractor_name'],
                      ].whereType<String>().join(' ').toLowerCase();
                      return haystack.contains(_query);
                    }).toList()..sort((a, b) {
                      final byContractor = (a['contractor_name'] as String? ?? '~').compareTo(
                        b['contractor_name'] as String? ?? '~',
                      );
                      if (byContractor != 0) return byContractor;
                      return (a['name'] as String? ?? '').compareTo(b['name'] as String? ?? '');
                    });

                if (visible.isEmpty) {
                  return ListView(
                    children: [
                      EmptyNote(
                        icon: Icons.groups_outlined,
                        title: _query.isEmpty ? 'Nobody on the books' : 'Nobody matches that',
                        body: _query.isEmpty
                            ? (canManage
                                  ? 'Add the first one with the button below — a name, a trade and '
                                        'what they are paid a day.'
                                  : 'Workers appear here as soon as somebody with the rights adds '
                                        'them.')
                            : 'Try part of a name, a trade like mason, or the contractor.',
                      ),
                    ],
                  );
                }

                String? lastContractor;
                return ListView.builder(
                  padding: EdgeInsets.only(bottom: bottomInset(context, hasFab: canManage)),
                  itemCount: visible.length,
                  itemBuilder: (context, index) {
                    final worker = visible[index];
                    final contractor = worker['contractor_name'] as String? ?? 'Direct labour';
                    final showHeader = contractor != lastContractor;
                    lastContractor = contractor;

                    return Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        if (showHeader)
                          Padding(
                            padding: const EdgeInsets.fromLTRB(16, 18, 16, 6),
                            child: Text(
                              contractor.toUpperCase(),
                              style: const TextStyle(
                                fontSize: 11.5,
                                fontWeight: FontWeight.w700,
                                letterSpacing: 1,
                                color: Palette.inkMuted,
                              ),
                            ),
                          ),
                        Material(
                          color: Palette.surface,
                          child: InkWell(
                            onTap: () => _sheet(context, _WorkerActions(worker: worker)),
                            child: Container(
                          margin: const EdgeInsets.only(bottom: 1),
                          padding: const EdgeInsets.fromLTRB(16, 12, 16, 12),
                          child: Row(
                            children: [
                              Expanded(
                                child: Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    Text(
                                      worker['name'] as String? ?? '',
                                      style: const TextStyle(
                                        fontSize: 15,
                                        fontWeight: FontWeight.w500,
                                      ),
                                    ),
                                    const SizedBox(height: 2),
                                    Text(
                                      [
                                        worker['trade'],
                                        titleCase(worker['skill_level'] as String? ?? ''),
                                      ].whereType<String>().where((s) => s.isNotEmpty).join(' · '),
                                      style: const TextStyle(
                                        fontSize: 12.5,
                                        color: Palette.inkMuted,
                                      ),
                                    ),
                                  ],
                                ),
                              ),
                              if (canSeeWages && worker['daily_wage'] != null)
                                Text(
                                  '${formatInr(worker['daily_wage'] as String)}/day',
                                  style: const TextStyle(
                                    fontSize: 13.5,
                                    fontWeight: FontWeight.w600,
                                  ),
                                ),
                              if (worker['status'] != 'active') ...[
                                const SizedBox(width: 8),
                                StatusPill(worker['status'] as String? ?? ''),
                              ],
                            ],
                          ),
                            ),
                          ),
                        ),
                      ],
                    );
                  },
                );
              },
            ),
          ),
        ),
      ],
      ),
    );
  }
}

/// Every sheet on this screen opens the same way.
void _sheet(BuildContext context, Widget child) => showModalBottomSheet<void>(
  context: context,
  isScrollControlled: true,
  backgroundColor: Palette.surface,
  shape: const RoundedRectangleBorder(
    borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
  ),
  builder: (_) => child,
);

/// The numbers the web page opens with, on a strip that scrolls.
class _WorkerKpis extends StatelessWidget {
  const _WorkerKpis({required this.workers, required this.contractors, required this.showMoney});

  final List<Map<String, dynamic>> workers;
  final List<Map<String, dynamic>> contractors;
  final bool showMoney;

  @override
  Widget build(BuildContext context) {
    final active = workers.where((w) => w['status'] == 'active').toList();
    final direct = active.where((w) => w['contractor_id'] == null).length;
    final dailyCost = active.fold(
      BigInt.zero,
      (sum, w) => sum + (BigInt.tryParse(w['daily_wage'] as String? ?? '') ?? BigInt.zero),
    );
    final trades = active
        .map((w) => w['trade'] as String?)
        .where((trade) => trade != null && trade.isNotEmpty)
        .toSet();

    return KpiStrip(
      tiles: [
        StatTile(
          label: 'Workers',
          value: '${workers.length}',
          note: '${active.length} active',
        ),
        StatTile(
          label: 'Contractors',
          value: '${contractors.length}',
          note: '$direct on direct labour',
        ),
        // The wage bill is not a supervisor's business, and in most companies they are not meant to
        // see it at all — the same rule the web page follows.
        if (showMoney)
          StatTile(
            label: 'Full-day cost',
            value: formatInrCompact(dailyCost.toString()),
            note: 'If everybody is present',
          ),
        StatTile(
          label: 'Work types',
          value: '${trades.length}',
          note: 'Kinds of work your crew can do',
        ),
      ],
    );
  }
}

/// What can be done to one worker, once you have tapped them.
///
/// A sheet rather than a detail screen: every one of these is a thirty-second job done standing up,
/// and pushing a page for each would bury them a level deeper than they deserve.
class _WorkerActions extends ConsumerWidget {
  const _WorkerActions({required this.worker});

  final Map<String, dynamic> worker;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final me = ref.watch(authControllerProvider).me;
    final canManage = me?.can('workers.manage') ?? false;
    final canPay = me?.can('payments.record') ?? false;
    final canRemove = me?.can('workers.delete') ?? false;
    final name = worker['name'] as String? ?? 'This worker';
    final active = worker['status'] == 'active';

    return SafeArea(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(20, 18, 20, 6),
            child: Row(
              children: [
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(name, style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w700)),
                      const SizedBox(height: 2),
                      Text(
                        [
                          worker['trade'],
                          worker['contractor_name'] ?? 'Direct labour',
                        ].whereType<String>().join(' · '),
                        style: const TextStyle(fontSize: 13, color: Palette.inkMuted),
                      ),
                    ],
                  ),
                ),
                if (!active) StatusPill(worker['status'] as String? ?? ''),
              ],
            ),
          ),
          const Divider(height: 18),
          if (canPay)
            ListTile(
              leading: const Icon(Icons.payments_outlined, color: Palette.accent),
              title: const Text('Record an advance'),
              subtitle: const Text('Cash handed over now, set against their wages'),
              onTap: () {
                Navigator.of(context).pop();
                showModalBottomSheet<void>(
                  context: context,
                  isScrollControlled: true,
                  backgroundColor: Palette.surface,
                  shape: const RoundedRectangleBorder(
                    borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
                  ),
                  builder: (_) => _AdvanceForm(worker: worker),
                );
              },
            ),
          if (canManage) ...[
            ListTile(
              leading: const Icon(Icons.edit_outlined, color: Palette.inkSoft),
              title: const Text('Edit details'),
              onTap: () {
                Navigator.of(context).pop();
                showModalBottomSheet<void>(
                  context: context,
                  isScrollControlled: true,
                  backgroundColor: Palette.surface,
                  shape: const RoundedRectangleBorder(
                    borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
                  ),
                  builder: (_) => _WorkerForm(existing: worker),
                );
              },
            ),
            ListTile(
              leading: const Icon(Icons.apartment_outlined, color: Palette.inkSoft),
              title: const Text('Assign to a site'),
              subtitle: const Text('From today, so the roll call has them'),
              onTap: () {
                Navigator.of(context).pop();
                showModalBottomSheet<void>(
                  context: context,
                  isScrollControlled: true,
                  backgroundColor: Palette.surface,
                  shape: const RoundedRectangleBorder(
                    borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
                  ),
                  builder: (_) => _AssignForm(worker: worker),
                );
              },
            ),
            ListTile(
              leading: Icon(
                active ? Icons.pause_circle_outline : Icons.play_circle_outline,
                color: Palette.inkSoft,
              ),
              title: Text(active ? 'Mark inactive' : 'Mark active'),
              subtitle: Text(
                active
                    ? 'Drops off roll calls and the wage bill, keeps their history'
                    : 'Back on the books',
              ),
              onTap: () async {
                final navigator = Navigator.of(context);
                final messenger = ScaffoldMessenger.of(context);
                await _run(messenger, () async {
                  await ref.read(apiProvider).updateWorker(worker['id'] as String, {
                    'status': active ? 'inactive' : 'active',
                  });
                });
                navigator.pop();
              },
            ),
          ],
          if (canRemove)
            ListTile(
              leading: const Icon(Icons.delete_outline, color: Palette.blocked),
              title: const Text('Remove', style: TextStyle(color: Palette.blocked)),
              subtitle: const Text('Past attendance and wages are kept'),
              onTap: () async {
                final navigator = Navigator.of(context);
                final messenger = ScaffoldMessenger.of(context);
                final sure = await confirm(
                  context,
                  title: 'Remove $name?',
                  body:
                      'They come off the books and out of every roll call from today. What they '
                      'have already worked and been paid stays on the record.',
                  danger: 'Remove',
                );
                if (!sure) return;
                await _run(messenger, () async {
                  await ref.read(apiProvider).removeWorker(worker['id'] as String);
                });
                navigator.pop();
              },
            ),
          const SizedBox(height: 8),
        ],
      ),
    );
  }
}

/// Runs a write and says what happened.
///
/// Takes the messenger rather than a context: both callers ask a question first, and a context held
/// across that await may belong to a widget that is already gone.
Future<void> _run(ScaffoldMessengerState messenger, Future<void> Function() action) async {
  try {
    await action();
    messenger.showSnackBar(const SnackBar(content: Text('Saved')));
  } on ApiException catch (error) {
    messenger.showSnackBar(
      SnackBar(content: Text(error.message), backgroundColor: Palette.blocked),
    );
  }
}

/// Adding somebody to the books, or correcting what is already there.
class _WorkerForm extends ConsumerStatefulWidget {
  const _WorkerForm({this.existing});

  final Map<String, dynamic>? existing;

  @override
  ConsumerState<_WorkerForm> createState() => _WorkerFormState();
}

class _WorkerFormState extends ConsumerState<_WorkerForm> {
  late final _name = TextEditingController(text: widget.existing?['name'] as String? ?? '');
  late final _phone = TextEditingController(text: widget.existing?['phone'] as String? ?? '');
  late final _trade = TextEditingController(text: widget.existing?['trade'] as String? ?? '');
  late final _wage = TextEditingController(text: _rupees(widget.existing?['daily_wage']));
  late final _overtime = TextEditingController(
    text: _rupees(widget.existing?['overtime_rate_per_hour']),
  );

  late String? _contractorId = widget.existing?['contractor_id'] as String?;
  late String _skill = widget.existing?['skill_level'] as String? ?? 'unskilled';
  String? _projectId;
  bool _saving = false;
  String? _error;

  bool get _editing => widget.existing != null;

  /// Paise back to whole rupees for the field, since that is what somebody typed in the first place.
  static String _rupees(Object? paise) {
    final value = BigInt.tryParse(paise as String? ?? '');
    if (value == null || value == BigInt.zero) return '';
    final whole = value ~/ BigInt.from(100);
    final rest = value % BigInt.from(100);
    return rest == BigInt.zero ? whole.toString() : '$whole.${rest.toString().padLeft(2, '0')}';
  }

  @override
  void dispose() {
    _name.dispose();
    _phone.dispose();
    _trade.dispose();
    _wage.dispose();
    _overtime.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final contractors = ref.watch(contractorsProvider);
    final sites = ref.watch(sitesProvider);

    return Padding(
      padding: EdgeInsets.only(bottom: MediaQuery.of(context).viewInsets.bottom),
      child: DraggableScrollableSheet(
        expand: false,
        initialChildSize: 0.88,
        maxChildSize: 0.95,
        builder: (context, controller) => ListView(
          controller: controller,
          padding: EdgeInsets.fromLTRB(20, 16, 20, 28 + systemBottomInset(context)),
          children: [
            Row(
              children: [
                Expanded(
                  child: Text(
                    _editing ? 'Edit worker' : 'Add worker',
                    style: const TextStyle(fontSize: 19, fontWeight: FontWeight.w700),
                  ),
                ),
                IconButton(
                  onPressed: () => Navigator.of(context).pop(),
                  icon: const Icon(Icons.close),
                ),
              ],
            ),
            const SizedBox(height: 12),
            const _FieldLabel('Name'),
            TextField(
              controller: _name,
              autofocus: !_editing,
              textCapitalization: TextCapitalization.words,
              style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w600),
              decoration: const InputDecoration(hintText: 'Raju M'),
            ),
            const SizedBox(height: 16),
            const _FieldLabel('Trade'),
            TextField(
              controller: _trade,
              textCapitalization: TextCapitalization.words,
              decoration: const InputDecoration(hintText: 'Mason'),
            ),
            const SizedBox(height: 16),
            const _FieldLabel('Phone'),
            TextField(
              controller: _phone,
              keyboardType: TextInputType.phone,
              decoration: const InputDecoration(prefixText: '+91  ', hintText: 'Optional'),
            ),
            const SizedBox(height: 16),
            const _FieldLabel('Daily wage'),
            TextField(
              controller: _wage,
              keyboardType: const TextInputType.numberWithOptions(decimal: true),
              decoration: const InputDecoration(prefixText: '₹ ', hintText: '850'),
            ),
            const SizedBox(height: 16),
            const _FieldLabel('Overtime, per hour'),
            TextField(
              controller: _overtime,
              keyboardType: const TextInputType.numberWithOptions(decimal: true),
              decoration: const InputDecoration(prefixText: '₹ ', hintText: '110'),
            ),
            const SizedBox(height: 16),
            const _FieldLabel('Skill'),
            DropdownButtonFormField<String>(
              initialValue: _skill,
              items: const [
                DropdownMenuItem(value: 'unskilled', child: Text('Unskilled')),
                DropdownMenuItem(value: 'semi', child: Text('Semi-skilled')),
                DropdownMenuItem(value: 'skilled', child: Text('Skilled')),
              ],
              onChanged: (value) => setState(() => _skill = value ?? 'unskilled'),
            ),
            const SizedBox(height: 16),
            const _FieldLabel('Contractor'),
            contractors.when(
              loading: () => const Loading(),
              error: (error, _) => ErrorNote(error: error),
              data: (rows) => DropdownButtonFormField<String?>(
                initialValue: rows.any((row) => row['id'] == _contractorId) ? _contractorId : null,
                items: [
                  const DropdownMenuItem<String?>(value: null, child: Text('Direct labour')),
                  for (final row in rows)
                    DropdownMenuItem<String?>(
                      value: row['id'] as String,
                      child: Text(row['name'] as String? ?? ''),
                    ),
                ],
                onChanged: (value) => setState(() => _contractorId = value),
              ),
            ),
            if (!_editing) ...[
              const SizedBox(height: 16),
              const _FieldLabel('Put them on a site'),
              sites.when(
                loading: () => const Loading(),
                error: (error, _) => ErrorNote(error: error),
                data: (rows) => DropdownButtonFormField<String?>(
                  initialValue: _projectId,
                  items: [
                    const DropdownMenuItem<String?>(value: null, child: Text('Not yet')),
                    for (final row in rows)
                      DropdownMenuItem<String?>(
                        value: row['id'] as String,
                        child: Text(row['name'] as String? ?? 'Site'),
                      ),
                  ],
                  onChanged: (value) => setState(() => _projectId = value),
                ),
              ),
              const Padding(
                padding: EdgeInsets.only(top: 6),
                child: Text(
                  'They show up in that site’s roll call from today.',
                  style: TextStyle(fontSize: 12, color: Palette.inkFaint),
                ),
              ),
            ],
            if (_error != null) ...[
              const SizedBox(height: 16),
              _FormError(_error!),
            ],
            const SizedBox(height: 22),
            FilledButton(
              onPressed: _saving ? null : _submit,
              child: _saving
                  ? const _Spinner()
                  : Text(_editing ? 'Save changes' : 'Add worker'),
            ),
          ],
        ),
      ),
    );
  }

  Future<void> _submit() async {
    final name = _name.text.trim();
    if (name.isEmpty) {
      setState(() => _error = 'Enter their name');
      return;
    }
    final wage = rupeesToPaise(_wage.text);
    if (wage == null || wage == '0') {
      setState(() => _error = 'Enter the daily wage in rupees, like 850');
      return;
    }
    final overtime = _overtime.text.trim().isEmpty ? '0' : rupeesToPaise(_overtime.text);
    if (overtime == null) {
      setState(() => _error = 'Enter the overtime rate in rupees, or leave it empty');
      return;
    }

    setState(() {
      _saving = true;
      _error = null;
    });
    try {
      final api = ref.read(apiProvider);
      if (_editing) {
        await api.updateWorker(widget.existing!['id'] as String, {
          'name': name,
          'trade': _trade.text.trim(),
          'skill_level': _skill,
          'daily_wage': wage,
          'overtime_rate_per_hour': overtime,
          'contractor_id': _contractorId,
          if (_phone.text.trim().isNotEmpty) 'phone': _phone.text.trim(),
        });
      } else {
        await api.createWorker(
          name: name,
          dailyWage: wage,
          phone: _phone.text.trim(),
          trade: _trade.text.trim(),
          contractorId: _contractorId,
          skillLevel: _skill,
          overtimeRate: overtime,
          projectId: _projectId,
        );
      }
      if (!mounted) return;
      Navigator.of(context).pop();
      notify(context, _editing ? 'Saved' : '$name added');
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() => _error = error.message);
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }
}

/// Cash handed over on site, against wages not yet run.
class _AdvanceForm extends ConsumerStatefulWidget {
  const _AdvanceForm({required this.worker});

  final Map<String, dynamic> worker;

  @override
  ConsumerState<_AdvanceForm> createState() => _AdvanceFormState();
}

class _AdvanceFormState extends ConsumerState<_AdvanceForm> {
  final _amount = TextEditingController();
  final _note = TextEditingController();

  String _type = 'advance';
  String _mode = 'cash';
  String _paidOn = todayIso();
  bool _saving = false;
  String? _error;

  @override
  void dispose() {
    _amount.dispose();
    _note.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final name = widget.worker['name'] as String? ?? 'this worker';

    return Padding(
      padding: EdgeInsets.only(bottom: MediaQuery.of(context).viewInsets.bottom),
      child: DraggableScrollableSheet(
        expand: false,
        initialChildSize: 0.8,
        maxChildSize: 0.95,
        builder: (context, controller) => ListView(
          controller: controller,
          padding: EdgeInsets.fromLTRB(20, 16, 20, 28 + systemBottomInset(context)),
          children: [
            Row(
              children: [
                Expanded(
                  child: Text(
                    'Pay $name',
                    style: const TextStyle(fontSize: 19, fontWeight: FontWeight.w700),
                  ),
                ),
                IconButton(
                  onPressed: () => Navigator.of(context).pop(),
                  icon: const Icon(Icons.close),
                ),
              ],
            ),
            const SizedBox(height: 12),
            const _FieldLabel('Amount'),
            TextField(
              controller: _amount,
              autofocus: true,
              keyboardType: const TextInputType.numberWithOptions(decimal: true),
              style: const TextStyle(fontSize: 22, fontWeight: FontWeight.w700),
              decoration: const InputDecoration(prefixText: '₹ ', hintText: '2,000'),
            ),
            const SizedBox(height: 16),
            const _FieldLabel('What it is'),
            DropdownButtonFormField<String>(
              initialValue: _type,
              items: const [
                DropdownMenuItem(value: 'advance', child: Text('Advance against wages')),
                DropdownMenuItem(value: 'bonus', child: Text('Bonus')),
                DropdownMenuItem(value: 'deduction', child: Text('Deduction')),
              ],
              onChanged: (value) => setState(() => _type = value ?? 'advance'),
            ),
            const SizedBox(height: 16),
            const _FieldLabel('How it was paid'),
            DropdownButtonFormField<String>(
              initialValue: _mode,
              items: const [
                DropdownMenuItem(value: 'cash', child: Text('Cash')),
                DropdownMenuItem(value: 'upi', child: Text('UPI')),
                DropdownMenuItem(value: 'bank', child: Text('Bank transfer')),
              ],
              onChanged: (value) => setState(() => _mode = value ?? 'cash'),
            ),
            const SizedBox(height: 16),
            const _FieldLabel('When'),
            OutlinedButton.icon(
              style: OutlinedButton.styleFrom(minimumSize: const Size.fromHeight(52)),
              onPressed: () async {
                final picked = await showDatePicker(
                  context: context,
                  initialDate: parseIsoDate(_paidOn) ?? DateTime.now(),
                  firstDate: DateTime.now().subtract(const Duration(days: 90)),
                  lastDate: DateTime.now(),
                );
                if (picked != null) setState(() => _paidOn = isoDate(picked));
              },
              icon: const Icon(Icons.calendar_today_outlined, size: 17),
              label: Text(_paidOn == todayIso() ? 'Today' : longDate(_paidOn)),
            ),
            const SizedBox(height: 16),
            const _FieldLabel('Note'),
            TextField(
              controller: _note,
              maxLines: 2,
              textCapitalization: TextCapitalization.sentences,
              decoration: const InputDecoration(hintText: 'Optional'),
            ),
            if (_error != null) ...[const SizedBox(height: 16), _FormError(_error!)],
            const SizedBox(height: 22),
            FilledButton(
              onPressed: _saving ? null : _submit,
              child: _saving ? const _Spinner() : const Text('Record'),
            ),
          ],
        ),
      ),
    );
  }

  Future<void> _submit() async {
    final amount = rupeesToPaise(_amount.text);
    if (amount == null || amount == '0') {
      setState(() => _error = 'Enter the amount in rupees, like 2000');
      return;
    }

    setState(() {
      _saving = true;
      _error = null;
    });
    try {
      await ref
          .read(apiProvider)
          .recordPayment(
            type: _type,
            amountPaise: amount,
            paidOn: _paidOn,
            mode: _mode,
            workerId: widget.worker['id'] as String,
            note: _note.text.trim(),
          );
      if (!mounted) return;
      Navigator.of(context).pop();
      notify(context, 'Recorded');
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() => _error = error.message);
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }
}

/// Putting a worker on a site, which is what a roll call reads.
class _AssignForm extends ConsumerStatefulWidget {
  const _AssignForm({required this.worker});

  final Map<String, dynamic> worker;

  @override
  ConsumerState<_AssignForm> createState() => _AssignFormState();
}

class _AssignFormState extends ConsumerState<_AssignForm> {
  String? _projectId;
  String _fromDate = todayIso();
  bool _saving = false;
  String? _error;

  @override
  Widget build(BuildContext context) {
    final sites = ref.watch(sitesProvider);
    final name = widget.worker['name'] as String? ?? 'this worker';

    return Padding(
      padding: EdgeInsets.only(bottom: MediaQuery.of(context).viewInsets.bottom),
      child: SafeArea(
        child: ListView(
          shrinkWrap: true,
          padding: EdgeInsets.fromLTRB(20, 16, 20, 28 + systemBottomInset(context)),
          children: [
            Row(
              children: [
                Expanded(
                  child: Text(
                    'Assign $name',
                    style: const TextStyle(fontSize: 19, fontWeight: FontWeight.w700),
                  ),
                ),
                IconButton(
                  onPressed: () => Navigator.of(context).pop(),
                  icon: const Icon(Icons.close),
                ),
              ],
            ),
            const SizedBox(height: 12),
            const _FieldLabel('Site'),
            sites.when(
              loading: () => const Loading(),
              error: (error, _) => ErrorNote(error: error),
              data: (rows) => DropdownButtonFormField<String>(
                initialValue: _projectId ?? (rows.isEmpty ? null : rows.first['id'] as String),
                items: [
                  for (final row in rows)
                    DropdownMenuItem(
                      value: row['id'] as String,
                      child: Text(row['name'] as String? ?? 'Site'),
                    ),
                ],
                onChanged: (value) => setState(() => _projectId = value),
              ),
            ),
            const SizedBox(height: 16),
            const _FieldLabel('From'),
            OutlinedButton.icon(
              style: OutlinedButton.styleFrom(minimumSize: const Size.fromHeight(52)),
              onPressed: () async {
                final picked = await showDatePicker(
                  context: context,
                  initialDate: parseIsoDate(_fromDate) ?? DateTime.now(),
                  firstDate: DateTime.now().subtract(const Duration(days: 365)),
                  lastDate: DateTime.now().add(const Duration(days: 365)),
                );
                if (picked != null) setState(() => _fromDate = isoDate(picked));
              },
              icon: const Icon(Icons.calendar_today_outlined, size: 17),
              label: Text(_fromDate == todayIso() ? 'Today' : longDate(_fromDate)),
            ),
            if (_error != null) ...[const SizedBox(height: 16), _FormError(_error!)],
            const SizedBox(height: 22),
            FilledButton(
              onPressed: _saving ? null : () => _submit(sites.value),
              child: _saving ? const _Spinner() : const Text('Assign'),
            ),
          ],
        ),
      ),
    );
  }

  Future<void> _submit(List<Map<String, dynamic>>? sites) async {
    final projectId = _projectId ?? (sites?.isNotEmpty == true ? sites!.first['id'] as String : null);
    if (projectId == null) {
      setState(() => _error = 'There is no site to assign them to yet');
      return;
    }

    setState(() {
      _saving = true;
      _error = null;
    });
    try {
      await ref
          .read(apiProvider)
          .assignWorker(
            workerId: widget.worker['id'] as String,
            projectId: projectId,
            fromDate: _fromDate,
          );
      if (!mounted) return;
      Navigator.of(context).pop();
      notify(context, 'Assigned');
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() => _error = error.message);
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }
}

class _FormError extends StatelessWidget {
  const _FormError(this.message);

  final String message;

  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
    decoration: BoxDecoration(color: Palette.blockedBg, borderRadius: BorderRadius.circular(10)),
    child: Text(message, style: const TextStyle(color: Palette.blocked, fontSize: 13.5)),
  );
}

class _Spinner extends StatelessWidget {
  const _Spinner();

  @override
  Widget build(BuildContext context) => const SizedBox(
    height: 20,
    width: 20,
    child: CircularProgressIndicator(strokeWidth: 2.2, color: Colors.white),
  );
}

class _FieldLabel extends StatelessWidget {
  const _FieldLabel(this.text);

  final String text;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.only(bottom: 6),
    child: Text(
      text,
      style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w600, color: Palette.inkMuted),
    ),
  );
}
