import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api_providers.dart';
import '../../core/auth_controller.dart';
import '../../core/format.dart';
import '../../core/theme.dart';
import '../../shared/widgets.dart';
import '../shell/app_shell.dart';
import '../sites/site_detail_screen.dart';
import '../../core/i18n.dart';

/// Today.
///
/// The first screen answers one question — what needs me? — before it shows anything else. Which is
/// why the sites that have not filed a report sort to the top and the money sits below the fold: a
/// supervisor opening this at 7am is not doing budget analysis.
class HomeScreen extends ConsumerWidget {
  const HomeScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final me = ref.watch(authControllerProvider).me;
    final overview = ref.watch(overviewProvider);

    return RefreshIndicator(
      onRefresh: () async {
        ref.invalidate(overviewProvider);
        ref.invalidate(todayProvider);
        await ref.read(authControllerProvider.notifier).refreshMe();
        await ref.read(overviewProvider.future);
      },
      child: ListView(
        padding: EdgeInsets.fromLTRB(16, 14, 16, bottomInset(context)),
        children: [
          _GreetingBanner(greeting: _greeting(me?.name ?? '')),
          const SizedBox(height: 14),
          AsyncSection<Map<String, dynamic>>(
            value: overview,
            onRetry: () => ref.invalidate(overviewProvider),
            builder: (data) => _Overview(data: data),
          ),
        ],
      ),
    );
  }

  String _greeting(String name) {
    final first = name.split(' ').first;
    final hour = DateTime.now().hour;
    final part = hour < 12
        ? 'Good morning'
        : hour < 17
        ? 'Good afternoon'
        : 'Good evening';
    return first.isEmpty ? part : '$part, $first';
  }
}

class _Overview extends ConsumerWidget {
  const _Overview({required this.data});

  final Map<String, dynamic> data;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final me = ref.watch(authControllerProvider).me;
    final totals = Map<String, dynamic>.from(data['totals'] as Map? ?? {});
    final sites = (data['sites'] as List<dynamic>? ?? const [])
        .map((row) => Map<String, dynamic>.from(row as Map))
        .toList();

    // Sites needing a report first, then by headcount: the ones with people on them matter more
    // than the ones sitting idle.
    sites.sort((a, b) {
      final missing =
          (a['dpr_status'] == 'missing' ? 0 : 1) - (b['dpr_status'] == 'missing' ? 0 : 1);
      if (missing != 0) return missing;
      return ((b['headcount_today'] as num?) ?? 0).compareTo((a['headcount_today'] as num?) ?? 0);
    });

    final pendingIndents = (totals['pending_indents'] as num?)?.toInt() ?? 0;
    final pendingExpenses = (totals['pending_expenses'] as num?)?.toInt() ?? 0;
    final missingReports = sites.where((site) => site['dpr_status'] == 'missing').length;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            Expanded(
              child: StatTile(
                label: 'On site today',
                value: '${totals['headcount_today'] ?? 0}',
                icon: Icons.person_outline,
                tint: Palette.accentSoft,
                onTap: () => ref.read(currentSectionProvider.notifier).state = 'attendance',
              ),
            ),
            const SizedBox(width: 10),
            Expanded(
              child: StatTile(
                label: missingReports == 1 ? 'Report not filed' : 'Reports not filed',
                value: '$missingReports',
                icon: Icons.description_outlined,
                tint: missingReports > 0 ? Palette.pendingBg : null,
                tone: missingReports > 0 ? Palette.pending : null,
                onTap: () => ref.read(currentSectionProvider.notifier).state = 'dpr',
              ),
            ),
          ],
        ),
        const SizedBox(height: 10),
        Row(
          children: [
            if (me?.can('indents.approve') == true || me?.can('indents.raise') == true)
              Expanded(
                child: StatTile(
                  label: 'Indents waiting',
                  value: '$pendingIndents',
                  icon: Icons.local_shipping_outlined,
                  tint: pendingIndents > 0 ? Palette.pendingBg : Palette.doneBg,
                  tone: pendingIndents > 0 ? Palette.pending : null,
                  onTap: () => ref.read(currentSectionProvider.notifier).state = 'indents',
                ),
              ),
            if (me?.can('expenses.view') == true) ...[
              const SizedBox(width: 10),
              Expanded(
                child: StatTile(
                  label: 'Expenses waiting',
                  value: '$pendingExpenses',
                  icon: Icons.account_balance_wallet_outlined,
                  tint: pendingExpenses > 0 ? Palette.pendingBg : Palette.doneBg,
                  tone: pendingExpenses > 0 ? Palette.pending : null,
                  onTap: () => ref.read(currentSectionProvider.notifier).state = 'expenses',
                ),
              ),
            ],
          ],
        ),

        // Money only for the people whose job it is. A supervisor does not need the month's labour
        // bill on their home screen, and in most companies is not meant to see it at all.
        if (me?.can('reports.view') == true) ...[
          const SizedBox(height: 10),
          Row(
            children: [
              Expanded(
                child: StatTile(
                  label: 'Labour this month',
                  value: formatInrCompact(totals['labour_cost_month'] as String?),
                  icon: Icons.trending_up,
                  tint: Palette.accentSoft,
                ),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: StatTile(
                  label: 'Spend this month',
                  value: formatInrCompact(totals['spend_month'] as String?),
                  icon: Icons.bar_chart_rounded,
                  tint: Palette.pendingBg,
                ),
              ),
            ],
          ),
        ],

        const SizedBox(height: 24),
        SectionLabel(
          'Sites today',
          trailing: TextButton(
            onPressed: () => ref.read(currentSectionProvider.notifier).state = 'sites',
            child: Text(t('All sites')),
          ),
        ),
        if (sites.isEmpty)
          const Card(
            child: EmptyNote(
              icon: Icons.apartment_outlined,
              title: 'No running sites',
              body: 'Sites appear here once somebody adds them and they are not yet completed.',
            ),
          )
        else
          ListCard(children: [for (final site in sites.take(8)) _SiteToday(site: site)]),
      ],
    );
  }
}

class _SiteToday extends StatelessWidget {
  const _SiteToday({required this.site});

  final Map<String, dynamic> site;

  @override
  Widget build(BuildContext context) {
    final headcount = (site['headcount_today'] as num?)?.toInt() ?? 0;
    final dprStatus = site['dpr_status'] as String? ?? 'missing';
    final hasIssues = site['dpr_has_issues'] as bool? ?? false;

    return InkWell(
      onTap: () => Navigator.of(context).push(
        MaterialPageRoute<void>(
          builder: (_) => SiteDetailScreen(
            projectId: site['id'] as String,
            name: site['name'] as String? ?? 'Site',
          ),
        ),
      ),
      child: Padding(
        padding: const EdgeInsets.fromLTRB(16, 13, 12, 13),
        child: Row(
          children: [
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    site['name'] as String? ?? 'Site',
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(fontSize: 15.5, fontWeight: FontWeight.w600),
                  ),
                  const SizedBox(height: 3),
                  Row(
                    children: [
                      Icon(
                        Icons.person_outline,
                        size: 14,
                        color: headcount > 0 ? Palette.inkMuted : Palette.inkFaint,
                      ),
                      const SizedBox(width: 3),
                      Text(
                        headcount > 0 ? '$headcount on site' : 'nobody marked',
                        style: TextStyle(
                          fontSize: 12.5,
                          color: headcount > 0 ? Palette.inkMuted : Palette.inkFaint,
                        ),
                      ),
                      if (hasIssues) ...[
                        const SizedBox(width: 10),
                        const Icon(Icons.warning_amber_rounded, size: 14, color: Palette.blocked),
                        const SizedBox(width: 3),
                        const Text(
                          'issue reported',
                          style: TextStyle(fontSize: 12.5, color: Palette.blocked),
                        ),
                      ],
                    ],
                  ),
                ],
              ),
            ),
            const SizedBox(width: 8),
            StatusPill(
              dprStatus == 'missing' ? 'pending' : 'submitted',
              label: dprStatus == 'missing' ? 'No report' : 'Reported',
            ),
            const Icon(Icons.chevron_right, size: 20, color: Palette.inkFaint),
          ],
        ),
      ),
    );
  }
}

/// The day, over the site.
///
/// A greeting in plain text was two lines of grey at the top of a screen that is otherwise numbers.
/// Behind a photograph of a site it is the one thing on this screen that is not a figure — which is
/// what makes the figures underneath read as a summary rather than as a wall.
class _GreetingBanner extends StatelessWidget {
  const _GreetingBanner({required this.greeting});

  final String greeting;

  @override
  Widget build(BuildContext context) {
    // Split so the name can carry the weight: "Good afternoon," is the part nobody reads twice.
    final comma = greeting.indexOf(',');
    final salutation = comma == -1 ? greeting : greeting.substring(0, comma + 1);
    final name = comma == -1 ? '' : greeting.substring(comma + 1).trim();

    return ClipRRect(
      borderRadius: BorderRadius.circular(18),
      child: SizedBox(
        height: 132,
        child: Stack(
          fit: StackFit.expand,
          children: [
            Image.asset('images/photo_site_hero.png', fit: BoxFit.cover),
            // Dark here, unlike the sign-in hero: this photograph is a bright midday sky and the
            // type over it is white, so the gap opens by darkening rather than by washing out.
            const DecoratedBox(
              decoration: BoxDecoration(
                gradient: LinearGradient(
                  begin: Alignment.centerLeft,
                  end: Alignment.centerRight,
                  stops: [0.0, 0.55, 1.0],
                  colors: [Color(0xD91B1A2E), Color(0x8C1B1A2E), Color(0x331B1A2E)],
                ),
              ),
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 0, 16, 0),
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    salutation,
                    style: const TextStyle(fontSize: 14, color: Colors.white70),
                  ),
                  if (name.isNotEmpty)
                    Text(
                      name,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        fontSize: 23,
                        fontWeight: FontWeight.w800,
                        color: Colors.white,
                      ),
                    ),
                  const SizedBox(height: 2),
                  Text(
                    longDate(todayIso()),
                    style: const TextStyle(fontSize: 13, color: Colors.white70),
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
