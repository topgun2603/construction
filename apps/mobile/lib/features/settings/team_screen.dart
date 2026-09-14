import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api_client.dart';
import '../../core/api_providers.dart';
import '../../core/auth_controller.dart';
import '../../core/format.dart';
import '../../core/theme.dart';
import '../../shared/widgets.dart';
import 'settings_screen.dart';

const _roles = ['owner', 'project_manager', 'site_supervisor', 'accounts', 'client'];

/// Who has a login.
///
/// Distinct from Workers, and the difference catches people out: a mason is a worker and has no
/// account; a site engineer is a team member and does. Somebody invited here can sign in with their
/// number and will see whatever their role allows.
///
/// Inviting writes the person and their role now — they become real the first time they sign in
/// with that number. There is no email, no link to click and nothing to accept, because the phone
/// number is already the identity everywhere else in this product.
class TeamScreen extends ConsumerWidget {
  const TeamScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final team = ref.watch(teamProvider);
    final me = ref.watch(authControllerProvider).me;
    final canManage = me?.can('team.manage') ?? false;

    return AdminScaffold(
      title: 'Team',
      addLabel: 'Invite',
      onAdd: canManage ? () => adminSheet(context, const _InviteForm()) : null,
      child: RefreshIndicator(
        onRefresh: () async {
          ref.invalidate(teamProvider);
          await ref.read(teamProvider.future);
        },
        child: AsyncSection<List<Map<String, dynamic>>>(
          value: team,
          onRetry: () => ref.invalidate(teamProvider),
          builder: (rows) {
            if (rows.isEmpty) {
              return ListView(
                children: const [
                  EmptyNote(
                    icon: Icons.badge_outlined,
                    title: 'Nobody else has a login',
                    body: 'Invite the people who need to see this app. Workers do not need one.',
                  ),
                ],
              );
            }

            return ListView.separated(
              padding: EdgeInsets.fromLTRB(16, 14, 16, bottomInset(context, hasFab: canManage)),
              itemCount: rows.length,
              separatorBuilder: (_, _) => const SizedBox(height: 10),
              itemBuilder: (context, index) {
                final member = rows[index];
                final isMe = member['id'] == me?.userId;
                final pending = member['status'] == 'pending';

                return Card(
                  child: ListTile(
                    contentPadding: const EdgeInsets.fromLTRB(16, 6, 8, 6),
                    title: Row(
                      children: [
                        Flexible(
                          child: Text(
                            member['name'] as String? ?? '',
                            overflow: TextOverflow.ellipsis,
                            style: const TextStyle(fontSize: 15.5, fontWeight: FontWeight.w600),
                          ),
                        ),
                        if (isMe) ...[
                          const SizedBox(width: 8),
                          const Text(
                            'you',
                            style: TextStyle(fontSize: 12, color: Palette.inkFaint),
                          ),
                        ],
                      ],
                    ),
                    subtitle: Text(
                      [
                        member['role_name'] as String? ??
                            titleCase(member['role'] as String? ?? ''),
                        '+${member['phone']}',
                        // A pending invite has never been used. Saying so stops somebody
                        // wondering why a person they added cannot see anything.
                        if (pending) 'has not signed in yet',
                      ].join(' · '),
                      style: const TextStyle(fontSize: 12.5, color: Palette.inkMuted),
                    ),
                    trailing: canManage && !isMe
                        ? IconButton(
                            icon: const Icon(
                              Icons.person_remove_outlined,
                              size: 20,
                              color: Palette.inkFaint,
                            ),
                            tooltip: 'Remove',
                            onPressed: () async {
                              final messenger = ScaffoldMessenger.of(context);
                              final sure = await confirm(
                                context,
                                title: 'Remove ${member['name']}?',
                                body:
                                    'They lose access immediately. Everything they filed — '
                                    'reports, roll calls, approvals — stays exactly as it is.',
                                danger: 'Remove',
                              );
                              if (!sure) return;
                              try {
                                await ref
                                    .read(apiProvider)
                                    .removeTeamMember(member['id'] as String);
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
                        // Removing yourself is the one action nobody wants to complete: it locks
                        // you out of the account you are administering, from inside it.
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

class _InviteForm extends ConsumerStatefulWidget {
  const _InviteForm();

  @override
  ConsumerState<_InviteForm> createState() => _InviteFormState();
}

class _InviteFormState extends ConsumerState<_InviteForm> {
  final _name = TextEditingController();
  final _phone = TextEditingController();

  String _role = 'site_supervisor';
  final Set<String> _projectIds = {};
  bool _saving = false;
  String? _error;

  /// A supervisor or a client only sees the sites they are put on, so the picker appears for them
  /// and not for the roles that see everything anyway.
  bool get _needsSites => _role == 'site_supervisor' || _role == 'client';

  @override
  void dispose() {
    _name.dispose();
    _phone.dispose();
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
          padding: const EdgeInsets.fromLTRB(20, 16, 20, 28),
          children: [
            Row(
              children: [
                const Expanded(
                  child: Text(
                    'Invite somebody',
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
              decoration: const InputDecoration(hintText: 'Suresh K'),
            ),
            const SizedBox(height: 16),
            const AdminLabel('Mobile number'),
            TextField(
              controller: _phone,
              keyboardType: TextInputType.phone,
              decoration: const InputDecoration(prefixText: '+91  ', hintText: '98765 43210'),
            ),
            const Padding(
              padding: EdgeInsets.only(top: 6),
              child: Text(
                'They sign in with this number. Nothing is sent — tell them yourself.',
                style: TextStyle(fontSize: 12, color: Palette.inkFaint),
              ),
            ),
            const SizedBox(height: 16),
            const AdminLabel('What they do'),
            DropdownButtonFormField<String>(
              initialValue: _role,
              items: [
                for (final role in _roles)
                  DropdownMenuItem(value: role, child: Text(titleCase(role))),
              ],
              onChanged: (value) => setState(() => _role = value ?? _role),
            ),
            if (_needsSites) ...[
              const SizedBox(height: 16),
              const AdminLabel('Which sites'),
              sites.when(
                loading: () => const Loading(),
                error: (error, _) => ErrorNote(error: error),
                data: (rows) => Column(
                  children: [
                    for (final site in rows)
                      CheckboxListTile(
                        value: _projectIds.contains(site['id']),
                        onChanged: (checked) => setState(() {
                          final id = site['id'] as String;
                          if (checked ?? false) {
                            _projectIds.add(id);
                          } else {
                            _projectIds.remove(id);
                          }
                        }),
                        contentPadding: EdgeInsets.zero,
                        controlAffinity: ListTileControlAffinity.leading,
                        dense: true,
                        title: Text(
                          site['name'] as String? ?? 'Site',
                          style: const TextStyle(fontSize: 14),
                        ),
                      ),
                  ],
                ),
              ),
              const Padding(
                padding: EdgeInsets.only(top: 4),
                child: Text(
                  'They see only these. More can be added later.',
                  style: TextStyle(fontSize: 12, color: Palette.inkFaint),
                ),
              ),
            ],
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
                  : const Text('Invite'),
            ),
          ],
        ),
      ),
    );
  }

  Future<void> _submit() async {
    final name = _name.text.trim();
    final phone = _phone.text.trim();
    if (name.isEmpty) {
      setState(() => _error = 'Enter their name');
      return;
    }
    if (phone.replaceAll(RegExp(r'\D'), '').length < 10) {
      setState(() => _error = 'Enter a 10-digit mobile number');
      return;
    }

    setState(() {
      _saving = true;
      _error = null;
    });
    try {
      await ref
          .read(apiProvider)
          .inviteTeamMember(
            name: name,
            phone: phone,
            role: _role,
            projectIds: _needsSites ? _projectIds.toList() : null,
          );
      if (!mounted) return;
      Navigator.of(context).pop();
      notify(context, '$name can now sign in');
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() => _error = error.message);
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }
}
