import 'dart:async';

import 'package:firebase_auth/firebase_auth.dart';
import 'package:firebase_core/firebase_core.dart';

import 'env.dart';

/// Proving somebody controls a phone number.
///
/// Firebase is the OTP vendor and nothing more: the token it returns is exchanged at
/// `POST /auth/exchange` for a BUILDR session and then never used again. Keeping that behind this
/// interface means the day Firebase is swapped for a local SMS gateway, only this file changes.
abstract class PhoneAuth {
  /// Whether this build can send a real OTP at all.
  bool get sendsRealCode;

  /// Starts verification. Returns a handle to give back to [confirm].
  ///
  /// [resend] asks the vendor for a *second* message to the same number. It is a separate flag
  /// rather than just calling this again because Android will otherwise answer a repeat request
  /// from its cache — the person taps "Resend" and no new SMS is ever sent.
  Future<String> sendCode(String e164, {bool resend = false});

  /// Turns the six digits into a token the API will accept.
  Future<String> confirm(String handle, String smsCode);

  /// Signs in with no code — only ever available when both halves are in development mode.
  Future<String> devSignIn(String e164);
}

/// Real OTP over Firebase phone auth.
class FirebasePhoneAuth implements PhoneAuth {
  FirebasePhoneAuth(this._auth);

  final FirebaseAuth _auth;

  /// True when a Firebase app was initialised — which needs `google-services.json` on Android and
  /// `GoogleService-Info.plist` on iOS. Without them this build cannot send an SMS, and the app
  /// says so rather than showing a code box that will never receive anything.
  static bool get configured => Firebase.apps.isNotEmpty;

  @override
  bool get sendsRealCode => true;

  /// Handed to us by `codeSent` and given back on a resend. Null until the first code is sent.
  int? _resendToken;

  @override
  Future<String> sendCode(String e164, {bool resend = false}) {
    final completer = Completer<String>();
    _auth.verifyPhoneNumber(
      phoneNumber: '+$e164',
      timeout: const Duration(seconds: 60),
      forceResendingToken: resend ? _resendToken : null,
      verificationCompleted: (_) {
        // Android can verify some numbers without the user typing anything. The code path below
        // still works, so this is left alone deliberately rather than racing the completer.
      },
      verificationFailed: (FirebaseAuthException error) {
        if (completer.isCompleted) return;
        completer.completeError(StateError(_readable(error)));
      },
      codeSent: (String verificationId, int? resendToken) {
        _resendToken = resendToken;
        if (!completer.isCompleted) completer.complete(verificationId);
      },
      codeAutoRetrievalTimeout: (String verificationId) {
        if (!completer.isCompleted) completer.complete(verificationId);
      },
    );
    return completer.future;
  }

  @override
  Future<String> confirm(String handle, String smsCode) async {
    final credential = PhoneAuthProvider.credential(verificationId: handle, smsCode: smsCode);
    final result = await _auth.signInWithCredential(credential);
    final token = await result.user?.getIdToken();
    if (token == null || token.isEmpty) {
      throw StateError('That code was accepted but produced no token. Try again.');
    }
    return token;
  }

  @override
  Future<String> devSignIn(String e164) => throw UnsupportedError('This build sends a real code');

  String _readable(FirebaseAuthException error) {
    switch (error.code) {
      case 'invalid-phone-number':
        return 'That is not a number this can send a code to.';
      case 'too-many-requests':
        return 'Too many attempts from this device. Wait a few minutes.';
      case 'session-expired':
        return 'That code has expired. Ask for a new one.';
      case 'quota-exceeded':
        return 'The SMS quota for today is used up.';
      case 'missing-client-identifier':
      case 'app-not-authorized':
        return 'This build is not registered with Firebase — see apps/mobile/README.md.';
      default:
        return error.message ?? 'Could not send the code (${error.code})';
    }
  }
}

/// No SMS: hands the API `dev:<phone>`, which it accepts only when it is itself running with
/// `DEV_AUTH_BYPASS=true`. Both halves must agree, so pointing this build at a production API simply
/// fails to sign in — it cannot weaken one.
class DevPhoneAuth implements PhoneAuth {
  const DevPhoneAuth();

  @override
  bool get sendsRealCode => false;

  @override
  Future<String> sendCode(String e164, {bool resend = false}) async => e164;

  @override
  Future<String> confirm(String handle, String smsCode) async => 'dev:$handle';

  @override
  Future<String> devSignIn(String e164) async => 'dev:$e164';
}

/// Whichever of the two this build can actually use.
///
/// Development mode is not chosen by the app on a whim: it needs `--dart-define=DEV_AUTH_BYPASS=true`
/// or a Firebase that never initialised. A release build with Firebase configured always sends a
/// real code.
PhoneAuth resolvePhoneAuth() {
  if (Env.devAuthBypass || !FirebasePhoneAuth.configured) return const DevPhoneAuth();
  return FirebasePhoneAuth(FirebaseAuth.instance);
}
