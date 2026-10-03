import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../../core/theme.dart';
import '../../core/i18n.dart';

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
  const _Slide({required this.image, required this.title, required this.body});

  final String image;
  final String title;
  final String body;
}

/// Four slides, shown once.
///
/// They say what the app is for, not how to use it: the people opening this are not reading a
/// manual, they are standing at a gate wondering whether this is the thing their boss told them to
/// install. Every claim here is something the app actually does today — an onboarding that promises
/// features which are not built is how a product loses somebody in the first minute.
///
/// The illustrations carry most of the weight, because the first thing somebody decides is whether
/// this app is *for them*: three men in hi-vis around a tablet says that faster than any sentence.
/// The file names do not match the slide order — they were drawn before the order was settled — so
/// the mapping is spelled out here rather than left to be inferred from a number.
const _slides = <_Slide>[
  _Slide(
    image: 'images/onbaoard_3.png', // the roll call card
    title: 'Mark the roll call in a minute',
    body:
        'Your crew, grouped by contractor, three big buttons each. The whole day is saved in one '
        'go, so half a roll call can never get stuck on a bad signal.',
  ),
  _Slide(
    image: 'images/onbaoard_4.png', // the day's report, with photographs
    title: 'File the day before you leave',
    body:
        'What got done, who was on site, what is in the way — and photographs of it. The office '
        'sees it the moment you send it.',
  ),
  _Slide(
    image: 'images/onbaoard_2.png', // a material request, approved or rejected
    title: 'Ask for material, get an answer',
    body:
        'Raise an indent from the site. Whoever approves purchases sees it on their phone and '
        'says yes or no, with a reason.',
  ),
  _Slide(
    image: 'images/onbaoard_1.png', // sites, tasks, access and role behind a lock
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
                child: TextButton(
                  onPressed: _finish,
                  child: Text(
                    t('Skip'),
                    style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w600),
                  ),
                ),
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
                child: Row(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    Text(
                      last ? t('Get Started') : t('Next'),
                      style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w600),
                    ),
                    const SizedBox(width: 8),
                    const Icon(Icons.arrow_forward_rounded, size: 19),
                  ],
                ),
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
      padding: const EdgeInsets.symmetric(horizontal: 28),
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Expanded(
            child: Center(
              /*
               * `contain`, not `cover`.
               *
               * These are illustrations with a soft edge and no safe crop: cropping one to fill a
               * box cuts a hard-hat off at the brow on a short phone, which reads as a mistake
               * rather than as a composition. Letting it letterbox costs nothing — the background
               * behind it is the same white.
               */
              child: Image.asset(slide.image, fit: BoxFit.contain),
            ),
          ),
          const SizedBox(height: 28),
          Text(
            t(slide.title),
            textAlign: TextAlign.center,
            style: const TextStyle(
              fontSize: 25,
              fontWeight: FontWeight.w800,
              height: 1.25,
              color: Palette.ink,
            ),
          ),
          const SizedBox(height: 14),
          Text(
            t(slide.body),
            textAlign: TextAlign.center,
            style: const TextStyle(fontSize: 15, color: Palette.inkMuted, height: 1.55),
          ),
          const SizedBox(height: 18),
        ],
      ),
    );
  }
}
