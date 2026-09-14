import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/auth_controller.dart';
import '../../core/env.dart';
import '../../core/format.dart';
import '../../core/phone.dart';
import '../../core/theme.dart';
import '../../shared/animated_logo.dart';
import '../../shared/widgets.dart';

/// Who you are signed in as, and the way out.
///
/// The permission list is here on purpose. "Why can't I see wages?" is the most common question a
/// site app gets, and the honest answer — your role does not include it, ask whoever runs the
/// account — is better than a screen that pretends the feature does not exist.
class ProfileScreen extends ConsumerWidget {
  const ProfileScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final me = ref.watch(authControllerProvider).me;
    if (me == null) return const Scaffold(body: SizedBox.shrink());

    return Scaffold(
      appBar: AppBar(title: const Text('Your account')),
      body: ListView(
        padding: EdgeInsets.fromLTRB(16, 14, 16, bottomInset(context, hasBar: false)),
        children: [
          Card(
            child: Padding(
              padding: const EdgeInsets.all(18),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      const AnimatedLogo(size: 44),
                      const SizedBox(width: 14),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              me.name,
                              style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w700),
                            ),
                            Text(
                              formatIndianPhone(me.phone),
                              style: const TextStyle(fontSize: 13.5, color: Palette.inkMuted),
                            ),
                          ],
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 18),
                  const Divider(height: 1),
                  const SizedBox(height: 14),
                  _Row(label: 'Company', value: me.companyName),
                  _Row(
                    label: 'Role',
                    value: me.roleName.isEmpty ? titleCase(me.role) : me.roleName,
                  ),
                  _Row(label: 'Plan', value: me.planLabel),
                  _Row(
                    label: 'Sites',
                    value: me.seesAllProjects ? 'All sites' : 'Only the ones you are on',
                  ),
                ],
              ),
            ),
          ),
          const SizedBox(height: 22),
          const SectionLabel('What your role allows'),
          Card(
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Wrap(
                spacing: 8,
                runSpacing: 8,
                children: [
                  for (final permission in me.permissions)
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
                      decoration: BoxDecoration(
                        color: Palette.neutralBg,
                        borderRadius: BorderRadius.circular(999),
                      ),
                      child: Text(
                        permission,
                        style: const TextStyle(fontSize: 11.5, color: Palette.inkSoft),
                      ),
                    ),
                ],
              ),
            ),
          ),
          const SizedBox(height: 22),
          const SectionLabel('This build'),
          Card(
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  _Row(label: 'API', value: Env.apiUrl),
                  _Row(
                    label: 'Sign-in',
                    value: Env.devAuthBypass ? 'Development (no SMS)' : 'One-time code by SMS',
                  ),
                ],
              ),
            ),
          ),
          const SizedBox(height: 26),
          OutlinedButton.icon(
            style: OutlinedButton.styleFrom(foregroundColor: Palette.blocked),
            onPressed: () => _confirmSignOut(context, ref),
            icon: const Icon(Icons.logout, size: 18),
            label: const Text('Sign out'),
          ),
        ],
      ),
    );
  }

  Future<void> _confirmSignOut(BuildContext context, WidgetRef ref) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Sign out?'),
        content: const Text('You will need the code sent to your number to sign in again.'),
        actions: [
          TextButton(onPressed: () => Navigator.of(context).pop(false), child: const Text('Stay')),
          FilledButton(
            style: FilledButton.styleFrom(minimumSize: const Size(100, 44)),
            onPressed: () => Navigator.of(context).pop(true),
            child: const Text('Sign out'),
          ),
        ],
      ),
    );
    if (confirmed != true) return;
    await ref.read(authControllerProvider.notifier).signOut();
    // The shell swaps itself for the login screen; this closes the profile page behind it.
    if (context.mounted) Navigator.of(context).popUntil((route) => route.isFirst);
  }
}

class _Row extends StatelessWidget {
  const _Row({required this.label, required this.value});

  final String label;
  final String value;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.only(bottom: 10),
    child: Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        SizedBox(
          width: 92,
          child: Text(label, style: const TextStyle(fontSize: 13, color: Palette.inkMuted)),
        ),
        Expanded(
          child: Text(value, style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w500)),
        ),
      ],
    ),
  );
}
