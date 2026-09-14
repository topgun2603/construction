import 'dart:convert';

import 'package:flutter_secure_storage/flutter_secure_storage.dart';

/// The tokens a signed-in session is made of.
class TokenPair {
  const TokenPair({required this.accessToken, required this.refreshToken, required this.expiresIn});

  final String accessToken;
  final String refreshToken;

  /// Seconds the access token is good for, as the API reported it.
  final int expiresIn;

  factory TokenPair.fromJson(Map<String, dynamic> json) => TokenPair(
    accessToken: json['access_token'] as String,
    refreshToken: json['refresh_token'] as String,
    expiresIn: (json['expires_in'] as num?)?.toInt() ?? 900,
  );

  Map<String, dynamic> toJson() => {
    'access_token': accessToken,
    'refresh_token': refreshToken,
    'expires_in': expiresIn,
  };
}

/// Who is signed in, from `GET /me`.
///
/// Only the parts the app acts on are modelled. `permissions` is the one that matters: what a person
/// may do is decided by the server per request, and the UI mirrors it so a button is never offered
/// that the API would refuse.
class Me {
  const Me({
    required this.userId,
    required this.name,
    required this.phone,
    required this.role,
    required this.roleName,
    required this.companyName,
    required this.plan,
    this.planExpiresOn,
    this.planStanding = 'active',
    required this.permissions,
    required this.enabledModules,
    required this.seesAllProjects,
    required this.unreadNotifications,
  });

  final String userId;
  final String name;
  final String phone;

  /// The built-in role underneath, for the few places behaviour genuinely differs.
  final String role;

  /// What the role is called here — an owner may have renamed it or invented their own.
  final String roleName;
  final String companyName;
  final String plan;

  /// Null on a lifetime plan, which does not end.
  final String? planExpiresOn;

  /// `active`, `grace` or `expired`, decided by the API against the grace window it enforces —
  /// not recomputed here, so the two can never disagree about whether somebody may still work.
  final String planStanding;
  final List<String> permissions;
  final List<String> enabledModules;
  final bool seesAllProjects;
  final int unreadNotifications;

  /// `three_months` → `3 months`. A plan is a length of time now, and the raw value reads as a
  /// database column if it is ever shown as one.
  String get planLabel => switch (plan) {
    'three_months' => '3 months',
    'six_months' => '6 months',
    'one_year' => '1 year',
    'lifetime' => 'Lifetime',
    _ => plan,
  };

  /// Past the grace period: everything can be read, nothing can be saved.
  bool get planExpired => planStanding == 'expired';

  bool can(String permission) => permissions.contains(permission);
  bool hasModule(String module) => enabledModules.contains(module);

  factory Me.fromJson(Map<String, dynamic> json) {
    final user = json['user'] as Map<String, dynamic>? ?? const {};
    final tenant = json['tenant'] as Map<String, dynamic>? ?? const {};
    return Me(
      userId: user['id'] as String? ?? '',
      name: user['name'] as String? ?? '',
      phone: user['phone'] as String? ?? '',
      role: user['role'] as String? ?? '',
      roleName: json['role_name'] as String? ?? '',
      companyName: tenant['name'] as String? ?? '',
      plan: tenant['plan'] as String? ?? '',
      planExpiresOn: tenant['plan_expires_on'] as String?,
      planStanding: tenant['plan_standing'] as String? ?? 'active',
      permissions: (json['permissions'] as List<dynamic>? ?? const []).cast<String>(),
      enabledModules: (json['enabled_modules'] as List<dynamic>? ?? const []).cast<String>(),
      seesAllProjects: json['sees_all_projects'] as bool? ?? false,
      unreadNotifications: (json['unread_notifications'] as num?)?.toInt() ?? 0,
    );
  }
}

/// Tokens on disk.
///
/// The platform keystore, not shared preferences: a refresh token is a long-lived credential for
/// somebody's whole company, and a rooted phone or a device backup reads plain preferences straight
/// off the filesystem. `Me` is cached beside them so a cold start can draw the home screen before
/// the network answers — it is a copy of public facts about the signed-in user, never a source of
/// authority. What a person may do is whatever the server says on the next request.
class SessionStore {
  SessionStore({FlutterSecureStorage? storage})
    : _storage =
          storage ??
          const FlutterSecureStorage(
            // Android encrypts through the keystore by default in this version. iOS needs telling:
            // `firstUnlock` so a background refresh after a reboot can still read the token, but
            // nothing can read it while the phone has never been unlocked.
            iOptions: IOSOptions(accessibility: KeychainAccessibility.first_unlock),
          );

  final FlutterSecureStorage _storage;

  static const _tokensKey = 'buildr.tokens';
  static const _meKey = 'buildr.me';
  static const _deviceKey = 'buildr.device_id';

  Future<TokenPair?> readTokens() async {
    final raw = await _storage.read(key: _tokensKey);
    if (raw == null) return null;
    try {
      return TokenPair.fromJson(jsonDecode(raw) as Map<String, dynamic>);
    } catch (_) {
      // Unreadable is the same as absent: sign in again rather than crash on a stale shape.
      await clear();
      return null;
    }
  }

  Future<void> writeTokens(TokenPair tokens) =>
      _storage.write(key: _tokensKey, value: jsonEncode(tokens.toJson()));

  Future<Map<String, dynamic>?> readMe() async {
    final raw = await _storage.read(key: _meKey);
    if (raw == null) return null;
    try {
      return jsonDecode(raw) as Map<String, dynamic>;
    } catch (_) {
      return null;
    }
  }

  Future<void> writeMe(Map<String, dynamic> me) =>
      _storage.write(key: _meKey, value: jsonEncode(me));

  /// A stable id for this install, so the API can tell one phone's session from another's and
  /// revoke them individually. Not an identifier of the person — it is thrown away on sign-out.
  Future<String> deviceId() async {
    final existing = await _storage.read(key: _deviceKey);
    if (existing != null && existing.isNotEmpty) return existing;
    final generated = 'and-${DateTime.now().microsecondsSinceEpoch.toRadixString(36)}';
    await _storage.write(key: _deviceKey, value: generated);
    return generated;
  }

  Future<void> clear() async {
    await _storage.delete(key: _tokensKey);
    await _storage.delete(key: _meKey);
    await _storage.delete(key: _deviceKey);
  }
}
