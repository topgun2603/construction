import 'dart:io' show Platform;

import 'package:flutter/foundation.dart' show kIsWeb;

/// Where this build talks to.
///
/// Overridden at build time, never at runtime:
///
/// ```
/// flutter run --dart-define=API_URL=https://api.buildr.example/v1
/// ```
///
/// The default is the local API, and it differs by platform because "localhost" means the device
/// itself: on the Android emulator the host machine is 10.0.2.2, on the iOS simulator it really is
/// localhost, and a physical phone needs the laptop's address on the same wifi passed in explicitly.
class Env {
  const Env._();

  static const String _override = String.fromEnvironment('API_URL');

  static String get apiUrl {
    if (_override.isNotEmpty) return _override;
    if (!kIsWeb && Platform.isAndroid) return 'http://10.0.2.2:4100/v1';
    return 'http://localhost:4100/v1';
  }

  /// Skips Firebase and sends `dev:<phone>` to `/auth/exchange`, which the API accepts only when it
  /// is itself running with `DEV_AUTH_BYPASS=true`. Both halves have to agree, so this can never
  /// open a door on a production API — the worst it can do is fail to sign in.
  static const bool devAuthBypass = bool.fromEnvironment('DEV_AUTH_BYPASS', defaultValue: false);

  /// A build talking to a real API over plaintext http is a mistake worth showing on screen.
  static bool get insecureTransport => apiUrl.startsWith('http://') && !isLocal;

  static bool get isLocal =>
      apiUrl.contains('localhost') || apiUrl.contains('10.0.2.2') || apiUrl.contains('127.0.0.1');
}
