import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../../core/theme.dart';

/// Whether the slides have been seen on this install.
///
/// Plain preferences, not the keystore: it is a UI flag, not a credential, and putting it beside the
/// tokens would mean signing out wiped it and everybody saw the slides again.
class OnboardingFlag {
  const OnboardingFlag._();

  static const _key = 'buildr.onboarding.seen.v1';

  static Future<bool> seen() async {
    final prefs = await SharedPreferences.getInstance();
    return prefs.getBool(_key) ?? false;
  }

  static Future<void> markSeen() async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setBool(_key, true);
  }
}

class _Slide {
  const _Slide({required this.icon, required this.title, required this.body});

  final IconData icon;
  final String title;
  final String body;
}

/// Four slides, shown once.
///
/// They say what the app is for, not how to use it: the people opening this are not reading a
/// manual, they are standing at a gate wondering whether this is the thing their boss told them to
/// install. Every claim here is something the app actually does today — an onboarding that promises
/// features which are not built is how a product loses somebody in the first minute.
const _slides = <_Slide>[
  _Slide(
    icon: Icons.how_to_reg_outlined,
    title: 'Mark the roll call in a minute',
    body:
        'Your crew, grouped by contractor, three big buttons each. The whole day is saved in one '
        'go, so half a roll call can never get stuck on a bad signal.',
  ),
  _Slide(
    icon: Icons.assignment_outlined,
    title: 'File the day before you leave',
    body:
        'What got done, who was on site, what is in the way — and photographs of it. The office '
        'sees it the moment you send it.',
  ),
  _Slide(
    icon: Icons.local_shipping_outlined,
    title: 'Ask for material, get an answer',
    body:
        'Raise an indent from the site. Whoever approves purchases sees it on their phone and '
        'says yes or no, with a reason.',
  ),
  _Slide(
    icon: Icons.lock_outline,
    title: 'You see your sites, nothing else',
    body:
        'What you can open is decided by the role your company gave you. Wages, budgets and other '
        'people’s sites simply are not there.',
  ),
];

class OnboardingScreen extends StatefulWidget {
  const OnboardingScreen({super.key, required this.onDone});

  final VoidCallback onDone;

  @override
  State<OnboardingScreen> createState() => _OnboardingScreenState();
}

class _OnboardingScreenState extends State<OnboardingScreen> {
  final _controller = PageController();
  int _index = 0;

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  Future<void> _finish() async {
    await OnboardingFlag.markSeen();
    widget.onDone();
  }

  @override
  Widget build(BuildContext context) {
    final last = _index == _slides.length - 1;

    return Scaffold(
      backgroundColor: Palette.surface,
      body: SafeArea(
        child: Column(
          children: [
            Align(
              alignment: Alignment.centerRight,
              child: Padding(
                padding: const EdgeInsets.only(right: 8, top: 4),
                child: TextButton(onPressed: _finish, child: const Text('Skip')),
              ),
            ),
            Expanded(
              child: PageView.builder(
                controller: _controller,
                itemCount: _slides.length,
                onPageChanged: (index) => setState(() => _index = index),
                itemBuilder: (context, index) => _SlideView(slide: _slides[index]),
              ),
            ),
            Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                for (var i = 0; i < _slides.length; i++)
                  AnimatedContainer(
                    duration: const Duration(milliseconds: 220),
                    margin: const EdgeInsets.symmetric(horizontal: 3),
                    width: i == _index ? 22 : 7,
                    height: 7,
                    decoration: BoxDecoration(
                      color: i == _index ? Palette.accent : Palette.lineStrong,
                      borderRadius: BorderRadius.circular(999),
                    ),
                  ),
              ],
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(24, 22, 24, 20),
              child: FilledButton(
                onPressed: last
                    ? _finish
                    : () => _controller.nextPage(
                        duration: const Duration(milliseconds: 260),
                        curve: Curves.easeOut,
                      ),
                child: Text(last ? 'Sign in' : 'Next'),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _SlideView extends StatelessWidget {
  const _SlideView({required this.slide});

  final _Slide slide;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 32),
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Container(
            width: 108,
            height: 108,
            decoration: const BoxDecoration(color: Palette.accentSoft, shape: BoxShape.circle),
            child: Icon(slide.icon, size: 48, color: Palette.accent),
          ),
          const SizedBox(height: 36),
          Text(
            slide.title,
            textAlign: TextAlign.center,
            style: const TextStyle(fontSize: 24, fontWeight: FontWeight.w700, height: 1.25),
          ),
          const SizedBox(height: 14),
          Text(
            slide.body,
            textAlign: TextAlign.center,
            style: const TextStyle(fontSize: 15.5, color: Palette.inkMuted, height: 1.55),
          ),
        ],
      ),
    );
  }
}
