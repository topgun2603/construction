import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api_client.dart';
import '../../core/api_providers.dart';
import '../../core/auth_controller.dart';
import '../../core/format.dart';
import '../../core/theme.dart';
import '../../shared/widgets.dart';
import 'settings_screen.dart';

const _paymentTerms = ['weekly', 'fortnightly', 'monthly'];

/// The gangs who bring labour.
///
/// A contractor is not an abstraction here: Kannan's steel gang arrives together, is marked
/// together on the roll call and is paid as one bill, so the wage run is generated per contractor.
/// Payment terms are on the row because that is what decides how often that happens.
class ContractorsScreen extends ConsumerWidget {
  const ContractorsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final contractors = ref.watch(contractorsProvider);
    final me = ref.watch(authControllerProvider).me;
    final canManage = me?.can('contractors.manage') ?? false;
    final canDelete = me?.can('contractors.delete') ?? false;

    return AdminScaffold(
      title: 'Contractors',
      addLabel: 'Add contractor',
      onAdd: canManage ? () => adminSheet(context, const _ContractorForm()) : null,
      child: RefreshIndicator(
        onRefresh: () async {
          ref.invalidate(contractorsProvider);
          await ref.read(contractorsProvider.future);
        },
        child: AsyncSection<List<Map<String, dynamic>>>(
          value: contractors,
          onRetry: () => ref.invalidate(contractorsProvider),
          builder: (rows) {
            if (rows.isEmpty) {
              return ListView(
                children: [
                  EmptyNote(
                    icon: Icons.handshake_outlined,
                    title: 'No contractors yet',
                    body: canManage
                        ? 'Add the gangs you work with. Workers are grouped under them, and each '
                              'gang gets its own wage run.'
                        : 'Whoever runs the company account sets these up.',
                  ),
                ],
              );
            }

            return ListView.separated(
              padding: EdgeInsets.fromLTRB(16, 14, 16, bottomInset(context, hasFab: canManage)),
              itemCount: rows.length,
              separatorBuilder: (_, _) => const SizedBox(height: 10),
              itemBuilder: (context, index) {
                final contractor = rows[index];
                return Card(
                  child: ListTile(
                    contentPadding: const EdgeInsets.fromLTRB(16, 6, 8, 6),
                    title: Text(
                      contractor['name'] as String? ?? '',
                      style: const TextStyle(fontSize: 15.5, fontWeight: FontWeight.w600),
                    ),
                    subtitle: Text(
                      [
                        contractor['trade'],
                        contractor['phone'] == null ? null : '+${contractor['phone']}',
                        'Paid ${contractor['payment_terms'] ?? 'weekly'}',
                      ].whereType<String>().join(' · '),
                      style: const TextStyle(fontSize: 12.5, color: Palette.inkMuted),
                    ),
                    trailing: canManage
                        ? PopupMenuButton<String>(
                            icon: const Icon(Icons.more_vert, color: Palette.inkFaint),
                            itemBuilder: (_) => [
                              const PopupMenuItem(value: 'edit', child: Text('Edit')),
                              if (canDelete)
                                const PopupMenuItem(
                                  value: 'delete',
                                  child: Text(
                                    'Remove',
                                    style: TextStyle(color: Palette.blocked),
                                  ),
                                ),
                            ],
                            onSelected: (choice) async {
                              if (choice == 'edit') {
                                await adminSheet(
                                  context,
                                  _ContractorForm(existing: contractor),
                                );
                                return;
                              }
                              final messenger = ScaffoldMessenger.of(context);
                              final sure = await confirm(
                                context,
                                title: 'Remove ${contractor['name']}?',
                                body:
                                    'Their workers stay on the books and move to direct labour. '
                                    'Past attendance and wage runs are untouched.',
                                danger: 'Remove',
                              );
                              if (!sure) return;
                              try {
                                await ref
                                    .read(apiProvider)
                                    .removeContractor(contractor['id'] as String);
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
                          )
                        : null,
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

class _ContractorForm extends ConsumerStatefulWidget {
  const _ContractorForm({this.existing});

  final Map<String, dynamic>? existing;

  @override
  ConsumerState<_ContractorForm> createState() => _ContractorFormState();
}

class _ContractorFormState extends ConsumerState<_ContractorForm> {
  late final _name = TextEditingController(text: widget.existing?['name'] as String? ?? '');
  late final _trade = TextEditingController(text: widget.existing?['trade'] as String? ?? '');
  late final _phone = TextEditingController(text: widget.existing?['phone'] as String? ?? '');
  late String _terms = widget.existing?['payment_terms'] as String? ?? 'weekly';

  bool _saving = false;
  String? _error;

  bool get _editing => widget.existing != null;

  @override
  void dispose() {
    _name.dispose();
    _trade.dispose();
    _phone.dispose();
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
                Expanded(
                  child: Text(
                    _editing ? 'Edit contractor' : 'Add contractor',
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
            const AdminLabel('Name'),
            TextField(
              controller: _name,
              autofocus: !_editing,
              textCapitalization: TextCapitalization.words,
              decoration: const InputDecoration(hintText: 'Kannan steel gang'),
            ),
            const SizedBox(height: 16),
            const AdminLabel('Trade'),
            TextField(
              controller: _trade,
              textCapitalization: TextCapitalization.words,
              decoration: const InputDecoration(hintText: 'Reinforcement'),
            ),
            const SizedBox(height: 16),
            const AdminLabel('Phone'),
            TextField(
              controller: _phone,
              keyboardType: TextInputType.phone,
              decoration: const InputDecoration(prefixText: '+91  ', hintText: 'Optional'),
            ),
            const SizedBox(height: 16),
            const AdminLabel('How often they are paid'),
            DropdownButtonFormField<String>(
              initialValue: _terms,
              items: [
                for (final term in _paymentTerms)
                  DropdownMenuItem(value: term, child: Text(titleCase(term))),
              ],
              onChanged: (value) => setState(() => _terms = value ?? 'weekly'),
            ),
            const Padding(
              padding: EdgeInsets.only(top: 6),
              child: Text(
                'Decides the default range when a wage run is generated for them.',
                style: TextStyle(fontSize: 12, color: Palette.inkFaint),
              ),
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
                  : Text(_editing ? 'Save changes' : 'Add contractor'),
            ),
          ],
        ),
      ),
    );
  }

  Future<void> _submit() async {
    final name = _name.text.trim();
    if (name.isEmpty) {
      setState(() => _error = 'Give the gang a name');
      return;
    }

    setState(() {
      _saving = true;
      _error = null;
    });
    try {
      final api = ref.read(apiProvider);
      final trade = _trade.text.trim();
      final phone = _phone.text.trim();
      if (_editing) {
        await api.updateContractor(widget.existing!['id'] as String, {
          'name': name,
          'payment_terms': _terms,
          if (trade.isNotEmpty) 'trade': trade,
          if (phone.isNotEmpty) 'phone': phone,
        });
      } else {
        await api.createContractor(
          name: name,
          trade: trade,
          phone: phone,
          paymentTerms: _terms,
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
