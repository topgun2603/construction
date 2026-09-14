import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/auth_controller.dart';
import '../../core/session.dart';
import '../../core/theme.dart';
import '../../shared/widgets.dart';
import 'contractors_screen.dart';
import 'materials_screen.dart';
import 'roles_screen.dart';
import 'team_screen.dart';

/// The lists a company sets up once and edits rarely.
///
/// A hub rather than four more items in the drawer. These are opened when something is wrong — a
/// gang was renamed, a material is missing from the indent picker, somebody new needs a login —
/// and burying them one tap deeper is the right trade against making the everyday navigation
/// longer for everybody.
///
/// Each row is gated on the permission the API enforces for that list, so what an owner sees and
/// what a supervisor sees are different screens rather than the same screen with dead rows.
class SettingsScreen extends ConsumerWidget {
  const SettingsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final me = ref.watch(authControllerProvider).me;
    if (me == null) return const SizedBox.shrink();

    final entries = <_Entry>[
      _Entry(
        id: 'contractors',
        icon: Icons.handshake_outlined,
        label: 'Contractors',
        blurb: 'The gangs who bring labour, and how they are paid',
        allowed: me.can('contractors.manage'),
        builder: ContractorsScreen.new,
      ),
      _Entry(
        id: 'materials',
        icon: Icons.category_outlined,
        label: 'Materials',
        blurb: 'What can be indented and booked into stock',
        allowed: me.can('materials.manage'),
        builder: MaterialsScreen.new,
      ),
      _Entry(
        id: 'team',
        icon: Icons.badge_outlined,
        label: 'Team',
        blurb: 'Who has a login, and what they can do',
        allowed: me.can('team.manage'),
        builder: TeamScreen.new,
      ),
      _Entry(
        id: 'roles',
        icon: Icons.lock_outline,
        label: 'Roles',
        blurb: 'Permissions, for jobs the built-in roles do not fit',
        allowed: me.can('roles.manage'),
        builder: RolesScreen.new,
      ),
    ];

    final visible = entries.where((entry) => entry.allowed).toList();

    if (visible.isEmpty) {
      return const EmptyNote(
        icon: Icons.lock_outline,
        title: 'Nothing to set up here',
        body: 'These lists are managed by whoever runs the company account.',
      );
    }

    return ListView(
      padding: EdgeInsets.fromLTRB(16, 14, 16, bottomInset(context)),
      children: [
        for (final entry in visible)
          Card(
            margin: const EdgeInsets.only(bottom: 10),
            child: ListTile(
              contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 6),
              leading: Icon(entry.icon, color: Palette.accent),
              title: Text(
                entry.label,
                style: const TextStyle(fontSize: 15.5, fontWeight: FontWeight.w600),
              ),
              subtitle: Text(
                entry.blurb,
                style: const TextStyle(fontSize: 12.5, color: Palette.inkMuted),
              ),
              trailing: const Icon(Icons.chevron_right, color: Palette.inkFaint),
              onTap: () => Navigator.of(
                context,
              ).push(MaterialPageRoute<void>(builder: (_) => entry.builder())),
            ),
          ),
      ],
    );
  }
}

class _Entry {
  const _Entry({
    required this.id,
    required this.icon,
    required this.label,
    required this.blurb,
    required this.allowed,
    required this.builder,
  });

  final String id;
  final IconData icon;
  final String label;
  final String blurb;
  final bool allowed;
  final Widget Function() builder;
}

/// Shared chrome for the four lists below it: a title, a back arrow, and a floating add button
/// that is absent rather than disabled when somebody may not use it.
class AdminScaffold extends StatelessWidget {
  const AdminScaffold({
    super.key,
    required this.title,
    required this.child,
    this.onAdd,
    this.addLabel = 'Add',
  });

  final String title;
  final Widget child;
  final VoidCallback? onAdd;
  final String addLabel;

  @override
  Widget build(BuildContext context) => Scaffold(
    backgroundColor: Palette.canvas,
    appBar: AppBar(title: Text(title)),
    floatingActionButton: onAdd == null
        ? null
        : FloatingActionButton.extended(
            backgroundColor: Palette.accent,
            foregroundColor: Colors.white,
            onPressed: onAdd,
            icon: const Icon(Icons.add),
            label: Text(addLabel),
          ),
    body: child,
  );
}

/// Opens a form sheet the way every other form in this app opens.
Future<T?> adminSheet<T>(BuildContext context, Widget child) => showModalBottomSheet<T>(
  context: context,
  isScrollControlled: true,
  backgroundColor: Palette.surface,
  shape: const RoundedRectangleBorder(
    borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
  ),
  builder: (_) => child,
);

/// The label every form field in these screens uses.
class AdminLabel extends StatelessWidget {
  const AdminLabel(this.text, {super.key});

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

/// A refusal from the server, shown where the form can see it.
class AdminError extends StatelessWidget {
  const AdminError(this.message, {super.key});

  final String message;

  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
    decoration: BoxDecoration(color: Palette.blockedBg, borderRadius: BorderRadius.circular(10)),
    child: Text(message, style: const TextStyle(color: Palette.blocked, fontSize: 13.5)),
  );
}

/// Kept here so the four screens do not each grow their own.
Me? currentUser(WidgetRef ref) => ref.watch(authControllerProvider).me;
