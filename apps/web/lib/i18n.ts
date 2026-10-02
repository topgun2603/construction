import type { LanguageCode } from '@sitebook/shared';
import { TA } from './i18n-ta';

/**
 * The interface, in the language the person reads.
 *
 * **Keyed by the English string itself**, not by invented names. `t('Sign out')` rather than
 * `t('nav.signOut')`. That choice is what made translating the whole app tractable rather than a
 * month of work:
 *
 *   * A string with no entry falls back to its own key, which *is* the English. A half-finished
 *     dictionary therefore shows English, never `nav.signOut` — so the app is never broken by a gap,
 *     and new strings can be added to the UI before anybody has translated them.
 *   * The rewrite that introduced this could be done mechanically, by a script over the AST. There
 *     was no mapping table to invent, review or keep in step: `>Sign out<` became
 *     `>{t('Sign out')}<` and nothing had to be decided per string.
 *   * Reading the JSX still tells you what is on screen. `{t('nav.signOut')}` tells you nothing
 *     without a second file open.
 *
 * The cost is real and worth naming: two buttons that happen to share English wording must share
 * the Tamil, and editing an English string orphans its translation until somebody re-runs the
 * extractor. For one app with one translated language, that is a better trade than a key namespace
 * nobody maintains.
 *
 * The dictionary itself is in `i18n-ta.ts`, kept apart from this logic because it is generated.
 */

const DICTIONARIES: Partial<Record<LanguageCode, Record<string, string>>> = {
  ta: TA,
};

/**
 * Which languages the interface is actually available in.
 *
 * The picker offers only these. The other four in `APP_LANGUAGES` are wired for *translation* —
 * somebody can have their typing turned into Telugu — but the interface itself has not been
 * written in them, and listing them here would be a promise made in a dropdown.
 */
export const TRANSLATED_LANGUAGES: LanguageCode[] = [
  'en',
  ...(Object.keys(DICTIONARIES) as LanguageCode[]),
];

/** One string. English in, the reader's language out — or the English back, which is a fine answer. */
export function translate(language: LanguageCode, english: string): string {
  if (language === 'en') return english;
  return DICTIONARIES[language]?.[english] ?? english;
}

/** The cookie the choice lives in. Read on the server so the first paint is already right. */
export const LANGUAGE_COOKIE = 'buildr_lang';

export type Translator = (english: string) => string;
