import 'package:firebase_core/firebase_core.dart';
import 'package:flutter/material.dart';
import 'package:flutter_native_splash/flutter_native_splash.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'core/auth_controller.dart';
import 'core/theme.dart';
import 'features/auth/login_screen.dart';
import 'features/onboarding/onboarding_screen.dart';
import 'features/shell/app_shell.dart';
import 'shared/animated_logo.dart';

Future<void> main() async {
  final binding = WidgetsFlutterBinding.ensureInitialized();

  // Holds the native splash past the first frame, so there is no white flash between the system
  // splash and the app working out whether this person is already signed in.
  FlutterNativeSplash.preserve(widgetsBinding: binding);

  /*
   * Firebase is optional at startup on purpose.
   *
   * It needs `google-services.json` (Android) or `GoogleService-Info.plist` (iOS) from the Firebase
   * console, and a checkout that has not been given them yet must still run — the app falls back to
   * the development sign-in, which only works against an API that has also been put in development
   * mode. Crashing on a missing config file would make the app unbuildable for anyone who has not
   * been handed credentials.
   */
  try {
    await Firebase.initializeApp();
  } catch (_) {
    // No Firebase: the login screen says so and offers the development path.
  }

  final onboarded = await OnboardingFlag.seen();

  runApp(ProviderScope(child: BuildrApp(onboarded: onboarded)));
}

class BuildrApp extends ConsumerStatefulWidget {
  const BuildrApp({super.key, required this.onboarded});

  final bool onboarded;

  @override
  ConsumerState<BuildrApp> createState() => _BuildrAppState();
}

class _BuildrAppState extends ConsumerState<BuildrApp> {
  late bool _onboarded = widget.onboarded;

  @override
  Widget build(BuildContext context) {
    final auth = ref.watch(authControllerProvider);

    // The splash comes down once the app knows what to draw underneath it, not on a timer.
    if (auth.status != AuthStatus.restoring) {
      WidgetsBinding.instance.addPostFrameCallback((_) => FlutterNativeSplash.remove());
    }

    return MaterialApp(
      title: 'BUILDR',
      debugShowCheckedModeBanner: false,
      theme: buildrTheme(),
      home: switch (auth.status) {
        // Reading the keystore. One frame usually, but on a cold start with a locked keychain it can
        // be longer — the native splash is still covering this.
        AuthStatus.restoring => const _Splash(),
        AuthStatus.signedIn => const AppShell(),
        // The slides come before the sign-in form and only on a first launch: somebody who signed
        // out and back in has already read them.
        _ =>
          _onboarded
              ? const LoginScreen()
              : OnboardingScreen(onDone: () => setState(() => _onboarded = true)),
      },
    );
  }
}

class _Splash extends StatelessWidget {
  const _Splash();

  @override
  Widget build(BuildContext context) => const Scaffold(
    backgroundColor: Palette.surface,
    body: Center(
      /*
       * The same mark the native splash just showed, at the same size, so the handover from the
       * system splash to Flutter is a continuation rather than a flash of something else. It
       * breathes instead of spinning: this wait is reading a keystore and asking `/me`, which is
       * usually one frame and occasionally several seconds, and a spinner promises a progress it
       * cannot report.
       */
      child: AnimatedLogo(size: 96, breathing: true),
    ),
  );
}
