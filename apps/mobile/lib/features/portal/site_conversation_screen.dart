import 'dart:io';

import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api_client.dart';
import '../../core/api_providers.dart';
import '../../core/auth_controller.dart';
import '../../core/format.dart';
import '../../core/photo_upload.dart';
import '../../core/theme.dart';
import '../../shared/widgets.dart';

/// How long an author has to take back what they wrote.
///
/// Mirrors `MESSAGE_DELETE_WINDOW_MINUTES` in the shared package, which the API enforces. This copy
/// is only ever used to *explain* the rule — whether the control appears at all comes from the
/// server's own `can_delete`, so the two cannot drift into offering something that would be
/// refused.
const kMessageDeleteWindowMinutes = 30;

/// One thing waiting to be sent — a photo, or any other file.
class _Pending {
  _Pending({required this.path, required this.contentType, this.filename});

  final String path;
  final String contentType;

  /// Null for a photograph, where the picture is its own label.
  final String? filename;

  bool get isImage => contentType.startsWith('image/');
}

/// The conversation on one site.
///
/// Three audiences, and which one is selected is never in doubt: it is a labelled row above the box
/// you type into, the box changes colour with it, and every message is drawn in the colour of the
/// audience it was written to. Being wrong about that means a note about a client landing in the
/// client's own thread, so it is said everywhere rather than once.
///
///   * **Everyone** — the client and the team. This is what the portal is for.
///   * **Team only** — offered to whoever holds `messages.internal`, and never to a client.
///   * **One person** — a named recipient, on either side of that line. The most ordinary thing on
///     a site is asking one person something, and a thread that can only broadcast sends those
///     conversations back to WhatsApp, which is where the record goes to die.
///
/// Laid out as a chat — newest at the bottom, your own words on the right — because a client who
/// has to learn a new metaphor to ask a question asks it somewhere else instead.
class SiteConversationScreen extends ConsumerStatefulWidget {
  const SiteConversationScreen({super.key, required this.projectId, this.siteName});

  final String projectId;

  /// Null when the screen was opened from a notification, which carries an id and no name.
  final String? siteName;

  @override
  ConsumerState<SiteConversationScreen> createState() => _SiteConversationScreenState();
}

class _SiteConversationScreenState extends ConsumerState<SiteConversationScreen> {
  final _composer = TextEditingController();
  final _pending = <_Pending>[];
  String _audience = 'everyone';
  String? _recipientId;
  bool _sending = false;

  @override
  void initState() {
    super.initState();
    /*
     * Opening the thread is reading it.
     *
     * After the first frame rather than during build: this writes, and a provider invalidated while
     * the tree is being built rebuilds it underneath itself.
     */
    WidgetsBinding.instance.addPostFrameCallback((_) {
      ref.read(apiProvider).markConversationRead(widget.projectId);
    });
  }

  @override
  void dispose() {
    _composer.dispose();
    super.dispose();
  }

  bool get _canSend => _composer.text.trim().isNotEmpty || _pending.isNotEmpty;

  Future<void> _attachPhoto({required bool fromCamera}) async {
    final picked = fromCamera
        ? [?await PhotoUploader.capture()]
        : await PhotoUploader.pickFromGallery();
    if (picked.isEmpty) return;
    setState(() {
      for (final photo in picked) {
        _pending.add(
          _Pending(path: photo.path, contentType: PhotoUploader.contentTypeOf(photo.path)),
        );
      }
    });
  }

  Future<void> _attachFile() async {
    final picked = await FilePicker.pickFile(
      dialogTitle: 'Attach a file',
      type: FileType.custom,
      allowedExtensions: const ['pdf', 'jpg', 'jpeg', 'png', 'webp', 'heic'],
    );
    final path = picked?.path;
    if (path == null || !mounted) return;

    final contentType = path.toLowerCase().endsWith('.pdf')
        ? 'application/pdf'
        : PhotoUploader.contentTypeOf(path);
    setState(() {
      _pending.add(
        _Pending(
          path: path,
          contentType: contentType,
          // A photograph is recognised by looking at it; a PDF is only ever found by its name.
          filename: contentType.startsWith('image/') ? null : picked!.name,
        ),
      );
    });
  }

  Future<void> _send() async {
    if (!_canSend || _sending) return;
    if (_audience == 'direct' && _recipientId == null) {
      notify(context, 'Choose who this is for', bad: true);
      return;
    }
    setState(() => _sending = true);

    try {
      final uploader = PhotoUploader(ref.read(apiClientProvider));
      final attachments = <Map<String, dynamic>>[];
      for (final item in _pending) {
        final key = await uploader.uploadFile(
          path: item.path,
          contentType: item.contentType,
          projectId: widget.projectId,
          kind: 'message_attachment',
        );
        attachments.add({
          's3_key': key,
          'content_type': item.contentType,
          'size_bytes': await File(item.path).length(),
          if (item.filename != null) 'filename': item.filename,
        });
      }

      await ref
          .read(apiProvider)
          .postSiteMessage(
            projectId: widget.projectId,
            body: _composer.text.trim(),
            audience: _audience,
            recipientId: _recipientId,
            attachments: attachments,
          );

      if (!mounted) return;
      setState(() {
        _composer.clear();
        _pending.clear();
      });
    } on ApiException catch (error) {
      if (mounted) notify(context, error.message, bad: true);
    } finally {
      if (mounted) setState(() => _sending = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final me = ref.watch(authControllerProvider).me;
    final canPost = me?.can('messages.post') ?? false;
    final canWriteInternal = me?.can('messages.internal') ?? false;
    final thread = ref.watch(siteMessagesProvider(widget.projectId));
    final people = ref.watch(messageRecipientsProvider(widget.projectId)).valueOrNull ?? const [];

    return Scaffold(
      appBar: AppBar(
        titleSpacing: 0,
        title: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            const Text(
              'Conversation',
              style: TextStyle(fontSize: 17.5, fontWeight: FontWeight.w700),
            ),
            Text(
              widget.siteName ??
                  ref.watch(siteProvider(widget.projectId)).valueOrNull?['name'] as String? ??
                  '',
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(fontSize: 12, color: Palette.inkMuted),
            ),
          ],
        ),
      ),
      body: Column(
        children: [
          Expanded(
            child: RefreshIndicator(
              onRefresh: () async {
                ref.invalidate(siteMessagesProvider(widget.projectId));
                await ref.read(siteMessagesProvider(widget.projectId).future);
              },
              child: AsyncSection<SiteThread>(
                value: thread,
                onRetry: () => ref.invalidate(siteMessagesProvider(widget.projectId)),
                builder: (data) {
                  if (data.messages.isEmpty) {
                    return ListView(
                      padding: const EdgeInsets.fromLTRB(16, 24, 16, 16),
                      children: [
                        EmptyNote(
                          icon: Icons.forum_outlined,
                          title: 'Nothing said yet',
                          body: canPost
                              ? 'Questions from the client and answers from the site live here, '
                                    'against the job, instead of in somebody’s WhatsApp.'
                              : 'Questions and answers about this site will appear here.',
                        ),
                      ],
                    );
                  }

                  /*
                   * `reverse: true` rather than scrolling to the end after layout: the newest
                   * message is the one being read, and a list that jumps into place after a frame
                   * is the jump everybody notices on a slow phone.
                   */
                  return ListView.builder(
                    reverse: true,
                    padding: const EdgeInsets.fromLTRB(12, 14, 12, 14),
                    itemCount: data.messages.length,
                    itemBuilder: (context, index) =>
                        _Bubble(message: data.messages[index], projectId: widget.projectId),
                  );
                },
              ),
            ),
          ),
          if (canPost)
            _Composer(
              controller: _composer,
              pending: _pending,
              audience: _audience,
              recipientId: _recipientId,
              people: people,
              canWriteInternal: canWriteInternal,
              sending: _sending,
              canSend: _canSend,
              onAudience: (value) => setState(() {
                _audience = value;
                if (value != 'direct') _recipientId = null;
              }),
              onRecipient: (value) => setState(() => _recipientId = value),
              onTyped: () => setState(() {}),
              onAttachPhoto: _attachPhoto,
              onAttachFile: _attachFile,
              onRemove: (index) => setState(() => _pending.removeAt(index)),
              onSend: _send,
            ),
        ],
      ),
    );
  }
}

class _Bubble extends ConsumerWidget {
  const _Bubble({required this.message, required this.projectId});

  final Map<String, dynamic> message;
  final String projectId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final mine = message['mine'] as bool? ?? false;
    final audience = message['audience'] as String? ?? 'everyone';
    final team = audience == 'team';
    final direct = audience == 'direct';
    final author = (message['author'] as Map?) ?? const {};
    final recipient = message['recipient'] as Map?;
    final body = message['body'] as String? ?? '';
    final attachments = (message['attachments'] as List<dynamic>? ?? const [])
        .map((row) => Map<String, dynamic>.from(row as Map))
        .toList(growable: false);
    final readBy = (message['read_by'] as List<dynamic>? ?? const [])
        .map((row) => (row as Map)['name'] as String)
        .toList(growable: false);
    /*
     * Whether taking it back is still on offer.
     *
     * The server decides, because the server owns the clock. A phone half an hour out would
     * otherwise show the option on a message it can no longer delete, or hide it on one it could.
     */
    final canDelete = message['can_delete'] as bool? ?? false;

    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: Column(
        crossAxisAlignment: mine ? CrossAxisAlignment.end : CrossAxisAlignment.start,
        children: [
          Padding(
            padding: const EdgeInsets.only(left: 4, right: 4, bottom: 3),
            child: Text(
              '${author['name'] ?? ''} · ${titleCase(author['role'] as String? ?? '')} · '
              '${relativeTime(message['created_at'] as String?)}',
              style: const TextStyle(fontSize: 11.5, color: Palette.inkFaint),
            ),
          ),
          GestureDetector(
            onLongPress: canDelete ? () => _offerRemove(context, ref) : null,
            child: Container(
              constraints: BoxConstraints(maxWidth: MediaQuery.sizeOf(context).width * 0.82),
              padding: const EdgeInsets.fromLTRB(13, 10, 13, 10),
              decoration: BoxDecoration(
                color: team
                    ? Palette.pendingBg
                    : direct
                    ? Palette.accentSoft
                    : mine
                    ? Palette.accentSoft
                    : Palette.surface,
                borderRadius: BorderRadius.circular(14),
                border: Border.all(
                  color: team
                      ? const Color(0xFFF3DCB6)
                      : direct
                      ? Palette.accent
                      : Palette.line,
                ),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  if (team) ...[
                    const _Marker(
                      icon: Icons.lock_outline,
                      label: 'TEAM ONLY',
                      colour: Palette.pending,
                    ),
                    const SizedBox(height: 5),
                  ],
                  if (direct) ...[
                    _Marker(
                      icon: Icons.person_outline,
                      label: mine
                          ? 'PRIVATE TO ${(recipient?['name'] as String? ?? 'ONE PERSON').toUpperCase()}'
                          : 'PRIVATE — ONLY YOU',
                      colour: Palette.accent,
                    ),
                    const SizedBox(height: 5),
                  ],
                  if (body.isNotEmpty)
                    Text(body, style: const TextStyle(fontSize: 14.5, height: 1.35)),
                  if (attachments.isNotEmpty) ...[
                    if (body.isNotEmpty) const SizedBox(height: 8),
                    Wrap(
                      spacing: 6,
                      runSpacing: 6,
                      children: [
                        for (final attachment in attachments) _Attachment(attachment: attachment),
                      ],
                    ),
                  ],
                  if (team) ...[
                    const SizedBox(height: 5),
                    const Text(
                      'The client cannot see this',
                      style: TextStyle(fontSize: 11, color: Palette.pending),
                    ),
                  ],
                ],
              ),
            ),
          ),
          if (mine)
            Padding(
              padding: const EdgeInsets.only(top: 3, right: 4),
              child: _Receipt(readBy: readBy),
            ),
        ],
      ),
    );
  }

  Future<void> _offerRemove(BuildContext context, WidgetRef ref) async {
    final agreed = await confirm(
      context,
      title: 'Take this back?',
      body:
          'It comes off the thread for everybody, and anything already read has been read. '
          'A message can only be taken back within $kMessageDeleteWindowMinutes minutes '
          'of sending it.',
      danger: 'Remove',
    );
    if (!agreed) return;
    try {
      await ref
          .read(apiProvider)
          .deleteSiteMessage(projectId: projectId, messageId: message['id'] as String);
    } on ApiException catch (error) {
      if (context.mounted) notify(context, error.message, bad: true);
    }
  }
}

class _Marker extends StatelessWidget {
  const _Marker({required this.icon, required this.label, required this.colour});

  final IconData icon;
  final String label;
  final Color colour;

  @override
  Widget build(BuildContext context) => Row(
    mainAxisSize: MainAxisSize.min,
    children: [
      Icon(icon, size: 13, color: colour),
      const SizedBox(width: 5),
      Flexible(
        child: Text(
          label,
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
          style: TextStyle(
            fontSize: 10.5,
            letterSpacing: 0.7,
            fontWeight: FontWeight.w700,
            color: colour,
          ),
        ),
      ),
    ],
  );
}

/// Whether anybody has read it.
///
/// One tick for sent, two for seen — the grammar everybody already knows from their phone, so it
/// needs no explaining. Only on your own messages: "has the client read my answer" is the question
/// this settles, and showing who has read everybody else's turns a receipt into a team watching
/// each other.
class _Receipt extends StatelessWidget {
  const _Receipt({required this.readBy});

  final List<String> readBy;

  @override
  Widget build(BuildContext context) {
    final seen = readBy.isNotEmpty;
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Icon(
          seen ? Icons.done_all : Icons.done,
          size: 14,
          color: seen ? Palette.accent : Palette.inkFaint,
        ),
        const SizedBox(width: 4),
        Text(
          switch (readBy.length) {
            0 => 'Sent',
            1 => 'Read by ${readBy.first}',
            _ => 'Read by ${readBy.length}',
          },
          style: TextStyle(fontSize: 11.5, color: seen ? Palette.accent : Palette.inkFaint),
        ),
      ],
    );
  }
}

/// One thing hanging off a message.
///
/// The URL arrives already signed for this person and expires, so nothing here holds a permanent
/// link to somebody's site — a link that leaks stops working on its own.
class _Attachment extends StatelessWidget {
  const _Attachment({required this.attachment});

  final Map<String, dynamic> attachment;

  @override
  Widget build(BuildContext context) {
    final isImage = attachment['is_image'] as bool? ?? true;
    final thumb = attachment['url'] as String?;
    final full = (attachment['full_url'] ?? attachment['url']) as String?;

    if (!isImage) {
      final size = (((attachment['size_bytes'] as num?)?.toInt() ?? 0) / 1024).round().clamp(1, 1 << 30);
      return GestureDetector(
        onTap: full == null ? null : () => _openExternally(context, full),
        child: Container(
          constraints: const BoxConstraints(maxWidth: 230),
          padding: const EdgeInsets.symmetric(horizontal: 11, vertical: 9),
          decoration: BoxDecoration(
            color: Palette.surface,
            borderRadius: BorderRadius.circular(10),
            border: Border.all(color: Palette.line),
          ),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Icon(Icons.description_outlined, size: 20, color: Palette.inkFaint),
              const SizedBox(width: 9),
              Flexible(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Text(
                      attachment['filename'] as String? ?? 'Attachment',
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w600),
                    ),
                    Text(
                      '$size KB',
                      style: const TextStyle(fontSize: 11, color: Palette.inkMuted),
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
      );
    }

    if (thumb == null) {
      return Container(
        width: 104,
        height: 104,
        decoration: BoxDecoration(
          color: Palette.neutralBg,
          borderRadius: BorderRadius.circular(10),
        ),
        alignment: Alignment.center,
        child: const Icon(Icons.broken_image_outlined, color: Palette.inkFaint),
      );
    }

    return GestureDetector(
      onTap: full == null ? null : () => _openImage(context, full),
      child: ClipRRect(
        borderRadius: BorderRadius.circular(10),
        child: Image.network(
          thumb,
          width: 104,
          height: 104,
          fit: BoxFit.cover,
          errorBuilder: (_, _, _) => Container(
            width: 104,
            height: 104,
            color: Palette.neutralBg,
            alignment: Alignment.center,
            child: const Icon(Icons.broken_image_outlined, color: Palette.inkFaint),
          ),
        ),
      ),
    );
  }

  void _openImage(BuildContext context, String url) {
    Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (_) => Scaffold(
          backgroundColor: Colors.black,
          appBar: AppBar(backgroundColor: Colors.black, foregroundColor: Colors.white),
          body: Center(
            child: InteractiveViewer(
              child: Image.network(
                url,
                errorBuilder: (_, _, _) =>
                    const Icon(Icons.broken_image_outlined, color: Colors.white38, size: 48),
              ),
            ),
          ),
        ),
      ),
    );
  }

  // Handed to the phone: a PDF opens in the viewer somebody already has, not in a reader this app
  // would have to grow.
  Future<void> _openExternally(BuildContext context, String url) async {
    final opened = await openExternal(url);
    if (!opened && context.mounted) {
      notify(context, 'Nothing on this phone can open that file', bad: true);
    }
  }
}

class _Composer extends StatelessWidget {
  const _Composer({
    required this.controller,
    required this.pending,
    required this.audience,
    required this.recipientId,
    required this.people,
    required this.canWriteInternal,
    required this.sending,
    required this.canSend,
    required this.onAudience,
    required this.onRecipient,
    required this.onTyped,
    required this.onAttachPhoto,
    required this.onAttachFile,
    required this.onRemove,
    required this.onSend,
  });

  final TextEditingController controller;
  final List<_Pending> pending;
  final String audience;
  final String? recipientId;
  final List<Map<String, dynamic>> people;
  final bool canWriteInternal;
  final bool sending;
  final bool canSend;
  final ValueChanged<String> onAudience;
  final ValueChanged<String?> onRecipient;
  final VoidCallback onTyped;
  final Future<void> Function({required bool fromCamera}) onAttachPhoto;
  final Future<void> Function() onAttachFile;
  final ValueChanged<int> onRemove;
  final VoidCallback onSend;

  Color get _ground => switch (audience) {
    'team' => Palette.pendingBg,
    'direct' => Palette.accentSoft,
    _ => Palette.surface,
  };

  @override
  Widget build(BuildContext context) {
    final choices = <({String value, String label, IconData icon})>[
      (value: 'everyone', label: 'Everyone', icon: Icons.groups_outlined),
      if (canWriteInternal) (value: 'team', label: 'Team only', icon: Icons.lock_outline),
      if (people.isNotEmpty) (value: 'direct', label: 'One person', icon: Icons.person_outline),
    ];

    return Container(
      decoration: BoxDecoration(
        color: _ground,
        border: const Border(top: BorderSide(color: Palette.line)),
      ),
      child: SafeArea(
        top: false,
        child: Padding(
          padding: const EdgeInsets.fromLTRB(12, 10, 12, 10),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              if (choices.length > 1)
                Align(
                  alignment: Alignment.centerLeft,
                  child: SingleChildScrollView(
                    scrollDirection: Axis.horizontal,
                    child: Container(
                      padding: const EdgeInsets.all(3),
                      decoration: BoxDecoration(
                        color: Palette.neutralBg,
                        borderRadius: BorderRadius.circular(11),
                      ),
                      child: Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          for (final choice in choices)
                            _Segment(
                              label: choice.label,
                              icon: choice.icon,
                              selected: audience == choice.value,
                              onTap: () => onAudience(choice.value),
                            ),
                        ],
                      ),
                    ),
                  ),
                ),
              if (audience == 'direct') ...[
                const SizedBox(height: 8),
                DropdownButtonFormField<String>(
                  initialValue: recipientId,
                  isExpanded: true,
                  decoration: InputDecoration(
                    isDense: true,
                    filled: true,
                    fillColor: Palette.surface,
                    hintText: 'Who is this for?',
                    contentPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
                    border: OutlineInputBorder(
                      borderRadius: BorderRadius.circular(10),
                      borderSide: const BorderSide(color: Palette.line),
                    ),
                  ),
                  items: [
                    for (final person in people)
                      DropdownMenuItem(
                        value: person['id'] as String,
                        child: Text(
                          '${person['name']} · ${titleCase(person['role'] as String? ?? '')}',
                          overflow: TextOverflow.ellipsis,
                        ),
                      ),
                  ],
                  onChanged: onRecipient,
                ),
              ],
              if (pending.isNotEmpty) ...[
                const SizedBox(height: 8),
                SizedBox(
                  height: 66,
                  child: ListView.separated(
                    scrollDirection: Axis.horizontal,
                    itemCount: pending.length,
                    separatorBuilder: (_, _) => const SizedBox(width: 8),
                    itemBuilder: (context, index) => _Chip(
                      item: pending[index],
                      onRemove: () => onRemove(index),
                    ),
                  ),
                ),
              ],
              const SizedBox(height: 8),
              Row(
                crossAxisAlignment: CrossAxisAlignment.end,
                children: [
                  IconButton(
                    tooltip: 'Take a photo',
                    onPressed: sending ? null : () => onAttachPhoto(fromCamera: true),
                    icon: const Icon(Icons.photo_camera_outlined),
                    color: Palette.inkSoft,
                    visualDensity: VisualDensity.compact,
                  ),
                  IconButton(
                    tooltip: 'Attach a file',
                    onPressed: sending ? null : onAttachFile,
                    icon: const Icon(Icons.attach_file),
                    color: Palette.inkSoft,
                    visualDensity: VisualDensity.compact,
                  ),
                  Expanded(
                    child: TextField(
                      controller: controller,
                      onChanged: (_) => onTyped(),
                      minLines: 1,
                      maxLines: 5,
                      maxLength: 4000,
                      textCapitalization: TextCapitalization.sentences,
                      decoration: InputDecoration(
                        counterText: '',
                        isDense: true,
                        filled: true,
                        fillColor: Palette.canvas,
                        hintText: switch (audience) {
                          'team' => 'A note for the team…',
                          'direct' => 'Only they will see this…',
                          _ => 'Write to the client and the site…',
                        },
                        border: OutlineInputBorder(
                          borderRadius: BorderRadius.circular(22),
                          borderSide: BorderSide.none,
                        ),
                        contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 11),
                      ),
                    ),
                  ),
                  const SizedBox(width: 6),
                  _SendButton(
                    sending: sending,
                    enabled: canSend,
                    audience: audience,
                    onTap: onSend,
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _Chip extends StatelessWidget {
  const _Chip({required this.item, required this.onRemove});

  final _Pending item;
  final VoidCallback onRemove;

  @override
  Widget build(BuildContext context) {
    return Stack(
      children: [
        if (item.isImage)
          ClipRRect(
            borderRadius: BorderRadius.circular(9),
            child: Image.file(File(item.path), width: 66, height: 66, fit: BoxFit.cover),
          )
        else
          Container(
            width: 90,
            height: 66,
            padding: const EdgeInsets.all(6),
            decoration: BoxDecoration(
              color: Palette.neutralBg,
              borderRadius: BorderRadius.circular(9),
            ),
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                const Icon(Icons.description_outlined, size: 18, color: Palette.inkSoft),
                const SizedBox(height: 3),
                Text(
                  item.filename ?? 'File',
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  textAlign: TextAlign.center,
                  style: const TextStyle(fontSize: 9.5, height: 1.15, color: Palette.inkSoft),
                ),
              ],
            ),
          ),
        Positioned(
          top: 2,
          right: 2,
          child: GestureDetector(
            onTap: onRemove,
            child: Container(
              width: 20,
              height: 20,
              decoration: const BoxDecoration(color: Color(0xB31B1A2E), shape: BoxShape.circle),
              child: const Icon(Icons.close, size: 13, color: Colors.white),
            ),
          ),
        ),
      ],
    );
  }
}

class _Segment extends StatelessWidget {
  const _Segment({
    required this.label,
    required this.icon,
    required this.selected,
    required this.onTap,
  });

  final String label;
  final IconData icon;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 140),
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 7),
        decoration: BoxDecoration(
          color: selected ? Palette.surface : Colors.transparent,
          borderRadius: BorderRadius.circular(9),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(icon, size: 14, color: selected ? Palette.ink : Palette.inkMuted),
            const SizedBox(width: 5),
            Text(
              label,
              style: TextStyle(
                fontSize: 12.5,
                fontWeight: selected ? FontWeight.w700 : FontWeight.w500,
                color: selected ? Palette.ink : Palette.inkMuted,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _SendButton extends StatelessWidget {
  const _SendButton({
    required this.sending,
    required this.enabled,
    required this.audience,
    required this.onTap,
  });

  final bool sending;
  final bool enabled;
  final String audience;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final colour = switch (audience) {
      'team' => Palette.pending,
      'direct' => Palette.accent,
      _ => Palette.accent,
    };
    final icon = switch (audience) {
      'team' => Icons.lock,
      'direct' => Icons.person,
      _ => Icons.send_rounded,
    };

    return SizedBox(
      width: 46,
      height: 46,
      child: Material(
        color: enabled && !sending ? colour : Palette.lineStrong,
        shape: const CircleBorder(),
        child: InkWell(
          customBorder: const CircleBorder(),
          onTap: enabled && !sending ? onTap : null,
          child: sending
              ? const Padding(
                  padding: EdgeInsets.all(14),
                  child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
                )
              : Icon(icon, size: 19, color: Colors.white),
        ),
      ),
    );
  }
}
