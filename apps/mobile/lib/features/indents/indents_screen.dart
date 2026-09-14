import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api_client.dart';
import '../../core/api_providers.dart';
import '../../core/auth_controller.dart';
import '../../core/format.dart';
import '../../core/theme.dart';
import '../../shared/widgets.dart';

/// Material indents: asking for material, and saying yes or no to the asking.
///
/// Approving is a two-tap action here rather than a form, because the person doing it is usually
/// walking somewhere and the answer is already in their head. Rejecting asks for a reason, because
/// the person who raised it has to know what to change.
class IndentsScreen extends ConsumerWidget {
  const IndentsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final indents = ref.watch(indentsProvider);
    final me = ref.watch(authControllerProvider).me;

    return Scaffold(
      backgroundColor: Palette.canvas,
      floatingActionButton: me?.can('indents.raise') == true
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
                  builder: (_) => const _IndentForm(),
                ),
                icon: const Icon(Icons.add),
                label: const Text('Raise indent'),
              ),
            )
          : null,
      body: RefreshIndicator(
        onRefresh: () async {
          ref.invalidate(indentsProvider);
          await ref.read(indentsProvider.future);
        },
        child: AsyncSection<List<Map<String, dynamic>>>(
          value: indents,
          onRetry: () => ref.invalidate(indentsProvider),
          builder: (rows) {
            if (rows.isEmpty) {
              return ListView(
                children: const [
                  EmptyNote(
                    icon: Icons.local_shipping_outlined,
                    title: 'No indents',
                    body:
                        'An indent is a request for material against a site. Raise one and it goes '
                        'to whoever approves purchases.',
                  ),
                ],
              );
            }
            // Waiting first: the whole reason to open this screen is something needing a decision.
            final sorted = [...rows]
              ..sort((a, b) {
                final aWaiting = a['status'] == 'requested' ? 0 : 1;
                final bWaiting = b['status'] == 'requested' ? 0 : 1;
                if (aWaiting != bWaiting) return aWaiting - bWaiting;
                return (b['created_at'] as String? ?? '').compareTo(
                  a['created_at'] as String? ?? '',
                );
              });

            final waiting = rows.where((row) => row['status'] == 'requested').toList();
            final approved = rows
                .where((row) => row['status'] == 'approved' || row['status'] == 'ordered')
                .length;
            final sites = waiting.map((row) => row['project_id']).toSet().length;

            return ListView.separated(
              padding: EdgeInsets.fromLTRB(0, 12, 0, bottomInset(context, hasFab: true)),
              itemCount: sorted.length + 1,
              separatorBuilder: (_, _) => const SizedBox(height: 10),
              itemBuilder: (context, index) {
                if (index == 0) {
                  return KpiStrip(
                    tiles: [
                      StatTile(
                        label: 'Waiting on you',
                        value: '${waiting.length}',
                        tone: waiting.isNotEmpty ? Palette.pending : null,
                        note: waiting.isEmpty ? 'Nothing to decide' : 'Needing a decision',
                      ),
                      StatTile(
                        label: 'Approved, not delivered',
                        value: '$approved',
                        note: 'Ordered or awaiting delivery',
                      ),
                      StatTile(
                        label: 'Sites affected',
                        value: '$sites',
                        note: 'With something pending',
                      ),
                      StatTile(
                        label: 'Indents raised',
                        value: '${rows.length}',
                        note: 'All time',
                      ),
                    ],
                  );
                }
                return Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 16),
                  child: _IndentCard(
                    indent: sorted[index - 1],
                    canDecide: me?.can('indents.approve') ?? false,
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

class _IndentCard extends ConsumerWidget {
  const _IndentCard({required this.indent, required this.canDecide});

  final Map<String, dynamic> indent;
  final bool canDecide;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final items = (indent['items'] as List<dynamic>? ?? const [])
        .map((row) => Map<String, dynamic>.from(row as Map))
        .toList();
    final status = indent['status'] as String? ?? 'requested';
    final waiting = status == 'requested';
    // Withdrawing is for a request nobody has answered yet. Once it is approved the decision
    // belongs to whoever made it, and the way back is a rejection, not a deletion.
    final canWithdraw =
        waiting && (ref.watch(authControllerProvider).me?.can('indents.raise') ?? false);

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
                        indent['project_name'] as String? ?? 'Site',
                        style: const TextStyle(fontSize: 15.5, fontWeight: FontWeight.w600),
                      ),
                      Text(
                        '${(indent['requested_by'] as Map?)?['name'] ?? ''} · '
                        '${relativeTime(indent['created_at'] as String?)}',
                        style: const TextStyle(fontSize: 12.5, color: Palette.inkMuted),
                      ),
                    ],
                  ),
                ),
                if (canWithdraw)
                  PopupMenuButton<String>(
                    icon: const Icon(Icons.more_vert, size: 20, color: Palette.inkFaint),
                    itemBuilder: (_) => const [
                      PopupMenuItem(
                        value: 'withdraw',
                        child: Text('Withdraw', style: TextStyle(color: Palette.blocked)),
                      ),
                    ],
                    onSelected: (_) async {
                      final messenger = ScaffoldMessenger.of(context);
                      final sure = await confirm(
                        context,
                        title: 'Withdraw this indent?',
                        body:
                            'It disappears from the approvals queue. Raise it again if the site '
                            'still needs the material.',
                        danger: 'Withdraw',
                      );
                      if (!sure) return;
                      try {
                        await ref.read(apiProvider).removeIndent(indent['id'] as String);
                        messenger.showSnackBar(const SnackBar(content: Text('Withdrawn')));
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
                if (indent['urgency'] == 'urgent' || indent['urgency'] == 'high') ...[
                  StatusPill(
                    indent['urgency'] as String,
                    label: titleCase(indent['urgency'] as String),
                  ),
                  const SizedBox(width: 6),
                ],
                StatusPill(status),
              ],
            ),
            const SizedBox(height: 12),
            for (final item in items)
              Padding(
                padding: const EdgeInsets.only(bottom: 4),
                child: Row(
                  children: [
                    Expanded(
                      child: Text(
                        item['material_name'] as String? ?? '',
                        style: const TextStyle(fontSize: 14),
                      ),
                    ),
                    Text(
                      '${item['quantity']} ${item['unit'] ?? ''}',
                      style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w600),
                    ),
                  ],
                ),
              ),
            if (indent['required_by'] != null) ...[
              const SizedBox(height: 8),
              Text(
                'Needed by ${shortDate(indent['required_by'] as String)}',
                style: const TextStyle(fontSize: 12.5, color: Palette.inkMuted),
              ),
            ],
            if (indent['notes'] != null) ...[
              const SizedBox(height: 8),
              Text(
                indent['notes'] as String,
                style: const TextStyle(fontSize: 13.5, color: Palette.inkSoft, height: 1.4),
              ),
            ],
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
    String? note;
    if (status == 'rejected') {
      // Whoever raised it has to know what to change, so a rejection carries a reason.
      note = await _askReason(context);
      if (note == null) return;
    }
    try {
      await ref.read(apiProvider).decideIndent(indent['id'] as String, status, note: note);
      if (context.mounted) {
        notify(context, status == 'approved' ? 'Approved' : 'Rejected');
      }
    } on ApiException catch (error) {
      if (context.mounted) notify(context, error.message, bad: true);
    }
  }

  Future<String?> _askReason(BuildContext context) {
    final controller = TextEditingController();
    return showDialog<String>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Why is it rejected?'),
        content: TextField(
          controller: controller,
          autofocus: true,
          maxLines: 3,
          textCapitalization: TextCapitalization.sentences,
          decoration: const InputDecoration(
            hintText: 'Too much for this stage — raise for 50 bags',
          ),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.of(context).pop(), child: const Text('Cancel')),
          FilledButton(
            style: FilledButton.styleFrom(minimumSize: const Size(100, 44)),
            onPressed: () => Navigator.of(context).pop(controller.text.trim()),
            child: const Text('Reject'),
          ),
        ],
      ),
    );
  }
}

/// Raising one: a site, a material, a quantity.
class _IndentForm extends ConsumerStatefulWidget {
  const _IndentForm();

  @override
  ConsumerState<_IndentForm> createState() => _IndentFormState();
}

class _IndentFormState extends ConsumerState<_IndentForm> {
  final _quantity = TextEditingController();
  final _notes = TextEditingController();

  String? _projectId;
  String? _materialId;
  String _urgency = 'normal';
  bool _saving = false;
  String? _error;

  @override
  void dispose() {
    _quantity.dispose();
    _notes.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final sites = ref.watch(sitesProvider);
    final materials = ref.watch(materialsProvider);

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
                const Expanded(
                  child: Text(
                    'Raise an indent',
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
            if (sites.isLoading || materials.isLoading)
              const Loading()
            else if (sites.hasError)
              ErrorNote(error: sites.error!)
            else if (materials.hasError)
              ErrorNote(error: materials.error!)
            else if ((materials.value ?? []).isEmpty)
              const EmptyNote(
                title: 'No materials set up',
                body:
                    'The material list is managed from the web app. Add cement, steel and the rest '
                    'there, then indents can name them.',
              )
            else
              _form(sites.value!, materials.value!),
          ],
        ),
      ),
    );
  }

  Widget _form(List<Map<String, dynamic>> sites, List<Map<String, dynamic>> materials) {
    if (sites.isEmpty) {
      return const EmptyNote(title: 'No sites', body: 'Nothing to raise an indent against.');
    }
    final projectId = _projectId ?? sites.first['id'] as String;
    final materialId = _materialId ?? materials.first['id'] as String;
    final material = materials.firstWhere(
      (row) => row['id'] == materialId,
      orElse: () => materials.first,
    );

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        const _Label('Site'),
        DropdownButtonFormField<String>(
          initialValue: projectId,
          items: [
            for (final site in sites)
              DropdownMenuItem(
                value: site['id'] as String,
                child: Text(site['name'] as String? ?? 'Site'),
              ),
          ],
          onChanged: (value) => setState(() => _projectId = value),
        ),
        const SizedBox(height: 16),
        const _Label('Material'),
        DropdownButtonFormField<String>(
          initialValue: materialId,
          isExpanded: true,
          items: [
            for (final row in materials)
              DropdownMenuItem(
                value: row['id'] as String,
                child: Text(row['name'] as String? ?? '', overflow: TextOverflow.ellipsis),
              ),
          ],
          onChanged: (value) => setState(() => _materialId = value),
        ),
        const SizedBox(height: 16),
        _Label('Quantity in ${material['unit'] ?? 'units'}'),
        TextField(
          controller: _quantity,
          keyboardType: const TextInputType.numberWithOptions(decimal: true),
          decoration: InputDecoration(hintText: '100', suffixText: material['unit'] as String?),
        ),
        const SizedBox(height: 16),
        const _Label('How urgent'),
        SegmentedButton<String>(
          segments: const [
            ButtonSegment(value: 'normal', label: Text('Normal')),
            ButtonSegment(value: 'high', label: Text('High')),
            ButtonSegment(value: 'urgent', label: Text('Urgent')),
          ],
          selected: {_urgency},
          onSelectionChanged: (value) => setState(() => _urgency = value.first),
        ),
        const SizedBox(height: 16),
        const _Label('Notes'),
        TextField(
          controller: _notes,
          maxLines: 2,
          textCapitalization: TextCapitalization.sentences,
          decoration: const InputDecoration(hintText: 'For the second floor slab pour on Friday'),
        ),
        if (_error != null) ...[
          const SizedBox(height: 16),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
            decoration: BoxDecoration(
              color: Palette.blockedBg,
              borderRadius: BorderRadius.circular(10),
            ),
            child: Text(_error!, style: const TextStyle(color: Palette.blocked, fontSize: 13.5)),
          ),
        ],
        const SizedBox(height: 22),
        FilledButton(
          onPressed: _saving ? null : () => _submit(projectId, materialId),
          child: _saving
              ? const SizedBox(
                  height: 20,
                  width: 20,
                  child: CircularProgressIndicator(strokeWidth: 2.2, color: Colors.white),
                )
              : const Text('Raise indent'),
        ),
      ],
    );
  }

  Future<void> _submit(String projectId, String materialId) async {
    final quantity = _quantity.text.trim();
    if (quantity.isEmpty || (double.tryParse(quantity) ?? 0) <= 0) {
      setState(() => _error = 'How much is needed?');
      return;
    }
    setState(() {
      _saving = true;
      _error = null;
    });
    try {
    String? siteName;
    for (final site in ref.read(sitesProvider).value ?? const <Map<String, dynamic>>[]) {
      if (site['id'] == projectId) siteName = site['name'] as String?;
    }

      final sent = await ref
          .read(apiProvider)
          .raiseIndent(
            projectId: projectId,
            urgency: _urgency,
            notes: _notes.text.trim(),
            items: [
              {'material_id': materialId, 'quantity': quantity},
            ],
            siteName: siteName,
          );
      if (!mounted) return;
      Navigator.of(context).pop();
      notify(context, sent ? 'Indent raised' : 'Saved — it will send when you have signal');
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
