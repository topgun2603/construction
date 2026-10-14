import { cache } from 'react';
import { createFormat, indiaFormat, type Format, type FormatLocale } from './format';
import { loadSelf, type SelfResponse } from './session';

/**
 * `Format` for server components: the signed-in company's currency, conventions and time zone.
 *
 * The same shape as `getT()`, and safe for the same reason — `loadSelf` is `cache()`d per server
 * render, so two requests from two companies in two currencies cannot see each other's, and a leaf
 * component calling this costs nothing the layout has not already paid for.
 *
 * Without a session (a page about to redirect) it is the Indian format, which is what every page
 * showed before companies had settings.
 */
export const getFormat = cache(async (): Promise<Format> => {
  const self = await loadSelf();
  return self ? createFormat(formatLocaleOf(self)) : indiaFormat;
});

export function formatLocaleOf(self: SelfResponse): FormatLocale {
  return {
    currency: self.tenant.currency,
    locale: self.tenant.locale,
    timezone: self.tenant.timezone,
    country: self.tenant.country,
    taxRegime: self.tenant.tax_regime,
  };
}
