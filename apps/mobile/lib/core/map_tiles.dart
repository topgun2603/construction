/// Where map tiles come from.
///
/// **MapTiler, not OpenStreetMap's own servers.** Theirs are run by volunteers and their usage
/// policy is enforced by blocking — it blocked this app, and a blocked client gets a striped
/// "Access blocked" image in place of every tile, for every site at once. A correct User-Agent does
/// not change that: the policy is about who may use the infrastructure, not how politely.
///
/// The key is supplied at build time, the same way the API URL is:
///
/// ```
/// flutter run --dart-define=MAPTILER_KEY=...
/// ```
///
/// It is public by design — a tile key travels with every tile request, so it cannot be hidden —
/// and is restricted by referrer in the MapTiler console instead.
class MapTiles {
  const MapTiles._();

  static const String _key = String.fromEnvironment('MAPTILER_KEY');

  /// Whether tiles can be drawn at all. False in a build nobody passed a key to.
  static bool get configured => _key.isNotEmpty;

  static String get urlTemplate =>
      'https://api.maptiler.com/maps/streets-v2/256/{z}/{x}/{y}.png?key=$_key';

  /// Shown wherever the map is, as both providers require.
  static const String attribution = '© MapTiler © OpenStreetMap';
}
