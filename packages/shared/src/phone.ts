/**
 * Mobile numbers for every country a company can be in (roadmap Phase 0, item 5).
 *
 * Stored form is unchanged: E.164 without the plus — `919876543210`, `971501234567`. Indian numbers
 * stored before this module existed are already in it, so nothing is migrated.
 *
 * Input is read in one of two ways:
 *
 *   * **International** — a leading `+` or `00` names the country, and the number must be a mobile
 *     there. This is what the web app always sends.
 *   * **National** — bare digits are read in `defaultCountry`, India unless the caller knows better.
 *     That keeps every client that sends ten Indian digits working exactly as before.
 *
 * Bare digits are never guessed across countries. A Nepali mobile (`98XXXXXXXX`) is also a valid
 * Indian one, so reading national digits in the wrong country would store a working-looking number
 * that belongs to somebody else. The one exception is digits that already start with a supported
 * calling code (`971501234567`), which is how numbers are stored and how dev sign-in tokens spell
 * them — those are unambiguous because no national number in the table is that long.
 */

export interface PhoneCountry {
  country: string;
  callingCode: string;
  /** A national mobile number, after the trunk `0` is dropped. */
  mobile: RegExp;
  /** For an input's placeholder. */
  example: string;
}

/** The countries in COUNTRY_PRESETS, plus nothing: a number is only accepted where a company can be. */
export const PHONE_COUNTRIES: readonly PhoneCountry[] = Object.freeze([
  { country: 'IN', callingCode: '91', mobile: /^[6-9]\d{9}$/, example: '98765 43210' },
  { country: 'AE', callingCode: '971', mobile: /^5\d{8}$/, example: '50 123 4567' },
  { country: 'SA', callingCode: '966', mobile: /^5\d{8}$/, example: '51 234 5678' },
  { country: 'QA', callingCode: '974', mobile: /^[3567]\d{7}$/, example: '3312 3456' },
  { country: 'KW', callingCode: '965', mobile: /^[569]\d{7}$/, example: '500 12345' },
  { country: 'OM', callingCode: '968', mobile: /^[79]\d{7}$/, example: '9212 3456' },
  { country: 'BH', callingCode: '973', mobile: /^[36]\d{7}$/, example: '3600 1234' },
  { country: 'LK', callingCode: '94', mobile: /^7\d{8}$/, example: '71 234 5678' },
  { country: 'BD', callingCode: '880', mobile: /^1[3-9]\d{8}$/, example: '1812 345678' },
  { country: 'NP', callingCode: '977', mobile: /^9[678]\d{8}$/, example: '984 1234567' },
]);

export function phoneCountry(country: string): PhoneCountry | undefined {
  return PHONE_COUNTRIES.find((entry) => entry.country === country);
}

/** National digits → stored form, or null. Drops one trunk `0` (`050…` in Dubai, `09…` in India). */
function national(digits: string, entry: PhoneCountry): string | null {
  const subscriber = digits.startsWith('0') ? digits.slice(1) : digits;
  return entry.mobile.test(subscriber) ? `${entry.callingCode}${subscriber}` : null;
}

/** Digits that begin with a calling code → stored form, or null. */
function withCallingCode(digits: string): string | null {
  // Longest code first, so 971 is tried before a hypothetical 97.
  const byLength = [...PHONE_COUNTRIES].sort((a, b) => b.callingCode.length - a.callingCode.length);
  for (const entry of byLength) {
    if (!digits.startsWith(entry.callingCode)) continue;
    const subscriber = digits.slice(entry.callingCode.length);
    if (entry.mobile.test(subscriber)) return `${entry.callingCode}${subscriber}`;
  }
  return null;
}

/**
 * Any supported mobile number as stored (E.164, no plus), or null when it is not one.
 *
 * `+971 50 123 4567`, `00971501234567` and `971501234567` all give `971501234567`;
 * `050 123 4567` gives it too when `defaultCountry` is `AE`, and null when it is `IN`.
 */
export function toE164(input: string, defaultCountry = 'IN'): string | null {
  const trimmed = input.trim();
  const international = trimmed.startsWith('+') || trimmed.startsWith('00');
  let digits = trimmed.replace(/\D/g, '');
  if (trimmed.startsWith('00')) digits = digits.slice(2);

  if (international) return withCallingCode(digits);

  const home = phoneCountry(defaultCountry);
  // National first: 9120196797 is a real Indian mobile that merely begins with 91.
  return (home && national(digits, home)) ?? withCallingCode(digits);
}

/** The country a stored number belongs to, for showing it back. */
export function countryOfPhone(stored: string): PhoneCountry | undefined {
  const digits = stored.replace(/\D/g, '');
  return [...PHONE_COUNTRIES]
    .sort((a, b) => b.callingCode.length - a.callingCode.length)
    .find(
      (entry) =>
        digits.startsWith(entry.callingCode) &&
        entry.mobile.test(digits.slice(entry.callingCode.length)),
    );
}

/** `971501234567` → `+971 501234567`; anything unrecognised → `+` and its digits. */
export function displayPhone(stored: string): string {
  const digits = stored.replace(/\D/g, '');
  const entry = countryOfPhone(digits);
  return entry ? `+${entry.callingCode} ${digits.slice(entry.callingCode.length)}` : `+${digits}`;
}
