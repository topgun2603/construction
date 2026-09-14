import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api_client.dart';
import '../../core/api_providers.dart';
import '../../core/auth_controller.dart';
import '../../core/theme.dart';
import '../../shared/widgets.dart';
import 'settings_screen.dart';

/// Everything that can be indented or booked into stock.
///
/// One list for the whole company rather than per site, because the same cement is the same cement
/// on every job — and an overrun report comparing "OPC 53" on one site against "Cement OPC53" on
/// another would be comparing nothing.
///
/// The unit is the part worth getting right. It is what every quantity in the product is counted
/// in, and it cannot be changed afterwards without making the stock ledger dishonest, so the form
/// says so rather than letting somebody discover it.
class MaterialsScreen extends ConsumerStatefulWidget {
  const MaterialsScreen({super.key});

  @override
  ConsumerState<MaterialsScreen> createState() => _MaterialsScreenState();
}

class _MaterialsScreenState extends ConsumerState<MaterialsScreen> {
  String _query = '';

  @override
  Widget build(BuildContext context) {
    final materials = ref.watch(materialsProvider);
    final canManage = ref.watch(authControllerProvider).me?.can('materials.manage') ?? false;

    return AdminScaffold(
      title: 'Materials',
      addLabel: 'Add material',
      onAdd: canManage ? () => adminSheet(context, const _MaterialForm()) : null,
      child: Column(
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 12, 16, 8),
            child: TextField(
              onChanged: (value) => setState(() => _query = value.trim().toLowerCase()),
              decoration: const InputDecoration(
                hintText: 'Search materials',
                prefixIcon: Icon(Icons.search, size: 20),
                contentPadding: EdgeInsets.symmetric(horizontal: 16, vertical: 14),
              ),
            ),
          ),
          Expanded(
            child: RefreshIndicator(
              onRefresh: () async {
                ref.invalidate(materialsProvider);
                await ref.read(materialsProvider.future);
              },
              child: AsyncSection<List<Map<String, dynamic>>>(
                value: materials,
                onRetry: () => ref.invalidate(materialsProvider),
                builder: (rows) {
                  final visible = _query.isEmpty
                      ? rows
                      : rows.where((material) {
                          final haystack = [material['name'], material['category']]
                              .whereType<String>()
                              .join(' ')
                              .toLowerCase();
                          return haystack.contains(_query);
                        }).toList();

                  if (visible.isEmpty) {
                    return ListView(
                      children: [
                        EmptyNote(
                          icon: Icons.category_outlined,
                          title: _query.isEmpty ? 'No materials yet' : 'Nothing matches that',
                          body: _query.isEmpty
                              ? 'Cement, steel, sand, blocks — whatever gets ordered and counted.'
                              : 'Try part of the name, or the category.',
                        ),
                      ],
                    );
                  }

                  return ListView.builder(
                    padding: EdgeInsets.only(
                      bottom: bottomInset(context, hasFab: canManage),
                    ),
                    itemCount: visible.length,
                    itemBuilder: (context, index) {
                      final material = visible[index];
                      return Material(
                        color: Palette.surface,
                        child: Container(
                          margin: const EdgeInsets.only(bottom: 1),
                          padding: const EdgeInsets.fromLTRB(16, 12, 8, 12),
                          child: Row(
                            children: [
                              Expanded(
                                child: Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    Text(
                                      material['name'] as String? ?? '',
                                      style: const TextStyle(
                                        fontSize: 15,
                                        fontWeight: FontWeight.w500,
                                      ),
                                    ),
                                    const SizedBox(height: 2),
                                    Text(
                                      [
                                        material['category'],
                                        'counted in ${material['unit'] ?? '—'}',
                                      ].whereType<String>().join(' · '),
                                      style: const TextStyle(
                                        fontSize: 12.5,
                                        color: Palette.inkMuted,
                                      ),
                                    ),
                                  ],
                                ),
                              ),
                              if (canManage)
                                IconButton(
                                  icon: const Icon(
                                    Icons.delete_outline,
                                    size: 20,
                                    color: Palette.inkFaint,
                                  ),
                                  tooltip: 'Remove',
                                  onPressed: () async {
                                    final messenger = ScaffoldMessenger.of(context);
                                    final sure = await confirm(
                                      context,
                                      title: 'Remove ${material['name']}?',
                                      body:
                                          'It stops being offered on new indents. Stock already '
                                          'booked against it, and every past movement, stays on '
                                          'the record.',
                                      danger: 'Remove',
                                    );
                                    if (!sure) return;
                                    try {
                                      await ref
                                          .read(apiProvider)
                                          .removeMaterial(material['id'] as String);
                                      messenger.showSnackBar(
                                        const SnackBar(content: Text('Removed')),
                                      );
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
  }
}

class _MaterialForm extends ConsumerStatefulWidget {
  const _MaterialForm();

  @override
  ConsumerState<_MaterialForm> createState() => _MaterialFormState();
}

class _MaterialFormState extends ConsumerState<_MaterialForm> {
  final _name = TextEditingController();
  final _unit = TextEditingController();
  final _category = TextEditingController();

  bool _saving = false;
  String? _error;

  @override
  void dispose() {
    _name.dispose();
    _unit.dispose();
    _category.dispose();
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
                    'Add material',
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
            const AdminLabel('Name'),
            TextField(
              controller: _name,
              autofocus: true,
              textCapitalization: TextCapitalization.words,
              decoration: const InputDecoration(hintText: 'OPC 53 grade cement'),
            ),
            const SizedBox(height: 16),
            const AdminLabel('Counted in'),
            TextField(
              controller: _unit,
              decoration: const InputDecoration(hintText: 'bag'),
            ),
            const Padding(
              padding: EdgeInsets.only(top: 6),
              child: Text(
                'Bag, tonne, cubic feet, number. Every quantity of this material is counted in it '
                'from now on, so it is worth a moment.',
                style: TextStyle(fontSize: 12, color: Palette.inkFaint),
              ),
            ),
            const SizedBox(height: 16),
            const AdminLabel('Category'),
            TextField(
              controller: _category,
              textCapitalization: TextCapitalization.words,
              decoration: const InputDecoration(hintText: 'Cement'),
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
                  : const Text('Add material'),
            ),
          ],
        ),
      ),
    );
  }

  Future<void> _submit() async {
    final name = _name.text.trim();
    final unit = _unit.text.trim();
    if (name.isEmpty) {
      setState(() => _error = 'Give the material a name');
      return;
    }
    if (unit.isEmpty) {
      setState(() => _error = 'Say what it is counted in — bag, tonne, number');
      return;
    }

    setState(() {
      _saving = true;
      _error = null;
    });
    try {
      await ref
          .read(apiProvider)
          .createMaterial(name: name, unit: unit, category: _category.text.trim());
      if (!mounted) return;
      Navigator.of(context).pop();
      notify(context, '$name added');
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() => _error = error.message);
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }
}
