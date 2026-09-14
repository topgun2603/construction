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
class DocumentsList extends ConsumerStatefulWidget {
  const DocumentsList({super.key, this.projectId, this.showProject = false});

  /// Null for every site this person is on.
  final String? projectId;

  /// Name the site on each row, for the list that spans several.
  final bool showProject;

  @override
  ConsumerState<DocumentsList> createState() => _DocumentsListState();
}

/// How a long list is narrowed on a phone.
///
/// The web page answers the same questions with a table — sort a column, page through. Neither
/// gesture exists here: a phone list scrolls, and columns do not fit. So the capabilities are the
/// same and the shape is not. Search and the newest-first default do most of the work; the filter
/// sheet holds the rest, because a toolbar of six controls above a list would leave no list.
///
/// Nothing is fetched again when any of this changes. The documents are already in hand, and a
/// request per keystroke on a site with one bar is how a search box comes to feel broken.
class _DocumentsListState extends ConsumerState<DocumentsList> {
  String _query = '';
  String? _category;
  String? _from;
  String? _to;
  _Sort _sort = _Sort.newest;

  /// Rendered so far. `ListView` is lazy, so this is not about drawing cost — it is about the
  /// scrollbar. Six hundred documents make the thumb a sliver and scrolling a gamble, and "show
  /// more" keeps somebody's place instead of dropping them into the middle of a list.
  static const _pageSize = 25;
  int _shown = _pageSize;

  bool get _filtered => _query.isNotEmpty || _category != null || _from != null || _to != null;

  void _reset() => setState(() => _shown = _pageSize);

  List<Map<String, dynamic>> _apply(List<Map<String, dynamic>> rows) {
    final filtered = rows.where((document) {
      if (_category != null && document['category'] != _category) return false;

      // `created_at` is an instant and the range is days, so only the date part is compared —
      // otherwise "to the 14th" would exclude everything filed on the 14th after midnight.
      final filed = (document['created_at'] as String? ?? '').split('T').first;
      if (_from != null && filed.compareTo(_from!) < 0) return false;
      if (_to != null && filed.compareTo(_to!) > 0) return false;

      if (_query.isEmpty) return true;
      final haystack = [
        document['title'],
        document['category'],
        document['project_name'],
        (document['uploaded_by'] as Map?)?['name'],
      ].whereType<String>().join(' ').toLowerCase();
      return haystack.contains(_query);
    }).toList();

    filtered.sort(switch (_sort) {
      _Sort.newest => (a, b) => (b['created_at'] as String? ?? '').compareTo(
        a['created_at'] as String? ?? '',
      ),
      _Sort.oldest => (a, b) => (a['created_at'] as String? ?? '').compareTo(
        b['created_at'] as String? ?? '',
      ),
      _Sort.name => (a, b) => (a['title'] as String? ?? '').toLowerCase().compareTo(
        (b['title'] as String? ?? '').toLowerCase(),
      ),
      _Sort.site => (a, b) => (a['project_name'] as String? ?? '~').compareTo(
        b['project_name'] as String? ?? '~',
      ),
    });

    return filtered;
  }

  Future<void> _openFilters(List<Map<String, dynamic>> rows) async {
    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Palette.surface,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
      ),
      builder: (_) => _FilterSheet(
        category: _category,
        from: _from,
        to: _to,
        sort: _sort,
        showSite: widget.showProject,
        onApply: (category, from, to, sort) => setState(() {
          _category = category;
          _from = from;
          _to = to;
          _sort = sort;
          _shown = _pageSize;
        }),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final me = ref.watch(authControllerProvider).me;
    final canManage = me?.can('documents.manage') ?? false;
    final documents = ref.watch(documentsProvider(widget.projectId));

    return AsyncSection<List<Map<String, dynamic>>>(
      value: documents,
      onRetry: () => ref.invalidate(documentsProvider(widget.projectId)),
      builder: (rows) {
        if (rows.isEmpty) {
          return Card(
            child: EmptyNote(
              icon: Icons.folder_open_outlined,
              title: widget.showProject ? 'No documents yet' : 'No documents on this site',
              body: canManage
                  ? 'Drawings, the contract, approvals. Each keeps its revisions, so you can show '
                        'what was current on the day something was built.'
                  : 'Drawings and documents shared with you will appear here.',
            ),
          );
        }

        final visible = _apply(rows);
        final shown = visible.take(_shown).toList();

        return Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            // The controls appear once there is enough to need them. Four drawings on a site do
            // not want a search box above them.
            if (rows.length > 5) ...[
              Row(
                children: [
                  Expanded(
                    child: TextField(
                      onChanged: (value) {
                        setState(() => _query = value.trim().toLowerCase());
                        _reset();
                      },
                      decoration: const InputDecoration(
                        hintText: 'Search documents',
                        prefixIcon: Icon(Icons.search, size: 20),
                        isDense: true,
                        contentPadding: EdgeInsets.symmetric(horizontal: 14, vertical: 12),
                      ),
                    ),
                  ),
                  const SizedBox(width: 8),
                  // Badged when something is on, so a list that looks short for no obvious reason
                  // always has a visible reason.
                  IconButton.filledTonal(
                    onPressed: () => _openFilters(rows),
                    icon: Badge(
                      isLabelVisible: _category != null || _from != null || _to != null,
                      backgroundColor: Palette.accent,
                      child: const Icon(Icons.tune, size: 20),
                    ),
                    tooltip: 'Filter and sort',
                  ),
                ],
              ),
              if (_filtered)
                Padding(
                  padding: const EdgeInsets.only(top: 8),
                  child: Row(
                    children: [
                      Expanded(
                        child: Text(
                          '${visible.length} of ${rows.length}',
                          style: const TextStyle(fontSize: 12.5, color: Palette.inkMuted),
                        ),
                      ),
                      TextButton(
                        onPressed: () => setState(() {
                          _query = '';
                          _category = null;
                          _from = null;
                          _to = null;
                          _shown = _pageSize;
                        }),
                        child: const Text('Clear'),
                      ),
                    ],
                  ),
                ),
              const SizedBox(height: 10),
            ],
            if (visible.isEmpty)
              Card(
                child: EmptyNote(
                  icon: Icons.search_off,
                  title: 'Nothing matches',
                  body: _from != null || _to != null
                      ? 'Nothing was filed in that range. Try widening the dates.'
                      : 'Try part of a name, or a different category.',
                ),
              )
            else
              ListCard(
                children: [
                  for (final document in shown)
                    _Row(
                      document: document,
                      canManage: canManage,
                      showProject: widget.showProject,
                      listProjectId: widget.projectId,
                    ),
                ],
              ),
            if (shown.length < visible.length)
              Padding(
                padding: const EdgeInsets.only(top: 10),
                child: OutlinedButton(
                  onPressed: () => setState(() => _shown += _pageSize),
                  child: Text('Show ${visible.length - shown.length} more'),
                ),
              ),
          ],
        );
      },
    );
  }
}

enum _Sort { newest, oldest, name, site }

extension _SortLabel on _Sort {
  String get label => switch (this) {
    _Sort.newest => 'Newest first',
    _Sort.oldest => 'Oldest first',
    _Sort.name => 'By name',
    _Sort.site => 'By site',
  };
}

/// Category, date range and order, in a sheet.
///
/// Applied on "Show results" rather than as each control is touched. Half a range — a start with no
/// end — would otherwise filter the list to something nobody asked for while they were still
/// picking the second date.
class _FilterSheet extends StatefulWidget {
  const _FilterSheet({
    required this.category,
    required this.from,
    required this.to,
    required this.sort,
    required this.showSite,
    required this.onApply,
  });

  final String? category;
  final String? from;
  final String? to;
  final _Sort sort;
  final bool showSite;
  final void Function(String? category, String? from, String? to, _Sort sort) onApply;

  @override
  State<_FilterSheet> createState() => _FilterSheetState();
}

class _FilterSheetState extends State<_FilterSheet> {
  late String? _category = widget.category;
  late String? _from = widget.from;
  late String? _to = widget.to;
  late _Sort _sort = widget.sort;

  Future<void> _pick({required bool start}) async {
    final picked = await showDatePicker(
      context: context,
      initialDate: parseIsoDate(start ? _from : _to) ?? DateTime.now(),
      firstDate: DateTime(DateTime.now().year - 5),
      lastDate: DateTime.now(),
    );
    if (picked == null) return;
    setState(() {
      if (start) {
        _from = isoDate(picked);
        // A start after the end is a range that matches nothing, so the end moves rather than
        // leaving somebody to work out why the list went empty.
        if (_to != null && _to!.compareTo(_from!) < 0) _to = _from;
      } else {
        _to = isoDate(picked);
        if (_from != null && _to!.compareTo(_from!) < 0) _from = _to;
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    return SafeArea(
      child: SingleChildScrollView(
        padding: const EdgeInsets.fromLTRB(20, 16, 20, 24),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          mainAxisSize: MainAxisSize.min,
          children: [
            Row(
              children: [
                const Expanded(
                  child: Text(
                    'Filter and sort',
                    style: TextStyle(fontSize: 19, fontWeight: FontWeight.w700),
                  ),
                ),
                IconButton(
                  onPressed: () => Navigator.of(context).pop(),
                  icon: const Icon(Icons.close),
                ),
              ],
            ),
            const SizedBox(height: 14),
            const _SheetLabel('What it is'),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: [
                ChoiceChip(
                  label: const Text('Anything'),
                  selected: _category == null,
                  onSelected: (_) => setState(() => _category = null),
                ),
                for (final category in documentCategories)
                  ChoiceChip(
                    label: Text(titleCase(category)),
                    selected: _category == category,
                    onSelected: (_) => setState(() => _category = category),
                  ),
              ],
            ),
            const SizedBox(height: 18),
            const _SheetLabel('Filed between'),
            Row(
              children: [
                Expanded(
                  child: OutlinedButton(
                    onPressed: () => _pick(start: true),
                    child: Text(_from == null ? 'Any time' : shortDate(_from)),
                  ),
                ),
                const Padding(
                  padding: EdgeInsets.symmetric(horizontal: 10),
                  child: Text('to', style: TextStyle(color: Palette.inkMuted)),
                ),
                Expanded(
                  child: OutlinedButton(
                    onPressed: () => _pick(start: false),
                    child: Text(_to == null ? 'Today' : shortDate(_to)),
                  ),
                ),
              ],
            ),
            if (_from != null || _to != null)
              Align(
                alignment: Alignment.centerLeft,
                child: TextButton(
                  onPressed: () => setState(() {
                    _from = null;
                    _to = null;
                  }),
                  child: const Text('Any date'),
                ),
              ),
            const SizedBox(height: 18),
            const _SheetLabel('Order'),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: [
                for (final option in _Sort.values)
                  if (option != _Sort.site || widget.showSite)
                    ChoiceChip(
                      label: Text(option.label),
                      selected: _sort == option,
                      onSelected: (_) => setState(() => _sort = option),
                    ),
              ],
            ),
            const SizedBox(height: 22),
            FilledButton(
              onPressed: () {
                widget.onApply(_category, _from, _to, _sort);
                Navigator.of(context).pop();
              },
              child: const Text('Show results'),
            ),
          ],
        ),
      ),
    );
  }
}

class _SheetLabel extends StatelessWidget {
  const _SheetLabel(this.text);

  final String text;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.only(bottom: 8),
    child: Text(
      text,
      style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w600, color: Palette.inkMuted),
    ),
  );
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
              leading: const Icon(Icons.edit_outlined),
              title: const Text('Rename or recategorise'),
              subtitle: const Text(
                'The same document, filed correctly',
                style: TextStyle(fontSize: 12),
              ),
              onTap: () => Navigator.of(context).pop('edit'),
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
      case 'edit':
        final details = await showDialog<({String title, String category})>(
          context: context,
          builder: (_) => _EditDetailsDialog(
            initialTitle: document['title'] as String? ?? '',
            initialCategory: document['category'] as String? ?? 'other',
          ),
        );
        if (details == null || !context.mounted) return;
        try {
          await ref
              .read(apiProvider)
              .updateDocument(
                document['id'] as String,
                title: details.title,
                category: details.category,
                projectId: projectId ?? listProjectId,
              );
          if (context.mounted) notify(context, 'Updated');
        } on ApiException catch (error) {
          if (context.mounted) notify(context, error.message, bad: true);
        }
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

/// Renaming a document, or filing it under the right kind.
///
/// Sharing is left out deliberately. It is one tap away in the same menu, and putting it here too
/// would mean an operator correcting a typo has to decide about client visibility at the same
/// time — which is how a contract ends up shared by somebody who was only fixing a spelling.
class _EditDetailsDialog extends StatefulWidget {
  const _EditDetailsDialog({required this.initialTitle, required this.initialCategory});

  final String initialTitle;
  final String initialCategory;

  @override
  State<_EditDetailsDialog> createState() => _EditDetailsDialogState();
}

class _EditDetailsDialogState extends State<_EditDetailsDialog> {
  late final _title = TextEditingController(text: widget.initialTitle);
  late String _category = documentCategories.contains(widget.initialCategory)
      ? widget.initialCategory
      : 'other';

  @override
  void dispose() {
    _title.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: const Text('Document details'),
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
              decoration: const InputDecoration(labelText: 'Name', counterText: ''),
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
          ],
        ),
      ),
      actions: [
        TextButton(onPressed: () => Navigator.of(context).pop(), child: const Text('Cancel')),
        TextButton(
          onPressed: _title.text.trim().isEmpty
              ? null
              : () => Navigator.of(
                  context,
                ).pop((title: _title.text.trim(), category: _category)),
          child: const Text('Save'),
        ),
      ],
    );
  }
}
