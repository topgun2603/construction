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

const documentCategories = <String>[
  'drawing',
  'contract',
  'approval',
  'permit',
  'invoice',
  'other',
];

/// Drawings, contracts and approvals.
///
/// Shows the current revision of each, because "the slab drawing" means the one people are building
/// to. Who can open it is stated on every row rather than hidden behind a tap: a builder needs to
/// see at a glance that their costing is not shared with the client, and "I thought it was private"
/// is not a thing you get to say afterwards.
class DocumentsList extends ConsumerWidget {
  const DocumentsList({super.key, this.projectId, this.showProject = false});

  /// Null for every site this person is on.
  final String? projectId;

  /// Name the site on each row, for the list that spans several.
  final bool showProject;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final me = ref.watch(authControllerProvider).me;
    final canManage = me?.can('documents.manage') ?? false;
    final documents = ref.watch(documentsProvider(projectId));

    return AsyncSection<List<Map<String, dynamic>>>(
      value: documents,
      onRetry: () => ref.invalidate(documentsProvider(projectId)),
      builder: (rows) {
        if (rows.isEmpty) {
          return Card(
            child: EmptyNote(
              icon: Icons.folder_open_outlined,
              title: showProject ? 'No documents yet' : 'No documents on this site',
              body: canManage
                  ? 'Drawings, the contract, approvals. Each keeps its revisions, so you can show '
                        'what was current on the day something was built.'
                  : 'Drawings and documents shared with you will appear here.',
            ),
          );
        }

        return ListCard(
          children: [
            for (final document in rows)
              _Row(
                document: document,
                canManage: canManage,
                showProject: showProject,
                listProjectId: projectId,
              ),
          ],
        );
      },
    );
  }
}

class _Row extends ConsumerWidget {
  const _Row({
    required this.document,
    required this.canManage,
    required this.showProject,
    required this.listProjectId,
  });

  final Map<String, dynamic> document;
  final bool canManage;
  final bool showProject;
  final String? listProjectId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final shared = document['visible_to_client'] as bool? ?? false;
    final version = (document['version'] as num?)?.toInt() ?? 1;
    final sizeKb = (((document['size_bytes'] as num?)?.toInt() ?? 0) / 1024).round().clamp(1, 1 << 30);

    final meta = <String>[
      if (showProject) document['project_name'] as String? ?? 'No site',
      ((document['uploaded_by'] as Map?)?['name'] as String?) ?? '',
      relativeTime(document['created_at'] as String?),
      '$sizeKb KB',
    ].where((part) => part.isNotEmpty).join(' · ');

    return InkWell(
      onTap: () => _open(context),
      onLongPress: canManage ? () => _actions(context, ref) : null,
      child: Padding(
        padding: const EdgeInsets.fromLTRB(16, 13, 12, 13),
        child: Row(
          children: [
            Icon(_icon(document['category'] as String?), size: 22, color: Palette.inkFaint),
            const SizedBox(width: 13),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Flexible(
                        child: Text(
                          document['title'] as String? ?? '',
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w600),
                        ),
                      ),
                      if (version > 1) ...[
                        const SizedBox(width: 6),
                        Container(
                          padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 1),
                          decoration: BoxDecoration(
                            color: Palette.neutralBg,
                            borderRadius: BorderRadius.circular(999),
                          ),
                          child: Text(
                            'rev $version',
                            style: const TextStyle(fontSize: 10.5, color: Palette.inkSoft),
                          ),
                        ),
                      ],
                    ],
                  ),
                  const SizedBox(height: 2),
                  Text(
                    meta,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(fontSize: 12, color: Palette.inkMuted),
                  ),
                  const SizedBox(height: 5),
                  // Who can open it, on the row itself.
                  Row(
                    children: [
                      Icon(
                        shared ? Icons.visibility_outlined : Icons.lock_outline,
                        size: 13,
                        color: shared ? Palette.done : Palette.inkFaint,
                      ),
                      const SizedBox(width: 4),
                      Text(
                        shared ? 'Shared with the client' : 'Team only',
                        style: TextStyle(
                          fontSize: 11.5,
                          color: shared ? Palette.done : Palette.inkFaint,
                        ),
                      ),
                    ],
                  ),
                ],
              ),
            ),
            if (canManage)
              IconButton(
                tooltip: 'More',
                onPressed: () => _actions(context, ref),
                icon: const Icon(Icons.more_vert, size: 20, color: Palette.inkFaint),
              )
            else
              const Icon(Icons.open_in_new, size: 17, color: Palette.inkFaint),
          ],
        ),
      ),
    );
  }

  Future<void> _open(BuildContext context) async {
    final url = document['url'] as String?;
    if (url == null) {
      notify(context, 'That file is not available', bad: true);
      return;
    }
    // Handed to the phone rather than rendered here: these are PDFs and CAD exports, and the
    // viewer somebody already has is better than anything this app would draw.
    final opened = await openExternal(url);
    if (!opened && context.mounted) {
      notify(context, 'Nothing on this phone can open that file', bad: true);
    }
  }

  Future<void> _actions(BuildContext context, WidgetRef ref) async {
    final shared = document['visible_to_client'] as bool? ?? false;
    final title = document['title'] as String? ?? 'this document';
    final projectId = document['project_id'] as String?;

    final choice = await showModalBottomSheet<String>(
      context: context,
      builder: (context) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(20, 16, 20, 8),
              child: Text(
                title,
                style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w700),
              ),
            ),
            ListTile(
              leading: const Icon(Icons.open_in_new),
              title: const Text('Open'),
              onTap: () => Navigator.of(context).pop('open'),
            ),
            ListTile(
              leading: Icon(shared ? Icons.lock_outline : Icons.visibility_outlined),
              title: Text(shared ? 'Stop sharing with the client' : 'Share with the client'),
              subtitle: Text(
                shared
                    ? 'The client loses access to every revision of it'
                    : 'The client can open this and its earlier revisions',
                style: const TextStyle(fontSize: 12),
              ),
              onTap: () => Navigator.of(context).pop('share'),
            ),
            ListTile(
              leading: const Icon(Icons.history),
              title: const Text('Upload a new revision'),
              subtitle: const Text(
                'Keeps the name, the category and who can see it',
                style: TextStyle(fontSize: 12),
              ),
              onTap: () => Navigator.of(context).pop('revise'),
            ),
            ListTile(
              leading: const Icon(Icons.delete_outline, color: Palette.blocked),
              title: const Text('Remove this revision', style: TextStyle(color: Palette.blocked)),
              onTap: () => Navigator.of(context).pop('delete'),
            ),
            const SizedBox(height: 8),
          ],
        ),
      ),
    );
    if (choice == null || !context.mounted) return;

    switch (choice) {
      case 'open':
        await _open(context);
      case 'revise':
        await addDocument(
          context,
          ref,
          projectId: projectId ?? listProjectId,
          supersedes: document,
        );
      case 'share':
        try {
          await ref
              .read(apiProvider)
              .setDocumentShared(
                document['id'] as String,
                shared: !shared,
                projectId: projectId ?? listProjectId,
              );
          if (context.mounted) {
            notify(
              context,
              shared ? '$title is no longer shared' : '$title is now visible to the client',
            );
          }
        } on ApiException catch (error) {
          if (context.mounted) notify(context, error.message, bad: true);
        }
      case 'delete':
        final agreed = await confirm(
          context,
          title: 'Remove this revision?',
          body:
              '$title comes off the list. Earlier revisions stay, and the stored file itself is '
              'kept.',
          danger: 'Remove',
        );
        if (!agreed) return;
        try {
          await ref
              .read(apiProvider)
              .removeDocument(document['id'] as String, projectId: projectId ?? listProjectId);
        } on ApiException catch (error) {
          if (context.mounted) notify(context, error.message, bad: true);
        }
    }
  }

  static IconData _icon(String? category) => switch (category) {
    'drawing' => Icons.architecture_outlined,
    'contract' => Icons.gavel_outlined,
    'approval' => Icons.verified_outlined,
    'permit' => Icons.badge_outlined,
    'invoice' => Icons.receipt_long_outlined,
    _ => Icons.description_outlined,
  };
}

/// Adding a document from a phone.
///
/// Two ways in, because there are two ways a document exists on a site. The drawing the architect
/// emailed is a PDF already sitting in somebody's downloads; the approval the inspector signed at
/// the gate exists only on paper, and the only copy that will ever be made is the photograph taken
/// of it before it goes into a folder and is lost.
///
/// [projectId] null means ask. The company-wide list has no site of its own, and a document filed
/// against nothing is one nobody can find again.
///
/// [supersedes] files it as the next revision of that document, which then keeps its name, its
/// category and who can see it — so the form skips straight to picking the file.
Future<void> addDocument(
  BuildContext context,
  WidgetRef ref, {
  String? projectId,
  Map<String, dynamic>? supersedes,
}) async {
  final siteId = projectId ?? await _askWhichSite(context, ref);
  if (siteId == null || !context.mounted) return;

  final source = await _askSource(context, revision: supersedes != null);
  if (source == null || !context.mounted) return;

  final String path;
  final String contentType;
  var suggestedName = '';

  if (source == 'camera') {
    final photo = await PhotoUploader.capture();
    if (photo == null || !context.mounted) return;
    path = photo.path;
    contentType = PhotoUploader.contentTypeOf(photo.path);
  } else {
    final picked = await FilePicker.pickFile(
      dialogTitle: 'Choose a document',
      type: FileType.custom,
      allowedExtensions: const ['pdf', 'jpg', 'jpeg', 'png', 'webp', 'heic'],
    );
    if (picked == null || picked.path == null || !context.mounted) return;
    path = picked.path!;
    contentType = _contentTypeOfFile(path);
    // A filename is usually what people already call the thing by.
    suggestedName = picked.name.replaceAll(RegExp(r'\.[^.]+$'), '');
  }

  final sizeBytes = await File(path).length();
  if (!context.mounted) return;
  if (sizeBytes > _maxBytes) {
    notify(context, 'That file is over 25 MB — too big to send from a phone', bad: true);
    return;
  }

  // A revision takes all of this from what it replaces, so there is nothing to ask.
  final details = supersedes != null
      ? (
          title: supersedes['title'] as String? ?? '',
          category: supersedes['category'] as String? ?? 'other',
          share: supersedes['visible_to_client'] as bool? ?? false,
        )
      : await showDialog<({String title, String category, bool share})>(
          context: context,
          builder: (context) => _DetailsDialog(initialTitle: suggestedName),
        );
  if (details == null || !context.mounted) return;

  notify(context, 'Uploading…');
  try {
    final key = await PhotoUploader(ref.read(apiClientProvider)).uploadFile(
      path: path,
      contentType: contentType,
      projectId: siteId,
      kind: 'document',
    );
    await ref
        .read(apiProvider)
        .addDocument(
          title: details.title,
          category: details.category,
          s3Key: key,
          contentType: contentType,
          sizeBytes: sizeBytes,
          projectId: siteId,
          visibleToClient: details.share,
          supersedesId: supersedes?['id'] as String?,
        );
    if (context.mounted) {
      notify(context, supersedes == null ? 'Filed against this site' : 'New revision filed');
    }
  } on ApiException catch (error) {
    if (context.mounted) notify(context, error.message, bad: true);
  }
}

/// 25 MB — the API's own cap for anything that is not a video.
const _maxBytes = 25 * 1024 * 1024;

Future<String?> _askWhichSite(BuildContext context, WidgetRef ref) async {
  final List<Map<String, dynamic>> sites;
  try {
    sites = await ref.read(sitesProvider.future);
  } on ApiException catch (error) {
    if (context.mounted) notify(context, error.message, bad: true);
    return null;
  }
  if (!context.mounted) return null;

  if (sites.isEmpty) {
    notify(context, 'Make a site first — a document has to belong to one', bad: true);
    return null;
  }
  if (sites.length == 1) return sites.single['id'] as String;

  return showModalBottomSheet<String>(
    context: context,
    builder: (context) => SafeArea(
      child: ListView(
        shrinkWrap: true,
        children: [
          const Padding(
            padding: EdgeInsets.fromLTRB(20, 16, 20, 6),
            child: Text(
              'Which site is this for?',
              style: TextStyle(fontSize: 16, fontWeight: FontWeight.w700),
            ),
          ),
          for (final site in sites)
            ListTile(
              leading: const Icon(Icons.apartment_outlined),
              title: Text(site['name'] as String? ?? ''),
              onTap: () => Navigator.of(context).pop(site['id'] as String),
            ),
        ],
      ),
    ),
  );
}

Future<String?> _askSource(BuildContext context, {required bool revision}) {
  return showModalBottomSheet<String>(
    context: context,
    builder: (context) => SafeArea(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(20, 16, 20, 6),
            child: Text(
              revision ? 'The new revision' : 'Add a document',
              style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w700),
            ),
          ),
          ListTile(
            leading: const Icon(Icons.attach_file),
            title: const Text('Choose a file'),
            subtitle: const Text('A PDF or an image already on this phone'),
            onTap: () => Navigator.of(context).pop('file'),
          ),
          ListTile(
            leading: const Icon(Icons.photo_camera_outlined),
            title: const Text('Photograph it'),
            subtitle: const Text('Paper that only exists on site'),
            onTap: () => Navigator.of(context).pop('camera'),
          ),
          const SizedBox(height: 8),
        ],
      ),
    ),
  );
}

String _contentTypeOfFile(String path) =>
    path.toLowerCase().endsWith('.pdf') ? 'application/pdf' : PhotoUploader.contentTypeOf(path);

/// The button that starts all of this.
///
/// Filled rather than a text link, and on both the site's own list and the company-wide one: the
/// previous version hid it in a section header, which is exactly where somebody looking for "how do
/// I add a document" does not look.
class AddDocumentButton extends ConsumerWidget {
  const AddDocumentButton({super.key, this.projectId, this.compact = false});

  final String? projectId;
  final bool compact;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final canManage = ref.watch(authControllerProvider).me?.can('documents.manage') ?? false;
    if (!canManage) return const SizedBox.shrink();

    if (compact) {
      return FilledButton.icon(
        onPressed: () => addDocument(context, ref, projectId: projectId),
        icon: const Icon(Icons.add, size: 17),
        label: const Text('Add'),
        style: FilledButton.styleFrom(
          padding: const EdgeInsets.symmetric(horizontal: 12),
          minimumSize: const Size(0, 34),
          tapTargetSize: MaterialTapTargetSize.shrinkWrap,
          textStyle: const TextStyle(fontSize: 13, fontWeight: FontWeight.w600),
        ),
      );
    }

    return FloatingActionButton.extended(
      heroTag: 'add-document',
      onPressed: () => addDocument(context, ref, projectId: projectId),
      icon: const Icon(Icons.note_add_outlined),
      label: const Text('Add document'),
    );
  }
}

class _DetailsDialog extends StatefulWidget {
  const _DetailsDialog({this.initialTitle = ''});

  final String initialTitle;

  @override
  State<_DetailsDialog> createState() => _DetailsDialogState();
}

class _DetailsDialogState extends State<_DetailsDialog> {
  late final _title = TextEditingController(text: widget.initialTitle);
  String _category = 'drawing';
  bool _share = false;

  @override
  void dispose() {
    _title.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: const Text('File this document'),
      content: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            TextField(
              controller: _title,
              autofocus: true,
              maxLength: 200,
              textCapitalization: TextCapitalization.sentences,
              onChanged: (_) => setState(() {}),
              decoration: const InputDecoration(
                labelText: 'Name',
                counterText: '',
                hintText: 'Ground floor slab layout',
              ),
            ),
            const SizedBox(height: 14),
            DropdownButtonFormField<String>(
              initialValue: _category,
              decoration: const InputDecoration(labelText: 'What is it'),
              items: [
                for (final category in documentCategories)
                  DropdownMenuItem(value: category, child: Text(titleCase(category))),
              ],
              onChanged: (value) => setState(() => _category = value ?? _category),
            ),
            const SizedBox(height: 8),
            CheckboxListTile(
              value: _share,
              onChanged: (value) => setState(() => _share = value ?? false),
              contentPadding: EdgeInsets.zero,
              controlAffinity: ListTileControlAffinity.leading,
              title: const Text('Let the client open this', style: TextStyle(fontSize: 14)),
              subtitle: const Text(
                'Off by default. Something shared by accident is not something you can take back.',
                style: TextStyle(fontSize: 11.5),
              ),
            ),
          ],
        ),
      ),
      actions: [
        TextButton(onPressed: () => Navigator.of(context).pop(), child: const Text('Cancel')),
        TextButton(
          onPressed: _title.text.trim().isEmpty
              ? null
              : () => Navigator.of(context).pop((
                  title: _title.text.trim(),
                  category: _category,
                  share: _share,
                )),
          child: const Text('File it'),
        ),
      ],
    );
  }
}
