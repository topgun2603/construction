import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api_client.dart';
import '../../core/api_providers.dart';
import '../../core/auth_controller.dart';
import '../../core/format.dart';
import '../../core/theme.dart';
import '../../shared/widgets.dart';
import '../settings/settings_screen.dart';

/// What the client owes on this site, instalment by instalment.
///
/// The other side of the money from everything else in this app: expenses and wages are what the
/// job costs, and this is what it brings in. A builder standing on site asking "has the slab
/// payment come in" is asking this question, and until now could only answer it from the web.
///
/// Two figures do the work. **Outstanding** never goes negative — a client who has overpaid is
/// money in hand, not a debt the builder owes back — and **unallocated** is money that arrived
/// against no particular instalment, which is most of it until somebody reconciles.
class PaymentSchedule extends ConsumerWidget {
  const PaymentSchedule({super.key, required this.projectId});

  final String projectId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final schedule = ref.watch(paymentScheduleProvider(projectId));
    final me = ref.watch(authControllerProvider).me;
    final canManage = me?.can('client_payments.manage') ?? false;

    return AsyncSection<Map<String, dynamic>>(
      value: schedule,
      onRetry: () => ref.invalidate(paymentScheduleProvider(projectId)),
      builder: (data) {
        final items = (data['items'] as List<dynamic>? ?? const [])
            .map((row) => Map<String, dynamic>.from(row as Map))
            .toList();
        final totals = Map<String, dynamic>.from(
          data['totals'] as Map? ?? const <String, dynamic>{},
        );
        final unallocated = totals['unallocated'] as String? ?? '0';
        final hasUnallocated = (BigInt.tryParse(unallocated) ?? BigInt.zero) > BigInt.zero;

        return Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Card(
              child: Padding(
                padding: const EdgeInsets.all(16),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Expanded(
                          child: _Figure(
                            label: 'Scheduled',
                            value: formatInr(totals['scheduled'] as String?),
                          ),
                        ),
                        Expanded(
                          child: _Figure(
                            label: 'Received',
                            value: formatInr(totals['received'] as String?),
                          ),
                        ),
                        Expanded(
                          child: _Figure(
                            label: 'Outstanding',
                            value: formatInr(totals['outstanding'] as String?),
                            strong: true,
                          ),
                        ),
                      ],
                    ),
                    if (hasUnallocated) ...[
                      const SizedBox(height: 10),
                      Text(
                        '${formatInr(unallocated)} received against no instalment yet',
                        style: const TextStyle(fontSize: 12.5, color: Palette.inkMuted),
                      ),
                    ],
                  ],
                ),
              ),
            ),
            const SizedBox(height: 10),
            if (items.isEmpty)
              Card(
                child: EmptyNote(
                  icon: Icons.request_quote_outlined,
                  title: 'No schedule set',
                  body: canManage
                      ? 'Break the contract value into instalments — on signing, on the slab, on '
                            'handover — so what is due and when stops being a conversation.'
                      : 'The payment schedule for this site has not been set up yet.',
                ),
              )
            else
              for (final stage in items)
                _StageCard(stage: stage, projectId: projectId, canManage: canManage),
            if (canManage) ...[
              const SizedBox(height: 10),
              Row(
                children: [
                  Expanded(
                    child: OutlinedButton.icon(
                      onPressed: () =>
                          adminSheet(context, _StageForm(projectId: projectId)),
                      icon: const Icon(Icons.add, size: 17),
                      label: const Text('Add instalment'),
                    ),
                  ),
                  const SizedBox(width: 10),
                  Expanded(
                    child: FilledButton.icon(
                      onPressed: () =>
                          adminSheet(context, _ReceiptForm(projectId: projectId, stages: items)),
                      icon: const Icon(Icons.south_west, size: 17),
                      label: const Text('Money in'),
                    ),
                  ),
                ],
              ),
            ],
          ],
        );
      },
    );
  }
}

class _StageCard extends ConsumerWidget {
  const _StageCard({required this.stage, required this.projectId, required this.canManage});

  final Map<String, dynamic> stage;
  final String projectId;
  final bool canManage;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final outstanding = BigInt.tryParse(stage['outstanding'] as String? ?? '0') ?? BigInt.zero;
    final settled = outstanding == BigInt.zero;
    final raised = stage['raised_at'] != null;

    return Card(
      margin: const EdgeInsets.only(bottom: 10),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        stage['label'] as String? ?? '',
                        style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w600),
                      ),
                      const SizedBox(height: 2),
                      Text(
                        [
                          if (stage['due_date'] != null)
                            'due ${shortDate(stage['due_date'] as String)}',
                          if (stage['milestone_name'] != null)
                            'on ${stage['milestone_name']}',
                          if (!raised) 'not raised yet',
                        ].join(' · '),
                        style: const TextStyle(fontSize: 12.5, color: Palette.inkMuted),
                      ),
                    ],
                  ),
                ),
                Column(
                  crossAxisAlignment: CrossAxisAlignment.end,
                  children: [
                    Text(
                      formatInr(stage['amount'] as String?),
                      style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w700),
                    ),
                    const SizedBox(height: 2),
                    Text(
                      settled ? 'settled' : '${formatInr(outstanding.toString())} left',
                      style: TextStyle(
                        fontSize: 12,
                        color: settled ? Palette.done : Palette.pending,
                      ),
                    ),
                  ],
                ),
                if (canManage && !raised)
                  PopupMenuButton<String>(
                    icon: const Icon(Icons.more_vert, size: 20, color: Palette.inkFaint),
                    itemBuilder: (_) => const [
                      PopupMenuItem(value: 'raise', child: Text('Mark as raised')),
                    ],
                    onSelected: (_) async {
                      final messenger = ScaffoldMessenger.of(context);
                      try {
                        await ref
                            .read(apiProvider)
                            .updatePaymentStage(
                              stage['id'] as String,
                              projectId: projectId,
                              changes: {'raised': true},
                            );
                        messenger.showSnackBar(const SnackBar(content: Text('Marked as raised')));
                      } on ApiException catch (error) {
                        messenger.showSnackBar(
                          SnackBar(
                            content: Text(error.message),
                            backgroundColor: Palette.blocked,
                          ),
                        );
                      }
                    },
                  ),
              ],
            ),
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

class _StageForm extends ConsumerStatefulWidget {
  const _StageForm({required this.projectId});

  final String projectId;

  @override
  ConsumerState<_StageForm> createState() => _StageFormState();
}

class _StageFormState extends ConsumerState<_StageForm> {
  final _label = TextEditingController();
  final _amount = TextEditingController();
  String? _dueDate;
  bool _saving = false;
  String? _error;

  @override
  void dispose() {
    _label.dispose();
    _amount.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
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
                    'Add instalment',
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
            const AdminLabel('What it is for'),
            TextField(
              controller: _label,
              autofocus: true,
              textCapitalization: TextCapitalization.sentences,
              decoration: const InputDecoration(hintText: 'On completion of the slab'),
            ),
            const Padding(
              padding: EdgeInsets.only(top: 6),
              child: Text(
                'The client sees this wording, so write what they would recognise.',
                style: TextStyle(fontSize: 12, color: Palette.inkFaint),
              ),
            ),
            const SizedBox(height: 16),
            const AdminLabel('Amount'),
            TextField(
              controller: _amount,
              keyboardType: const TextInputType.numberWithOptions(decimal: true),
              style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w700),
              decoration: const InputDecoration(prefixText: '₹ ', hintText: '5,00,000'),
            ),
            const SizedBox(height: 16),
            const AdminLabel('Due'),
            OutlinedButton.icon(
              style: OutlinedButton.styleFrom(minimumSize: const Size.fromHeight(52)),
              onPressed: () async {
                final picked = await showDatePicker(
                  context: context,
                  initialDate: parseIsoDate(_dueDate) ?? DateTime.now(),
                  firstDate: DateTime(DateTime.now().year - 1),
                  lastDate: DateTime(DateTime.now().year + 10),
                );
                if (picked != null) setState(() => _dueDate = isoDate(picked));
              },
              icon: const Icon(Icons.calendar_today_outlined, size: 17),
              label: Text(_dueDate == null ? 'No date' : longDate(_dueDate)),
            ),
            if (_error != null) ...[const SizedBox(height: 16), AdminError(_error!)],
            const SizedBox(height: 22),
            FilledButton(
              onPressed: _saving ? null : _submit,
              child: _saving
                  ? const SizedBox(
                      height: 20,
                      width: 20,
                      child: CircularProgressIndicator(strokeWidth: 2.2, color: Colors.white),
                    )
                  : const Text('Add instalment'),
            ),
          ],
        ),
      ),
    );
  }

  Future<void> _submit() async {
    final label = _label.text.trim();
    if (label.isEmpty) {
      setState(() => _error = 'Say what the instalment is for');
      return;
    }
    final amount = rupeesToPaise(_amount.text);
    if (amount == null || amount == '0') {
      setState(() => _error = 'Enter the amount in rupees');
      return;
    }

    setState(() {
      _saving = true;
      _error = null;
    });
    try {
      await ref
          .read(apiProvider)
          .addPaymentStage(
            projectId: widget.projectId,
            label: label,
            amountPaise: amount,
            dueDate: _dueDate,
          );
      if (!mounted) return;
      Navigator.of(context).pop();
      notify(context, 'Added');
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() => _error = error.message);
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }
}

/// Recording money the client actually sent.
class _ReceiptForm extends ConsumerStatefulWidget {
  const _ReceiptForm({required this.projectId, required this.stages});

  final String projectId;
  final List<Map<String, dynamic>> stages;

  @override
  ConsumerState<_ReceiptForm> createState() => _ReceiptFormState();
}

class _ReceiptFormState extends ConsumerState<_ReceiptForm> {
  final _amount = TextEditingController();
  final _reference = TextEditingController();

  String? _stageId;
  String _mode = 'bank';
  String _receivedOn = todayIso();
  bool _saving = false;
  String? _error;

  @override
  void dispose() {
    _amount.dispose();
    _reference.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
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
                    'Money in',
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
            const AdminLabel('Amount'),
            TextField(
              controller: _amount,
              autofocus: true,
              keyboardType: const TextInputType.numberWithOptions(decimal: true),
              style: const TextStyle(fontSize: 22, fontWeight: FontWeight.w700),
              decoration: const InputDecoration(prefixText: '₹ ', hintText: '5,00,000'),
            ),
            const SizedBox(height: 16),
            const AdminLabel('Against'),
            DropdownButtonFormField<String?>(
              initialValue: _stageId,
              isExpanded: true,
              items: [
                const DropdownMenuItem<String?>(
                  value: null,
                  child: Text('Nothing in particular'),
                ),
                for (final stage in widget.stages)
                  DropdownMenuItem<String?>(
                    value: stage['id'] as String,
                    child: Text(
                      stage['label'] as String? ?? '',
                      overflow: TextOverflow.ellipsis,
                    ),
                  ),
              ],
              onChanged: (value) => setState(() => _stageId = value),
            ),
            const Padding(
              padding: EdgeInsets.only(top: 6),
              child: Text(
                'Unallocated money still counts against the total. It can be filed against an '
                'instalment later.',
                style: TextStyle(fontSize: 12, color: Palette.inkFaint),
              ),
            ),
            const SizedBox(height: 16),
            const AdminLabel('How it came'),
            DropdownButtonFormField<String>(
              initialValue: _mode,
              items: const [
                DropdownMenuItem(value: 'bank', child: Text('Bank transfer')),
                DropdownMenuItem(value: 'upi', child: Text('UPI')),
                DropdownMenuItem(value: 'cash', child: Text('Cash')),
              ],
              onChanged: (value) => setState(() => _mode = value ?? 'bank'),
            ),
            const SizedBox(height: 16),
            const AdminLabel('When'),
            OutlinedButton.icon(
              style: OutlinedButton.styleFrom(minimumSize: const Size.fromHeight(52)),
              onPressed: () async {
                final picked = await showDatePicker(
                  context: context,
                  initialDate: parseIsoDate(_receivedOn) ?? DateTime.now(),
                  firstDate: DateTime.now().subtract(const Duration(days: 365)),
                  lastDate: DateTime.now(),
                );
                if (picked != null) setState(() => _receivedOn = isoDate(picked));
              },
              icon: const Icon(Icons.calendar_today_outlined, size: 17),
              label: Text(_receivedOn == todayIso() ? 'Today' : longDate(_receivedOn)),
            ),
            const SizedBox(height: 16),
            const AdminLabel('Reference'),
            TextField(
              controller: _reference,
              decoration: const InputDecoration(hintText: 'UTR or cheque number'),
            ),
            if (_error != null) ...[const SizedBox(height: 16), AdminError(_error!)],
            const SizedBox(height: 22),
            FilledButton(
              onPressed: _saving ? null : _submit,
              child: _saving
                  ? const SizedBox(
                      height: 20,
                      width: 20,
                      child: CircularProgressIndicator(strokeWidth: 2.2, color: Colors.white),
                    )
                  : const Text('Record'),
            ),
          ],
        ),
      ),
    );
  }

  Future<void> _submit() async {
    final amount = rupeesToPaise(_amount.text);
    if (amount == null || amount == '0') {
      setState(() => _error = 'Enter the amount in rupees');
      return;
    }

    setState(() {
      _saving = true;
      _error = null;
    });
    try {
      await ref
          .read(apiProvider)
          .recordClientReceipt(
            projectId: widget.projectId,
            amountPaise: amount,
            receivedOn: _receivedOn,
            stageId: _stageId,
            mode: _mode,
            reference: _reference.text.trim(),
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
