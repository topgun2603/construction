import 'dart:async';

import 'package:flutter/material.dart';

import '../core/ai_api.dart';
import '../core/api_client.dart';
import '../core/i18n.dart';
import '../core/theme.dart';

/// A text field that types in one language and files in another.
///
/// The project manager in the office types English. The supervisor who has to act on the
/// instruction, and the client's family reading the progress note, read Tamil. Today that gap is
/// closed by somebody pasting into another app, or — far more often — not closed at all: the note
/// goes out in English and the person it was written for does not read it.
///
/// **One tap, not zero.** The translation is never swapped in by itself, and that is not timidity:
/// "pour the slab tomorrow" rendered slightly wrong is an instruction going to a site, and the
/// person sending it is the only one who can tell. Showing it and waiting is the difference between
/// a tool and a liability.
class BilingualField extends StatefulWidget {
  const BilingualField({
    super.key,
    required this.api,
    required this.controller,
    this.maxLines = 4,
    this.hintText,
    this.into,
  });

  final ApiClient api;
  final TextEditingController controller;
  final int maxLines;
  final String? hintText;

  /// What to translate into. Defaults to the opposite of whatever the interface is set to, so a
  /// Tamil interface still produces English notes for the office.
  final String? into;

  @override
  State<BilingualField> createState() => _BilingualFieldState();
}

class _BilingualFieldState extends State<BilingualField> {
  Timer? _debounce;
  String? _draft;
  bool _working = false;

  /// What the current draft is a translation *of*, so an answer that arrives after the next
  /// keystroke is discarded rather than shown against text it does not match.
  String _asked = '';

  String get _target => widget.into ?? (appLanguage == 'en' ? 'ta' : 'en');

  @override
  void initState() {
    super.initState();
    widget.controller.addListener(_onChanged);
  }

  @override
  void dispose() {
    _debounce?.cancel();
    widget.controller.removeListener(_onChanged);
    super.dispose();
  }

  void _onChanged() {
    _debounce?.cancel();
    final text = widget.controller.text.trim();

    // Under a dozen characters it is a word, and a word has no context to translate from. Asking on
    // every keystroke of "sl" would be noise with a price.
    if (text.length < 12 || _alreadyInTarget(text)) {
      if (_draft != null) setState(() => _draft = null);
      return;
    }

    // 900ms after the last keystroke: long enough that a sentence is one call rather than thirty,
    // short enough that it appears while somebody is still looking at the field.
    _debounce = Timer(const Duration(milliseconds: 900), () => unawaited(_translate(text)));
  }

  Future<void> _translate(String text) async {
    setState(() {
      _asked = text;
      _working = true;
    });
    try {
      final translated = await AiApi(widget.api).translate(text, to: _target);
      if (!mounted || _asked != text) return;
      setState(() {
        // A vendor that hands back what it was given has said the text was already in the target
        // language; offering that as a translation would be absurd.
        _draft = translated.trim() == text ? null : translated;
      });
    } catch (_) {
      if (mounted) setState(() => _draft = null);
    } finally {
      if (mounted) setState(() => _working = false);
    }
  }

  /// By script, which for these languages is exact and free — each occupies its own Unicode block,
  /// so one character settles it. Asking a vendor to translate Tamil into Tamil on every pause
  /// would be a charge for nothing.
  bool _alreadyInTarget(String text) {
    final ranges = <String, ({int start, int end})>{
      'ta': (start: 0x0B80, end: 0x0BFF),
      'te': (start: 0x0C00, end: 0x0C7F),
      'kn': (start: 0x0C80, end: 0x0CFF),
      'ml': (start: 0x0D00, end: 0x0D7F),
      'hi': (start: 0x0900, end: 0x097F),
    };
    final range = ranges[_target];
    if (range == null) return false;
    return text.runes.any((rune) => rune >= range.start && rune <= range.end);
  }

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        TextField(
          controller: widget.controller,
          maxLines: widget.maxLines,
          textCapitalization: TextCapitalization.sentences,
          decoration: InputDecoration(hintText: widget.hintText),
        ),
        if (_working)
          Padding(
            padding: const EdgeInsets.only(top: 8),
            child: Text(
              '${t('Translating')}…',
              style: const TextStyle(fontSize: 12, color: Palette.inkMuted),
            ),
          ),
        if (_draft != null && !_working)
          Container(
            margin: const EdgeInsets.only(top: 8),
            padding: const EdgeInsets.all(10),
            decoration: BoxDecoration(
              color: Palette.neutralBg,
              borderRadius: BorderRadius.circular(12),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  supportedLanguages[_target] ?? _target,
                  style: const TextStyle(
                    fontSize: 11,
                    fontWeight: FontWeight.w600,
                    color: Palette.inkMuted,
                  ),
                ),
                const SizedBox(height: 4),
                Text(_draft!, style: const TextStyle(fontSize: 13.5, height: 1.5)),
                const SizedBox(height: 4),
                Align(
                  alignment: Alignment.centerLeft,
                  child: TextButton(
                    onPressed: () {
                      widget.controller.text = _draft!;
                      setState(() => _draft = null);
                    },
                    child: Text(t('Use this')),
                  ),
                ),
              ],
            ),
          ),
      ],
    );
  }
}
