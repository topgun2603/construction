import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api_client.dart';
import '../../core/api_providers.dart';
import '../../core/format.dart';
import '../../core/theme.dart';
import '../../shared/widgets.dart';

/// What happened while you were not looking.
///
/// Reading one marks it read; there is no separate tick to hunt for. "Mark all read" exists for the
/// morning where forty of them arrived overnight, which is the only time anybody wants it.
class NotificationsScreen extends ConsumerWidget {
  const NotificationsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final notifications = ref.watch(notificationsProvider);
    final unread = ref.watch(unreadCountProvider);

    return Scaffold(
      appBar: AppBar(
        title: const Text('Notifications'),
        actions: [
          if (unread > 0)
            TextButton(
              onPressed: () async {
                try {
                  await ref.read(apiProvider).markAllNotificationsRead();
                } on ApiException catch (error) {
                  if (context.mounted) notify(context, error.message, bad: true);
                }
              },
              child: const Text('Mark all read'),
            ),
          const SizedBox(width: 4),
        ],
      ),
      body: RefreshIndicator(
        onRefresh: () async {
          ref.invalidate(notificationsProvider);
          await ref.read(notificationsProvider.future);
        },
        child: AsyncSection<List<Map<String, dynamic>>>(
          value: notifications,
          onRetry: () => ref.invalidate(notificationsProvider),
          builder: (rows) {
            if (rows.isEmpty) {
              return ListView(
                children: const [
                  EmptyNote(
                    icon: Icons.notifications_none,
                    title: 'Nothing yet',
                    body:
                        'Indents needing approval, reports filed and wage sheets ready all land '
                        'here.',
                  ),
                ],
              );
            }
            return ListView.builder(
              padding: EdgeInsets.only(bottom: bottomInset(context, hasBar: false)),
              itemCount: rows.length,
              itemBuilder: (context, index) => _NotificationRow(notification: rows[index]),
            );
          },
        ),
      ),
    );
  }
}

class _NotificationRow extends ConsumerWidget {
  const _NotificationRow({required this.notification});

  final Map<String, dynamic> notification;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final read = notification['read_at'] != null;

    return InkWell(
      onTap: read
          ? null
          : () async {
              try {
                await ref.read(apiProvider).markNotificationRead(notification['id'] as String);
              } on ApiException catch (error) {
                if (context.mounted) notify(context, error.message, bad: true);
              }
            },
      child: Container(
        color: read ? Palette.surface : Palette.raised,
        margin: const EdgeInsets.only(bottom: 1),
        padding: const EdgeInsets.fromLTRB(16, 14, 16, 14),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Container(
              margin: const EdgeInsets.only(top: 6, right: 12),
              width: 8,
              height: 8,
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                color: read ? Colors.transparent : Palette.accent,
              ),
            ),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    notification['title'] as String? ?? '',
                    style: TextStyle(
                      fontSize: 15,
                      fontWeight: read ? FontWeight.w500 : FontWeight.w600,
                    ),
                  ),
                  if (notification['body'] != null) ...[
                    const SizedBox(height: 3),
                    Text(
                      notification['body'] as String,
                      style: const TextStyle(fontSize: 13.5, color: Palette.inkSoft, height: 1.4),
                    ),
                  ],
                  const SizedBox(height: 5),
                  Text(
                    relativeTime(notification['created_at'] as String?),
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
