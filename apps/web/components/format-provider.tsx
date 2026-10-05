'use client';

import { createContext, useContext, useMemo } from 'react';
import { createFormat, indiaFormat, type Format, type FormatLocale } from '@/lib/format';

const FormatContext = createContext<Format>(indiaFormat);

/**
 * The company's display settings, for client components.
 *
 * The layout passes the plain settings rather than a `Format`, because functions cannot cross from
 * a server component to a client one; the `Format` is rebuilt here from the same three values, so
 * the server render and the hydrated one print the same thing.
 *
 * Outside a provider — a test rendering one component, the login page — it is the Indian format.
 */
export function FormatProvider({
  settings,
  children,
}: {
  settings: FormatLocale;
  children: React.ReactNode;
}) {
  const { currency, locale, timezone, country, taxRegime } = settings;
  const format = useMemo(
    () => createFormat({ currency, locale, timezone, country, taxRegime }),
    [currency, locale, timezone, country, taxRegime],
  );
  return <FormatContext.Provider value={format}>{children}</FormatContext.Provider>;
}

export function useFormat(): Format {
  return useContext(FormatContext);
}
