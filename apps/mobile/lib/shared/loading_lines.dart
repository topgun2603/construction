import 'dart:async';
import 'dart:math';

import 'package:flutter/material.dart';

import '../core/theme.dart';

/// What the app says while somebody waits.
///
/// Site sense rather than fortune cookies, and about the work rather than about waiting — a person
/// looking at this is already waiting, and being told so is not company. The same lines the web app
/// shows, so the two products sound like one.
const List<String> loadingLines = [
  'Measure twice. Pour once.',
  'A slab is only as good as its shuttering.',
  'The best site diary is the one written today.',
  'Count the heads before you count the bags.',
  'Rain stops the pour, not the records.',
  'Steel is bought by weight and lost by inches.',
  'The gate register is the first line of the ledger.',
  'A wage frozen the day it was earned never has to be argued about.',
  'Cement sets whether or not the paperwork does.',
  'Every rupee on this site has a name.',
];

/// One line, swapped every few seconds, faded rather than cut.
///
/// It starts invisible and fades in after [delay]. A boot that takes one frame — which most do,
/// because the keystore read is fast — shows nothing at all, and the line is reserved for the wait
/// that is actually long enough to read something.
class LoadingLine extends StatefulWidget {
  const LoadingLine({
    super.key,
    this.delay = const Duration(milliseconds: 600),
    this.interval = const Duration(seconds: 5),
  });

  final Duration delay;
  final Duration interval;

  @override
  State<LoadingLine> createState() => _LoadingLineState();
}

class _LoadingLineState extends State<LoadingLine> {
  // A random start, so somebody who waits twice does not read the same line twice.
  int _index = Random().nextInt(loadingLines.length);
  bool _visible = false;
  Timer? _rotation;
  Timer? _reveal;

  @override
  void initState() {
    super.initState();
    _reveal = Timer(widget.delay, () {
      if (mounted) setState(() => _visible = true);
    });
    _rotation = Timer.periodic(widget.interval, (_) {
      if (mounted) setState(() => _index = (_index + 1) % loadingLines.length);
    });
  }

  @override
  void dispose() {
    _reveal?.cancel();
    _rotation?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => AnimatedOpacity(
    opacity: _visible ? 1 : 0,
    duration: const Duration(milliseconds: 300),
    child: SizedBox(
      // Fixed height so a two-line quote does not shift the mark above it when it swaps.
      height: 44,
      child: AnimatedSwitcher(
        duration: const Duration(milliseconds: 350),
        child: Padding(
          key: ValueKey(_index),
          padding: const EdgeInsets.symmetric(horizontal: 32),
          child: Text(
            loadingLines[_index],
            textAlign: TextAlign.center,
            style: const TextStyle(fontSize: 13.5, height: 1.4, color: Palette.inkMuted),
          ),
        ),
      ),
    ),
  );
}
