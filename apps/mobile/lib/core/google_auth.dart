import 'package:firebase_auth/firebase_auth.dart';
import 'package:firebase_core/firebase_core.dart';
import 'package:google_sign_in/google_sign_in.dart';

/// Signing in with the Google account the office already uses.
///
/// The same shape as the phone path and for the same reason: Google is an identity vendor and
/// nothing more. What comes back is a Firebase ID token, which is exchanged at
/// `POST /auth/exchange` for a BUILDR session and then never used again — so the API has one way in
/// whether somebody proved a phone number or an email address.
///
/// This exists because half the people who use the web console on a laptop are already signed into
/// Google there, and being made to wait for an SMS on a site with one bar to open the same account
/// on a phone is a worse experience than the one they already have.
class GoogleAuth {
  const GoogleAuth();

  /// Whether this build can do it at all: Firebase needs `google-services.json`, and without one
  /// the button is hidden rather than offered and then failing.
  static bool get configured => Firebase.apps.isNotEmpty;

  /// Returns a token the API will accept, or null if the person backed out.
  ///
  /// Backing out is not an error. Somebody who opens the account chooser and changes their mind has
  /// not failed at anything, and a red box telling them so is the app being rude.
  Future<String?> signIn() async {
    if (!configured) {
      // A development build with no Firebase. The web app's dev branch asks for an address and
      // sends `dev:<address>`; there is no equivalent worth building on a phone, so the button is
      // simply not shown and this is the belt to that braces.
      throw StateError('Google sign-in is not configured in this build');
    }

    final google = GoogleSignIn.instance;
    await google.initialize();

    final GoogleSignInAccount account;
    try {
      account = await google.authenticate();
    } on GoogleSignInException catch (error) {
      if (error.code == GoogleSignInExceptionCode.canceled) return null;
      rethrow;
    }

    final authentication = account.authentication;
    final idToken = authentication.idToken;
    if (idToken == null) {
      throw StateError('Google did not return an identity for that account');
    }

    final credential = GoogleAuthProvider.credential(idToken: idToken);
    final result = await FirebaseAuth.instance.signInWithCredential(credential);

    final token = await result.user?.getIdToken();
    if (token == null) throw StateError('Could not complete that sign-in');
    return token;
  }
}
