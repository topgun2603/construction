import 'package:flutter/material.dart';

/// The mark, with a little life in it.
///
/// Two behaviours in one widget. It always makes an entrance — a short rise and fade as the app
/// takes over from the system splash, so the handover does not look like a jump cut. With
/// [breathing] on it then keeps a slow, shallow pulse, which is the honest way to say "still
/// working" while the keystore is read and `/me` comes back: a spinner promises a determinate wait
/// that this is not.
///
/// The movement is deliberately small. A logo that bounces is a logo somebody sees twice and then
/// starts waiting through.
class AnimatedLogo extends StatefulWidget {
  const AnimatedLogo({super.key, this.size = 44, this.breathing = false});

  final double size;
  final bool breathing;

  @override
  State<AnimatedLogo> createState() => _AnimatedLogoState();
}

class _AnimatedLogoState extends State<AnimatedLogo> with TickerProviderStateMixin {
  late final AnimationController _entrance = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 520),
  )..forward();

  late final AnimationController _breath = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 1600),
  );

  late final Animation<double> _scale = CurvedAnimation(
    parent: _entrance,
    // Settles just past its final size and back, which reads as arriving rather than appearing.
    curve: Curves.easeOutBack,
  );

  late final Animation<double> _fade = CurvedAnimation(
    parent: _entrance,
    curve: const Interval(0, 0.6, curve: Curves.easeOut),
  );

  @override
  void initState() {
    super.initState();
    if (widget.breathing) _startBreathing();
  }

  @override
  void didUpdateWidget(AnimatedLogo old) {
    super.didUpdateWidget(old);
    if (widget.breathing && !old.breathing) {
      _startBreathing();
    } else if (!widget.breathing && old.breathing) {
      _breath.stop();
      _breath.value = 0;
    }
  }

  void _startBreathing() {
    // Waits for the entrance to finish so the two do not fight over the same scale.
    _entrance.forward().whenComplete(() {
      if (mounted && widget.breathing) _breath.repeat(reverse: true);
    });
  }

  @override
  void dispose() {
    _entrance.dispose();
    _breath.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: Listenable.merge([_entrance, _breath]),
      builder: (context, child) {
        // 0.88 → 1.0 arriving, then ±2% while it waits. Anything larger looks like a heartbeat.
        final entering = 0.88 + 0.12 * _scale.value;
        final breath = 1 + 0.02 * Curves.easeInOut.transform(_breath.value);
        return Opacity(
          opacity: _fade.value,
          child: Transform.scale(scale: entering * breath, child: child),
        );
      },
      child: Image.asset(
        'assets/logo.png',
        width: widget.size,
        height: widget.size,
        // Cached at the size it is drawn: the source is 1024px square and decoding all of it for a
        // 44px mark is memory nobody sees.
        cacheWidth: (widget.size * MediaQuery.devicePixelRatioOf(context)).round(),
      ),
    );
  }
}
