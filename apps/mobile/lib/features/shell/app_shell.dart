import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api_providers.dart';
import '../../core/auth_controller.dart';
import '../../core/push.dart';
import '../../core/session.dart';
import '../../core/theme.dart';
import '../../shared/animated_logo.dart';
import '../../shared/sync_banner.dart';
import 'bottom_bar.dart';
import '../attendance/attendance_screen.dart';
import '../documents/documents_screen.dart';
import '../dpr/dpr_screen.dart';
import '../expenses/expenses_screen.dart';
import '../home/home_screen.dart';
import '../indents/indents_screen.dart';
import '../notifications/notifications_screen.dart';
import '../portal/site_conversation_screen.dart';
import '../profile/profile_screen.dart';
import '../settings/settings_screen.dart';
import '../wages/wage_periods_screen.dart';
import '../sites/sites_screen.dart';
import '../stock/stock_screen.dart';
import '../workers/workers_screen.dart';

/// One section of the app.
///
/// `permission` and `module` are the same strings the API checks. A destination whose permission the
/// person lacks is not shown — not shown greyed out, not shown leading to a 403. The role decides
/// the navigation, which is why a client's app is four items and an owner's is ten.
class Destination {
  const Destination({
    required this.id,
    required this.label,
    required this.icon,
    required this.builder,
    this.permission,
    this.module,
    this.primary = false,
  });

  final String id;
  final String label;
  final IconData icon;
  final Widget Function() builder;

  /// Any one of these is enough. Null means everybody.
  final String? permission;

  /// A module the company must be paying for.
  final String? module;

  /// Whether it earns a place in the bottom bar, if the role has room for it.
  final bool primary;

  bool allowed(Me me) {
    if (module != null && !me.hasModule(module!)) return false;
    if (permission != null && !me.can(permission!)) return false;
    return true;
  }
}

final _destinations = <Destination>[
  Destination(
    id: 'home',
    label: 'Today',
    icon: Icons.home_outlined,
    builder: HomeScreen.new,
    /*
     * Today is the cost-and-approvals screen, and the API refuses `/dashboard` to anybody without
     * `expenses.view` — a client must never be shown the labour cost of the house they are paying
     * a fixed price for. Without this the client's app would open on an error, which is the worst
     * first screen there is.
     */
    permission: 'expenses.view',
    primary: true,
  ),
  Destination(
    id: 'sites',
    label: 'Sites',
    icon: Icons.apartment_outlined,
    builder: SitesScreen.new,
    permission: 'projects.view',
    primary: true,
  ),
  Destination(
    id: 'attendance',
    label: 'Roll call',
    icon: Icons.how_to_reg_outlined,
    builder: AttendanceScreen.new,
    permission: 'attendance.view',
    primary: true,
  ),
  Destination(
    id: 'dpr',
    label: 'Reports',
    icon: Icons.assignment_outlined,
    builder: DprScreen.new,
    permission: 'dpr.view',
    primary: true,
  ),
  Destination(
    id: 'documents',
    label: 'Documents',
    icon: Icons.folder_open_outlined,
    builder: DocumentsScreen.new,
    permission: 'documents.view',
    module: 'documents',
    /*
     * Primary, because of who it is primary *for*. A client's app is Today, Sites, Reports and
     * this — the drawings and the contract are half of what they were given an account to see.
     * An owner has ten destinations and the bar takes the first four, so this stays in their
     * drawer without anybody having to say so twice.
     */
    primary: true,
  ),
  Destination(
    id: 'workers',
    label: 'Workers',
    icon: Icons.groups_outlined,
    builder: WorkersScreen.new,
    permission: 'workers.view',
  ),
  Destination(
    id: 'indents',
    label: 'Indents',
    icon: Icons.local_shipping_outlined,
    builder: IndentsScreen.new,
    permission: 'indents.raise',
  ),
  Destination(
    id: 'expenses',
    label: 'Expenses',
    icon: Icons.receipt_long_outlined,
    builder: ExpensesScreen.new,
    permission: 'expenses.view',
  ),
  Destination(
    id: 'wages',
    label: 'Wages',
    icon: Icons.receipt_long_outlined,
    builder: WagePeriodsScreen.new,
    permission: 'wages.view',
  ),
  Destination(
    id: 'settings',
    label: 'Set up',
    icon: Icons.tune,
    builder: SettingsScreen.new,
    // Any one of these opens the hub; the hub itself decides which lists to show.
    permission: 'contractors.manage',
  ),
  Destination(
    id: 'stock',
    label: 'Stock',
    icon: Icons.inventory_2_outlined,
    builder: StockScreen.new,
    permission: 'stock.view',
    module: 'stock',
  ),
];

/// Which section is on screen.
final currentSectionProvider = StateProvider<String>((ref) => 'home');

/// The app: a top bar, a drawer, a bottom bar, and whichever section is showing.
///
/// One Scaffold rather than a navigator stack for the sections, because moving between them is
/// switching channel, not going deeper — a back button that walks you through five sections you
/// happened to visit is a thing people escape by force-quitting. Detail screens *do* push, so back
/// means "up out of this worker" and nothing else.
class AppShell extends ConsumerWidget {
  const AppShell({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final me = ref.watch(authControllerProvider).me;
    if (me == null) return const SizedBox.shrink();

    final allowed = _destinations.where((destination) => destination.allowed(me)).toList();
    final currentId = ref.watch(currentSectionProvider);
    final current = allowed.firstWhere(
      (destination) => destination.id == currentId,
      orElse: () => allowed.first,
    );

    // Four is the most a thumb reaches without looking. Everything else lives in the drawer, and
    // the fourth slot becomes "More" when there is more than the bar can hold.
    final primary = allowed.where((destination) => destination.primary).take(4).toList();
    final showBar = primary.length > 1;

    /*
     * A tapped notification is handled here rather than where it arrives: the push service runs
     * outside the widget tree and has no navigator, and this is the one widget that is always on
     * screen while somebody is signed in — including on a cold start from the launch intent, which
     * is why the pending tap is read on every build rather than only on a change.
     */
    final tap = ref.watch(pushTapProvider);
    if (tap != null) {
      WidgetsBinding.instance.addPostFrameCallback((_) => _openTapped(context, ref, tap, allowed));
    }

    return Scaffold(
      appBar: _TopBar(title: current.label, me: me),
      drawer: _Drawer(destinations: allowed, currentId: current.id, me: me),
      /*
       * The bar floats over the content rather than pushing it up, so a list scrolls behind it.
       * Every scrolling screen adds `bottomInset(context)` to its own padding, which is what keeps
       * the last row clear of both the bar and the phone's gesture strip.
       */
      extendBody: true,
      body: Column(
        children: [
          // Above the section, not inside it: the queue belongs to the app, not to whichever
          // screen happens to be open when the signal drops.
          const SyncBanner(),
          Expanded(child: current.builder()),
        ],
      ),
      bottomNavigationBar: showBar
          ? FloatingBottomBar(
              items: [
                for (final destination in primary)
                  (icon: destination.icon, label: destination.label),
              ],
              selectedIndex: primary
                  .indexWhere((d) => d.id == current.id)
                  .clamp(0, primary.length - 1),
              onSelected: (index) =>
                  ref.read(currentSectionProvider.notifier).state = primary[index].id,
            )
          : null,
    );
  }
}

/// Follows a tapped notification to wherever it belongs.
///
/// The section is offered only if this person's role has it; a notification can outlive a
/// permission, and a client who is sent an indent decision must not be dropped on a screen their
/// navigation does not contain. Everything else — and everything with no mobile section at all,
/// like a drafted wage sheet — opens the notification list, which always has something to show.
void _openTapped(BuildContext context, WidgetRef ref, PushTap tap, List<Destination> allowed) {
  ref.read(pushTapProvider.notifier).state = null;
  if (!context.mounted) return;

  /*
   * Something said on a site opens that site's thread, not a list.
   *
   * A message is the one notification where the useful destination is a conversation rather than a
   * section — and the reply somebody is being asked for is two taps away if this drops them on a
   * notification list instead.
   */
  if (tap.type.startsWith('message.') && tap.projectId != null) {
    Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (_) => SiteConversationScreen(projectId: tap.projectId!),
      ),
    );
    return;
  }

  final section = sectionForNotification(tap.type);
  if (section != null && allowed.any((destination) => destination.id == section)) {
    ref.read(currentSectionProvider.notifier).state = section;
    return;
  }

  Navigator.of(context).push(MaterialPageRoute<void>(builder: (_) => const NotificationsScreen()));
}

class _TopBar extends ConsumerWidget implements PreferredSizeWidget {
  const _TopBar({required this.title, required this.me});

  final String title;
  final Me me;

  @override
  Size get preferredSize => const Size.fromHeight(60);

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final unread = ref.watch(unreadCountProvider);

    return AppBar(
      toolbarHeight: 60,
      title: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Text(title, style: const TextStyle(fontSize: 17.5, fontWeight: FontWeight.w700)),
          Text(
            me.companyName,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: const TextStyle(fontSize: 12, color: Palette.inkMuted),
          ),
        ],
      ),
      actions: [
        IconButton(
          tooltip: 'Notifications',
          onPressed: () => Navigator.of(
            context,
          ).push(MaterialPageRoute<void>(builder: (_) => const NotificationsScreen())),
          icon: Badge(
            isLabelVisible: unread > 0,
            backgroundColor: Palette.blocked,
            label: Text(unread > 99 ? '99+' : '$unread'),
            child: const Icon(Icons.notifications_none, size: 24),
          ),
        ),
        Padding(
          padding: const EdgeInsets.only(right: 12, left: 4),
          child: InkWell(
            borderRadius: BorderRadius.circular(999),
            onTap: () => Navigator.of(
              context,
            ).push(MaterialPageRoute<void>(builder: (_) => const ProfileScreen())),
            child: _Avatar(name: me.name),
          ),
        ),
      ],
    );
  }
}

class _Avatar extends StatelessWidget {
  const _Avatar({required this.name});

  final String name;

  @override
  Widget build(BuildContext context) {
    final initials = name
        .trim()
        .split(RegExp(r'\s+'))
        .where((part) => part.isNotEmpty)
        .take(2)
        .map((part) => part[0].toUpperCase())
        .join();
    return Container(
      width: 34,
      height: 34,
      decoration: const BoxDecoration(color: Palette.accentSoft, shape: BoxShape.circle),
      alignment: Alignment.center,
      child: Text(
        initials.isEmpty ? '?' : initials,
        style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w700, color: Palette.accent),
      ),
    );
  }
}

class _Drawer extends ConsumerWidget {
  const _Drawer({required this.destinations, required this.currentId, required this.me});

  final List<Destination> destinations;
  final String currentId;
  final Me me;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return Drawer(
      backgroundColor: Palette.surface,
      child: SafeArea(
        child: Column(
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(20, 18, 20, 16),
              child: Row(
                children: [
                  const AnimatedLogo(size: 38),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          me.companyName,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w700),
                        ),
                        Text(
                          '${me.name} · ${me.roleName.isEmpty ? me.role : me.roleName}',
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(fontSize: 12.5, color: Palette.inkMuted),
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            ),
            const Divider(height: 1),
            Expanded(
              child: ListView(
                padding: const EdgeInsets.symmetric(vertical: 8),
                children: [
                  for (final destination in destinations)
                    ListTile(
                      leading: Icon(
                        destination.icon,
                        color: destination.id == currentId ? Palette.accent : Palette.inkSoft,
                      ),
                      title: Text(
                        destination.label,
                        style: TextStyle(
                          fontSize: 15,
                          fontWeight: destination.id == currentId
                              ? FontWeight.w600
                              : FontWeight.w400,
                          color: destination.id == currentId ? Palette.accent : Palette.ink,
                        ),
                      ),
                      selected: destination.id == currentId,
                      selectedTileColor: Palette.raised,
                      onTap: () {
                        ref.read(currentSectionProvider.notifier).state = destination.id;
                        Navigator.of(context).pop();
                      },
                    ),
                  const Divider(height: 17, indent: 16, endIndent: 16),
                  ListTile(
                    leading: const Icon(Icons.person_outline, color: Palette.inkSoft),
                    title: const Text('Your account', style: TextStyle(fontSize: 15)),
                    onTap: () {
                      Navigator.of(context).pop();
                      Navigator.of(
                        context,
                      ).push(MaterialPageRoute<void>(builder: (_) => const ProfileScreen()));
                    },
                  ),
                ],
              ),
            ),
            const Divider(height: 1),
            Padding(
              padding: const EdgeInsets.fromLTRB(20, 12, 20, 14),
              child: Row(
                children: [
                  const Text(
                    'BUILDR',
                    style: TextStyle(
                      fontSize: 12,
                      letterSpacing: 1.4,
                      fontWeight: FontWeight.w700,
                      color: Palette.inkFaint,
                    ),
                  ),
                  const Spacer(),
                  Text(
                    me.plan.isEmpty
                        ? ''
                        : '${me.plan[0].toUpperCase()}${me.plan.substring(1)} plan',
                    style: const TextStyle(fontSize: 12, color: Palette.inkFaint),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}
