import 'package:buildr_mobile/core/auth_controller.dart';
import 'package:buildr_mobile/core/phone_auth.dart';
import 'package:buildr_mobile/core/session.dart';
import 'package:buildr_mobile/core/theme.dart';
import 'package:buildr_mobile/features/auth/login_screen.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

/// A session store that never touches the keystore.
///
/// Every method that would reach a platform channel is overridden, so these tests run on the Dart VM
/// with no device and no plugin registration.
class _EmptyStore extends SessionStore {
  @override
  Future<TokenPair?> readTokens() async => null;

  @override
  Future<void> writeTokens(TokenPair tokens) async {}

  @override
  Future<Map<String, dynamic>?> readMe() async => null;

  @override
  Future<void> writeMe(Map<String, dynamic> me) async {}

  @override
  Future<String> deviceId() async => 'test-device';

  @override
  Future<void> clear() async {}
}

Widget _app({required PhoneAuth phoneAuth}) {
  return ProviderScope(
    overrides: [
      sessionStoreProvider.overrideWithValue(_EmptyStore()),
      phoneAuthProvider.overrideWithValue(phoneAuth),
    ],
    child: MaterialApp(theme: buildrTheme(), home: const LoginScreen()),
  );
}

void main() {
  testWidgets('asks for a number, not for who you are', (tester) async {
    await tester.pumpWidget(_app(phoneAuth: const DevPhoneAuth()));
    await tester.pumpAndSettle();

    expect(find.text('Sign in'), findsWidgets);
    expect(find.text('Use the mobile number your company added you with.'), findsOneWidget);

    // No role picker, anywhere. Everybody signs in the same way; what differs is what the server
    // then says they may do.
    expect(find.textContaining('Owner'), findsNothing);
    expect(find.textContaining('Supervisor'), findsNothing);
  });

  testWidgets('says out loud when the build cannot send an SMS', (tester) async {
    await tester.pumpWidget(_app(phoneAuth: const DevPhoneAuth()));
    await tester.pumpAndSettle();

    // A code box that will never receive anything would be worse than this notice.
    expect(find.text('Development build — no SMS'), findsOneWidget);
  });

  testWidgets('refuses a number that could never receive a code', (tester) async {
    await tester.pumpWidget(_app(phoneAuth: const DevPhoneAuth()));
    await tester.pumpAndSettle();

    await tester.enterText(find.byType(TextField), '12345');
    await tester.tap(find.widgetWithText(FilledButton, 'Sign in'));
    await tester.pumpAndSettle();

    expect(find.text('Enter a 10-digit mobile number'), findsOneWidget);
  });

  testWidgets('moves to the code step once a real code is sent', (tester) async {
    await tester.pumpWidget(_app(phoneAuth: _StubSmsAuth()));
    await tester.pumpAndSettle();

    await tester.enterText(find.byType(TextField), '9876543210');
    await tester.tap(find.widgetWithText(FilledButton, 'Send code'));
    await tester.pump();

    expect(find.text('Enter the code'), findsOneWidget);
    // Shown back the way it is read aloud, so a mistyped digit is obvious before waiting for an SMS.
    expect(find.text('Sent to +91 98765 43210.'), findsOneWidget);

    // Let the resend cooldown run out, or it is still ticking when the test ends.
    await tester.pump(const Duration(seconds: 31));
  });

  testWidgets('holds the resend back, then offers it', (tester) async {
    final auth = _StubSmsAuth();
    await tester.pumpWidget(_app(phoneAuth: auth));
    await tester.pumpAndSettle();

    await tester.enterText(find.byType(TextField), '9876543210');
    await tester.tap(find.widgetWithText(FilledButton, 'Send code'));
    await tester.pump();

    // A second SMS the instant the first was sent is quota spent for nothing, so the button says
    // when it will be worth tapping rather than sitting there greyed out and silent.
    expect(find.text('Resend in 30s'), findsOneWidget);
    expect(tester.widget<TextButton>(find.widgetWithText(TextButton, 'Resend in 30s')).onPressed,
        isNull);

    await tester.pump(const Duration(seconds: 10));
    expect(find.text('Resend in 20s'), findsOneWidget);

    await tester.pump(const Duration(seconds: 21));
    expect(find.text('Resend code'), findsOneWidget);

    await tester.tap(find.widgetWithText(TextButton, 'Resend code'));
    await tester.pump();

    // Firebase is told this is a resend; without that flag Android answers from its cache and no
    // second message is ever sent.
    expect(auth.sends, [(phone: '919876543210', resend: false), (phone: '919876543210', resend: true)]);
    expect(find.text('Resend in 30s'), findsOneWidget);

    await tester.pump(const Duration(seconds: 31));
  });

  testWidgets('a changed number leaves no timer running', (tester) async {
    await tester.pumpWidget(_app(phoneAuth: _StubSmsAuth()));
    await tester.pumpAndSettle();

    await tester.enterText(find.byType(TextField), '9876543210');
    await tester.tap(find.widgetWithText(FilledButton, 'Send code'));
    await tester.pump();

    await tester.tap(find.widgetWithText(TextButton, 'Change number'));
    await tester.pump();

    expect(find.text('Sign in'), findsWidgets);
    // Nothing pumped past here: a cooldown left ticking would fail this test, which is the point.
  });
}

/// Pretends to send an SMS, so the code step can be reached without Firebase.
class _StubSmsAuth implements PhoneAuth {
  final List<({String phone, bool resend})> sends = [];

  @override
  bool get sendsRealCode => true;

  @override
  Future<String> sendCode(String e164, {bool resend = false}) async {
    sends.add((phone: e164, resend: resend));
    return 'verification-id';
  }

  @override
  Future<String> confirm(String handle, String smsCode) async => 'token';

  @override
  Future<String> devSignIn(String e164) async => throw UnsupportedError('not in this build');
}
