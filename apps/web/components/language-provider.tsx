'use client';

import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import type { LanguageCode } from '@sitebook/shared';
import { LANGUAGE_COOKIE, translate, type MessageKey } from '@/lib/i18n';

interface LanguageContextValue {
  language: LanguageCode;
  /** Look up one string. Falls back to English when it has not been translated yet. */
  t: (key: MessageKey) => string;
  setLanguage: (language: LanguageCode) => void;
}

const LanguageContext = createContext<LanguageContextValue>({
  language: 'en',
  t: (key) => translate('en', key),
  setLanguage: () => undefined,
});

/**
 * Which language the interface is in.
 *
 * The chosen language is read from a cookie on the server and passed in here, so the first paint is
 * already in the right language — a navigation rail that renders in English and then flips to Tamil
 * is worse than one that never flipped.
 *
 * Changing it writes the cookie and reloads. A reload rather than a re-render on purpose: the
 * server components that render most of this app read the cookie, and only a fresh request makes
 * them render again. It happens roughly once per person per installation, so paying a page load for
 * it is the right trade against threading a locale through every server component.
 */
export function LanguageProvider({
  initial,
  children,
}: {
  initial: LanguageCode;
  children: React.ReactNode;
}) {
  const [language, setLanguageState] = useState<LanguageCode>(initial);

  const setLanguage = useCallback((next: LanguageCode) => {
    setLanguageState(next);
    // A year, and `SameSite=Lax`: it is a display preference, not a credential, and it has to
    // survive arriving back on the app from a WhatsApp link.
    document.cookie = `${LANGUAGE_COOKIE}=${next}; path=/; max-age=31536000; samesite=lax`;
    window.location.reload();
  }, []);

  const value = useMemo(
    () => ({ language, t: (key: MessageKey) => translate(language, key), setLanguage }),
    [language, setLanguage],
  );

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useLanguage(): LanguageContextValue {
  return useContext(LanguageContext);
}
