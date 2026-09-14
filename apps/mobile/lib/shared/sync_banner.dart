import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../core/api_providers.dart';
import '../core/db/sync.dart';
import '../core/auth_controller.dart';
import '../core/theme.dart';

/// What the phone is still holding.
///
/// Shown only when there is something to say. A permanent "you are online" badge trains people to
/// ignore the strip, and then it is worth nothing on the morning it says the opposite.
///
/// The wording matters more than it looks. Somebody who has just marked forty people needs to know
/// the work is *safe* — on the phone, going out on its own — not that a request failed. Failure
/// language here makes people re-mark a roll call that was never lost.
class SyncBanner extends ConsumerWidget {
  const SyncBanner({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final state = ref.watch(syncStateProvider).value ?? const SyncState();
    final me = ref.watch(authControllerProvider).me;

    /*
     * Above the queue, because it explains the queue.
     *
     * Once a term has run out the server refuses every write, so a supervisor marking a roll call
     * sees it fail and has no way to know why — the request looks exactly like a bad connection
     * from where they are standing. This is the only place in the app that says otherwise, and it
     * has to outrank a sync message that would otherwise be blaming the network.
     */
    if (me?.planExpired ?? false) {
      return const _Strip(
        background: Palette.blockedBg,
        foreground: Palette.blocked,
        icon: Icons.lock_clock,
        text: 'The plan has run out — you can read everything, but nothing new will save.',
      );
    }

    if (state.blocked > 0) {
      return _Strip(
        background: Palette.blockedBg,
        foreground: Palette.blocked,
        icon: Icons.error_outline,
        text: state.blocked == 1
            ? '1 entry the server refused. It is kept here — tell the office.'
            : '${state.blocked} entries the server refused. They are kept here — tell the office.',
      );
    }

    if (state.pending > 0) {
      return _Strip(
        background: Palette.pendingBg,
        foreground: Palette.pending,
        icon: state.sending ? Icons.cloud_upload_outlined : Icons.cloud_off,
        text: state.sending
            ? 'Sending ${state.pending} ${state.pending == 1 ? 'entry' : 'entries'}…'
            : '${state.pending} ${state.pending == 1 ? 'entry' : 'entries'} saved on this phone. '
                  'They will send themselves.',
        trailing: state.sending
            ? const SizedBox(
                height: 14,
                width: 14,
                child: CircularProgressIndicator(strokeWidth: 2, color: Palette.pending),
              )
            : TextButton(
                onPressed: () => ref.read(syncEngineProvider).drain(),
                style: TextButton.styleFrom(
                  minimumSize: const Size(0, 32),
                  padding: const EdgeInsets.symmetric(horizontal: 10),
                  foregroundColor: Palette.pending,
                ),
                child: const Text('Try now'),
              ),
      );
    }

    if (!state.online) {
      return const _Strip(
        background: Palette.neutralBg,
        foreground: Palette.inkSoft,
        icon: Icons.cloud_off,
        text: 'No network. Roll call and reports still work.',
      );
    }

    return const SizedBox.shrink();
  }
}

class _Strip extends StatelessWidget {
  const _Strip({
    required this.background,
    required this.foreground,
    required this.icon,
    required this.text,
    this.trailing,
  });

  final Color background;
  final Color foreground;
  final IconData icon;
  final String text;
  final Widget? trailing;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      color: background,
      padding: const EdgeInsets.fromLTRB(16, 8, 8, 8),
      child: Row(
        children: [
          Icon(icon, size: 16, color: foreground),
          const SizedBox(width: 8),
          Expanded(
            child: Text(text, style: TextStyle(fontSize: 12.5, color: foreground, height: 1.3)),
          ),
          ?trailing,
        ],
      ),
    );
  }
}
