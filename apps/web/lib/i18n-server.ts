import { cookies } from 'next/headers';
import type { LanguageCode } from '@sitebook/shared';
import { LANGUAGE_COOKIE, TRANSLATED_LANGUAGES, translate, type Translator } from './i18n';

/**
 * `t` for server components.
 *
 * Most of this app renders on the server, so most of its words are here rather than in a client
 * component — the rail and the dialogs were only ever the visible half. A server component cannot
 * read React context, so it reads the cookie instead.
 *
 * Nothing has to be threaded through props: `cookies()` is backed by Next's own request-scoped
 * storage, so two requests for two people in two languages cannot see each other's. That is the
 * only reason a bare `await getT()` in a leaf component is safe rather than a race.
 */
export async function getLanguage(): Promise<LanguageCode> {
  const stored = (await cookies()).get(LANGUAGE_COOKIE)?.value;
  return TRANSLATED_LANGUAGES.includes(stored as LanguageCode) ? (stored as LanguageCode) : 'en';
}

export async function getT(): Promise<Translator> {
  const language = await getLanguage();
  return (english: string) => translate(language, english);
}
