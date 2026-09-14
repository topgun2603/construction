import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api_providers.dart';
import '../../core/auth_controller.dart';
import '../../core/format.dart';
import '../../core/theme.dart';
import '../../shared/site_map.dart';
import '../../shared/site_photos.dart';
import '../../shared/widgets.dart';
import 'payment_schedule.dart';
import '../documents/documents_list.dart';
import '../portal/site_conversation_screen.dart';

/// One site: what it is, where it has got to, and who is on it.
class SiteDetailScreen extends ConsumerWidget {
  const SiteDetailScreen({super.key, required this.projectId, required this.name});

  final String projectId;
  final String name;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final site = ref.watch(siteProvider(projectId));
    final me = ref.watch(authControllerProvider).me;

    return Scaffold(
      appBar: AppBar(title: Text(name)),
      body: RefreshIndicator(
        onRefresh: () async {
          ref.invalidate(siteProvider(projectId));
          ref.invalidate(milestonesProvider(projectId));
          ref.invalidate(siteMembersProvider(projectId));
          ref.invalidate(siteMediaProvider(projectId));
          ref.invalidate(documentsProvider(projectId));
          await ref.read(siteProvider(projectId).future);
        },
        child: ListView(
          padding: EdgeInsets.fromLTRB(16, 14, 16, bottomInset(context, hasBar: false)),
          children: [
            AsyncSection<Map<String, dynamic>>(
              value: site,
              onRetry: () => ref.invalidate(siteProvider(projectId)),
              builder: (data) => Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  _Header(site: data, canSeeMoney: me?.can('reports.view') ?? false),
                  const SizedBox(height: 24),
                  /*
                   * Where it is and what it looks like come before what stage it is at: somebody
                   * opening a site they have never visited wants to recognise the place first.
                   */
                  const SectionLabel('Location'),
                  SiteMap(
                    lat: (data['lat'] as num?)?.toDouble(),
                    lng: (data['lng'] as num?)?.toDouble(),
                    name: data['name'] as String?,
                    address: data['address'] as String?,
                  ),
                ],
              ),
            ),
            /*
             * The conversation sits directly under the header, above everything else on the page.
             * For a client it is the reason they opened the app at all, and for the site it is the
             * question that has been waiting since this morning — neither belongs below three
             * sections of reference material.
             */
            if ((me?.hasModule('client_portal') ?? false) && (me?.can('projects.view') ?? false)) ...[
              const SizedBox(height: 24),
              _ConversationCard(projectId: projectId, siteName: name),
            ],
            const SizedBox(height: 24),
            const SectionLabel('Photos'),
            SitePhotos(projectId: projectId),
            if ((me?.hasModule('documents') ?? false) && (me?.can('documents.view') ?? false)) ...[
              const SizedBox(height: 24),
              SectionLabel(
                'Documents',
                trailing: AddDocumentButton(projectId: projectId, compact: true),
              ),
              DocumentsList(projectId: projectId),
            ],
            const SizedBox(height: 24),
            // The money the job brings in, kept next to the timeline it is usually tied to: an
            // instalment falls due when a milestone is reached, and reading one without the other
            // is how a builder forgets to raise it.
            if ((me?.can('client_payments.view') ?? false)) ...[
              const SizedBox(height: 24),
              const SectionLabel('Client payments'),
              PaymentSchedule(projectId: projectId),
            ],
            const SizedBox(height: 24),
            const SectionLabel('Timeline'),
            _Milestones(projectId: projectId),
            const SizedBox(height: 24),
            const SectionLabel('On this site'),
            _Members(projectId: projectId),
          ],
        ),
      ),
    );
  }
}

class _Header extends StatelessWidget {
  const _Header({required this.site, required this.canSeeMoney});

  final Map<String, dynamic> site;
  final bool canSeeMoney;

  @override
  Widget build(BuildContext context) {
    final start = site['start_date'] as String?;
    final end = site['target_end_date'] as String?;

    // Elapsed, not complete: the app knows how much of the window has gone, and claiming that is
    // progress would be inventing a number nobody measured.
    int? elapsed;
    final from = parseIsoDate(start);
    final to = parseIsoDate(end);
    if (from != null && to != null && to.isAfter(from)) {
      final total = to.difference(from).inDays;
      final gone = DateTime.now().difference(from).inDays;
      elapsed = ((gone / total) * 100).clamp(0, 100).round();
    }

    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Expanded(
                  child: Text(
                    site['name'] as String? ?? 'Site',
                    style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w700),
                  ),
                ),
                StatusPill(site['status'] as String? ?? 'planning'),
              ],
            ),
            if (site['client_name'] != null) ...[
              const SizedBox(height: 4),
              Text(
                site['client_name'] as String,
                style: const TextStyle(fontSize: 13.5, color: Palette.inkMuted),
              ),
            ],
            const SizedBox(height: 16),
            const Divider(height: 1),
            const SizedBox(height: 14),
            Row(
              children: [
                Expanded(
                  child: _Pair(label: 'Started', value: start == null ? '—' : shortDate(start)),
                ),
                Expanded(
                  child: _Pair(label: 'Handover', value: end == null ? '—' : shortDate(end)),
                ),
                if (canSeeMoney)
                  Expanded(
                    child: _Pair(
                      label: 'Budget',
                      value: site['budget_amount'] == null
                          ? '—'
                          : formatInrCompact(site['budget_amount'] as String),
                    ),
                  ),
              ],
            ),
            if (elapsed != null) ...[
              const SizedBox(height: 16),
              Row(
                children: [
                  Text(
                    '$elapsed% of the schedule gone',
                    style: const TextStyle(fontSize: 12.5, color: Palette.inkMuted),
                  ),
                ],
              ),
              const SizedBox(height: 6),
              ClipRRect(
                borderRadius: BorderRadius.circular(999),
                child: LinearProgressIndicator(
                  value: elapsed / 100,
                  minHeight: 7,
                  backgroundColor: Palette.neutralBg,
                  color: elapsed > 90 ? Palette.blocked : Palette.accent,
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }
}

class _Pair extends StatelessWidget {
  const _Pair({required this.label, required this.value});

  final String label;
  final String value;

  @override
  Widget build(BuildContext context) => Column(
    crossAxisAlignment: CrossAxisAlignment.start,
    children: [
      Text(label, style: const TextStyle(fontSize: 12, color: Palette.inkMuted)),
      const SizedBox(height: 2),
      Text(value, style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w600)),
    ],
  );
}

class _Milestones extends ConsumerWidget {
  const _Milestones({required this.projectId});

  final String projectId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final milestones = ref.watch(milestonesProvider(projectId));

    return AsyncSection<List<Map<String, dynamic>>>(
      value: milestones,
      onRetry: () => ref.invalidate(milestonesProvider(projectId)),
      builder: (rows) {
        if (rows.isEmpty) {
          return const Card(
            child: EmptyNote(
              icon: Icons.flag_outlined,
              title: 'No milestones set',
              body: 'Stages like foundation, slab and handover are added from the web app.',
            ),
          );
        }
        return ListCard(
          children: [
            for (final milestone in rows)
              Padding(
                padding: const EdgeInsets.fromLTRB(16, 13, 16, 13),
                child: Row(
                  children: [
                    Icon(
                      milestone['actual_date'] != null
                          ? Icons.check_circle
                          : Icons.radio_button_unchecked,
                      size: 19,
                      color: milestone['actual_date'] != null ? Palette.done : Palette.inkFaint,
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            milestone['name'] as String? ?? '',
                            style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w500),
                          ),
                          if (milestone['planned_date'] != null)
                            Text(
                              milestone['actual_date'] != null
                                  ? 'Done ${shortDate(milestone['actual_date'] as String)}'
                                  : 'Planned ${shortDate(milestone['planned_date'] as String)}',
                              style: const TextStyle(fontSize: 12.5, color: Palette.inkMuted),
                            ),
                        ],
                      ),
                    ),
                  ],
                ),
              ),
          ],
        );
      },
    );
  }
}

class _Members extends ConsumerWidget {
  const _Members({required this.projectId});

  final String projectId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final members = ref.watch(siteMembersProvider(projectId));

    return AsyncSection<List<Map<String, dynamic>>>(
      value: members,
      onRetry: () => ref.invalidate(siteMembersProvider(projectId)),
      builder: (rows) {
        if (rows.isEmpty) {
          return const Card(
            child: EmptyNote(
              icon: Icons.groups_outlined,
              title: 'Nobody assigned',
              body:
                  'Owners and accounts see every site without being added; anybody else is put on '
                  'it from the web app.',
            ),
          );
        }
        return ListCard(
          children: [
            for (final member in rows)
              Padding(
                padding: const EdgeInsets.fromLTRB(16, 13, 16, 13),
                child: Row(
                  children: [
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            (member['user'] as Map?)?['name'] as String? ?? '',
                            style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w500),
                          ),
                          Text(
                            titleCase(member['role_on_project'] as String? ?? ''),
                            style: const TextStyle(fontSize: 12.5, color: Palette.inkMuted),
                          ),
                        ],
                      ),
                    ),
                  ],
                ),
              ),
          ],
        );
      },
    );
  }
}

/// The way into the site conversation.
///
/// A card rather than a tab, because on a phone the thread deserves its own screen: a chat squeezed
/// into a section of a scrolling page is one somebody writes two words into and gives up on.
class _ConversationCard extends ConsumerWidget {
  const _ConversationCard({required this.projectId, required this.siteName});

  final String projectId;
  final String siteName;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final thread = ref.watch(siteMessagesProvider(projectId)).valueOrNull;
    final latest = thread?.messages.firstOrNull;
    final unread = thread?.unread ?? 0;

    return Card(
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: () => Navigator.of(context).push(
          MaterialPageRoute<void>(
            builder: (_) => SiteConversationScreen(projectId: projectId, siteName: siteName),
          ),
        ),
        child: Padding(
          padding: const EdgeInsets.fromLTRB(16, 14, 12, 14),
          child: Row(
            children: [
              const Icon(Icons.forum_outlined, size: 22, color: Palette.accent),
              const SizedBox(width: 13),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Text(
                      'Conversation',
                      style: TextStyle(fontSize: 15, fontWeight: FontWeight.w600),
                    ),
                    const SizedBox(height: 2),
                    Text(
                      switch (latest) {
                        null => 'Ask the site a question, or answer one.',
                        final message => _preview(message),
                      },
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(fontSize: 12.5, color: Palette.inkMuted),
                    ),
                  ],
                ),
              ),
              if (unread > 0)
                Container(
                  margin: const EdgeInsets.only(right: 4),
                  padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 2),
                  decoration: BoxDecoration(
                    color: Palette.accent,
                    borderRadius: BorderRadius.circular(999),
                  ),
                  child: Text(
                    unread > 99 ? '99+' : '$unread',
                    style: const TextStyle(
                      fontSize: 11,
                      fontWeight: FontWeight.w700,
                      color: Colors.white,
                    ),
                  ),
                ),
              const Icon(Icons.chevron_right, color: Palette.inkFaint),
            ],
          ),
        ),
      ),
    );
  }

  static String _preview(Map<String, dynamic> message) {
    final who = ((message['author'] as Map?)?['name'] as String?) ?? '';
    final body = (message['body'] as String? ?? '').replaceAll(RegExp(r'\s+'), ' ').trim();
    final lock = switch (message['audience']) {
      'team' => '🔒 ',
      'direct' => '👤 ',
      _ => '',
    };
    if (body.isEmpty) return '$lock$who sent a file';
    return '$lock$who: $body';
  }
}
