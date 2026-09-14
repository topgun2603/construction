import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api_client.dart';
import '../../core/api_providers.dart';
import '../../core/auth_controller.dart';
import '../../core/format.dart';
import '../../core/theme.dart';
import '../../shared/widgets.dart';
import '../settings/settings_screen.dart';

/// Wage runs: what a gang earned over a period, and whether that figure is settled yet.
///
/// A run is generated per contractor because that is how the money moves — Kannan's gang is paid
/// as one bill, not eleven. It starts as a draft that recomputes from attendance, and finalising
/// freezes it: after that, correcting a day's roll call no longer moves what somebody was paid.
/// That is the whole point of the two states, and why finalising asks first.
class WagePeriodsScreen extends ConsumerWidget {
  const WagePeriodsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final periods = ref.watch(wagePeriodsProvider);
    final me = ref.watch(authControllerProvider).me;
    final canGenerate = me?.can('wages.generate') ?? false;

    return Scaffold(
      backgroundColor: Palette.canvas,
      floatingActionButton: canGenerate
          ? Padding(
              padding: EdgeInsets.only(bottom: fabInset(context)),
              child: FloatingActionButton.extended(
                backgroundColor: Palette.accent,
                foregroundColor: Colors.white,
                onPressed: () => adminSheet(context, const _GenerateForm()),
                icon: const Icon(Icons.add),
                label: const Text('New run'),
              ),
            )
          : null,
      body: RefreshIndicator(
        onRefresh: () async {
          ref.invalidate(wagePeriodsProvider);
          await ref.read(wagePeriodsProvider.future);
        },
        child: AsyncSection<List<Map<String, dynamic>>>(
          value: periods,
          onRetry: () => ref.invalidate(wagePeriodsProvider),
          builder: (rows) {
            if (rows.isEmpty) {
              return ListView(
                children: [
                  EmptyNote(
                    icon: Icons.receipt_long_outlined,
                    title: 'No wage runs yet',
                    body: canGenerate
                        ? 'Generate one for a contractor and a date range. It adds up the roll '
                              'call for you — nobody retypes attendance into a wage sheet.'
                        : 'Wage runs appear here once somebody generates them.',
                  ),
                ],
              );
            }

            final drafts = rows.where((row) => row['status'] == 'draft').length;

            return ListView.builder(
              padding: EdgeInsets.fromLTRB(0, 12, 0, bottomInset(context, hasFab: canGenerate)),
              itemCount: rows.length + 1,
              itemBuilder: (context, index) {
                if (index == 0) {
                  final owed = rows
                      .where((row) => row['status'] != 'paid')
                      .fold(
                        BigInt.zero,
                        (sum, row) =>
                            sum + (BigInt.tryParse(row['net_payable'] as String? ?? '') ?? BigInt.zero),
                      );
                  return Padding(
                    padding: const EdgeInsets.only(bottom: 14),
                    child: KpiStrip(
                      tiles: [
                        StatTile(
                          label: 'Runs',
                          value: '${rows.length}',
                          note: drafts > 0 ? '$drafts still draft' : 'All settled',
                        ),
                        StatTile(
                          label: 'Not yet paid',
                          value: formatInrCompact(owed.toString()),
                          tone: owed > BigInt.zero ? Palette.pending : null,
                          note: 'Across every open run',
                        ),
                      ],
                    ),
                  );
                }

                final period = rows[index - 1];
                return Padding(
                  padding: const EdgeInsets.fromLTRB(16, 0, 16, 10),
                  child: _PeriodCard(period: period),
                );
              },
            );
          },
        ),
      ),
    );
  }
}

class _PeriodCard extends ConsumerWidget {
  const _PeriodCard({required this.period});

  final Map<String, dynamic> period;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final status = period['status'] as String? ?? 'draft';
    final me = ref.watch(authControllerProvider).me;
    final canFinalise = me?.can('wages.finalise') ?? false;
    final draft = status == 'draft';

    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        period['contractor_name'] as String? ?? 'Direct labour',
                        style: const TextStyle(fontSize: 15.5, fontWeight: FontWeight.w600),
                      ),
                      Text(
                        '${shortDate(period['period_start'] as String?)} — '
                        '${shortDate(period['period_end'] as String?)}',
                        style: const TextStyle(fontSize: 12.5, color: Palette.inkMuted),
                      ),
                    ],
                  ),
                ),
                StatusPill(status),
              ],
            ),
            const SizedBox(height: 12),
            Row(
              children: [
                Expanded(
                  child: _Figure(
                    label: 'Earned',
                    value: formatInr(period['gross_amount'] as String?),
                  ),
                ),
                Expanded(
                  child: _Figure(
                    label: 'Advances',
                    value: formatInr(period['advances_deducted'] as String?),
                  ),
                ),
                Expanded(
                  child: _Figure(
                    label: 'To pay',
                    value: formatInr(period['net_payable'] as String?),
                    strong: true,
                  ),
                ),
              ],
            ),
            if (draft && canFinalise) ...[
              const SizedBox(height: 14),
              FilledButton(
                onPressed: () async {
                  final messenger = ScaffoldMessenger.of(context);
                  final sure = await confirm(
                    context,
                    title: 'Finalise this run?',
                    body:
                        'The figures stop moving. Correcting a day on the roll call after this '
                        'will not change what this run says anybody is owed — that is what makes '
                        'it safe to pay from.',
                    danger: 'Finalise',
                  );
                  if (!sure) return;
                  try {
                    await ref.read(apiProvider).finaliseWagePeriod(period['id'] as String);
                    messenger.showSnackBar(const SnackBar(content: Text('Finalised')));
                  } on ApiException catch (error) {
                    messenger.showSnackBar(
                      SnackBar(content: Text(error.message), backgroundColor: Palette.blocked),
                    );
                  }
                },
                child: const Text('Finalise'),
              ),
            ],
          ],
        ),
      ),
    );
  }
}

class _Figure extends StatelessWidget {
  const _Figure({required this.label, required this.value, this.strong = false});

  final String label;
  final String value;
  final bool strong;

  @override
  Widget build(BuildContext context) => Column(
    crossAxisAlignment: CrossAxisAlignment.start,
    children: [
      Text(label, style: const TextStyle(fontSize: 11.5, color: Palette.inkMuted)),
      const SizedBox(height: 2),
      Text(
        value,
        style: TextStyle(
          fontSize: strong ? 15 : 13.5,
          fontWeight: strong ? FontWeight.w700 : FontWeight.w500,
        ),
      ),
    ],
  );
}

/// Drafting a run for one contractor over a range.
class _GenerateForm extends ConsumerStatefulWidget {
  const _GenerateForm();

  @override
  ConsumerState<_GenerateForm> createState() => _GenerateFormState();
}

class _GenerateFormState extends ConsumerState<_GenerateForm> {
  String? _contractorId;
  late String _from = _mondayOfThisWeek();
  late String _to = todayIso();
  bool _saving = false;
  String? _error;

  /// Most Indian sites settle labour weekly, so the range opens on this week rather than empty.
  static String _mondayOfThisWeek() {
    final now = DateTime.now();
    return isoDate(now.subtract(Duration(days: now.weekday - 1)));
  }

  @override
  Widget build(BuildContext context) {
    final contractors = ref.watch(contractorsProvider);

    return Padding(
      padding: EdgeInsets.only(bottom: MediaQuery.of(context).viewInsets.bottom),
      child: SafeArea(
        child: ListView(
          shrinkWrap: true,
          padding: const EdgeInsets.fromLTRB(20, 16, 20, 28),
          children: [
            Row(
              children: [
                const Expanded(
                  child: Text(
                    'New wage run',
                    style: TextStyle(fontSize: 19, fontWeight: FontWeight.w700),
                  ),
                ),
                IconButton(
                  onPressed: () => Navigator.of(context).pop(),
                  icon: const Icon(Icons.close),
                ),
              ],
            ),
            const SizedBox(height: 12),
            const AdminLabel('Contractor'),
            contractors.when(
              loading: () => const Loading(),
              error: (error, _) => ErrorNote(error: error),
              data: (rows) {
                if (rows.isEmpty) {
                  return const EmptyNote(
                    title: 'No contractors',
                    body: 'A wage run is generated per gang. Add one under Set up first.',
                  );
                }
                return DropdownButtonFormField<String>(
                  initialValue: _contractorId ?? rows.first['id'] as String,
                  isExpanded: true,
                  items: [
                    for (final contractor in rows)
                      DropdownMenuItem(
                        value: contractor['id'] as String,
                        child: Text(contractor['name'] as String? ?? ''),
                      ),
                  ],
                  onChanged: (value) => setState(() => _contractorId = value),
                );
              },
            ),
            const SizedBox(height: 16),
            const AdminLabel('From'),
            _DayButton(value: _from, onPicked: (value) => setState(() => _from = value)),
            const SizedBox(height: 16),
            const AdminLabel('To'),
            _DayButton(value: _to, onPicked: (value) => setState(() => _to = value)),
            const Padding(
              padding: EdgeInsets.only(top: 6),
              child: Text(
                'Every day marked in this range is added up, and advances already paid in it are '
                'taken off.',
                style: TextStyle(fontSize: 12, color: Palette.inkFaint),
              ),
            ),
            if (_error != null) ...[const SizedBox(height: 16), AdminError(_error!)],
            const SizedBox(height: 22),
            FilledButton(
              onPressed: _saving ? null : () => _submit(contractors.value),
              child: _saving
                  ? const SizedBox(
                      height: 20,
                      width: 20,
                      child: CircularProgressIndicator(strokeWidth: 2.2, color: Colors.white),
                    )
                  : const Text('Generate draft'),
            ),
          ],
        ),
      ),
    );
  }

  Future<void> _submit(List<Map<String, dynamic>>? contractors) async {
    final contractorId =
        _contractorId ??
        (contractors != null && contractors.isNotEmpty
            ? contractors.first['id'] as String
            : null);
    if (contractorId == null) {
      setState(() => _error = 'Pick a contractor');
      return;
    }
    if (_to.compareTo(_from) < 0) {
      setState(() => _error = 'The end of the range is before its start');
      return;
    }

    setState(() {
      _saving = true;
      _error = null;
    });
    try {
      await ref
          .read(apiProvider)
          .generateWagePeriod(contractorId: contractorId, from: _from, to: _to);
      if (!mounted) return;
      Navigator.of(context).pop();
      notify(context, 'Draft ready to review');
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() => _error = error.message);
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }
}

class _DayButton extends StatelessWidget {
  const _DayButton({required this.value, required this.onPicked});

  final String value;
  final void Function(String) onPicked;

  @override
  Widget build(BuildContext context) => OutlinedButton.icon(
    style: OutlinedButton.styleFrom(minimumSize: const Size.fromHeight(52)),
    onPressed: () async {
      final picked = await showDatePicker(
        context: context,
        initialDate: parseIsoDate(value) ?? DateTime.now(),
        firstDate: DateTime.now().subtract(const Duration(days: 365)),
        lastDate: DateTime.now(),
      );
      if (picked != null) onPicked(isoDate(picked));
    },
    icon: const Icon(Icons.calendar_today_outlined, size: 17),
    label: Text(longDate(value)),
  );
}
