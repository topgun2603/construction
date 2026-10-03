import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api_client.dart';
import '../../core/auth_controller.dart';
import '../../core/phone.dart';
import '../../core/google_auth.dart';
import '../../core/i18n.dart';
import '../../core/theme.dart';
import '../../shared/animated_logo.dart';

/// Signing in, for everybody.
///
/// There is one door: a mobile number and the code sent to it. An owner, an accounts clerk, a
/// supervisor and a client all arrive here and all get in the same way — what differs afterwards is
/// what the server says they may do, never how they prove who they are. Nothing on this screen asks
/// what kind of person is signing in, because nothing should.
class LoginScreen extends ConsumerStatefulWidget {
  const LoginScreen({super.key});

  @override
  ConsumerState<LoginScreen> createState() => _LoginScreenState();
}

enum _Step { phone, code }

/// How long "Resend code" stays out of reach.
///
/// An SMS that is merely slow is the common case, and a second one does not make the first arrive
/// any sooner — it burns the daily quota and, past a handful of attempts, Firebase blocks the
/// device outright. Thirty seconds is long enough for the message to land and short enough that
/// somebody standing on a site with one bar is not left with nothing to do.
const int _resendCooldownSeconds = 30;

class _LoginScreenState extends ConsumerState<LoginScreen> {
  final _phoneController = TextEditingController();
  final _codeController = TextEditingController();

  _Step _step = _Step.phone;
  String? _e164;
  String? _handle;
  String? _error;
  bool _busy = false;

  Timer? _cooldown;
  int _resendIn = 0;

  @override
  void dispose() {
    _cooldown?.cancel();
    _phoneController.dispose();
    _codeController.dispose();
    super.dispose();
  }

  void _startCooldown() {
    _cooldown?.cancel();
    setState(() => _resendIn = _resendCooldownSeconds);
    _cooldown = Timer.periodic(const Duration(seconds: 1), (timer) {
      if (!mounted) {
        timer.cancel();
        return;
      }
      setState(() {
        _resendIn -= 1;
        if (_resendIn <= 0) timer.cancel();
      });
    });
  }

  void _stopCooldown() {
    _cooldown?.cancel();
    _resendIn = 0;
  }

  Future<void> _run(Future<void> Function() action) async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await action();
    } on ApiException catch (error) {
      setState(() => _error = error.message);
    } catch (error) {
      setState(() => _error = _readable(error));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  /// Errors from the phone-auth layer arrive as plain exceptions. `Exception: ` in front of a
  /// sentence written for a person is noise.
  String _readable(Object error) {
    final text = error.toString();
    return text.replaceFirst(RegExp(r'^(Exception|StateError|Bad state): '), '');
  }

  Future<void> _submitPhone() => _run(() async {
    // The shared rule, ported rather than re-invented: this is the same normalisation the API
    // uses to look the person up, so the two must not drift.
    final e164 = toE164Indian(_phoneController.text);
    if (e164 == null) {
      throw StateError('Enter a 10-digit mobile number');
    }
    _e164 = e164;

    final auth = ref.read(phoneAuthProvider);
    if (!auth.sendsRealCode) {
      // Development build: no SMS to wait for.
      final token = await auth.devSignIn(e164);
      await ref.read(authControllerProvider.notifier).completeSignIn(token);
      return;
    }

    _handle = await auth.sendCode(e164);
    if (!mounted) return;
    setState(() => _step = _Step.code);
    _startCooldown();
  });

  /// Asks for a second message to the same number.
  ///
  /// The old code is abandoned rather than kept alive alongside the new one: two valid codes in the
  /// same inbox is how somebody ends up typing the first one, being told it is wrong, and not
  /// believing the app again.
  Future<void> _resend() => _run(() async {
    final auth = ref.read(phoneAuthProvider);
    _handle = await auth.sendCode(_e164!, resend: true);
    _codeController.clear();
    if (!mounted) return;
    _startCooldown();
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text(t('A new code is on its way'))),
    );
  });

  Future<void> _submitCode() => _run(() async {
    final code = _codeController.text.trim();
    if (code.length < 6) throw StateError('Enter the six digits from the message');
    final auth = ref.read(phoneAuthProvider);
    final token = await auth.confirm(_handle!, code);
    await ref.read(authControllerProvider.notifier).completeSignIn(token);
  });

  @override
  Widget build(BuildContext context) {
    final status = ref.watch(authControllerProvider).status;

    if (status == AuthStatus.needsOnboarding) return const _OnboardingNotice();

    return Scaffold(
      backgroundColor: Palette.surface,
      /*
       * `resizeToAvoidBottomInset: false`, with the sheet scrolling instead.
       *
       * Letting the keyboard resize the page squashes the hero into a letterbox the moment somebody
       * taps the number field, and the logo jumping as the keyboard opens is the first thing they
       * see the app do. The sheet scrolls under the keyboard instead and the header stays put.
       */
      resizeToAvoidBottomInset: false,
      body: Column(
        children: [
          const _HeroHeader(),
          Expanded(
            child: Container(
              width: double.infinity,
              decoration: const BoxDecoration(
                color: Palette.surface,
                borderRadius: BorderRadius.vertical(top: Radius.circular(26)),
              ),
              child: SingleChildScrollView(
                padding: EdgeInsets.fromLTRB(
                  24,
                  26,
                  24,
                  24 + MediaQuery.of(context).viewInsets.bottom,
                ),
                child: ConstrainedBox(
                  constraints: const BoxConstraints(maxWidth: 420),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      Text(
                        _step == _Step.phone ? t('Sign in') : t('Enter the code'),
                        style: const TextStyle(
                          fontSize: 26,
                          fontWeight: FontWeight.w800,
                          color: Palette.ink,
                        ),
                      ),
                      const SizedBox(height: 8),
                      Text(
                        _step == _Step.phone
                            ? t('Use the mobile number your company added you with.')
                            : '${t('Sent to')} ${formatIndianPhone(_e164 ?? '')}.',
                        style: const TextStyle(
                          fontSize: 15,
                          color: Palette.inkMuted,
                          height: 1.4,
                        ),
                      ),
                      const SizedBox(height: 24),
                      if (_step == _Step.phone) ..._phoneStep() else ..._codeStep(),
                      if (_error != null) ...[
                        const SizedBox(height: 16),
                        _ErrorBanner(message: _error!),
                      ],
                      const SizedBox(height: 16),
                    ],
                  ),
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }

  List<Widget> _phoneStep() => [
    TextField(
      controller: _phoneController,
      keyboardType: TextInputType.phone,
      autofillHints: const [AutofillHints.telephoneNumberNational],
      enabled: !_busy,
      maxLength: 14,
      inputFormatters: [FilteringTextInputFormatter.allow(RegExp(r'[0-9 +]'))],
      style: const TextStyle(fontSize: 20, letterSpacing: 1.2),
      decoration: const InputDecoration(
        /*
         * `prefixIcon`, carrying both the icon and the country code.
         *
         * `prefixText` is only painted once the field has focus or content, so on first paint the
         * field read "98765 43210" with no +91 anywhere — somebody typing their number has no way
         * to know whether the country code is wanted. A `prefixIcon` is always painted.
         */
        prefixIcon: _PhonePrefix(),
        hintText: '98765 43210',
        counterText: '',
      ),
      onSubmitted: (_) => _busy ? null : _submitPhone(),
    ),
    const SizedBox(height: 16),
    FilledButton(
      onPressed: _busy ? null : _submitPhone,
      child: _busy
          ? const _ButtonSpinner()
          : Text(ref.read(phoneAuthProvider).sendsRealCode ? t('Send code') : t('Sign in')),
    ),
    // Only when Firebase is configured. A button that cannot work is worse than no button: it is
    // the one somebody taps first, because it looks like the quick way in.
    if (GoogleAuth.configured) ...[
      const SizedBox(height: 14),
      Row(
        children: [
          const Expanded(child: Divider(color: Palette.line)),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 10),
            child: Text(
              t('or'),
              style: const TextStyle(fontSize: 12, color: Palette.inkFaint),
            ),
          ),
          const Expanded(child: Divider(color: Palette.line)),
        ],
      ),
      const SizedBox(height: 14),
      OutlinedButton.icon(
        onPressed: _busy ? null : _signInWithGoogle,
        icon: const _GoogleMark(),
        label: Text(
          t('Continue with Google'),
          style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w600, color: Palette.ink),
        ),
        style: OutlinedButton.styleFrom(
          minimumSize: const Size.fromHeight(52),
          side: const BorderSide(color: Palette.lineStrong),
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
        ),
      ),
    ],
  ];

  /// The same account somebody already uses on the web console, without waiting for an SMS on a
  /// site with one bar.
  Future<void> _signInWithGoogle() => _run(() async {
    final token = await const GoogleAuth().signIn();
    // Null means they closed the account chooser, which is a decision rather than a failure.
    if (token == null) return;
    await ref.read(authControllerProvider.notifier).completeSignIn(token);
  });

  List<Widget> _codeStep() => [
    TextField(
      controller: _codeController,
      keyboardType: TextInputType.number,
      autofillHints: const [AutofillHints.oneTimeCode],
      enabled: !_busy,
      maxLength: 6,
      textAlign: TextAlign.center,
      inputFormatters: [FilteringTextInputFormatter.digitsOnly],
      style: const TextStyle(fontSize: 30, letterSpacing: 10, fontWeight: FontWeight.w600),
      decoration: const InputDecoration(hintText: '······', counterText: ''),
      onChanged: (value) {
        // Six digits is the whole form; making somebody reach for a button after typing the
        // last one is a step for nothing.
        if (value.length == 6 && !_busy) _submitCode();
      },
    ),
    const SizedBox(height: 16),
    FilledButton(
      onPressed: _busy ? null : _submitCode,
      child: _busy ? const _ButtonSpinner() : Text(t('Sign in')),
    ),
    const SizedBox(height: 4),
    Row(
      mainAxisAlignment: MainAxisAlignment.spaceBetween,
      children: [
        // Counting down rather than simply greyed out: a button that does nothing and says nothing
        // about when it will is tapped again and again.
        TextButton(
          onPressed: (_busy || _resendIn > 0) ? null : _resend,
          child: Text(_resendIn > 0 ? 'Resend in ${_resendIn}s' : 'Resend code'),
        ),
        TextButton(
          onPressed: _busy
              ? null
              : () => setState(() {
                  _stopCooldown();
                  _step = _Step.phone;
                  _codeController.clear();
                  _error = null;
                }),
          child: Text(t('Change number')),
        ),
      ],
    ),
  ];
}

/// The site behind the wordmark.
///
/// A sign-in screen is the one place this app has to say what it is before anybody has used it, and
/// a building under a crane says it faster than the three words underneath. The image is the same
/// one the web app opens with, so somebody who has seen the console recognises this as the same
/// product rather than a second one.
class _HeroHeader extends StatelessWidget {
  const _HeroHeader();

  @override
  Widget build(BuildContext context) {
    // A share of the screen rather than a fixed height: 300px is half of a small phone and a third
    // of a tall one, and the sheet below has to keep room for a keyboard either way.
    final height = MediaQuery.of(context).size.height * 0.34;

    return SizedBox(
      height: height,
      width: double.infinity,
      child: Stack(
        fit: StackFit.expand,
        children: [
          Image.asset('images/hero_bg.png', fit: BoxFit.cover, alignment: Alignment.bottomCenter),
          /*
           * A white wash, not a dark one.
           *
           * The first attempt put a faint black gradient over the top, which did nothing: the
           * artwork is pale, the type is dark, and darkening a pale background only closes the gap.
           * The tagline sat across the concrete of the building and could not be read at all.
           * Washing the top towards white opens the gap instead, and keeps the illustration's
           * character where it matters — the crane and the skyline at the bottom.
           */
          const DecoratedBox(
            decoration: BoxDecoration(
              gradient: LinearGradient(
                begin: Alignment.topCenter,
                end: Alignment.bottomCenter,
                stops: [0.0, 0.62, 1.0],
                colors: [Color(0xF2FFFFFF), Color(0x66FFFFFF), Color(0x00FFFFFF)],
              ),
            ),
          ),
          SafeArea(
            child: Align(
              // Towards the top, where the wash is strongest. Centred put the tagline across the
              // concrete, which is the one part of the picture type cannot survive.
              alignment: const Alignment(0, -0.45),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  const AnimatedLogo(size: 54),
                  const SizedBox(height: 10),
                  const Text(
                    'BUILDR',
                    style: TextStyle(
                      fontSize: 30,
                      fontWeight: FontWeight.w800,
                      letterSpacing: 2,
                      color: Palette.ink,
                    ),
                  ),
                  const SizedBox(height: 6),
                  Text(
                    t('Sites. People. Materials.\nAll in one place.'),
                    textAlign: TextAlign.center,
                    style: const TextStyle(
                      fontSize: 13.5,
                      height: 1.4,
                      fontWeight: FontWeight.w500,
                      color: Palette.inkSoft,
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
}

/// The phone icon and `+91`, always visible.
///
/// Lives in `prefixIcon` because that is the only slot Flutter paints before the field has focus,
/// and a country code that appears only once you start typing is one you cannot plan around.
class _PhonePrefix extends StatelessWidget {
  const _PhonePrefix();

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        const SizedBox(width: 14),
        const Icon(Icons.phone_outlined, size: 19, color: Palette.accent),
        const SizedBox(width: 9),
        Text(
          '+91',
          style: const TextStyle(
            fontSize: 19,
            color: Palette.inkSoft,
            fontWeight: FontWeight.w500,
          ),
        ),
        const SizedBox(width: 10),
        Container(width: 1, height: 22, color: Palette.line),
        const SizedBox(width: 10),
      ],
    );
  }
}

/// Google's four-colour G, drawn rather than shipped.
///
/// Their brand guidelines require the real mark on a sign-in button — a grey account icon is both
/// wrong and less recognisable — and four arcs is less weight than another image asset for
/// something this small.
class _GoogleMark extends StatelessWidget {
  const _GoogleMark();

  static const size = 20.0;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: size,
      height: size,
      child: CustomPaint(painter: _GooglePainter()),
    );
  }
}

class _GooglePainter extends CustomPainter {
  static const _blue = Color(0xFF4285F4);
  static const _red = Color(0xFFEA4335);
  static const _yellow = Color(0xFFFBBC05);
  static const _green = Color(0xFF34A853);

  @override
  void paint(Canvas canvas, Size size) {
    final stroke = size.width * 0.26;
    final rect = Rect.fromLTWH(
      stroke / 2,
      stroke / 2,
      size.width - stroke,
      size.height - stroke,
    );
    final paint = Paint()
      ..style = PaintingStyle.stroke
      ..strokeWidth = stroke
      ..strokeCap = StrokeCap.butt;

    // Four quadrants, in Google's own order, starting from the right and going clockwise.
    canvas.drawArc(rect, -0.35, -1.25, false, paint..color = _red);
    canvas.drawArc(rect, -1.6, -1.55, false, paint..color = _yellow);
    canvas.drawArc(rect, -3.15, -1.5, false, paint..color = _green);
    canvas.drawArc(rect, 1.6, -1.95, false, paint..color = _blue);

    // The bar across the middle of the G.
    final barPaint = Paint()..color = _blue;
    canvas.drawRect(
      Rect.fromLTWH(size.width * 0.5, size.height * 0.37, size.width * 0.5, stroke),
      barPaint,
    );
  }

  @override
  bool shouldRepaint(covariant CustomPainter oldDelegate) => false;
}

class _Wordmark extends StatelessWidget {
  const _Wordmark();

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisAlignment: MainAxisAlignment.center,
      children: [
        const AnimatedLogo(size: 44),
        const SizedBox(width: 12),
        const Text(
          'BUILDR',
          style: TextStyle(
            fontSize: 22,
            fontWeight: FontWeight.w800,
            letterSpacing: 1.5,
            color: Palette.ink,
          ),
        ),
      ],
    );
  }
}

class _ErrorBanner extends StatelessWidget {
  const _ErrorBanner({required this.message});

  final String message;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
      decoration: BoxDecoration(color: Palette.blockedBg, borderRadius: BorderRadius.circular(10)),
      child: Text(
        message,
        style: const TextStyle(color: Palette.blocked, fontSize: 14, height: 1.35),
      ),
    );
  }
}

class _ButtonSpinner extends StatelessWidget {
  const _ButtonSpinner();

  @override
  Widget build(BuildContext context) => const SizedBox(
    height: 20,
    width: 20,
    child: CircularProgressIndicator(strokeWidth: 2.2, color: Colors.white),
  );
}

/// A verified number that belongs to no company.
///
/// Starting one means choosing a plan and paying for it, and that is a web flow — this screen says
/// so plainly instead of dead-ending somebody who has just proved they own the phone.
class _OnboardingNotice extends ConsumerWidget {
  const _OnboardingNotice();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return Scaffold(
      body: SafeArea(
        child: Center(
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 28),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                const _Wordmark(),
                const SizedBox(height: 32),
                Text(
                  t('This number is not on any company yet'),
                  textAlign: TextAlign.center,
                  style: TextStyle(fontSize: 21, fontWeight: FontWeight.w700, color: Palette.ink),
                ),
                const SizedBox(height: 12),
                const Text(
                  'If you are joining a company, ask them to add your number under Settings → Team, '
                  'then sign in again.\n\nIf you are setting up your own, that happens on the web — '
                  'there is a plan to choose.',
                  textAlign: TextAlign.center,
                  style: TextStyle(fontSize: 15, color: Palette.inkMuted, height: 1.5),
                ),
                const SizedBox(height: 28),
                OutlinedButton(
                  onPressed: () => ref.read(authControllerProvider.notifier).backToSignIn(),
                  child: Text(t('Try another number')),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
