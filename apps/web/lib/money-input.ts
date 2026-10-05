/**
 * Money typed by a human → the minor-unit string the API expects.
 *
 * Builders enter major units ("650", "1250.50"), and the API takes an integer count of
 * minor units as a string (ADR 0003). The conversion is done on the digits rather than
 * with `Number(x) * 100`, because 1250.50 × 100 is 125049.99999999999 in floating
 * point and that would quietly short a worker by a paisa.
 *
 * `digits` is the currency's — 2 for INR and AED, 3 for KWD — from `useFormat().currencyDigits`.
 * `symbol` is stripped as well as `₹`, so a pasted "AED 1,250" parses.
 */
export function amountToMinorString(input: string, digits = 2, symbol = ''): string {
  let trimmed = input.replace(/[,\s₹]/g, '');
  if (symbol) trimmed = trimmed.split(symbol).join('');
  trimmed = trimmed.trim();
  if (trimmed.length === 0) return '0';

  const match = new RegExp(`^(-?)(\\d*)(?:\\.(\\d{0,${digits}}))?$`).exec(trimmed);
  if (!match) throw new RangeError(`not an amount: ${input}`);

  const [, sign, whole, fraction = ''] = match;
  const minor = `${whole || '0'}${fraction.padEnd(digits, '0')}`;
  // Strip leading zeros but keep a single one for zero itself.
  const normalised = minor.replace(/^0+(?=\d)/, '');
  return `${sign}${normalised}`;
}

/** The inverse, for pre-filling an edit form: `65000` → `650`. */
export function minorToAmountInput(minor: string, digits = 2): string {
  const negative = minor.startsWith('-');
  const raw = negative ? minor.slice(1) : minor;
  if (digits === 0) return `${negative ? '-' : ''}${raw.replace(/^0+(?=\d)/, '')}`;
  const padded = raw.padStart(digits + 1, '0');
  const whole = padded.slice(0, -digits).replace(/^0+(?=\d)/, '');
  const fraction = padded.slice(-digits);
  const body = /^0+$/.test(fraction) ? whole : `${whole}.${fraction}`;
  return negative ? `-${body}` : body;
}

/** `amountToMinorString` for rupees. */
export function rupeesToPaiseString(input: string): string {
  return amountToMinorString(input, 2);
}

/** `minorToAmountInput` for rupees. */
export function paiseToRupeesInput(paise: string): string {
  return minorToAmountInput(paise, 2);
}
