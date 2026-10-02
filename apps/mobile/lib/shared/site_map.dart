import 'package:flutter/material.dart';
import 'package:google_maps_flutter/google_maps_flutter.dart';
import 'package:url_launcher/url_launcher.dart';

import '../core/i18n.dart';
import '../core/theme.dart';

/// Where the site is.
///
/// Google Maps, matching the web app. The tile layer this replaced ran on somebody else's charity
/// and was blocked for it once already; a key with a billing account behind it is the difference
/// between a map and a striped "access blocked" image across every site at once.
///
/// The key lives in `android/local.properties` as `MAPS_API_KEY`, is injected into the manifest by
/// Gradle, and is gitignored. It travels inside the APK and cannot be hidden, so it is restricted
/// in the Cloud console to this package name and the signing certificate's SHA-1 — that, not
/// secrecy, is what stops somebody else spending it.
///
/// Tapping opens whatever map app the phone has. A pin on a 350px card is enough to recognise a
/// place; getting a lorry to it is a job for the app that does turn-by-turn.
class SiteMap extends StatefulWidget {
  const SiteMap({
    super.key,
    required this.lat,
    required this.lng,
    this.name,
    this.address,
    this.height = 190,
  });

  final double? lat;
  final double? lng;
  final String? name;
  final String? address;
  final double height;

  @override
  State<SiteMap> createState() => _SiteMapState();
}

class _SiteMapState extends State<SiteMap> {
  /// Satellite is not a gimmick on a construction site: the plot next to a half-built structure
  /// looks like every other plot on a street map, and the imagery is how somebody recognises it.
  MapType _type = MapType.normal;

  @override
  Widget build(BuildContext context) {
    final lat = widget.lat;
    final lng = widget.lng;

    if (lat == null || lng == null) {
      return Card(
        child: SizedBox(
          height: widget.height,
          child: Center(
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 28),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  const Icon(Icons.location_off_outlined, size: 30, color: Palette.inkFaint),
                  const SizedBox(height: 12),
                  Text(
                    t('No location set'),
                    style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w600),
                  ),
                  const SizedBox(height: 5),
                  Text(
                    widget.address ??
                        t('Drop a pin on this site from the web app and it appears here.'),
                    textAlign: TextAlign.center,
                    style: const TextStyle(fontSize: 13, color: Palette.inkMuted, height: 1.4),
                  ),
                ],
              ),
            ),
          ),
        ),
      );
    }

    final point = LatLng(lat, lng);

    return Card(
      clipBehavior: Clip.antiAlias,
      child: Column(
        children: [
          SizedBox(
            height: widget.height,
            child: Stack(
              children: [
                GoogleMap(
                  initialCameraPosition: CameraPosition(target: point, zoom: 16),
                  mapType: _type,
                  markers: {
                    Marker(markerId: const MarkerId('site'), position: point),
                  },
                  // The card is for recognising a place, not for exploring. Panning it inside a
                  // scrolling page fights the scroll, so the gestures are off and the whole thing
                  // opens properly on tap.
                  zoomControlsEnabled: false,
                  zoomGesturesEnabled: false,
                  scrollGesturesEnabled: false,
                  rotateGesturesEnabled: false,
                  tiltGesturesEnabled: false,
                  myLocationButtonEnabled: false,
                  liteModeEnabled: true,
                ),
                Positioned.fill(
                  child: Material(
                    color: Colors.transparent,
                    child: InkWell(onTap: () => _open(point)),
                  ),
                ),
                Positioned(
                  right: 8,
                  top: 8,
                  child: Material(
                    color: const Color(0xE6FFFFFF),
                    borderRadius: BorderRadius.circular(999),
                    child: InkWell(
                      borderRadius: BorderRadius.circular(999),
                      onTap: () => setState(
                        () => _type = _type == MapType.normal ? MapType.hybrid : MapType.normal,
                      ),
                      child: Padding(
                        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                        child: Text(
                          _type == MapType.normal ? t('Satellite') : t('Map'),
                          style: const TextStyle(fontSize: 11.5, fontWeight: FontWeight.w600),
                        ),
                      ),
                    ),
                  ),
                ),
              ],
            ),
          ),
          InkWell(
            onTap: () => _open(point),
            child: Padding(
              padding: const EdgeInsets.fromLTRB(16, 12, 16, 12),
              child: Row(
                children: [
                  Expanded(
                    child: Text(
                      widget.address ??
                          '${lat.toStringAsFixed(5)}, ${lng.toStringAsFixed(5)}',
                      maxLines: 2,
                      style: const TextStyle(fontSize: 13.5, color: Palette.inkSoft, height: 1.35),
                    ),
                  ),
                  const SizedBox(width: 10),
                  const Icon(Icons.directions_outlined, size: 18, color: Palette.accent),
                  const SizedBox(width: 5),
                  Text(
                    t('Directions'),
                    style: const TextStyle(
                      fontSize: 13.5,
                      fontWeight: FontWeight.w600,
                      color: Palette.accent,
                    ),
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }

  Future<void> _open(LatLng point) async {
    final label = Uri.encodeComponent(widget.name ?? 'Site');
    // `geo:` hands it to whatever map app is installed and carries the pin label. Where nothing
    // handles it — an emulator with no map app — the browser URL is the fallback.
    final geo = Uri.parse(
      'geo:${point.latitude},${point.longitude}?q='
      '${point.latitude},${point.longitude}($label)',
    );
    final web = Uri.parse(
      'https://www.google.com/maps/search/?api=1&query='
      '${point.latitude},${point.longitude}',
    );

    if (await canLaunchUrl(geo)) {
      await launchUrl(geo);
      return;
    }
    await launchUrl(web, mode: LaunchMode.externalApplication);
  }
}
