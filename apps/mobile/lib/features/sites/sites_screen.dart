import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:image_picker/image_picker.dart';
import 'package:latlong2/latlong.dart';

import '../../core/api_client.dart';
import '../../core/api_providers.dart';
import '../../core/auth_controller.dart';
import '../../core/format.dart';
import '../../core/theme.dart';
import '../../core/photo_upload.dart';
import '../../core/device_location.dart';
import '../../shared/location_picker.dart';
import '../../shared/widgets.dart';
import 'site_detail_screen.dart';

/// Every site this person can see, searchable.
///
/// The search is local, over a list already in hand: a company with two hundred sites still fits in
/// one request, and a round trip per keystroke on a site with one bar of signal makes the field feel
/// broken.
class SitesScreen extends ConsumerStatefulWidget {
  const SitesScreen({super.key});

  @override
  ConsumerState<SitesScreen> createState() => _SitesScreenState();
}

class _SitesScreenState extends ConsumerState<SitesScreen> {
  String _query = '';

  @override
  Widget build(BuildContext context) {
    final sites = ref.watch(sitesProvider);
    // The same permission the API checks on POST /projects. A supervisor sees no button rather than
    // a button that turns into a 403.
    final canAdd = ref.watch(authControllerProvider).me?.can('projects.manage') ?? false;

    return Scaffold(
      backgroundColor: Palette.canvas,
      floatingActionButton: canAdd
          ? Padding(
              padding: EdgeInsets.only(bottom: fabInset(context)),
              child: FloatingActionButton.extended(
                backgroundColor: Palette.accent,
                foregroundColor: Colors.white,
                onPressed: () => _openSiteForm(context),
                icon: const Icon(Icons.add),
                label: const Text('New site'),
              ),
            )
          : null,
      body: Column(
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 12, 16, 8),
          child: TextField(
            onChanged: (value) => setState(() => _query = value.trim().toLowerCase()),
            decoration: const InputDecoration(
              hintText: 'Search sites, clients, addresses',
              prefixIcon: Icon(Icons.search, size: 20),
              contentPadding: EdgeInsets.symmetric(horizontal: 16, vertical: 14),
            ),
          ),
        ),
        Expanded(
          child: RefreshIndicator(
            onRefresh: () async {
              ref.invalidate(sitesProvider);
              await ref.read(sitesProvider.future);
            },
            child: AsyncSection<List<Map<String, dynamic>>>(
              value: sites,
              onRetry: () => ref.invalidate(sitesProvider),
              builder: (rows) {
                final visible = _query.isEmpty
                    ? rows
                    : rows.where((site) {
                        final haystack = [
                          site['name'],
                          site['client_name'],
                          site['address'],
                        ].whereType<String>().join(' ').toLowerCase();
                        return haystack.contains(_query);
                      }).toList();

                if (visible.isEmpty) {
                  return ListView(
                    children: [
                      EmptyNote(
                        icon: Icons.apartment_outlined,
                        title: _query.isEmpty ? 'No sites yet' : 'Nothing matches that',
                        body: _query.isEmpty
                            ? (canAdd
                                  ? 'Start one with the button below. A name is enough — the budget, '
                                        'the dates and the team can follow.'
                                  : 'Sites appear here as soon as somebody with the rights adds one.')
                            : 'Try part of the site name, the client, or the address.',
                      ),
                    ],
                  );
                }

                return ListView.separated(
                  padding: EdgeInsets.fromLTRB(16, 6, 16, bottomInset(context, hasFab: canAdd)),
                  itemCount: visible.length,
                  separatorBuilder: (_, _) => const SizedBox(height: 10),
                  itemBuilder: (context, index) => _SiteCard(site: visible[index]),
                );
              },
            ),
          ),
        ),
      ],
      ),
    );
  }
}

/// The new-site sheet.
Future<void> _openSiteForm(BuildContext context) => showModalBottomSheet<void>(
  context: context,
  isScrollControlled: true,
  backgroundColor: Palette.surface,
  shape: const RoundedRectangleBorder(
    borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
  ),
  builder: (_) => const _SiteForm(),
);

class _SiteCard extends StatelessWidget {
  const _SiteCard({required this.site});

  final Map<String, dynamic> site;

  @override
  Widget build(BuildContext context) {
    final subtitle = [site['client_name'], site['address']].whereType<String>().join(' · ');
    final budget = site['budget_amount'] as String?;

    /*
     * The covers arrive signed with the list itself, so leading the card with a photograph costs no
     * extra request. A builder with six jobs recognises them by what they look like long before they
     * read a name.
     */
    final covers = (site['covers'] as List<dynamic>? ?? const [])
        .map((row) => Map<String, dynamic>.from(row as Map))
        .toList();
    final photoCount = (site['photo_count'] as num?)?.toInt() ?? 0;

    return Card(
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: () => Navigator.of(context).push(
          MaterialPageRoute<void>(
            builder: (_) => SiteDetailScreen(
              projectId: site['id'] as String,
              name: site['name'] as String? ?? 'Site',
            ),
          ),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            if (covers.isNotEmpty) _Cover(covers: covers, photoCount: photoCount),
            Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Expanded(
                        child: Text(
                          site['name'] as String? ?? 'Site',
                          style: const TextStyle(fontSize: 16.5, fontWeight: FontWeight.w600),
                        ),
                      ),
                      StatusPill(site['status'] as String? ?? 'planning'),
                    ],
                  ),
                  if (subtitle.isNotEmpty) ...[
                    const SizedBox(height: 4),
                    Text(
                      subtitle,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(fontSize: 13, color: Palette.inkMuted),
                    ),
                  ],
                  const SizedBox(height: 12),
                  Row(
                    children: [
                      _Fact(
                        icon: Icons.account_balance_wallet_outlined,
                        text: budget == null ? 'No budget' : formatInrCompact(budget),
                      ),
                      const SizedBox(width: 16),
                      _Fact(
                        icon: Icons.flag_outlined,
                        text: site['target_end_date'] == null
                            ? 'No handover date'
                            : shortDate(site['target_end_date'] as String),
                      ),
                    ],
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

/// The photos, swipeable, with a count when there are more than fit.
class _Cover extends StatefulWidget {
  const _Cover({required this.covers, required this.photoCount});

  final List<Map<String, dynamic>> covers;
  final int photoCount;

  @override
  State<_Cover> createState() => _CoverState();
}

class _CoverState extends State<_Cover> {
  int _index = 0;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      height: 170,
      child: Stack(
        fit: StackFit.expand,
        children: [
          Container(color: Palette.neutralBg),
          PageView.builder(
            itemCount: widget.covers.length,
            onPageChanged: (index) => setState(() => _index = index),
            itemBuilder: (context, index) => Image.network(
              widget.covers[index]['url'] as String,
              fit: BoxFit.cover,
              errorBuilder: (_, _, _) =>
                  const Center(child: Icon(Icons.broken_image_outlined, color: Palette.inkFaint)),
            ),
          ),
          if (widget.covers.length > 1)
            Positioned(
              left: 0,
              right: 0,
              bottom: 10,
              child: Row(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  for (var i = 0; i < widget.covers.length; i++)
                    Container(
                      margin: const EdgeInsets.symmetric(horizontal: 3),
                      width: i == _index ? 16 : 6,
                      height: 6,
                      decoration: BoxDecoration(
                        color: i == _index ? Colors.white : Colors.white54,
                        borderRadius: BorderRadius.circular(999),
                      ),
                    ),
                ],
              ),
            ),
          if (widget.photoCount > 0)
            Positioned(
              right: 10,
              top: 10,
              child: Container(
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                decoration: BoxDecoration(
                  color: const Color(0xB31B1A2E),
                  borderRadius: BorderRadius.circular(999),
                ),
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    const Icon(Icons.photo_camera_outlined, size: 12, color: Colors.white),
                    const SizedBox(width: 4),
                    Text(
                      '${widget.photoCount}',
                      style: const TextStyle(color: Colors.white, fontSize: 11.5),
                    ),
                  ],
                ),
              ),
            ),
        ],
      ),
    );
  }
}

class _Fact extends StatelessWidget {
  const _Fact({required this.icon, required this.text});

  final IconData icon;
  final String text;

  @override
  Widget build(BuildContext context) => Row(
    mainAxisSize: MainAxisSize.min,
    children: [
      Icon(icon, size: 15, color: Palette.inkFaint),
      const SizedBox(width: 5),
      Text(text, style: const TextStyle(fontSize: 13, color: Palette.inkMuted)),
    ],
  );
}

/// Starting a site from the phone.
///
/// A builder wins a job standing on it, not at a desk, and until now the only way to enter one was
/// the web app — so the site got recorded that evening, or the next week, or after the first three
/// days of labour had already been marked against nothing.
///
/// The name is the only thing asked for. Everything else on this sheet is a field the web app also
/// offers and the API also takes as optional; a budget still under negotiation and a handover date
/// that is only a hope are worse than blank, because they are believed.
class _SiteForm extends ConsumerStatefulWidget {
  const _SiteForm();

  @override
  ConsumerState<_SiteForm> createState() => _SiteFormState();
}

class _SiteFormState extends ConsumerState<_SiteForm> {
  final _name = TextEditingController();
  final _client = TextEditingController();
  final _address = TextEditingController();
  final _budget = TextEditingController();

  String _status = 'planning';
  String? _startDate;
  String? _targetEndDate;
  LatLng? _location;
  final List<XFile> _media = [];
  bool _saving = false;

  /// What the button says while a site with six photos is being created.
  String? _progress;
  String? _error;

  @override
  void dispose() {
    _name.dispose();
    _client.dispose();
    _address.dispose();
    _budget.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: EdgeInsets.only(bottom: MediaQuery.of(context).viewInsets.bottom),
      child: DraggableScrollableSheet(
        expand: false,
        initialChildSize: 0.85,
        maxChildSize: 0.95,
        builder: (context, controller) => ListView(
          controller: controller,
          // The sheet reaches the bottom of the display, so the gesture strip sits over the last
          // thing in it — which is the button that creates the site.
          padding: EdgeInsets.fromLTRB(20, 16, 20, 28 + systemBottomInset(context)),
          children: [
            Row(
              children: [
                const Expanded(
                  child: Text(
                    'New site',
                    style: TextStyle(fontSize: 19, fontWeight: FontWeight.w700),
                  ),
                ),
                IconButton(
                  onPressed: () => Navigator.of(context).pop(),
                  icon: const Icon(Icons.close),
                ),
              ],
            ),
            const SizedBox(height: 12),
            const _FieldLabel('Site name'),
            TextField(
              controller: _name,
              autofocus: true,
              textCapitalization: TextCapitalization.words,
              style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w600),
              decoration: const InputDecoration(hintText: 'Lakeview Tower'),
            ),
            const SizedBox(height: 16),
            const _FieldLabel('Client'),
            TextField(
              controller: _client,
              textCapitalization: TextCapitalization.words,
              decoration: const InputDecoration(hintText: 'Optional'),
            ),
            const SizedBox(height: 16),
            const _FieldLabel('Address'),
            TextField(
              controller: _address,
              maxLines: 2,
              textCapitalization: TextCapitalization.sentences,
              decoration: const InputDecoration(hintText: 'Survey number, area'),
            ),
            const SizedBox(height: 16),
            const _FieldLabel('Budget'),
            TextField(
              controller: _budget,
              keyboardType: const TextInputType.numberWithOptions(decimal: true),
              decoration: const InputDecoration(prefixText: '₹ ', hintText: '4,20,00,000'),
            ),
            const SizedBox(height: 16),
            const _FieldLabel('Stage'),
            DropdownButtonFormField<String>(
              initialValue: _status,
              items: const [
                DropdownMenuItem(value: 'planning', child: Text('Planning')),
                DropdownMenuItem(value: 'active', child: Text('On site')),
                DropdownMenuItem(value: 'on_hold', child: Text('On hold')),
              ],
              onChanged: (value) => setState(() => _status = value ?? 'planning'),
            ),
            const SizedBox(height: 16),
            const _FieldLabel('Where it is'),
            _LocationRow(
              location: _location,
              onPick: () async {
                final picked = await Navigator.of(context).push<LatLng>(
                  MaterialPageRoute<LatLng>(
                    builder: (_) => LocationPickerSheet(
                      initial: _location,
                      query: _address.text.trim(),
                    ),
                  ),
                );
                if (picked != null) setState(() => _location = picked);
              },
              onHere: () async {
                final fix = await DeviceLocation.current();
                if (!context.mounted) return;
                if (fix.point == null) {
                  notify(context, fix.problem ?? 'Could not get a fix', bad: true);
                  return;
                }
                setState(() => _location = fix.point);
              },
              onClear: () => setState(() => _location = null),
            ),
            const SizedBox(height: 16),
            const _FieldLabel('Photos and video'),
            _MediaRow(
              files: _media,
              onAdd: _addMedia,
              onRemove: (file) => setState(() => _media.remove(file)),
            ),
            const SizedBox(height: 16),
            const _FieldLabel('Start date'),
            _DateButton(
              value: _startDate,
              onPicked: (picked) => setState(() => _startDate = picked),
            ),
            const SizedBox(height: 16),
            const _FieldLabel('Target handover'),
            _DateButton(
              value: _targetEndDate,
              onPicked: (picked) => setState(() => _targetEndDate = picked),
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
              onPressed: _saving ? null : _submit,
              child: _saving
                  ? Row(
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        const SizedBox(
                          height: 18,
                          width: 18,
                          child: CircularProgressIndicator(strokeWidth: 2.2, color: Colors.white),
                        ),
                        // Uploading six photos over 4G is a wait worth narrating; a bare spinner
                        // for forty seconds reads as a hang.
                        if (_progress != null) ...[
                          const SizedBox(width: 10),
                          Text(_progress!),
                        ],
                      ],
                    )
                  : const Text('Create site'),
            ),
          ],
        ),
      ),
    );
  }

  /// Photos from the camera or the gallery, or one clip.
  ///
  /// Offered as a choice rather than straight to the camera: a site is usually entered from an
  /// office, days after somebody walked it, so the photographs are already on the phone.
  Future<void> _addMedia() async {
    final choice = await showModalBottomSheet<String>(
      context: context,
      backgroundColor: Palette.surface,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
      ),
      builder: (context) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            ListTile(
              leading: const Icon(Icons.photo_camera_outlined),
              title: const Text('Take a photo'),
              onTap: () => Navigator.of(context).pop('camera'),
            ),
            ListTile(
              leading: const Icon(Icons.photo_library_outlined),
              title: const Text('Choose photos'),
              onTap: () => Navigator.of(context).pop('gallery'),
            ),
            ListTile(
              leading: const Icon(Icons.videocam_outlined),
              title: const Text('Add a video'),
              subtitle: const Text('Up to a minute'),
              onTap: () => Navigator.of(context).pop('video'),
            ),
          ],
        ),
      ),
    );
    if (choice == null) return;

    final added = switch (choice) {
      'camera' => [?await PhotoUploader.capture()],
      'gallery' => await PhotoUploader.pickFromGallery(),
      _ => [?await PhotoUploader.pickVideo()],
    };
    if (added.isEmpty) return;
    setState(() => _media.addAll(added));
  }

  /// Uploads what was picked and attaches each one to the site. Returns how many did not make it.
  ///
  /// One failure does not stop the rest, and none of them undo the site: a photograph that failed
  /// to send can be added again from the site itself, while a site rolled back because of one is
  /// a form somebody has to fill in twice.
  Future<int> _uploadMedia({required String projectId}) async {
    if (_media.isEmpty) return 0;

    final uploader = PhotoUploader(ref.read(apiClientProvider));
    final api = ref.read(apiProvider);
    var failed = 0;

    for (var index = 0; index < _media.length; index++) {
      if (mounted) setState(() => _progress = 'Sending ${index + 1} of ${_media.length}');
      final file = _media[index];
      try {
        final key = await uploader.upload(file, projectId: projectId, kind: 'site_media');
        await api.addSiteMedia(
          projectId: projectId,
          s3Key: key,
          contentType: PhotoUploader.contentTypeOf(file.path),
          sizeBytes: await file.length(),
        );
      } on ApiException {
        failed++;
      }
    }
    if (mounted) setState(() => _progress = null);
    return failed;
  }

  Future<void> _submit() async {
    final name = _name.text.trim();
    if (name.length < 2) {
      setState(() => _error = 'Give the site a name');
      return;
    }

    // Checked here as well as on the server, so the answer arrives before the round trip and in
    // words rather than as a field path: a handover before the start is a typo, every time.
    if (_startDate != null &&
        _targetEndDate != null &&
        _targetEndDate!.compareTo(_startDate!) < 0) {
      setState(() => _error = 'Handover cannot be before the start date');
      return;
    }

    String? budget;
    if (_budget.text.trim().isNotEmpty) {
      budget = rupeesToPaise(_budget.text);
      if (budget == null) {
        setState(() => _error = 'Enter the budget in rupees, like 42000000');
        return;
      }
    }

    setState(() {
      _saving = true;
      _error = null;
    });
    try {
      final api = ref.read(apiProvider);
      final id = await api.createSite(
        name: name,
        clientName: _client.text.trim(),
        address: _address.text.trim(),
        budgetPaise: budget,
        startDate: _startDate,
        targetEndDate: _targetEndDate,
        status: _status,
        lat: _location?.latitude,
        lng: _location?.longitude,
      );

      final failed = await _uploadMedia(projectId: id);
      if (!mounted) return;
      final navigator = Navigator.of(context);
      navigator.pop();
      notify(
        context,
        // The site exists either way. Saying so plainly beats a bare success message that leaves
        // somebody wondering where their photographs went.
        failed == 0
            ? '$name created'
            : '$name created — $failed ${failed == 1 ? 'file' : 'files'} did not upload',
        bad: failed > 0,
      );
      // Straight into what was just made: the next thing anybody does with a new site is add the
      // team or the first milestone, and both live in there.
      navigator.push(
        MaterialPageRoute<void>(builder: (_) => SiteDetailScreen(projectId: id, name: name)),
      );
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() => _error = error.message);
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }
}

class _DateButton extends StatelessWidget {
  const _DateButton({required this.value, required this.onPicked});

  final String? value;
  final void Function(String) onPicked;

  @override
  Widget build(BuildContext context) => OutlinedButton.icon(
    style: OutlinedButton.styleFrom(minimumSize: const Size.fromHeight(52)),
    onPressed: () async {
      final picked = await showDatePicker(
        context: context,
        initialDate: parseIsoDate(value) ?? DateTime.now(),
        // A site can be entered years after it started, and planned years ahead; neither end of
        // that range is a mistake worth refusing.
        firstDate: DateTime(DateTime.now().year - 5),
        lastDate: DateTime(DateTime.now().year + 10),
      );
      if (picked != null) onPicked(isoDate(picked));
    },
    icon: const Icon(Icons.calendar_today_outlined, size: 17),
    label: Text(value == null ? 'Not set' : longDate(value)),
  );
}

class _FieldLabel extends StatelessWidget {
  const _FieldLabel(this.text);

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

/// The location field: a button until there is a pin, a readout with a map behind it afterwards.
class _LocationRow extends StatefulWidget {
  const _LocationRow({
    required this.location,
    required this.onPick,
    required this.onHere,
    required this.onClear,
  });

  final LatLng? location;
  final VoidCallback onPick;
  final Future<void> Function() onHere;
  final VoidCallback onClear;

  @override
  State<_LocationRow> createState() => _LocationRowState();
}

class _LocationRowState extends State<_LocationRow> {
  bool _locating = false;

  Future<void> _here() async {
    setState(() => _locating = true);
    try {
      await widget.onHere();
    } finally {
      if (mounted) setState(() => _locating = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final location = widget.location;

    if (location == null) {
      /*
       * Two ways in, side by side.
       *
       * Most sites are entered from an office, where the map is the only option. But a site being
       * entered while standing on it — which is how the plots with no address get recorded — needs
       * one tap, not a map to pan to a field that looks like every other field.
       */
      return Row(
        children: [
          Expanded(
            child: OutlinedButton.icon(
              style: OutlinedButton.styleFrom(minimumSize: const Size.fromHeight(52)),
              onPressed: widget.onPick,
              icon: const Icon(Icons.map_outlined, size: 18),
              label: const Text('Pick on map'),
            ),
          ),
          const SizedBox(width: 10),
          Expanded(
            child: OutlinedButton.icon(
              style: OutlinedButton.styleFrom(minimumSize: const Size.fromHeight(52)),
              onPressed: _locating ? null : _here,
              icon: _locating
                  ? const SizedBox(
                      height: 16,
                      width: 16,
                      child: CircularProgressIndicator(strokeWidth: 2.2),
                    )
                  : const Icon(Icons.my_location, size: 18),
              label: const Text("I'm here"),
            ),
          ),
        ],
      );
    }

    return Row(
      children: [
        const Icon(Icons.location_on, size: 20, color: Palette.accent),
        const SizedBox(width: 8),
        Expanded(
          child: Text(
            '${location.latitude.toStringAsFixed(5)}, ${location.longitude.toStringAsFixed(5)}',
            style: const TextStyle(fontSize: 13.5, fontFamily: 'monospace'),
          ),
        ),
        IconButton(
          onPressed: _locating ? null : _here,
          icon: _locating
              ? const SizedBox(height: 16, width: 16, child: CircularProgressIndicator(strokeWidth: 2.2))
              : const Icon(Icons.my_location, size: 18, color: Palette.accent),
          tooltip: "Use where I'm standing",
        ),
        TextButton(onPressed: widget.onPick, child: const Text('Change')),
        IconButton(
          onPressed: widget.onClear,
          icon: const Icon(Icons.close, size: 18, color: Palette.inkFaint),
          tooltip: 'Clear',
        ),
      ],
    );
  }
}

/// What has been picked, before any of it has been sent anywhere.
class _MediaRow extends StatelessWidget {
  const _MediaRow({required this.files, required this.onAdd, required this.onRemove});

  final List<XFile> files;
  final VoidCallback onAdd;
  final void Function(XFile) onRemove;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      height: 84,
      child: ListView.separated(
        scrollDirection: Axis.horizontal,
        itemCount: files.length + 1,
        separatorBuilder: (_, _) => const SizedBox(width: 8),
        itemBuilder: (context, index) {
          if (index == 0) {
            return InkWell(
              onTap: onAdd,
              borderRadius: BorderRadius.circular(12),
              child: Container(
                width: 84,
                decoration: BoxDecoration(
                  borderRadius: BorderRadius.circular(12),
                  border: Border.all(color: Palette.line),
                  color: Palette.raised,
                ),
                child: const Column(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    Icon(Icons.add_a_photo_outlined, size: 20, color: Palette.inkMuted),
                    SizedBox(height: 4),
                    Text('Add', style: TextStyle(fontSize: 11.5, color: Palette.inkMuted)),
                  ],
                ),
              ),
            );
          }

          final file = files[index - 1];
          final video = PhotoUploader.isVideo(file.path);
          return Stack(
            children: [
              ClipRRect(
                borderRadius: BorderRadius.circular(12),
                child: video
                    // No frame is extracted for the thumbnail: pulling one needs a decoder this app
                    // does not carry, and a labelled tile says as much as a blurry first frame.
                    ? Container(
                        width: 84,
                        height: 84,
                        color: Palette.neutralBg,
                        child: const Center(
                          child: Icon(Icons.videocam, color: Palette.inkMuted),
                        ),
                      )
                    : Image.file(
                        File(file.path),
                        width: 84,
                        height: 84,
                        fit: BoxFit.cover,
                        errorBuilder: (_, _, _) => Container(
                          width: 84,
                          height: 84,
                          color: Palette.neutralBg,
                          child: const Icon(Icons.broken_image_outlined, color: Palette.inkFaint),
                        ),
                      ),
              ),
              Positioned(
                right: 2,
                top: 2,
                child: InkWell(
                  onTap: () => onRemove(file),
                  child: const CircleAvatar(
                    radius: 11,
                    backgroundColor: Color(0xCC1B1A2E),
                    child: Icon(Icons.close, size: 13, color: Colors.white),
                  ),
                ),
              ),
            ],
          );
        },
      ),
    );
  }
}
