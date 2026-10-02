/// The interface, in the language the person reads.
///
/// **Keyed by the English string itself**, exactly as the web app does it — `t('Sign out')`, not
/// `t('nav.signOut')`. A string with no entry falls back to its own key, which *is* the English, so
/// a gap shows English rather than a broken label. The two apps share one dictionary format and a
/// good part of one dictionary: a button called "Sites" is called "Sites" in both.
///
/// `t` is a plain top-level function reading a module-level variable, which on a server would be a
/// race between two people reading in two languages. Here it cannot be: a phone runs one app for
/// one person, the language changes only when that person changes it, and the alternative —
/// threading a translator through every widget constructor in fifty files — buys nothing.
library;

import 'package:flutter/widgets.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'i18n_ta.dart';

const supportedLanguages = <String, String>{
  'en': 'English',
  // Its own name in its own script. Somebody who cannot read the interface cannot read the word
  // "Tamil" either, and this is the one word on the screen they can.
  'ta': 'தமிழ்',
};

String _language = 'en';

/// Which language the interface is in, for the few places that need to branch on it rather than
/// just look a string up — the translate-as-you-type field needs to know what to translate *into*.
String get appLanguage => _language;

/// One string. English in, the reader's language out — or the English back, which is a fine answer.
String t(String english) {
  if (_language == 'en') return english;
  return taStrings[english] ?? english;
}

const _prefsKey = 'buildr.language';

/// Which language the app is in, and the only thing that changes it.
class LanguageController extends StateNotifier<String> {
  LanguageController() : super(_language) {
    _restore();
  }

  Future<void> _restore() async {
    final prefs = await SharedPreferences.getInstance();
    final stored = prefs.getString(_prefsKey);
    if (stored != null && supportedLanguages.containsKey(stored)) {
      _language = stored;
      state = stored;
    }
  }

  Future<void> set(String language) async {
    if (!supportedLanguages.containsKey(language)) return;
    _language = language;
    state = language;
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_prefsKey, language);
  }
}

final languageProvider = StateNotifierProvider<LanguageController, String>(
  (ref) => LanguageController(),
);

/// Rebuilds everything below it when the language changes.
///
/// `t()` reads a plain variable, so nothing re-renders on its own when that variable changes — the
/// widget tree has to be told. Keying on the language code is the bluntest way to say "all of this
/// is stale", and switching language is a once-per-installation event, so the cost of throwing the
/// tree away is nothing against the cost of a screen half in each language.
class LanguageScope extends ConsumerWidget {
  const LanguageScope({super.key, required this.child});

  final Widget child;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final language = ref.watch(languageProvider);
    return KeyedSubtree(key: ValueKey(language), child: child);
  }
}
