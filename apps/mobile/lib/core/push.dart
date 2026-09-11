import 'dart:async';
import 'dart:io' show Platform;

import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'api_client.dart';
import 'api_providers.dart';
import 'auth_controller.dart';

/// A notification the person tapped, waiting for the shell to act on it.
///
/// Null until something is tapped, and set back to null once the shell has moved. The tap is held
/// as data rather than acted on here: this runs outside the widget tree, and the navigator that
/// knows where "indents" is lives inside it.
class PushTap {
  const PushTap({required this.type, this.projectId});

  factory PushTap.fromData(Map<String, dynamic> data) =>
      PushTap(type: data['type'] as String? ?? '', projectId: data['project_id'] as String?);

  final String type;
  final String? projectId;
}

final pushTapProvider = StateProvider<PushTap?>((ref) => null);

/// Which section of the app a notification belongs to, or null when it has no home on a phone.
///
/// The API's types are `<subject>.<what happened>` — `indent.approved`, `dpr.submitted`,
/// `wage_period.drafted` — so the subject alone decides. Wage periods are reviewed on the web and
/// have no mobile section; those open the notification list instead of guessing at a destination.
String? sectionForNotification(String type) {
  final subject = type.split('.').first;
  return switch (subject) {
    'indent' => 'indents',
    'dpr' => 'dpr',
    'expense' => 'expenses',
    'attendance' => 'attendance',
    _ => null,
  };
}

final pushServiceProvider = Provider<PushService>((ref) {
  final service = PushService(ref);
  ref.onDispose(service.dispose);
  return service;
});

/// Push notifications: registering this device, and reacting when one arrives.
///
/// The device token is per install, not per person. A site phone that three supervisors share must
/// not keep delivering the first one's approvals to the third, so the token is registered when a
/// session starts and withdrawn when it ends — [register] and [unregister] bracket the session
/// exactly as the tokens in the keystore do.
///
/// Every failure here is swallowed. Push is a convenience on top of a list the app already polls;
/// a phone with notifications denied, an old Android without Play Services, or a checkout with no
/// `google-services.json` must still sign in and work.
class PushService {
  PushService(this._ref);

  final Ref _ref;

  final List<StreamSubscription<dynamic>> _subscriptions = [];
  String? _token;
  bool _listening = false;

  ApiClient get _api => _ref.read(apiClientProvider);

  /// Firebase is optional at startup (see `main.dart`), so everything here has to ask first.
  bool get _available => Firebase.apps.isNotEmpty;

  /// Called once a session exists. Asks for permission, hands the token to the API, and starts
  /// listening.
  ///
  /// Permission is requested here rather than at launch on purpose: "BUILDR would like to send you
  /// notifications" means something to somebody who has just signed in to their sites, and nothing
  /// to somebody looking at a login form.
  Future<void> register() async {
    if (!_available) return;

    try {
      final messaging = FirebaseMessaging.instance;
      final settings = await messaging.requestPermission();
      if (settings.authorizationStatus == AuthorizationStatus.denied) return;

      // On iOS the FCM token is minted from the APNs token, which arrives a moment after the
      // permission dialog. Asking too early returns null; `onTokenRefresh` catches it when it lands.
      if (!kIsWeb && Platform.isIOS && await messaging.getAPNSToken() == null) {
        _listen(messaging);
        return;
      }

      await _send(await messaging.getToken());
      _listen(messaging);
    } catch (error, stack) {
      debugPrint('Push registration skipped: $error\n$stack');
    }
  }

  /// Called as the session ends, before the tokens are cleared — the request needs one.
  Future<void> unregister() async {
    if (!_available) return;

    final token = _token ?? await _tokenOrNull();
    _token = null;
    if (token == null) return;

    try {
      await _api.delete('/me/fcm-tokens', body: {'token': token});
    } catch (_) {
      // Signing out must not fail because the network did. The token is dropped locally either
      // way, and the server prunes what FCM later reports as dead.
    }

    try {
      // Locally too, so a phone that signed out offline is not still holding a live token for an
      // account it no longer has. The next sign-in mints a fresh one.
      await FirebaseMessaging.instance.deleteToken();
    } catch (_) {
      // Nothing to do about it.
    }
  }

  void _listen(FirebaseMessaging messaging) {
    if (_listening) return;
    _listening = true;

    // The token rotates on reinstall, restore from backup, and occasionally on its own.
    _subscriptions.add(messaging.onTokenRefresh.listen(_send));

    // In the foreground the system tray stays silent, so the badge and the list are the only sign
    // anything happened. Both come from data the app already has a provider for.
    _subscriptions.add(FirebaseMessaging.onMessage.listen((_) => _refreshUnread()));

    _subscriptions.add(FirebaseMessaging.onMessageOpenedApp.listen(_tapped));

    // Launched from a notification while terminated: the tap is waiting in the launch intent.
    unawaited(
      messaging.getInitialMessage().then((message) {
        if (message != null) _tapped(message);
      }),
    );
  }

  void _tapped(RemoteMessage message) {
    _ref.read(pushTapProvider.notifier).state = PushTap.fromData(message.data);
    _refreshUnread();
  }

  /// The badge is read from `/me`, and the list from `/notifications` — pulling both is what makes
  /// an arriving notification visible without the person pulling to refresh.
  void _refreshUnread() {
    unawaited(_ref.read(authControllerProvider.notifier).refreshMe());
    _ref.invalidate(notificationsProvider);
  }

  Future<void> _send(String? token) async {
    if (token == null || token.isEmpty || token == _token) return;
    try {
      await _api.post('/me/fcm-tokens', body: {'token': token});
      _token = token;
    } catch (error) {
      // A token the API never heard is a silent phone, not a broken one. The next sign-in or
      // refresh tries again.
      debugPrint('Could not register for push: $error');
    }
  }

  Future<String?> _tokenOrNull() async {
    try {
      return await FirebaseMessaging.instance.getToken();
    } catch (_) {
      return null;
    }
  }

  void dispose() {
    for (final subscription in _subscriptions) {
      unawaited(subscription.cancel());
    }
    _subscriptions.clear();
    _listening = false;
  }
}
