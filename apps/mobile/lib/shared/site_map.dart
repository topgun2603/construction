import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:latlong2/latlong.dart';
import 'package:url_launcher/url_launcher.dart';

import '../core/theme.dart';

/// Where the site is.
///
/// OpenStreetMap raster tiles, the same source the web app uses, so the two show the same map and
/// neither needs an API key or a billing account. The tile server is somebody else's charity: the
/// user agent below identifies this app, as their usage policy requires.
///
/// Tapping opens whatever map app the phone has. A pin on a 350px card is enough to recognise a
/// place; getting a lorry to it is a job for the app that does turn-by-turn.
class SiteMap extends StatelessWidget {
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
  Widget build(BuildContext context) {
    if (lat == null || lng == null) {
      return Card(
        child: SizedBox(
          height: height,
          child: Center(
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 28),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  const Icon(Icons.location_off_outlined, size: 30, color: Palette.inkFaint),
                  const SizedBox(height: 12),
                  const Text(
                    'No location set',
                    style: TextStyle(fontSize: 15, fontWeight: FontWeight.w600),
                  ),
                  const SizedBox(height: 5),
                  Text(
                    address ?? 'Drop a pin on this site from the web app and it appears here.',
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

    final point = LatLng(lat!, lng!);

    return Card(
      clipBehavior: Clip.antiAlias,
      child: Column(
        children: [
          SizedBox(
            height: height,
            child: Stack(
              children: [
                FlutterMap(
                  options: MapOptions(
                    initialCenter: point,
                    initialZoom: 15,
                    // The card is for recognising a place, not for exploring. Panning it inside a
                    // scrolling page fights the scroll, so the gestures are off and the whole thing
                    // opens properly on tap.
                    interactionOptions: const InteractionOptions(flags: InteractiveFlag.none),
                  ),
                  children: [
                    TileLayer(
                      urlTemplate: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
                      userAgentPackageName: 'com.buildr.buildr_mobile',
                      maxNativeZoom: 19,
                    ),
                    MarkerLayer(
                      markers: [
                        Marker(
                          point: point,
                          width: 40,
                          height: 40,
                          alignment: Alignment.topCenter,
                          child: const Icon(Icons.location_on, size: 38, color: Palette.accent),
                        ),
                      ],
                    ),
                  ],
                ),
                Positioned.fill(
                  child: Material(
                    color: Colors.transparent,
                    child: InkWell(onTap: () => _open(context, point)),
                  ),
                ),
                // OSM's licence asks for attribution wherever their tiles are shown.
                Positioned(
                  right: 0,
                  bottom: 0,
                  child: Container(
                    color: const Color(0xCCFFFFFF),
                    padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                    child: const Text(
                      '© OpenStreetMap',
                      style: TextStyle(fontSize: 9.5, color: Palette.inkMuted),
                    ),
                  ),
                ),
              ],
            ),
          ),
          InkWell(
            onTap: () => _open(context, point),
            child: Padding(
              padding: const EdgeInsets.fromLTRB(16, 12, 16, 12),
              child: Row(
                children: [
                  Expanded(
                    child: Text(
                      address ?? '${lat!.toStringAsFixed(5)}, ${lng!.toStringAsFixed(5)}',
                      maxLines: 2,
                      style: const TextStyle(fontSize: 13.5, color: Palette.inkSoft, height: 1.35),
                    ),
                  ),
                  const SizedBox(width: 10),
                  const Icon(Icons.directions_outlined, size: 18, color: Palette.accent),
                  const SizedBox(width: 5),
                  const Text(
                    'Directions',
                    style: TextStyle(
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

  Future<void> _open(BuildContext context, LatLng point) async {
    final label = Uri.encodeComponent(name ?? 'Site');
    // `geo:` hands it to whatever map app is installed and carries the pin label. Where nothing
    // handles it — an emulator with no map app — the browser URL is the fallback.
    final geo = Uri.parse(
      'geo:${point.latitude},${point.longitude}?q='
      '${point.latitude},${point.longitude}($label)',
    );
    final web = Uri.parse(
      'https://www.openstreetmap.org/?mlat=${point.latitude}&mlon=${point.longitude}#map=17/'
      '${point.latitude}/${point.longitude}',
    );

    if (await canLaunchUrl(geo)) {
      await launchUrl(geo);
      return;
    }
    await launchUrl(web, mode: LaunchMode.externalApplication);
  }
}
