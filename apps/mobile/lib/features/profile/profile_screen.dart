import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api_providers.dart';
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
                  if (me.planExpiresOn != null)
                    _Row(
                      label: 'Runs until',
                      value: longDate(me.planExpiresOn!.substring(0, 10)),
                    ),
                  _Row(
                    label: 'Sites',
                    value: me.seesAllProjects ? 'All sites' : 'Only the ones you are on',
                  ),
                ],
              ),
            ),
          ),
          const SizedBox(height: 22),
          const _PlanCatalogue(),
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

/// What a builder can buy, straight from the catalogue an operator edits.
///
/// Quiet when the API cannot answer. This sits below the account card on a screen somebody opened
/// to check who they are signed in as — a red error box about a price list would be noise.
class _PlanCatalogue extends ConsumerWidget {
  const _PlanCatalogue();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final plans = ref.watch(plansProvider).valueOrNull;
    if (plans == null || plans.isEmpty) return const SizedBox.shrink();

    final current = ref.watch(authControllerProvider).me?.plan;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const SectionLabel('What you can buy'),
        for (final plan in plans) _PlanCard(plan: plan, yours: plan['code'] == current),
        const SizedBox(height: 8),
        const Padding(
          padding: EdgeInsets.only(bottom: 22),
          child: Text(
            'Every plan includes every feature. What you buy is how long it runs. '
            'Talk to us to change or renew it.',
            style: TextStyle(fontSize: 12.5, color: Palette.inkMuted),
          ),
        ),
      ],
    );
  }
}

class _PlanCard extends StatelessWidget {
  const _PlanCard({required this.plan, required this.yours});

  final Map<String, dynamic> plan;
  final bool yours;

  @override
  Widget build(BuildContext context) {
    final badge = (plan['badge'] as String?)?.trim();
    final months = plan['months'] as int?;
    final highlights = (plan['highlights'] as List<dynamic>? ?? const [])
        .map((line) => line.toString())
        .toList();

    // A badged plan is the one being pushed, so it is the one that looks different. Yours wins the
    // outline when both apply: on your own account screen, which one you are on matters more.
    final outlined = yours || (badge != null && badge.isNotEmpty);

    return Card(
      margin: const EdgeInsets.only(bottom: 10),
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(14),
        side: BorderSide(
          color: outlined ? Palette.accent : Palette.line,
          width: outlined ? 1.4 : 1,
        ),
      ),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Expanded(
                  child: Text(
                    plan['name']?.toString() ?? '',
                    style: const TextStyle(fontSize: 15.5, fontWeight: FontWeight.w700),
                  ),
                ),
                if (yours)
                  const _Pill(text: 'Yours', background: Palette.doneBg, foreground: Palette.done)
                else if (badge != null && badge.isNotEmpty)
                  _Pill(text: badge, background: Palette.accentSoft, foreground: Palette.accent),
              ],
            ),
            const SizedBox(height: 6),
            Row(
              crossAxisAlignment: CrossAxisAlignment.baseline,
              textBaseline: TextBaseline.alphabetic,
              children: [
                Text(
                  formatInr(plan['price']?.toString()),
                  style: const TextStyle(fontSize: 19, fontWeight: FontWeight.w700),
                ),
                const SizedBox(width: 8),
                Text(
                  months == null ? 'once, never again' : 'for $months months',
                  style: const TextStyle(fontSize: 12.5, color: Palette.inkMuted),
                ),
              ],
            ),
            if ((plan['description'] as String?)?.isNotEmpty ?? false) ...[
              const SizedBox(height: 6),
              Text(
                plan['description'].toString(),
                style: const TextStyle(fontSize: 12.5, color: Palette.inkSoft),
              ),
            ],
            if (highlights.isNotEmpty) ...[
              const SizedBox(height: 8),
              for (final line in highlights)
                Padding(
                  padding: const EdgeInsets.only(bottom: 4),
                  child: Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const Icon(Icons.check, size: 14, color: Palette.done),
                      const SizedBox(width: 6),
                      Expanded(
                        child: Text(
                          line,
                          style: const TextStyle(fontSize: 12.5, color: Palette.inkSoft),
                        ),
                      ),
                    ],
                  ),
                ),
            ],
          ],
        ),
      ),
    );
  }
}

class _Pill extends StatelessWidget {
  const _Pill({required this.text, required this.background, required this.foreground});

  final String text;
  final Color background;
  final Color foreground;

  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
    decoration: BoxDecoration(color: background, borderRadius: BorderRadius.circular(999)),
    child: Text(
      text,
      style: TextStyle(fontSize: 11.5, fontWeight: FontWeight.w700, color: foreground),
    ),
  );
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
