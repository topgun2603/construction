import 'package:geolocator/geolocator.dart';
import 'package:latlong2/latlong.dart';

/// Where the phone is.
///
/// Wrapped rather than called directly so the three ways this fails — permission refused, refused
/// permanently, location switched off on the phone — each come back as a sentence somebody can act
/// on. "Location error" tells a site engineer standing in a field nothing about what to do next.
class DeviceLocation {
  const DeviceLocation._();

  /// The phone's current position, or an explanation.
  ///
  /// Asks for permission at the moment somebody taps the button, never at launch: a permission
  /// dialog on first run, before the app has shown what it is for, is the one people refuse.
  static Future<({LatLng? point, String? problem})> current() async {
    if (!await Geolocator.isLocationServiceEnabled()) {
      return (point: null, problem: 'Location is switched off on this phone');
    }

    var permission = await Geolocator.checkPermission();
    if (permission == LocationPermission.denied) {
      permission = await Geolocator.requestPermission();
    }
    if (permission == LocationPermission.deniedForever) {
      return (
        point: null,
        problem: 'Location is blocked for BUILDR. Turn it on in the phone’s app settings.',
      );
    }
    if (permission == LocationPermission.denied) {
      return (point: null, problem: 'Location permission was not given');
    }

    try {
      /*
       * `high` accuracy with a timeout, not `best`.
       *
       * A site is a place on a plot, so metres are enough and a fix arrives in seconds. `best` keeps
       * refining for as long as it is allowed to, which on a phone under a slab of reinforcement is
       * a spinner that never ends.
       */
      final position = await Geolocator.getCurrentPosition(
        locationSettings: const LocationSettings(
          accuracy: LocationAccuracy.high,
          timeLimit: Duration(seconds: 20),
        ),
      );
      return (point: LatLng(position.latitude, position.longitude), problem: null);
    } catch (_) {
      // Timed out, or the phone has no fix indoors. Either way there is a map to tap instead.
      return (point: null, problem: 'Could not get a fix. Tap the map instead.');
    }
  }
}
