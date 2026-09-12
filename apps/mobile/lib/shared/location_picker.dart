import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:latlong2/latlong.dart';

import '../core/api_client.dart';
import '../core/api_providers.dart';
import '../core/device_location.dart';
import '../core/map_tiles.dart';
import '../core/theme.dart';

/// Where a site is, chosen on a map.
///
/// Dropping a pin is the primary path, not typing coordinates. A plot on the edge of a town has no
/// postal address, often no road name, and the person entering it is either standing on it or
/// looking at it on a map Ã¢â‚¬â€ both of which are a tap, and neither of which is a decimal degree.
///
/// Searching gets you to the right kilometre; the pin does the rest. The search runs through the
/// API rather than straight to the tile provider, because the free geocoder asks for at most one
/// request a second and the server is where that limit is enforced for everybody.
///
/// A screen of its own rather than a sheet. It used to open as a bottom sheet from inside the
/// new-site sheet, which left a map in a draggable panel inside another draggable panel Ã¢â‚¬â€ three
/// things competing for the same vertical drag, on the one screen where dragging *is* the
/// interaction. A map wants the whole display and one obvious way back.
class LocationPickerSheet extends ConsumerStatefulWidget {
  const LocationPickerSheet({super.key, this.initial, this.query});

  final LatLng? initial;

  /// The address already typed into the form, used as the first search.
  final String? query;

  @override
  ConsumerState<LocationPickerSheet> createState() => _LocationPickerSheetState();
}

class _LocationPickerSheetState extends ConsumerState<LocationPickerSheet> {
  final _controller = MapController();
  late final _search = TextEditingController(text: widget.query ?? '');

  /// Coimbatore, because this product is sold there and an empty map has to start somewhere.
  static const _fallback = LatLng(11.0168, 76.9558);

  late LatLng _point = widget.initial ?? _fallback;
  bool _placed = false;
  bool _searching = false;
  bool _locating = false;

  /// Set when the tile server refuses or the phone has no route to it.
  ///
  /// Without this a failed tile is an empty grey rectangle, which reads as "the map did not open"
  /// Ã¢â‚¬â€ and sends somebody looking for a bug in the app rather than at their signal.
  bool _tilesFailed = false;
  String? _error;
  List<Map<String, dynamic>> _results = const [];

  @override
  void initState() {
    super.initState();
    _placed = widget.initial != null;
  }

  @override
  void dispose() {
    _search.dispose();
    super.dispose();
  }

  Future<void> _find() async {
    final query = _search.text.trim();
    if (query.length < 3) {
      setState(() => _error = 'Type at least three letters of a place');
      return;
    }
    setState(() {
      _searching = true;
      _error = null;
      _results = const [];
    });
    try {
      final results = await ref.read(apiProvider).geocode(query);
      if (!mounted) return;
      if (results.isEmpty) {
        setState(() => _error = 'Nothing found for that. Try the town, or pan the map instead.');
        return;
      }
      setState(() => _results = results);
      _goTo(results.first);
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() => _error = error.message);
    } finally {
      if (mounted) setState(() => _searching = false);
    }
  }

  /// Drops the pin where the phone is.
  ///
  /// The fastest correct answer when somebody is standing on the plot, and on a site with no road
  /// name the only accurate one Ã¢â‚¬â€ searching finds the village, not the survey number.
  Future<void> _useMyLocation() async {
    setState(() {
      _locating = true;
      _error = null;
    });
    final fix = await DeviceLocation.current();
    if (!mounted) return;
    setState(() {
      _locating = false;
      _error = fix.problem;
      if (fix.point != null) {
        _point = fix.point!;
        _placed = true;
        _results = const [];
      }
    });
    if (fix.point != null) _controller.move(_point, 17);
  }

  void _goTo(Map<String, dynamic> result) {
    final lat = (result['lat'] as num?)?.toDouble();
    final lng = (result['lng'] as num?)?.toDouble();
    if (lat == null || lng == null) return;
    setState(() {
      _point = LatLng(lat, lng);
      _placed = true;
      _results = const [];
    });
    _controller.move(_point, 16);
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Where is the site?')),
      body: SafeArea(
        child: Column(
          children: [
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 20),
              child: TextField(
                controller: _search,
                textInputAction: TextInputAction.search,
                onSubmitted: (_) => _find(),
                decoration: InputDecoration(
                  hintText: 'Search a locality or landmark',
                  prefixIcon: const Icon(Icons.search, size: 20),
                  suffixIcon: _searching
                      ? const Padding(
                          padding: EdgeInsets.all(12),
                          child: SizedBox(
                            height: 18,
                            width: 18,
                            child: CircularProgressIndicator(strokeWidth: 2.2),
                          ),
                        )
                      : IconButton(icon: const Icon(Icons.arrow_forward), onPressed: _find),
                ),
              ),
            ),
            if (_error != null)
              Padding(
                padding: const EdgeInsets.fromLTRB(20, 10, 20, 0),
                child: Text(
                  _error!,
                  style: const TextStyle(color: Palette.blocked, fontSize: 13),
                ),
              ),
            const SizedBox(height: 10),
            Expanded(
              child: Stack(
                children: [
                  FlutterMap(
                    mapController: _controller,
                    options: MapOptions(
                      initialCenter: _point,
                      initialZoom: _placed ? 16 : 11,
                      // Tapping the map is the whole interaction. Long-press does nothing extra on
                      // purpose Ã¢â‚¬â€ one gesture, no discovery required.
                      onTap: (_, point) => setState(() {
                        _point = point;
                        _placed = true;
                        _results = const [];
                      }),
                    ),
                    children: [
                      TileLayer(
                        urlTemplate: MapTiles.urlTemplate,
                        userAgentPackageName: 'com.buildr.buildr_mobile',
                        maxNativeZoom: 19,
                        errorTileCallback: (_, _, _) {
                          if (_tilesFailed || !mounted) return;
                          // After the frame: this fires during the tile's own build.
                          WidgetsBinding.instance.addPostFrameCallback((_) {
                            if (mounted) setState(() => _tilesFailed = true);
                          });
                        },
                      ),
                      if (_placed)
                        MarkerLayer(
                          markers: [
                            Marker(
                              point: _point,
                              width: 44,
                              height: 44,
                              alignment: Alignment.topCenter,
                              child: const Icon(
                                Icons.location_on,
                                size: 42,
                                color: Palette.accent,
                              ),
                            ),
                          ],
                        ),
                    ],
                  ),
                  if (_tilesFailed)
                    const Positioned(
                      left: 16,
                      right: 16,
                      top: 16,
                      child: _Hint(
                        'The map images are not loading. The pin still works Ã¢â‚¬â€ '
                        'search or tap where the site is.',
                      ),
                    ),
                  if (_results.isNotEmpty)
                    Positioned(
                      left: 12,
                      right: 12,
                      top: 12,
                      child: Material(
                        borderRadius: BorderRadius.circular(12),
                        color: Palette.surface,
                        elevation: 3,
                        child: Column(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            for (final result in _results.take(5))
                              ListTile(
                                dense: true,
                                leading: const Icon(Icons.place_outlined, size: 18),
                                title: Text(
                                  result['label'] as String? ?? '',
                                  maxLines: 2,
                                  style: const TextStyle(fontSize: 13.5),
                                ),
                                onTap: () => _goTo(result),
                              ),
                          ],
                        ),
                      ),
                    ),
                  // Over the map rather than in the footer: it is a way of moving the pin, and it
                  // belongs beside the other one.
                  Positioned(
                    right: 12,
                    bottom: _placed ? 12 : 66,
                    child: FloatingActionButton.small(
                      heroTag: 'use-my-location',
                      onPressed: _locating ? null : _useMyLocation,
                      backgroundColor: Palette.surface,
                      foregroundColor: Palette.accent,
                      tooltip: 'Use my location',
                      child: _locating
                          ? const SizedBox(
                              height: 17,
                              width: 17,
                              child: CircularProgressIndicator(strokeWidth: 2.2),
                            )
                          : const Icon(Icons.my_location, size: 20),
                    ),
                  ),
                  if (!_placed)
                    const Positioned(
                      left: 16,
                      right: 16,
                      bottom: 16,
                      child: _Hint('Tap the map to drop a pin, or use the button for where you are'),
                    ),
                  // OSM's licence asks for attribution wherever their tiles are shown.
                  const Positioned(
                    right: 0,
                    bottom: 0,
                    child: ColoredBox(
                      color: Color(0xCCFFFFFF),
                      child: Padding(
                        padding: EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                        child: Text(
                          'Ã‚Â© OpenStreetMap',
                          style: TextStyle(fontSize: 9.5, color: Palette.inkMuted),
                        ),
                      ),
                    ),
                  ),
                ],
              ),
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(20, 12, 20, 12),
              child: Row(
                children: [
                  Expanded(
                    child: Text(
                      _placed
                          ? '${_point.latitude.toStringAsFixed(5)}, ${_point.longitude.toStringAsFixed(5)}'
                          : 'No pin yet',
                      style: const TextStyle(
                        fontSize: 13,
                        fontFamily: 'monospace',
                        color: Palette.inkMuted,
                      ),
                    ),
                  ),
                  FilledButton(
                    onPressed: _placed ? () => Navigator.of(context).pop(_point) : null,
                    child: const Text('Use this spot'),
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

class _Hint extends StatelessWidget {
  const _Hint(this.text);

  final String text;

  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
    decoration: BoxDecoration(
      color: const Color(0xE61B1A2E),
      borderRadius: BorderRadius.circular(10),
    ),
    child: Text(
      text,
      textAlign: TextAlign.center,
      style: const TextStyle(color: Colors.white, fontSize: 13),
    ),
  );
}
