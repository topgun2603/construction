import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api_client.dart';
import '../../core/api_providers.dart';
import '../../core/auth_controller.dart';
import '../../core/format.dart';
import '../../core/theme.dart';
import '../../shared/widgets.dart';

/// What is on site, per material: received, used, what is left — and the booking of both.
///
/// A delivery is received in the yard, and material is drawn from the store by somebody standing in
/// it. That is why this belongs on a phone at all. The care the roll call got applies here too:
/// booking the same lorry in twice makes the store look fuller than the yard is, and the overrun
/// report then reads as theft.
class StockScreen extends ConsumerStatefulWidget {
  const StockScreen({super.key});

  @override
  ConsumerState<StockScreen> createState() => _StockScreenState();
}

class _StockScreenState extends ConsumerState<StockScreen> {
  String? _projectId;

  @override
  Widget build(BuildContext context) {
    final sites = ref.watch(sitesProvider);
    final canRecord = ref.watch(authControllerProvider).me?.can('stock.record') ?? false;

    return AsyncSection<List<Map<String, dynamic>>>(
      value: sites,
      onRetry: () => ref.invalidate(sitesProvider),
      builder: (siteRows) {
        if (siteRows.isEmpty) {
          return const EmptyNote(
            icon: Icons.inventory_2_outlined,
            title: 'No sites',
            body: 'Stock is counted per site, so there is nothing to show yet.',
          );
        }
        final projectId = _projectId ?? siteRows.first['id'] as String;
        final stock = ref.watch(stockProvider(projectId));
        final siteName =
            siteRows.firstWhere(
                  (site) => site['id'] == projectId,
                  orElse: () => siteRows.first,
                )['name']
                as String? ??
            'Site';

        return Scaffold(
          backgroundColor: Palette.canvas,
          floatingActionButton: canRecord
              ? Padding(
                  padding: EdgeInsets.only(bottom: fabInset(context)),
                  child: FloatingActionButton.extended(
                    backgroundColor: Palette.accent,
                    foregroundColor: Colors.white,
                    onPressed: () =>
                        _openMovement(context, projectId: projectId, siteName: siteName),
                    icon: const Icon(Icons.add),
                    label: const Text('Book stock'),
                  ),
                )
              : null,
          body: Column(
          children: [
            Container(
              color: Palette.surface,
              padding: const EdgeInsets.fromLTRB(16, 10, 16, 10),
              child: DropdownButtonHideUnderline(
                child: DropdownButton<String>(
                  value: siteRows.any((s) => s['id'] == projectId)
                      ? projectId
                      : siteRows.first['id'] as String,
                  isExpanded: true,
                  borderRadius: BorderRadius.circular(12),
                  items: [
                    for (final site in siteRows)
                      DropdownMenuItem(
                        value: site['id'] as String,
                        child: Text(
                          site['name'] as String? ?? 'Site',
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w600),
                        ),
                      ),
                  ],
                  onChanged: (value) => setState(() => _projectId = value),
                ),
              ),
            ),
            Expanded(
              child: RefreshIndicator(
                onRefresh: () async {
                  ref.invalidate(stockProvider(projectId));
                  await ref.read(stockProvider(projectId).future);
                },
                child: AsyncSection<Map<String, dynamic>>(
                  value: stock,
                  onRetry: () => ref.invalidate(stockProvider(projectId)),
                  builder: (data) {
                    final items = (data['items'] as List<dynamic>? ?? const [])
                        .map((row) => Map<String, dynamic>.from(row as Map))
                        .toList();
                    final totals = Map<String, dynamic>.from(
                      data['totals'] as Map? ?? const <String, dynamic>{},
                    );
                    final empty = items
                        .where(
                          (row) => (double.tryParse(row['on_hand'] as String? ?? '0') ?? 0) == 0,
                        )
                        .length;
                    final negative = items
                        .where(
                          (row) => (double.tryParse(row['on_hand'] as String? ?? '0') ?? 0) < 0,
                        )
                        .length;

                    if (items.isEmpty) {
                      return ListView(
                        children: const [
                          EmptyNote(
                            icon: Icons.inventory_2_outlined,
                            title: 'Nothing booked in',
                            body:
                                'Material appears here once a delivery is received against an '
                                'indent, or booked in from the web app.',
                          ),
                        ],
                      );
                    }

                    return ListView.builder(
                      padding: EdgeInsets.fromLTRB(
                        0,
                        12,
                        0,
                        bottomInset(context, hasFab: canRecord),
                      ),
                      itemCount: items.length + 1,
                      itemBuilder: (context, index) {
                        // The numbers ride at the top of the same list, so they scroll away when
                        // somebody is looking for a material rather than at the summary.
                        if (index == 0) {
                          return Padding(
                            padding: const EdgeInsets.only(bottom: 14),
                            child: KpiStrip(
                              tiles: [
                                StatTile(
                                  label: 'Materials tracked',
                                  value: '${totals['material_count'] ?? items.length}',
                                  note: empty > 0 ? '$empty at zero' : 'All have stock',
                                ),
                                StatTile(
                                  label: 'Needs checking',
                                  value: '$negative',
                                  tone: negative > 0 ? Palette.blocked : null,
                                  note: negative > 0
                                      ? 'More booked out than in'
                                      : 'Nothing below zero',
                                ),
                                StatTile(
                                  label: 'Booked in',
                                  value: _sum(items, 'received'),
                                  note: 'Across every material',
                                ),
                                StatTile(
                                  label: 'Booked out',
                                  value: _sum(items, 'used'),
                                  note: 'What the site has drawn',
                                ),
                              ],
                            ),
                          );
                        }
                        final row = items[index - 1];
                        final onHand = double.tryParse(row['on_hand'] as String? ?? '0') ?? 0;
                        return Card(
                          margin: const EdgeInsets.fromLTRB(16, 0, 16, 10),
                          child: InkWell(
                            borderRadius: BorderRadius.circular(14),
                            onTap: canRecord
                                ? () => _openMovement(
                                    context,
                                    projectId: projectId,
                                    siteName: siteName,
                                    material: row,
                                  )
                                : null,
                            child: Padding(
                            padding: const EdgeInsets.all(16),
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Row(
                                  children: [
                                    Expanded(
                                      child: Text(
                                        row['material_name'] as String? ?? '',
                                        style: const TextStyle(
                                          fontSize: 15.5,
                                          fontWeight: FontWeight.w600,
                                        ),
                                      ),
                                    ),
                                    Text(
                                      '${row['on_hand']} ${row['unit'] ?? ''}',
                                      style: TextStyle(
                                        fontSize: 16,
                                        fontWeight: FontWeight.w700,
                                        // Nothing left is worth noticing before somebody walks to
                                        // the store to find out.
                                        color: onHand <= 0 ? Palette.blocked : Palette.ink,
                                      ),
                                    ),
                                  ],
                                ),
                                const SizedBox(height: 8),
                                Text(
                                  'In ${row['received']} · used ${row['used']}',
                                  style: const TextStyle(fontSize: 12.5, color: Palette.inkMuted),
                                ),
                              ],
                            ),
                            ),
                          ),
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
      },
    );
  }
}

/// Quantities are decimal strings from the API. Summed for a tile, and shown without inventing a
/// precision the yard does not have.
String _sum(List<Map<String, dynamic>> rows, String field) {
  final total = rows.fold<double>(
    0,
    (sum, row) => sum + (double.tryParse(row[field] as String? ?? '0') ?? 0),
  );
  return total == total.roundToDouble() ? total.toStringAsFixed(0) : total.toStringAsFixed(1);
}

void _openMovement(
  BuildContext context, {
  required String projectId,
  required String siteName,
  Map<String, dynamic>? material,
}) => showModalBottomSheet<void>(
  context: context,
  isScrollControlled: true,
  backgroundColor: Palette.surface,
  shape: const RoundedRectangleBorder(
    borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
  ),
  builder: (_) => _MovementForm(projectId: projectId, siteName: siteName, material: material),
);

/// Booking material in or out.
///
/// The one screen in this app where a double tap costs real money: a delivery booked twice makes
/// the store look fuller than the yard is, and the overrun report then reads as theft. So the
/// button commits once and the sheet closes on success — there is no way to submit the same form
/// twice without filling it in again.
class _MovementForm extends ConsumerStatefulWidget {
  const _MovementForm({required this.projectId, required this.siteName, this.material});

  final String projectId;
  final String siteName;

  /// Prefilled when opened from a row, so "used ten bags of that" is three taps.
  final Map<String, dynamic>? material;

  @override
  ConsumerState<_MovementForm> createState() => _MovementFormState();
}

class _MovementFormState extends ConsumerState<_MovementForm> {
  final _quantity = TextEditingController();
  final _ref = TextEditingController();
  final _note = TextEditingController();

  late String? _materialId = widget.material?['material_id'] as String?;
  String _type = 'in';
  String _movedOn = todayIso();
  bool _saving = false;
  String? _error;

  @override
  void dispose() {
    _quantity.dispose();
    _ref.dispose();
    _note.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
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
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const Text(
                        'Book stock',
                        style: TextStyle(fontSize: 19, fontWeight: FontWeight.w700),
                      ),
                      Text(
                        widget.siteName,
                        style: const TextStyle(fontSize: 13, color: Palette.inkMuted),
                      ),
                    ],
                  ),
                ),
                IconButton(
                  onPressed: () => Navigator.of(context).pop(),
                  icon: const Icon(Icons.close),
                ),
              ],
            ),
            const SizedBox(height: 14),
            // In or out first: it changes what every field below means, and getting it wrong is the
            // error that matters here.
            SegmentedButton<String>(
              segments: const [
                ButtonSegment(
                  value: 'in',
                  icon: Icon(Icons.south_west, size: 17),
                  label: Text('Received'),
                ),
                ButtonSegment(
                  value: 'out',
                  icon: Icon(Icons.north_east, size: 17),
                  label: Text('Used'),
                ),
              ],
              selected: {_type},
              onSelectionChanged: (value) => setState(() => _type = value.first),
            ),
            const SizedBox(height: 18),
            const _StockLabel('Material'),
            materials.when(
              loading: () => const Loading(),
              error: (error, _) => ErrorNote(error: error),
              data: (rows) {
                if (rows.isEmpty) {
                  return const EmptyNote(
                    title: 'No materials yet',
                    body: 'Materials are set up once for the company, then booked per site.',
                  );
                }
                final selected = rows.any((row) => row['id'] == _materialId)
                    ? _materialId
                    : rows.first['id'] as String;
                return DropdownButtonFormField<String>(
                  initialValue: selected,
                  isExpanded: true,
                  items: [
                    for (final row in rows)
                      DropdownMenuItem(
                        value: row['id'] as String,
                        child: Text(
                          '${row['name']} (${row['unit']})',
                          overflow: TextOverflow.ellipsis,
                        ),
                      ),
                  ],
                  onChanged: (value) => setState(() => _materialId = value),
                );
              },
            ),
            const SizedBox(height: 16),
            const _StockLabel('Quantity'),
            TextField(
              controller: _quantity,
              keyboardType: const TextInputType.numberWithOptions(decimal: true),
              style: const TextStyle(fontSize: 22, fontWeight: FontWeight.w700),
              decoration: const InputDecoration(hintText: '150'),
            ),
            const SizedBox(height: 16),
            _StockLabel(_type == 'in' ? 'Challan or bill number' : 'Reference'),
            TextField(
              controller: _ref,
              decoration: const InputDecoration(hintText: 'Optional'),
            ),
            const SizedBox(height: 16),
            const _StockLabel('When'),
            OutlinedButton.icon(
              style: OutlinedButton.styleFrom(minimumSize: const Size.fromHeight(52)),
              onPressed: () async {
                final picked = await showDatePicker(
                  context: context,
                  initialDate: parseIsoDate(_movedOn) ?? DateTime.now(),
                  firstDate: DateTime.now().subtract(const Duration(days: 90)),
                  lastDate: DateTime.now(),
                );
                if (picked != null) setState(() => _movedOn = isoDate(picked));
              },
              icon: const Icon(Icons.calendar_today_outlined, size: 17),
              label: Text(_movedOn == todayIso() ? 'Today' : longDate(_movedOn)),
            ),
            const SizedBox(height: 16),
            const _StockLabel('Note'),
            TextField(
              controller: _note,
              maxLines: 2,
              textCapitalization: TextCapitalization.sentences,
              decoration: const InputDecoration(hintText: 'Optional'),
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
              onPressed: _saving ? null : () => _submit(materials.value),
              child: _saving
                  ? const SizedBox(
                      height: 20,
                      width: 20,
                      child: CircularProgressIndicator(strokeWidth: 2.2, color: Colors.white),
                    )
                  : Text(_type == 'in' ? 'Book it in' : 'Book it out'),
            ),
          ],
        ),
      ),
    );
  }

  Future<void> _submit(List<Map<String, dynamic>>? materials) async {
    final materialId =
        _materialId ??
        (materials != null && materials.isNotEmpty ? materials.first['id'] as String : null);
    if (materialId == null) {
      setState(() => _error = 'Pick a material');
      return;
    }

    // Three decimals, matching the column. Anything else is a typo, and a quantity typo in a stock
    // ledger is not visible again until somebody counts the yard.
    final quantity = _quantity.text.trim();
    if (!RegExp(r'^\d+(?:\.\d{1,3})?$').hasMatch(quantity) ||
        (double.tryParse(quantity) ?? 0) <= 0) {
      setState(() => _error = 'Enter a quantity, like 150 or 12.5');
      return;
    }

    setState(() {
      _saving = true;
      _error = null;
    });
    String? materialName;
    for (final material in materials ?? const <Map<String, dynamic>>[]) {
      if (material['id'] == materialId) materialName = material['name'] as String?;
    }

    try {
      final sent = await ref
          .read(apiProvider)
          .recordStockMovement(
            projectId: widget.projectId,
            materialId: materialId,
            type: _type,
            quantity: quantity,
            movedOn: _movedOn,
            reference: _ref.text.trim(),
            note: _note.text.trim(),
            materialName: materialName,
          );
      if (!mounted) return;
      Navigator.of(context).pop();
      notify(
        context,
        sent
            ? (_type == 'in' ? 'Booked in' : 'Booked out')
            : 'Saved — it will book when you have signal',
      );
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() => _error = error.message);
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }
}

class _StockLabel extends StatelessWidget {
  const _StockLabel(this.text);

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
