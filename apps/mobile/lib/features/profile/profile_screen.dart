import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/auth_controller.dart';
import '../../core/env.dart';
import '../../core/format.dart';
import '../../core/phone.dart';
import '../../core/theme.dart';
import '../../shared/animated_logo.dart';
import '../../shared/widgets.dart';
import '../../core/i18n.dart';

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
      appBar: AppBar(title: Text(t('Your account'))),
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
                  _Row(label: t('Company'), value: me.companyName),
                  _Row(
                    label: t('Role'),
                    value: me.roleName.isEmpty ? titleCase(me.role) : me.roleName,
                  ),
                  _Row(
                    label: t('Sites'),
                    value: me.seesAllProjects ? 'All sites' : 'Only the ones you are on',
                  ),
                  const SizedBox(height: 14),
                  const Divider(height: 1),
                  const SizedBox(height: 10),
                  const _LanguagePicker(),
                ],
              ),
            ),
          ),
          const SizedBox(height: 22),
          SectionLabel(t('What your role allows')),
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
          SectionLabel(t('This build')),
          Card(
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  _Row(label: 'API', value: Env.apiUrl),
                  _Row(
                    label: t('Sign-in'),
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
            label: Text(t('Sign out')),
          ),
        ],
      ),
    );
  }

  Future<void> _confirmSignOut(BuildContext context, WidgetRef ref) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text(t('Sign out?')),
        content: Text(t('You will need the code sent to your number to sign in again.')),
        actions: [
          TextButton(onPressed: () => Navigator.of(context).pop(false), child: Text(t('Stay'))),
          FilledButton(
            style: FilledButton.styleFrom(minimumSize: const Size(100, 44)),
            onPressed: () => Navigator.of(context).pop(true),
            child: Text(t('Sign out')),
          ),
        ],
      ),
    );
    if (confirmed != true) return;
    if (!context.mounted) return;

    /*
     * A curtain while it happens.
     *
     * Signing out withdraws the push token and revokes the session on the server — two round
     * trips, and on a site with one bar of signal they are not quick. Until they finish the app
     * still looks signed in, so the button gets tapped again, and the second sign-out lands on a
     * session that is already going. The barrier is what stops that; the spinner is what explains
     * why nothing is happening.
     *
     * `barrierDismissible: false` and `canPop: false` together: no tap outside, no back gesture.
     * There is nothing to decide here and no way to cancel a sign-out halfway.
     */
    final rootNavigator = Navigator.of(context, rootNavigator: true);
    final pageNavigator = Navigator.of(context);
    unawaited(
      showDialog<void>(
        context: context,
        barrierDismissible: false,
        builder: (context) => PopScope(
          canPop: false,
          child: AlertDialog(
            content: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                SizedBox(
                  width: 20,
                  height: 20,
                  child: CircularProgressIndicator(strokeWidth: 2.4),
                ),
                SizedBox(width: 16),
                Text(t('Signing out…')),
              ],
            ),
          ),
        ),
      ),
    );

    try {
      await ref.read(authControllerProvider.notifier).signOut();
    } finally {
      // Both come down even if the revoke failed: `signOut` clears the session locally whatever
      // the server said, so leaving the curtain up would strand somebody who is already out.
      rootNavigator.pop();
      pageNavigator.popUntil((route) => route.isFirst);
    }
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

/// The language the app is in.
///
/// Here rather than in settings, with the rest of "things about me": a supervisor has no permission
/// to open the settings screens, and the language is the one preference that belongs to the person
/// rather than to the company.
///
/// Each language is offered in its own script, because somebody who cannot read the interface
/// cannot read the word "Tamil" either — but they can read "தமிழ்".
class _LanguagePicker extends ConsumerWidget {
  const _LanguagePicker();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final current = ref.watch(languageProvider);
    return Row(
      mainAxisAlignment: MainAxisAlignment.spaceBetween,
      children: [
        Text(t('Language'), style: const TextStyle(fontSize: 13.5, color: Palette.inkMuted)),
        Wrap(
          spacing: 8,
          children: [
            for (final entry in supportedLanguages.entries)
              ChoiceChip(
                label: Text(entry.value),
                selected: entry.key == current,
                onSelected: (_) => ref.read(languageProvider.notifier).set(entry.key),
              ),
          ],
        ),
      ],
    );
  }
}
