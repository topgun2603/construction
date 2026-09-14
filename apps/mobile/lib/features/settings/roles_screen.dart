import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api_client.dart';
import '../../core/api_providers.dart';
import '../../core/auth_controller.dart';
import '../../core/theme.dart';
import '../../shared/widgets.dart';
import 'settings_screen.dart';

/// Roles a company has defined for itself.
///
/// The five built-in roles cover most firms; this is for the ones they do not fit — a storekeeper
/// who books material but must not see wages, a partner who sees money on every site but files
/// nothing. Built-in roles are listed but not editable: changing what "owner" means underneath
/// everybody is not a thing a company should be able to do to itself by accident.
///
/// A new role starts from an existing one and is adjusted, rather than from an empty list of sixty
/// checkboxes. Starting from nothing produces roles that cannot do their job, and the person
/// building them finds out days later when somebody cannot file a report.
class RolesScreen extends ConsumerWidget {
  const RolesScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final roles = ref.watch(rolesProvider);
    final canManage = ref.watch(authControllerProvider).me?.can('roles.manage') ?? false;

    return AdminScaffold(
      title: 'Roles',
      addLabel: 'New role',
      onAdd: canManage ? () => adminSheet(context, const _RoleForm()) : null,
      child: RefreshIndicator(
        onRefresh: () async {
          ref.invalidate(rolesProvider);
          await ref.read(rolesProvider.future);
        },
        child: AsyncSection<List<Map<String, dynamic>>>(
          value: roles,
          onRetry: () => ref.invalidate(rolesProvider),
          builder: (rows) {
            final builtIn = rows.where((role) => role['is_system'] == true).toList();
            final custom = rows.where((role) => role['is_system'] != true).toList();

            return ListView(
              padding: EdgeInsets.fromLTRB(16, 14, 16, bottomInset(context, hasFab: canManage)),
              children: [
                const SectionLabel('Yours'),
                if (custom.isEmpty)
                  Card(
                    child: EmptyNote(
                      icon: Icons.lock_outline,
                      title: 'No roles of your own',
                      body: canManage
                          ? 'Start one from a built-in role and adjust what it can do.'
                          : 'Only the account owner can add these.',
                    ),
                  )
                else
                  for (final role in custom)
                    _RoleCard(role: role, canManage: canManage, editable: true),
                const SizedBox(height: 18),
                const SectionLabel('Built in'),
                for (final role in builtIn)
                  _RoleCard(role: role, canManage: canManage, editable: false),
              ],
            );
          },
        ),
      ),
    );
  }
}

class _RoleCard extends ConsumerWidget {
  const _RoleCard({required this.role, required this.canManage, required this.editable});

  final Map<String, dynamic> role;
  final bool canManage;
  final bool editable;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final permissions = (role['permissions'] as List<dynamic>? ?? const []).length;
    final members = (role['member_count'] as num?)?.toInt() ?? 0;

    return Card(
      margin: const EdgeInsets.only(bottom: 10),
      child: ListTile(
        contentPadding: const EdgeInsets.fromLTRB(16, 6, 8, 6),
        title: Text(
          role['name'] as String? ?? '',
          style: const TextStyle(fontSize: 15.5, fontWeight: FontWeight.w600),
        ),
        subtitle: Text(
          [
            '$permissions permission${permissions == 1 ? '' : 's'}',
            if (members > 0) '$members on it',
            if (role['sees_all_projects'] == true) 'every site',
          ].join(' · '),
          style: const TextStyle(fontSize: 12.5, color: Palette.inkMuted),
        ),
        trailing: canManage && editable
            ? PopupMenuButton<String>(
                icon: const Icon(Icons.more_vert, color: Palette.inkFaint),
                itemBuilder: (_) => const [
                  PopupMenuItem(value: 'edit', child: Text('Edit')),
                  PopupMenuItem(
                    value: 'delete',
                    child: Text('Remove', style: TextStyle(color: Palette.blocked)),
                  ),
                ],
                onSelected: (choice) async {
                  if (choice == 'edit') {
                    await adminSheet(context, _RoleForm(existing: role));
                    return;
                  }
                  final messenger = ScaffoldMessenger.of(context);
                  final sure = await confirm(
                    context,
                    title: 'Remove ${role['name']}?',
                    body: members > 0
                        ? 'Somebody is on this role. The server will refuse while that is true — '
                              'move them to another role first.'
                        : 'Nobody is on it, so nothing changes for anybody.',
                    danger: 'Remove',
                  );
                  if (!sure) return;
                  try {
                    await ref.read(apiProvider).removeRole(role['id'] as String);
                    messenger.showSnackBar(const SnackBar(content: Text('Removed')));
                  } on ApiException catch (error) {
                    messenger.showSnackBar(
                      SnackBar(content: Text(error.message), backgroundColor: Palette.blocked),
                    );
                  }
                },
              )
            : null,
      ),
    );
  }
}

/// Building or adjusting a role.
class _RoleForm extends ConsumerStatefulWidget {
  const _RoleForm({this.existing});

  final Map<String, dynamic>? existing;

  @override
  ConsumerState<_RoleForm> createState() => _RoleFormState();
}

class _RoleFormState extends ConsumerState<_RoleForm> {
  late final _name = TextEditingController(text: widget.existing?['name'] as String? ?? '');
  late String _baseRole = widget.existing?['base_role'] as String? ?? 'site_supervisor';
  late Set<String> _permissions = {
    ...(widget.existing?['permissions'] as List<dynamic>? ?? const []).cast<String>(),
  };
  late bool _seesAll = widget.existing?['sees_all_projects'] == true;

  bool _saving = false;
  String? _error;

  bool get _editing => widget.existing != null;

  @override
  void dispose() {
    _name.dispose();
    super.dispose();
  }

  /// Loads the base role's permissions as a starting set, replacing whatever was ticked.
  ///
  /// Only offered while creating. Doing it to an existing role would quietly undo deliberate
  /// adjustments somebody made months ago, which is worse than making them tick boxes.
  Future<void> _startFrom(String base, List<Map<String, dynamic>> roles) async {
    for (final role in roles) {
      if (role['is_system'] == true && role['key'] == base) {
        setState(() {
          _baseRole = base;
          _permissions = {
            ...(role['permissions'] as List<dynamic>? ?? const []).cast<String>(),
          };
          _seesAll = role['sees_all_projects'] == true;
        });
        return;
      }
    }
    setState(() => _baseRole = base);
  }

  @override
  Widget build(BuildContext context) {
    final catalogue = ref.watch(permissionCatalogueProvider);
    final roles = ref.watch(rolesProvider);

    return Padding(
      padding: EdgeInsets.only(bottom: MediaQuery.of(context).viewInsets.bottom),
      child: DraggableScrollableSheet(
        expand: false,
        initialChildSize: 0.9,
        maxChildSize: 0.95,
        builder: (context, controller) => ListView(
          controller: controller,
          padding: const EdgeInsets.fromLTRB(20, 16, 20, 28),
          children: [
            Row(
              children: [
                Expanded(
                  child: Text(
                    _editing ? 'Edit role' : 'New role',
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
            const AdminLabel('What you would call this job'),
            TextField(
              controller: _name,
              autofocus: !_editing,
              textCapitalization: TextCapitalization.words,
              decoration: const InputDecoration(hintText: 'Storekeeper'),
            ),
            if (!_editing) ...[
              const SizedBox(height: 16),
              const AdminLabel('Start from'),
              roles.when(
                loading: () => const Loading(),
                error: (error, _) => ErrorNote(error: error),
                data: (rows) => DropdownButtonFormField<String>(
                  initialValue: _baseRole,
                  items: [
                    for (final role in rows.where((row) => row['is_system'] == true))
                      DropdownMenuItem(
                        value: role['key'] as String,
                        child: Text(role['name'] as String? ?? ''),
                      ),
                  ],
                  onChanged: (value) {
                    if (value != null) unawaited(_startFrom(value, rows));
                  },
                ),
              ),
              const Padding(
                padding: EdgeInsets.only(top: 6),
                child: Text(
                  'Copies that role’s permissions, then you adjust them below.',
                  style: TextStyle(fontSize: 12, color: Palette.inkFaint),
                ),
              ),
            ],
            const SizedBox(height: 16),
            SwitchListTile(
              value: _seesAll,
              onChanged: (value) => setState(() => _seesAll = value),
              contentPadding: EdgeInsets.zero,
              title: const Text('Sees every site', style: TextStyle(fontSize: 14.5)),
              subtitle: const Text(
                'Off means they see only the sites they are put on.',
                style: TextStyle(fontSize: 12),
              ),
            ),
            const SizedBox(height: 8),
            const AdminLabel('What they can do'),
            catalogue.when(
              loading: () => const Loading(),
              error: (error, _) => ErrorNote(error: error),
              data: (groups) => Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  for (final group in groups)
                    _PermissionGroup(
                      title: group['group'] as String? ?? '',
                      items: (group['items'] as List<dynamic>? ?? const [])
                          .map((item) => Map<String, dynamic>.from(item as Map))
                          .toList(),
                      selected: _permissions,
                      onToggle: (permission, on) => setState(() {
                        if (on) {
                          _permissions.add(permission);
                        } else {
                          _permissions.remove(permission);
                        }
                      }),
                    ),
                ],
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
                  : Text(_editing ? 'Save changes' : 'Create role'),
            ),
          ],
        ),
      ),
    );
  }

  Future<void> _submit() async {
    final name = _name.text.trim();
    if (name.length < 2) {
      setState(() => _error = 'Give the role a name');
      return;
    }
    if (_permissions.isEmpty) {
      setState(() => _error = 'A role that can do nothing is not worth having');
      return;
    }

    setState(() {
      _saving = true;
      _error = null;
    });
    try {
      final api = ref.read(apiProvider);
      if (_editing) {
        await api.updateRole(widget.existing!['id'] as String, {
          'name': name,
          'permissions': _permissions.toList(),
          'sees_all_projects': _seesAll,
        });
      } else {
        await api.createRole(
          name: name,
          basedOn: _baseRole,
          permissions: _permissions.toList(),
          seesAllProjects: _seesAll,
        );
      }
      if (!mounted) return;
      Navigator.of(context).pop();
      notify(context, _editing ? 'Saved' : '$name created');
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() => _error = error.message);
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }
}

class _PermissionGroup extends StatelessWidget {
  const _PermissionGroup({
    required this.title,
    required this.items,
    required this.selected,
    required this.onToggle,
  });

  final String title;
  final List<Map<String, dynamic>> items;
  final Set<String> selected;
  final void Function(String permission, bool on) onToggle;

  @override
  Widget build(BuildContext context) => Column(
    crossAxisAlignment: CrossAxisAlignment.start,
    children: [
      Padding(
        padding: const EdgeInsets.fromLTRB(0, 14, 0, 2),
        child: Text(
          title.toUpperCase(),
          style: const TextStyle(
            fontSize: 11.5,
            fontWeight: FontWeight.w700,
            letterSpacing: 1,
            color: Palette.inkMuted,
          ),
        ),
      ),
      for (final item in items)
        CheckboxListTile(
          value: selected.contains(item['permission']),
          onChanged: (on) => onToggle(item['permission'] as String, on ?? false),
          contentPadding: EdgeInsets.zero,
          controlAffinity: ListTileControlAffinity.leading,
          dense: true,
          title: Text(item['label'] as String? ?? '', style: const TextStyle(fontSize: 14)),
          subtitle: item['note'] == null
              ? null
              : Text(
                  item['note'] as String,
                  style: const TextStyle(fontSize: 11.5, color: Palette.inkFaint),
                ),
        ),
    ],
  );
}
