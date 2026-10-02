import { z } from 'zod';

/**
 * Typing in one language and filing in another.
 *
 * A project manager in the office types English. The supervisor who has to read the instruction,
 * and the client's family who read the progress note, read Tamil. Today that gap is closed by
 * somebody pasting into Google Translate in another tab, or more often by not closing it at all —
 * the note goes out in English and the person it was for does not read it.
 *
 * So the field does it. You type English, the Tamil appears underneath, and one tap files the
 * Tamil. It is never swapped in silently: a translation of "pour the slab tomorrow" that came back
 * slightly wrong is a thing somebody has to be able to see before it is sent to a site.
 */

/**
 * The languages this product translates between.
 *
 * Deliberately short, and every one of them is a language a construction crew in south India
 * actually works in. A list of a hundred would cost nothing to write and would be a promise that
 * nobody has checked the output of.
 */
export const APP_LANGUAGES = [
  { code: 'en', label: 'English', native: 'English' },
  { code: 'ta', label: 'Tamil', native: 'தமிழ்' },
  { code: 'hi', label: 'Hindi', native: 'हिन्दी' },
  { code: 'te', label: 'Telugu', native: 'తెలుగు' },
  { code: 'kn', label: 'Kannada', native: 'ಕನ್ನಡ' },
  { code: 'ml', label: 'Malayalam', native: 'മലയാളം' },
] as const;

export const LANGUAGE_CODES = APP_LANGUAGES.map((language) => language.code);
export type LanguageCode = (typeof APP_LANGUAGES)[number]['code'];

export function languageName(code: string): string {
  return APP_LANGUAGES.find((language) => language.code === code)?.label ?? code;
}

export const translateSchema = z.object({
  /**
   * What to translate.
   *
   * Capped at what a long site note is, not at what a document is. This runs while somebody types,
   * so the ceiling is also a cost ceiling — a field that quietly sent four thousand characters on
   * every keystroke pause would be a bill nobody expected.
   */
  text: z.string().trim().min(1).max(1200),
  to: z.enum(LANGUAGE_CODES as [LanguageCode, ...LanguageCode[]]),
  /** Usually left out: the vendor detects it, and a wrong hint is worse than none. */
  from: z.enum(LANGUAGE_CODES as [LanguageCode, ...LanguageCode[]]).optional(),
});
export type TranslateInput = z.infer<typeof translateSchema>;

export interface TranslateResult {
  text: string;
  /** What the source was taken to be, so a field can stop offering to translate Tamil to Tamil. */
  detected: string | null;
}
