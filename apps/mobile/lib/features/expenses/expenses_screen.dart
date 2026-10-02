import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/ai_api.dart';
import '../../core/api_client.dart';
import '../../core/api_providers.dart';
import '../../core/auth_controller.dart';
import '../../core/format.dart';
import '../../core/photo_upload.dart';
import '../../core/theme.dart';
import '../../shared/widgets.dart';

const _categories = [
  'materials',
  'transport',
  'fuel',
  'equipment_hire',
  'tools',
  'site_office',
  'utilities',
  'food',
  'permits',
  'repairs',
  'safety',
  'other',
];

/// Site expenses: money that left today, and whether it was allowed to.
class ExpensesScreen extends ConsumerWidget {
  const ExpensesScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final expenses = ref.watch(expensesProvider);
    final me = ref.watch(authControllerProvider).me;

    return Scaffold(
      backgroundColor: Palette.canvas,
      floatingActionButton: me?.can('expenses.record') == true
          ? Padding(
              padding: EdgeInsets.only(bottom: fabInset(context)),
              child: FloatingActionButton.extended(
                backgroundColor: Palette.accent,
                foregroundColor: Colors.white,
                onPressed: () => showModalBottomSheet<void>(
                  context: context,
                  isScrollControlled: true,
                  backgroundColor: Palette.surface,
                  shape: const RoundedRectangleBorder(
                    borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
                  ),
                  builder: (_) => const _ExpenseForm(),
                ),
                icon: const Icon(Icons.add),
                label: const Text('Record spend'),
              ),
            )
          : null,
      body: RefreshIndicator(
        onRefresh: () async {
          ref.invalidate(expensesProvider);
          await ref.read(expensesProvider.future);
        },
        child: AsyncSection<List<Map<String, dynamic>>>(
          value: expenses,
          onRetry: () => ref.invalidate(expensesProvider),
          builder: (rows) {
            if (rows.isEmpty) {
              return ListView(
                children: const [
                  EmptyNote(
                    icon: Icons.receipt_long_outlined,
                    title: 'Nothing recorded',
                    body:
                        'Diesel, autos, tea, small tools — the spending that never reaches a '
                        'purchase order but still adds up.',
                  ),
                ],
              );
            }
            final pending = rows.where((row) => row['status'] == 'pending').toList();
            final pendingTotal = pending.fold(
              BigInt.zero,
              (sum, row) => sum + (BigInt.tryParse(row['amount'] as String? ?? '') ?? BigInt.zero),
            );
            final total = rows.fold(
              BigInt.zero,
              (sum, row) => sum + (BigInt.tryParse(row['amount'] as String? ?? '') ?? BigInt.zero),
            );
            final categories = rows.map((row) => row['category']).whereType<String>().toSet();

            return ListView.separated(
              padding: EdgeInsets.fromLTRB(0, 12, 0, bottomInset(context, hasFab: true)),
              itemCount: rows.length + 1,
              separatorBuilder: (_, _) => const SizedBox(height: 10),
              itemBuilder: (context, index) {
                if (index == 0) {
                  return KpiStrip(
                    tiles: [
                      StatTile(
                        label: 'Recorded',
                        value: formatInrCompact(total.toString()),
                        note: '${rows.length} bills',
                      ),
                      StatTile(
                        label: 'Awaiting approval',
                        value: '${pending.length}',
                        tone: pending.isNotEmpty ? Palette.pending : null,
                        note: pending.isEmpty
                            ? 'Nothing waiting'
                            : formatInrCompact(pendingTotal.toString()),
                      ),
                      StatTile(
                        label: 'Categories',
                        value: '${categories.length}',
                        note: 'Kinds of spend recorded',
                      ),
                    ],
                  );
                }
                return Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 16),
                  child: _ExpenseCard(
                    expense: rows[index - 1],
                    canDecide: me?.can('expenses.approve') ?? false,
                  ),
                );
              },
            );
          },
        ),
      ),
    );
  }
}

class _ExpenseCard extends ConsumerWidget {
  const _ExpenseCard({required this.expense, required this.canDecide});

  final Map<String, dynamic> expense;
  final bool canDecide;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final status = expense['status'] as String? ?? 'pending';
    final waiting = status == 'pending';
    // Only while it is still waiting. An approved bill has been seen by whoever signs for money,
    // and quietly editing it afterwards is how the ledger and the decision stop matching.
    final canAmend =
        waiting && (ref.watch(authControllerProvider).me?.can('expenses.record') ?? false);

    return Card(
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
                        titleCase(expense['category'] as String? ?? 'other'),
                        style: const TextStyle(fontSize: 15.5, fontWeight: FontWeight.w600),
                      ),
                      Text(
                        '${expense['project_name'] ?? ''} · ${shortDate(expense['spent_on'] as String?)}',
                        style: const TextStyle(fontSize: 12.5, color: Palette.inkMuted),
                      ),
                    ],
                  ),
                ),
                Column(
                  crossAxisAlignment: CrossAxisAlignment.end,
                  children: [
                    Text(
                      formatInr(expense['amount'] as String?),
                      style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w700),
                    ),
                    const SizedBox(height: 4),
                    StatusPill(status),
                  ],
                ),
                if (canAmend)
                  PopupMenuButton<String>(
                    icon: const Icon(Icons.more_vert, size: 20, color: Palette.inkFaint),
                    itemBuilder: (_) => const [
                      PopupMenuItem(value: 'edit', child: Text('Edit')),
                      PopupMenuItem(
                        value: 'delete',
                        child: Text('Delete', style: TextStyle(color: Palette.blocked)),
                      ),
                    ],
                    onSelected: (choice) async {
                      if (choice == 'edit') {
                        await showModalBottomSheet<void>(
                          context: context,
                          isScrollControlled: true,
                          backgroundColor: Palette.surface,
                          shape: const RoundedRectangleBorder(
                            borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
                          ),
                          builder: (_) => _ExpenseForm(existing: expense),
                        );
                        return;
                      }
                      final messenger = ScaffoldMessenger.of(context);
                      final sure = await confirm(
                        context,
                        title: 'Delete this bill?',
                        body:
                            'It comes off the site spend and out of the approvals queue. There is '
                            'no undo, but you can record it again.',
                        danger: 'Delete',
                      );
                      if (!sure) return;
                      try {
                        await ref.read(apiProvider).removeExpense(expense['id'] as String);
                        messenger.showSnackBar(const SnackBar(content: Text('Deleted')));
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
            if (expense['note'] != null) ...[
              const SizedBox(height: 10),
              Text(
                expense['note'] as String,
                style: const TextStyle(fontSize: 13.5, color: Palette.inkSoft, height: 1.4),
              ),
            ],
            const SizedBox(height: 8),
            Text(
              'By ${(expense['submitted_by'] as Map?)?['name'] ?? ''}'
              '${relativeTime(expense['created_at'] as String?).isEmpty ? '' : ' · ${relativeTime(expense['created_at'] as String?)}'}',
              style: const TextStyle(fontSize: 12, color: Palette.inkFaint),
            ),
            if (waiting && canDecide) ...[
              const SizedBox(height: 14),
              Row(
                children: [
                  Expanded(
                    child: OutlinedButton(
                      style: OutlinedButton.styleFrom(
                        minimumSize: const Size.fromHeight(46),
                        foregroundColor: Palette.blocked,
                      ),
                      onPressed: () => _decide(context, ref, 'rejected'),
                      child: const Text('Reject'),
                    ),
                  ),
                  const SizedBox(width: 10),
                  Expanded(
                    child: FilledButton(
                      style: FilledButton.styleFrom(minimumSize: const Size.fromHeight(46)),
                      onPressed: () => _decide(context, ref, 'approved'),
                      child: const Text('Approve'),
                    ),
                  ),
                ],
              ),
            ],
          ],
        ),
      ),
    );
  }

  Future<void> _decide(BuildContext context, WidgetRef ref, String status) async {
    try {
      await ref.read(apiProvider).decideExpense(expense['id'] as String, status);
      if (context.mounted) notify(context, status == 'approved' ? 'Approved' : 'Rejected');
    } on ApiException catch (error) {
      if (context.mounted) notify(context, error.message, bad: true);
    }
  }
}

class _ExpenseForm extends ConsumerStatefulWidget {
  const _ExpenseForm({this.existing});

  /// When present this is an amendment, not a new bill.
  final Map<String, dynamic>? existing;

  @override
  ConsumerState<_ExpenseForm> createState() => _ExpenseFormState();
}

class _ExpenseFormState extends ConsumerState<_ExpenseForm> {
  late final _amount = TextEditingController(text: _rupees(widget.existing?['amount']));
  late final _note = TextEditingController(text: widget.existing?['note'] as String? ?? '');

  late String? _projectId = widget.existing?['project_id'] as String?;
  late String _category = widget.existing?['category'] as String? ?? 'materials';
  late String _spentOn = (widget.existing?['spent_on'] as String?) ?? todayIso();
  bool _saving = false;
  String? _error;

  /// The photographed bill, once it is in storage. Filed with the expense so the evidence stays
  /// attached rather than being thrown away the moment it has been read.
  String? _billS3Key;
  bool _scanning = false;

  /// Fields the scan could not fill, so the form can say so rather than look complete.
  List<String> _unread = const [];

  bool get _editing => widget.existing != null;

  /// Photographs a bill and fills the form from it. Saves nothing.
  ///
  /// The amount is converted from rupees to paise by the server, not here and not by the model —
  /// money in this product is an integer number of paise and only tested code produces one.
  Future<void> _scanBill(String projectId) async {
    final shot = await PhotoUploader.capture();
    if (shot == null) return;

    setState(() {
      _scanning = true;
      _error = null;
    });
    try {
      final api = ref.read(apiClientProvider);
      final key = await PhotoUploader(api).uploadFile(
        path: shot.path,
        contentType: PhotoUploader.contentTypeOf(shot.path),
        projectId: projectId,
        kind: 'bill',
      );
      final draft = await AiApi(api).scanBill(key);
      if (!mounted) return;

      setState(() {
        _billS3Key = key;
        _unread = draft.unread;
        if (draft.amountPaise != null) _amount.text = _rupees(draft.amountPaise);
        if (draft.category != null) _category = draft.category!;
        if (draft.spentOn != null) _spentOn = draft.spentOn!;
        // The vendor and what was bought, which is what somebody writes in the note by hand.
        final parts = [draft.vendor, draft.summary].whereType<String>();
        if (parts.isNotEmpty && _note.text.trim().isEmpty) _note.text = parts.join(' — ');
      });
    } on ApiException catch (error) {
      if (mounted) setState(() => _error = error.message);
    } catch (_) {
      if (mounted) setState(() => _error = 'Could not read that bill. Enter it by hand.');
    } finally {
      if (mounted) setState(() => _scanning = false);
    }
  }

  /// Paise back to the rupees somebody typed, so an amendment starts from what is already there.
  static String _rupees(Object? paise) {
    final value = BigInt.tryParse(paise as String? ?? '');
    if (value == null) return '';
    final whole = value ~/ BigInt.from(100);
    final rest = value % BigInt.from(100);
    return rest == BigInt.zero ? whole.toString() : '$whole.${rest.toString().padLeft(2, '0')}';
  }

  @override
  void dispose() {
    _amount.dispose();
    _note.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final sites = ref.watch(sitesProvider);

    return Padding(
      padding: EdgeInsets.only(bottom: MediaQuery.of(context).viewInsets.bottom),
      child: DraggableScrollableSheet(
        expand: false,
        initialChildSize: 0.85,
        maxChildSize: 0.95,
        builder: (context, controller) => ListView(
          controller: controller,
          padding: EdgeInsets.fromLTRB(20, 16, 20, 28 + systemBottomInset(context)),
          children: [
            Row(
              children: [
                Expanded(
                  child: Text(
                    _editing ? 'Edit spend' : 'Record spend',
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
            sites.when(
              loading: () => const Loading(),
              error: (error, _) => ErrorNote(error: error),
              data: (rows) {
                if (rows.isEmpty) {
                  return const EmptyNote(title: 'No sites', body: 'Nothing to record against.');
                }
                final projectId = _projectId ?? rows.first['id'] as String;
                return Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    // Only for a new expense. An amendment already has its figures, and a scan
                    // that silently overwrote a corrected amount would undo somebody's correction.
                    if (!_editing) ...[
                      _ScanBillRow(
                        scanning: _scanning,
                        scanned: _billS3Key != null,
                        unread: _unread,
                        onScan: _saving ? null : () => _scanBill(projectId),
                      ),
                      const SizedBox(height: 16),
                    ],
                    const _Label('Amount'),
                    TextField(
                      controller: _amount,
                      keyboardType: const TextInputType.numberWithOptions(decimal: true),
                      style: const TextStyle(fontSize: 22, fontWeight: FontWeight.w700),
                      decoration: const InputDecoration(prefixText: '₹ ', hintText: '3,200'),
                    ),
                    const SizedBox(height: 16),
                    const _Label('Site'),
                    DropdownButtonFormField<String>(
                      initialValue: projectId,
                      items: [
                        for (final site in rows)
                          DropdownMenuItem(
                            value: site['id'] as String,
                            child: Text(site['name'] as String? ?? 'Site'),
                          ),
                      ],
                      onChanged: (value) => setState(() => _projectId = value),
                    ),
                    const SizedBox(height: 16),
                    const _Label('What for'),
                    DropdownButtonFormField<String>(
                      initialValue: _category,
                      items: [
                        for (final category in _categories)
                          DropdownMenuItem(value: category, child: Text(titleCase(category))),
                      ],
                      onChanged: (value) => setState(() => _category = value ?? 'other'),
                    ),
                    const SizedBox(height: 16),
                    const _Label('When the money left'),
                    OutlinedButton.icon(
                      style: OutlinedButton.styleFrom(minimumSize: const Size.fromHeight(52)),
                      onPressed: () async {
                        final picked = await showDatePicker(
                          context: context,
                          initialDate: parseIsoDate(_spentOn) ?? DateTime.now(),
                          firstDate: DateTime.now().subtract(const Duration(days: 90)),
                          lastDate: DateTime.now(),
                        );
                        if (picked != null) setState(() => _spentOn = isoDate(picked));
                      },
                      icon: const Icon(Icons.calendar_today_outlined, size: 17),
                      label: Text(_spentOn == todayIso() ? 'Today' : longDate(_spentOn)),
                    ),
                    const SizedBox(height: 16),
                    const _Label('Note'),
                    TextField(
                      controller: _note,
                      maxLines: 2,
                      textCapitalization: TextCapitalization.sentences,
                      decoration: const InputDecoration(hintText: 'Diesel for the JCB'),
                    ),
                    if (_error != null) ...[
                      const SizedBox(height: 16),
                      Container(
                        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
                        decoration: BoxDecoration(
                          color: Palette.blockedBg,
                          borderRadius: BorderRadius.circular(10),
                        ),
                        child: Text(
                          _error!,
                          style: const TextStyle(color: Palette.blocked, fontSize: 13.5),
                        ),
                      ),
                    ],
                    const SizedBox(height: 22),
                    FilledButton(
                      onPressed: _saving ? null : () => _submit(projectId),
                      child: _saving
                          ? const SizedBox(
                              height: 20,
                              width: 20,
                              child: CircularProgressIndicator(
                                strokeWidth: 2.2,
                                color: Colors.white,
                              ),
                            )
                          : Text(_editing ? 'Save changes' : 'Record'),
                    ),
                  ],
                );
              },
            ),
          ],
        ),
      ),
    );
  }

  Future<void> _submit(String projectId) async {
    final total = rupeesToPaise(_amount.text);
    if (total == null || total == '0') {
      setState(() => _error = 'Enter the amount in rupees, like 3200 or 3200.50');
      return;
    }

    String? siteName;
    for (final site in ref.read(sitesProvider).value ?? const <Map<String, dynamic>>[]) {
      if (site['id'] == projectId) siteName = site['name'] as String?;
    }

    setState(() {
      _saving = true;
      _error = null;
    });
    try {
      // True when it went to the outbox instead of the server. An amendment is never queued: it
      // edits a row only the server knows the current state of.
      bool queued;
      final api = ref.read(apiProvider);
      if (_editing) {
        await api.updateExpense(widget.existing!['id'] as String, {
          'amount': total,
          'category': _category,
          'spent_on': _spentOn,
          'note': _note.text.trim(),
        });
        queued = false;
      } else {
        queued = !await api.recordExpense(
          projectId: projectId,
          amountPaise: total,
          category: _category,
          spentOn: _spentOn,
          note: _note.text.trim(),
          siteName: siteName,
          billS3Key: _billS3Key,
        );
      }
      if (!mounted) return;
      Navigator.of(context).pop();
      notify(
        context,
        queued
            ? 'Saved — it will send when you have signal'
            : (_editing ? 'Saved' : 'Recorded'),
      );
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() => _error = error.message);
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }
}

class _Label extends StatelessWidget {
  const _Label(this.text);

  final String text;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.only(bottom: 6),
    child: Text(
      text,
      style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w600, color: Palette.inkSoft),
    ),
  );
}

/// Photograph the bill, and let it fill the form.
///
/// The scan never saves anything: it returns a draft that somebody corrects and submits, which is
/// the whole safety model. A model misreading ₹1,250 as ₹12.50 is then a typo a person catches
/// rather than a wrong number in the ledger — so the fields it could not read are named, and the
/// form says so rather than looking complete.
class _ScanBillRow extends StatelessWidget {
  const _ScanBillRow({
    required this.scanning,
    required this.scanned,
    required this.unread,
    required this.onScan,
  });

  final bool scanning;
  final bool scanned;
  final List<String> unread;
  final VoidCallback? onScan;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: Palette.neutralBg,
        borderRadius: BorderRadius.circular(14),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            scanned
                ? 'Read from the bill. Check the figures before you file it.'
                : 'Photograph the bill and it fills the form in.',
            style: const TextStyle(fontSize: 12.5, color: Palette.inkMuted),
          ),
          const SizedBox(height: 8),
          Align(
            alignment: Alignment.centerLeft,
            child: scanning
                ? FilledButton.tonalIcon(
                    onPressed: null,
                    icon: SizedBox(
                      width: 16,
                      height: 16,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    ),
                    label: Text('Reading it…'),
                  )
                : FilledButton.tonalIcon(
                    onPressed: onScan,
                    icon: Icon(
                      scanned ? Icons.refresh_rounded : Icons.document_scanner_outlined,
                      size: 18,
                    ),
                    label: Text(scanned ? 'Scan another' : 'Scan a bill'),
                  ),
          ),
          if (unread.isNotEmpty) ...[
            const SizedBox(height: 8),
            Text(
              'Could not read: ${unread.map(_fieldName).join(', ')}. Fill those in yourself.',
              style: const TextStyle(fontSize: 12, color: Palette.pending),
            ),
          ],
        ],
      ),
    );
  }

  static String _fieldName(String field) => const {
    'amount': 'the amount',
    'vendor': 'the supplier',
    'spent_on': 'the date',
    'category': 'the category',
  }[field] ?? field;
}
