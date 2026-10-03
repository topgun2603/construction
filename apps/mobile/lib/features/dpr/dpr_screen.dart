import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:image_picker/image_picker.dart';

import '../../core/ai_api.dart';
import '../../core/api_client.dart';
import '../../core/api_providers.dart';
import '../../core/auth_controller.dart';
import '../../core/format.dart';
import '../../core/photo_upload.dart';
import '../../core/theme.dart';
import '../../shared/bilingual_field.dart';
import '../../shared/voice_note_button.dart';
import '../../shared/widgets.dart';
import '../../core/i18n.dart';

/// Daily progress reports: what was read, and what gets written.
class DprScreen extends ConsumerStatefulWidget {
  const DprScreen({super.key});

  @override
  ConsumerState<DprScreen> createState() => _DprScreenState();
}

class _DprScreenState extends ConsumerState<DprScreen> {
  /// Which reports are shown. Filed-but-unread is the common question — "what came in today" —
  /// and a draft somebody abandoned is noise against it.
  String _status = 'all';

  @override
  Widget build(BuildContext context) {
    final reports = ref.watch(dprProvider);
    final me = ref.watch(authControllerProvider).me;

    return Scaffold(
      backgroundColor: Palette.canvas,
      floatingActionButton: me?.can('dpr.file') == true
          ? Padding(
              padding: EdgeInsets.only(bottom: fabInset(context)),
              child: FloatingActionButton.extended(
                backgroundColor: Palette.accent,
                foregroundColor: Colors.white,
                onPressed: () => _openForm(context),
                icon: const Icon(Icons.edit_outlined),
                label: const Text("File today's report"),
              ),
            )
          : null,
      body: RefreshIndicator(
        onRefresh: () async {
          ref.invalidate(dprProvider);
          await ref.read(dprProvider.future);
        },
        child: AsyncSection<List<Map<String, dynamic>>>(
          value: reports,
          onRetry: () => ref.invalidate(dprProvider),
          builder: (all) {
            final rows = _status == 'all'
                ? all
                : all.where((row) => row['status'] == _status).toList();

            if (all.isEmpty) {
              return ListView(
                children: [
                  EmptyNote(
                    image: 'images/illus_reports.png',
                    title: t('No reports yet'),
                    body:
                        'A daily report says what got done, who was on site and what is in the '
                        'way. It takes about a minute.',
                  ),
                ],
              );
            }
            return Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Padding(
                  padding: const EdgeInsets.fromLTRB(16, 12, 16, 10),
                  child: FilterChips(
                    options: {
                      'all': t('All'),
                      'submitted': t('Submitted'),
                      'draft': t('Draft'),
                    },
                    selected: _status,
                    onSelected: (value) => setState(() => _status = value),
                  ),
                ),
                Expanded(
                  child: rows.isEmpty
                      ? ListView(
                          children: [
                            EmptyNote(
                              icon: Icons.filter_alt_off_outlined,
                              title: t('Nothing here'),
                              body: t('No report matches that filter.'),
                            ),
                          ],
                        )
                      : ListView.separated(
                          padding: EdgeInsets.fromLTRB(
                            16,
                            0,
                            16,
                            bottomInset(context, hasFab: true),
                          ),
                          itemCount: rows.length,
                          separatorBuilder: (_, _) => const SizedBox(height: 10),
                          itemBuilder: (context, index) => _ReportCard(report: rows[index]),
                        ),
                ),
              ],
            );
          },
        ),
      ),
    );
  }

  void _openForm(BuildContext context) {
    showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Palette.surface,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
      ),
      builder: (_) => const _ReportForm(),
    );
  }
}

class _ReportCard extends StatelessWidget {
  const _ReportCard({required this.report});

  final Map<String, dynamic> report;

  @override
  Widget build(BuildContext context) {
    final manpower = (report['manpower'] as List<dynamic>? ?? const [])
        .map((row) => Map<String, dynamic>.from(row as Map))
        .toList();
    final activities = (report['activities'] as List<dynamic>? ?? const [])
        .map((row) => Map<String, dynamic>.from(row as Map))
        .toList();
    final photos = (report['photos'] as List<dynamic>? ?? const [])
        .map((row) => Map<String, dynamic>.from(row as Map))
        .toList();

    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        report['project_name'] as String? ?? 'Site',
                        style: const TextStyle(fontSize: 15.5, fontWeight: FontWeight.w600),
                      ),
                      Text(
                        '${shortDate(report['report_date'] as String?)} · '
                        '${(report['submitted_by'] as Map?)?['name'] ?? ''}',
                        style: const TextStyle(fontSize: 12.5, color: Palette.inkMuted),
                      ),
                    ],
                  ),
                ),
                StatusPill(report['status'] as String? ?? 'draft'),
              ],
            ),
            if (report['work_done'] != null) ...[
              const SizedBox(height: 12),
              Text(
                report['work_done'] as String,
                style: const TextStyle(fontSize: 14, height: 1.45),
              ),
            ],
            if (activities.isNotEmpty) ...[
              const SizedBox(height: 12),
              Wrap(
                spacing: 8,
                runSpacing: 8,
                children: [
                  for (final activity in activities)
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
                      decoration: BoxDecoration(
                        border: Border.all(color: Palette.lineStrong),
                        borderRadius: BorderRadius.circular(999),
                      ),
                      child: Text(
                        '${activity['activity']}'
                        '${activity['quantity'] != null ? ' · ${activity['quantity']} ${activity['unit'] ?? ''}' : ''}',
                        style: const TextStyle(fontSize: 12.5),
                      ),
                    ),
                ],
              ),
            ],
            if (photos.isNotEmpty) ...[
              const SizedBox(height: 12),
              SizedBox(
                height: 88,
                child: ListView.separated(
                  scrollDirection: Axis.horizontal,
                  itemCount: photos.length,
                  separatorBuilder: (_, _) => const SizedBox(width: 8),
                  itemBuilder: (context, index) => _ReportPhoto(photo: photos[index]),
                ),
              ),
            ],
            if (report['issues'] != null) ...[
              const SizedBox(height: 12),
              Container(
                width: double.infinity,
                padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
                decoration: BoxDecoration(
                  color: Palette.blockedBg,
                  borderRadius: BorderRadius.circular(10),
                ),
                child: Text(
                  report['issues'] as String,
                  style: const TextStyle(fontSize: 13.5, color: Palette.blocked, height: 1.4),
                ),
              ),
            ],
            const SizedBox(height: 12),
            Row(
              children: [
                const Icon(Icons.groups_outlined, size: 15, color: Palette.inkFaint),
                const SizedBox(width: 5),
                Text(
                  '${report['headcount'] ?? 0} on site'
                  '${manpower.isEmpty ? '' : ' · ${manpower.map((row) => '${row['count']} ${row['trade']}').join(', ')}'}',
                  style: const TextStyle(fontSize: 12.5, color: Palette.inkMuted),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

/// Filing a report.
///
/// Four fields and a trade count. The web form has more, and this deliberately does not: the person
/// filling this in is standing up, at the end of a long day, on a phone.
class _ReportForm extends ConsumerStatefulWidget {
  const _ReportForm();

  @override
  ConsumerState<_ReportForm> createState() => _ReportFormState();
}

class _ReportFormState extends ConsumerState<_ReportForm> {
  final _workDone = TextEditingController();
  final _issues = TextEditingController();
  final _weather = TextEditingController();
  final _headcount = TextEditingController();

  String? _projectId;
  bool _saving = false;
  String? _error;

  /// Which photo is going up, so the button says so instead of spinning silently.
  int? _uploading;

  /// Photos chosen but not yet sent. They upload when the report is filed, not on selection: a
  /// person who changes their mind should not leave three orphaned files in storage behind them.
  final List<XFile> _photos = [];

  /// What a spoken note left behind, if one was used. Kept so the transcript can sit above the
  /// form — it is the only thing on this screen somebody can check against their own memory.
  VoiceDraft? _spoken;

  /// Fills the form from a spoken note. Fills, not files: every field stays editable and nothing
  /// is submitted. A spoken "twelve masons" heard as "twenty" has to be a typo somebody catches,
  /// not twenty masons in the wage bill.
  void _applyDraft(VoiceDraft draft) {
    setState(() {
      _spoken = draft;
      if (draft.workDone != null) _workDone.text = draft.workDone!;
      if (draft.issues != null) _issues.text = draft.issues!;
      if (draft.weather != null) _weather.text = draft.weather!;
      if (draft.headcount > 0) _headcount.text = draft.headcount.toString();
      _error = null;
    });
  }

  Future<void> _addPhoto(ImageSource source) async {
    try {
      if (source == ImageSource.camera) {
        final shot = await PhotoUploader.capture();
        if (shot != null) setState(() => _photos.add(shot));
      } else {
        final picked = await PhotoUploader.pickFromGallery();
        if (picked.isNotEmpty) setState(() => _photos.addAll(picked));
      }
    } catch (_) {
      if (!mounted) return;
      // Nearly always a refused camera permission, which deserves a sentence not a stack trace.
      setState(() => _error = 'Could not open the camera or gallery. Check the app permissions.');
    }
  }

  @override
  void dispose() {
    _workDone.dispose();
    _issues.dispose();
    _weather.dispose();
    _headcount.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final sites = ref.watch(sitesProvider);
    final date = ref.watch(workingDateProvider);

    return Padding(
      padding: EdgeInsets.only(bottom: MediaQuery.of(context).viewInsets.bottom),
      child: DraggableScrollableSheet(
        expand: false,
        initialChildSize: 0.9,
        maxChildSize: 0.95,
        builder: (context, scrollController) => ListView(
          controller: scrollController,
          padding: EdgeInsets.fromLTRB(20, 16, 20, 28 + systemBottomInset(context)),
          children: [
            Row(
              children: [
                Expanded(
                  child: Text(
                    t('Daily report'),
                    style: TextStyle(fontSize: 19, fontWeight: FontWeight.w700),
                  ),
                ),
                IconButton(
                  onPressed: () => Navigator.of(context).pop(),
                  icon: const Icon(Icons.close),
                ),
              ],
            ),
            Text(longDate(date), style: const TextStyle(fontSize: 13.5, color: Palette.inkMuted)),
            const SizedBox(height: 18),
            sites.when(
              loading: () => const Loading(),
              error: (error, _) => ErrorNote(error: error),
              data: (rows) {
                if (rows.isEmpty) {
                  return EmptyNote(
                    title: t('No sites'),
                    body: t('You are not on any site, so there is nothing to report against.'),
                  );
                }
                final projectId = _projectId ?? rows.first['id'] as String;
                return Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    _Label(t('Site')),
                    DropdownButtonFormField<String>(
                      initialValue: projectId,
                      items: [
                        for (final site in rows)
                          DropdownMenuItem(
                            value: site['id'] as String,
                            child: Text(site['name'] as String? ?? 'Site'),
                          ),
                      ],
                      onChanged: (value) => setState(() => _projectId = value),
                    ),
                    const SizedBox(height: 16),
                    _SpeakRow(
                      projectId: projectId,
                      reportDate: date,
                      onDraft: _applyDraft,
                      enabled: !_saving,
                    ),
                    if (_spoken != null) _Transcript(draft: _spoken!),
                    const SizedBox(height: 16),
                    _Label(t('What got done today')),
                    // The two prose fields translate as you type. The date and the headcount do
                    // not: putting a vendor call behind typing a digit buys nothing.
                    BilingualField(
                      api: ref.watch(apiClientProvider),
                      controller: _workDone,
                      hintText: t('Second floor slab shuttering completed, curing started on…'),
                    ),
                    const SizedBox(height: 16),
                    _Label(t('Anything in the way')),
                    BilingualField(
                      api: ref.watch(apiClientProvider),
                      controller: _issues,
                      maxLines: 3,
                      hintText: t('Left blank if nothing is holding the work up'),
                    ),
                    const SizedBox(height: 16),
                    Row(
                      children: [
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              _Label(t('People on site')),
                              TextField(
                                controller: _headcount,
                                keyboardType: TextInputType.number,
                                decoration: const InputDecoration(hintText: '24'),
                              ),
                            ],
                          ),
                        ),
                        const SizedBox(width: 12),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              _Label(t('Weather')),
                              TextField(
                                controller: _weather,
                                textCapitalization: TextCapitalization.sentences,
                                decoration: InputDecoration(hintText: t('Clear')),
                              ),
                            ],
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 16),
                    _Label(t('Photos')),
                    _PhotoStrip(
                      photos: _photos,
                      onCamera: () => _addPhoto(ImageSource.camera),
                      onGallery: () => _addPhoto(ImageSource.gallery),
                      onRemove: (index) => setState(() => _photos.removeAt(index)),
                    ),
                    if (_error != null) ...[
                      const SizedBox(height: 16),
                      Container(
                        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
                        decoration: BoxDecoration(
                          color: Palette.blockedBg,
                          borderRadius: BorderRadius.circular(10),
                        ),
                        child: Text(
                          _error!,
                          style: const TextStyle(color: Palette.blocked, fontSize: 13.5),
                        ),
                      ),
                    ],
                    const SizedBox(height: 22),
                    FilledButton(
                      onPressed: _saving ? null : () => _submit(projectId, date),
                      child: _saving
                          ? Row(
                              mainAxisAlignment: MainAxisAlignment.center,
                              children: [
                                const SizedBox(
                                  height: 20,
                                  width: 20,
                                  child: CircularProgressIndicator(
                                    strokeWidth: 2.2,
                                    color: Colors.white,
                                  ),
                                ),
                                if (_uploading != null) ...[
                                  const SizedBox(width: 10),
                                  Text('Photo $_uploading of ${_photos.length}'),
                                ],
                              ],
                            )
                          : Text(
                              _photos.isEmpty
                                  ? 'File report'
                                  : 'File report with ${_photos.length} photo'
                                        '${_photos.length == 1 ? '' : 's'}',
                            ),
                    ),
                  ],
                );
              },
            ),
          ],
        ),
      ),
    );
  }

  Future<void> _submit(String projectId, String date) async {
    if (_workDone.text.trim().isEmpty) {
      setState(() => _error = 'Say what got done — that is the whole point of the report.');
      return;
    }
    setState(() {
      _saving = true;
      _error = null;
    });
    try {
      final headcount = int.tryParse(_headcount.text.trim());
      /*
       * Queued on the phone rather than posted. Filing is the end of a long day and often happens
       * in a site office with no signal; the report belongs on disk the moment the button is
       * pressed, and the outbox gets it out.
       */
      await ref
          .read(offlineRepositoryProvider)
          .fileReport(
            // Paths, not uploads. The queue carries the bytes, so a report with photographs files
            // in a basement exactly as easily as one without.
            photoPaths: [for (final photo in _photos) photo.path],
            projectId: projectId,
            date: date,
            workDone: _workDone.text.trim(),
            issues: _issues.text.trim(),
            weather: _weather.text.trim(),
            headcount: headcount,
          );
      if (!mounted) return;
      Navigator.of(context).pop();
      final online = ref.read(syncStateProvider).value?.online ?? true;
      notify(
        context,
        online
            ? 'Report filed'
            : _photos.isEmpty
            ? 'Report saved on this phone. It will send itself.'
            : 'Report and ${_photos.length} '
                  '${_photos.length == 1 ? 'photo' : 'photos'} saved on this phone. '
                  'They will send themselves.',
      );
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() => _error = error.message);
    } finally {
      if (mounted) {
        setState(() {
          _saving = false;
          _uploading = null;
        });
      }
    }
  }
}

/// One photo on a filed report. Signed on demand, like every other stored object.
class _ReportPhoto extends ConsumerWidget {
  const _ReportPhoto({required this.photo});

  final Map<String, dynamic> photo;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final key = (photo['thumb_s3_key'] ?? photo['s3_key']) as String;
    final url = ref.watch(viewUrlProvider(key));

    return ClipRRect(
      borderRadius: BorderRadius.circular(10),
      child: SizedBox(
        width: 110,
        height: 88,
        child: Container(
          color: Palette.neutralBg,
          child: url.when(
            loading: () => const Center(
              child: SizedBox(
                height: 16,
                width: 16,
                child: CircularProgressIndicator(strokeWidth: 2),
              ),
            ),
            error: (_, _) =>
                const Center(child: Icon(Icons.broken_image_outlined, color: Palette.inkFaint)),
            data: (link) => Image.network(
              link,
              fit: BoxFit.cover,
              errorBuilder: (_, _, _) =>
                  const Center(child: Icon(Icons.broken_image_outlined, color: Palette.inkFaint)),
            ),
          ),
        ),
      ),
    );
  }
}

/// The photos on this report, with the two ways to add one.
class _PhotoStrip extends StatelessWidget {
  const _PhotoStrip({
    required this.photos,
    required this.onCamera,
    required this.onGallery,
    required this.onRemove,
  });

  final List<XFile> photos;
  final VoidCallback onCamera;
  final VoidCallback onGallery;
  final ValueChanged<int> onRemove;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      height: 96,
      child: ListView(
        scrollDirection: Axis.horizontal,
        children: [
          // Camera first: on a site the photo is being taken now, not found.
          _AddButton(icon: Icons.photo_camera_outlined, label: t('Camera'), onTap: onCamera),
          const SizedBox(width: 10),
          _AddButton(icon: Icons.photo_library_outlined, label: t('Gallery'), onTap: onGallery),
          for (final (index, photo) in photos.indexed) ...[
            const SizedBox(width: 10),
            Stack(
              children: [
                ClipRRect(
                  borderRadius: BorderRadius.circular(12),
                  child: Image.file(File(photo.path), width: 96, height: 96, fit: BoxFit.cover),
                ),
                Positioned(
                  right: 2,
                  top: 2,
                  child: InkWell(
                    onTap: () => onRemove(index),
                    child: Container(
                      padding: const EdgeInsets.all(4),
                      decoration: const BoxDecoration(
                        color: Color(0xCC1B1A2E),
                        shape: BoxShape.circle,
                      ),
                      child: const Icon(Icons.close, size: 15, color: Colors.white),
                    ),
                  ),
                ),
              ],
            ),
          ],
        ],
      ),
    );
  }
}

class _AddButton extends StatelessWidget {
  const _AddButton({required this.icon, required this.label, required this.onTap});

  final IconData icon;
  final String label;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) => InkWell(
    onTap: onTap,
    borderRadius: BorderRadius.circular(12),
    child: Container(
      width: 96,
      height: 96,
      decoration: BoxDecoration(
        border: Border.all(color: Palette.lineStrong),
        borderRadius: BorderRadius.circular(12),
        color: Palette.raised,
      ),
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Icon(icon, size: 24, color: Palette.accent),
          const SizedBox(height: 6),
          Text(label, style: const TextStyle(fontSize: 12, color: Palette.inkMuted)),
        ],
      ),
    ),
  );
}

class _Label extends StatelessWidget {
  const _Label(this.text);

  final String text;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.only(bottom: 6),
    child: Text(
      text,
      style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w600, color: Palette.inkSoft),
    ),
  );
}

/// The invitation to speak, above the fields it fills.
///
/// A whole row rather than a bare button: somebody who has typed this form forty times will not
/// notice a new icon, and the one line of explanation is what makes them try it once.
class _SpeakRow extends ConsumerWidget {
  const _SpeakRow({
    required this.projectId,
    required this.reportDate,
    required this.onDraft,
    required this.enabled,
  });

  final String projectId;
  final String reportDate;
  final void Function(VoiceDraft) onDraft;
  final bool enabled;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: Palette.neutralBg,
        borderRadius: BorderRadius.circular(14),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            t('Rather say it? Two lines in Tamil or English fills the form in.'),
            style: TextStyle(fontSize: 12.5, color: Palette.inkMuted),
          ),
          const SizedBox(height: 8),
          Align(
            alignment: Alignment.centerLeft,
            child: VoiceNoteButton(
              api: ref.watch(apiClientProvider),
              projectId: projectId,
              reportDate: reportDate,
              onDraft: onDraft,
              enabled: enabled,
            ),
          ),
        ],
      ),
    );
  }
}

/// The words that were said, verbatim and in their own script.
///
/// Not translated, trimmed or tidied. If the draft says "ten carpenters" and this says "ten
/// plumbers", the mistake is visible in one glance rather than being filed — and that is the only
/// safety net between a misheard note and the wage bill.
class _Transcript extends StatelessWidget {
  const _Transcript({required this.draft});

  final VoiceDraft draft;

  @override
  Widget build(BuildContext context) {
    final heard = draft.language == null ? '' : ' · heard as ${_languageName(draft.language!)}';
    return Container(
      margin: const EdgeInsets.only(top: 12),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: Palette.surface,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: Palette.line),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            'What was said$heard',
            style: const TextStyle(
              fontSize: 11,
              fontWeight: FontWeight.w600,
              letterSpacing: 0.4,
              color: Palette.inkMuted,
            ),
          ),
          const SizedBox(height: 6),
          Text(draft.transcript, style: const TextStyle(fontSize: 13.5, height: 1.5)),
          if (draft.manpower.isNotEmpty) ...[
            const SizedBox(height: 8),
            Text(
              [for (final row in draft.manpower) '${row.count} ${row.trade}'].join(' · '),
              style: const TextStyle(fontSize: 12, color: Palette.inkMuted),
            ),
          ],
          for (final caveat in draft.caveats) ...[
            const SizedBox(height: 6),
            Text(caveat, style: const TextStyle(fontSize: 12, color: Palette.pending)),
          ],
        ],
      ),
    );
  }
}

/// The transcriber's language code, in words. Anything unexpected is shown as it came.
String _languageName(String code) => const {
  'ta': 'Tamil',
  'tamil': 'Tamil',
  'hi': 'Hindi',
  'hindi': 'Hindi',
  'te': 'Telugu',
  'telugu': 'Telugu',
  'kn': 'Kannada',
  'kannada': 'Kannada',
  'ml': 'Malayalam',
  'malayalam': 'Malayalam',
  'en': 'English',
  'english': 'English',
}[code.toLowerCase()] ?? code;
