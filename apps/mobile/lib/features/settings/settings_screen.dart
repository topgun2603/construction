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
import '../../core/i18n.dart';

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
        image: 'images/illus_contractors.png',
        icon: Icons.handshake_outlined,
        label: t('Contractors'),
        blurb: 'The gangs who bring labour, and how they are paid',
        allowed: me.can('contractors.manage'),
        builder: ContractorsScreen.new,
      ),
      _Entry(
        id: 'materials',
        image: 'images/illus_materials.png',
        icon: Icons.category_outlined,
        label: t('Materials'),
        blurb: 'What can be indented and booked into stock',
        allowed: me.can('materials.manage'),
        builder: MaterialsScreen.new,
      ),
      _Entry(
        id: 'team',
        image: 'images/illus_team.png',
        icon: Icons.badge_outlined,
        label: t('Team'),
        blurb: 'Who has a login, and what they can do',
        allowed: me.can('team.manage'),
        builder: TeamScreen.new,
      ),
      _Entry(
        id: 'roles',
        image: 'images/illus_roles.png',
        icon: Icons.lock_outline,
        label: t('Roles'),
        blurb: 'Permissions, for jobs the built-in roles do not fit',
        allowed: me.can('roles.manage'),
        builder: RolesScreen.new,
      ),
    ];

    final visible = entries.where((entry) => entry.allowed).toList();

    if (visible.isEmpty) {
      return EmptyNote(
        icon: Icons.lock_outline,
        title: t('Nothing to set up here'),
        body: t('These lists are managed by whoever runs the company account.'),
      );
    }

    return ListView(
      padding: EdgeInsets.fromLTRB(16, 14, 16, bottomInset(context)),
      children: [
        for (final entry in visible)
          _SetupCard(entry: entry),
      ],
    );
  }
}

class _Entry {
  const _Entry({
    required this.id,
    required this.image,
    required this.icon,
    required this.label,
    required this.blurb,
    required this.allowed,
    required this.builder,
  });

  final String id;
  final String image;

  /// Kept alongside the picture. The icon is what the row falls back to while the image decodes,
  /// and what it would show if an asset were ever missing — a card with a blank right half reads
  /// as broken, where a card with an icon reads as plain.
  final IconData icon;
  final String label;
  final String blurb;
  final bool allowed;
  final Widget Function() builder;
}

/// One of the four lists, as a card with its own picture.
///
/// The illustration bleeds off the right edge rather than sitting in a box. These four rows are
/// opened rarely and read quickly — a picture that reaches the edge is recognised before the label
/// is, which is what makes a rarely-visited hub navigable rather than four lines of grey text.
class _SetupCard extends StatelessWidget {
  const _SetupCard({required this.entry});

  final _Entry entry;

  @override
  Widget build(BuildContext context) {
    return Card(
      margin: const EdgeInsets.only(bottom: 12),
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: () => Navigator.of(
          context,
        ).push(MaterialPageRoute<void>(builder: (_) => entry.builder())),
        child: SizedBox(
          height: 132,
          child: Stack(
            children: [
              // Right of centre and bleeding off the edge, so the words always have the left half
              // to themselves whatever the picture's own composition is.
              Positioned(
                right: -10,
                top: 0,
                bottom: 0,
                width: 210,
                child: Image.asset(
                  entry.image,
                  fit: BoxFit.cover,
                  alignment: Alignment.centerLeft,
                  errorBuilder: (context, _, _) =>
                      Icon(entry.icon, size: 54, color: Palette.accentSoft),
                ),
              ),
              // A wash from the left, so a label never lands on a hard-hat.
              const Positioned.fill(
                child: DecoratedBox(
                  decoration: BoxDecoration(
                    gradient: LinearGradient(
                      begin: Alignment.centerLeft,
                      end: Alignment.centerRight,
                      stops: [0.0, 0.46, 0.78],
                      colors: [Color(0xFFFFFFFF), Color(0xF2FFFFFF), Color(0x00FFFFFF)],
                    ),
                  ),
                ),
              ),
              Padding(
                padding: const EdgeInsets.fromLTRB(16, 18, 150, 18),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    Row(
                      children: [
                        Flexible(
                          child: Text(
                            entry.label,
                            style: const TextStyle(
                              fontSize: 17,
                              fontWeight: FontWeight.w700,
                              color: Palette.ink,
                            ),
                          ),
                        ),
                        const SizedBox(width: 4),
                        const Icon(Icons.chevron_right, size: 20, color: Palette.inkFaint),
                      ],
                    ),
                    const SizedBox(height: 5),
                    Text(
                      entry.blurb,
                      style: const TextStyle(
                        fontSize: 12.5,
                        height: 1.4,
                        color: Palette.inkMuted,
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
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
