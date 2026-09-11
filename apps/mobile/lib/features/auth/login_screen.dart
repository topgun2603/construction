import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api_client.dart';
import '../../core/auth_controller.dart';
import '../../core/env.dart';
import '../../core/phone.dart';
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
      const SnackBar(content: Text('A new code is on its way')),
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
    final auth = ref.watch(phoneAuthProvider);
    final status = ref.watch(authControllerProvider).status;

    if (status == AuthStatus.needsOnboarding) return const _OnboardingNotice();

    return Scaffold(
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 32),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 420),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  const _Wordmark(),
                  const SizedBox(height: 36),
                  Text(
                    _step == _Step.phone ? 'Sign in' : 'Enter the code',
                    style: const TextStyle(
                      fontSize: 26,
                      fontWeight: FontWeight.w700,
                      color: Palette.ink,
                    ),
                  ),
                  const SizedBox(height: 8),
                  Text(
                    _step == _Step.phone
                        ? 'Use the mobile number your company added you with.'
                        : 'Sent to ${formatIndianPhone(_e164 ?? '')}.',
                    style: const TextStyle(fontSize: 15, color: Palette.inkMuted, height: 1.4),
                  ),
                  const SizedBox(height: 28),
                  if (_step == _Step.phone) ..._phoneStep() else ..._codeStep(),
                  if (_error != null) ...[
                    const SizedBox(height: 16),
                    _ErrorBanner(message: _error!),
                  ],
                  const SizedBox(height: 24),
                  if (!auth.sendsRealCode) const _DevModeNote(),
                ],
              ),
            ),
          ),
        ),
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
        prefixText: '+91  ',
        prefixStyle: TextStyle(fontSize: 20, color: Palette.inkMuted),
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
          : Text(ref.read(phoneAuthProvider).sendsRealCode ? 'Send code' : 'Sign in'),
    ),
  ];

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
      child: _busy ? const _ButtonSpinner() : const Text('Sign in'),
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
          child: const Text('Change number'),
        ),
      ],
    ),
  ];
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

/// Says out loud that this build cannot send an SMS. A code box that will never receive anything is
/// worse than an honest note.
class _DevModeNote extends StatelessWidget {
  const _DevModeNote();

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(color: Palette.pendingBg, borderRadius: BorderRadius.circular(10)),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text(
            'Development build — no SMS',
            style: TextStyle(fontWeight: FontWeight.w600, color: Palette.pending, fontSize: 13.5),
          ),
          const SizedBox(height: 4),
          Text(
            'Signs in without a code, and only works against an API running with '
            'DEV_AUTH_BYPASS=true. Talking to ${Env.apiUrl}.',
            style: const TextStyle(color: Palette.pending, fontSize: 12.5, height: 1.4),
          ),
        ],
      ),
    );
  }
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
                const Text(
                  'This number is not on any company yet',
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
                  child: const Text('Try another number'),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
