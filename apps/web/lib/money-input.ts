/**
 * Money typed by a human → the paise string the API expects.
 *
 * Builders enter rupees ("650", "1250.50"), and the API takes an integer count of
 * paise as a string (ADR 0003). The conversion is done on the digits rather than
 * with `Number(x) * 100`, because 1250.50 × 100 is 125049.99999999999 in floating
 * point and that would quietly short a worker by a paisa.
 */
export function rupeesToPaiseString(input: string): string {
  const trimmed = input.replace(/[,\s₹]/g, '').trim();
  if (trimmed.length === 0) return '0';

  const match = /^(-?)(\d*)(?:\.(\d{0,2}))?$/.exec(trimmed);
  if (!match) throw new RangeError(`not an amount: ${input}`);

  const [, sign, whole, fraction = ''] = match;
  const paise = `${whole || '0'}${fraction.padEnd(2, '0')}`;
  // Strip leading zeros but keep a single one for zero itself.
  const normalised = paise.replace(/^0+(?=\d)/, '');
  return `${sign}${normalised}`;
}

/** The inverse, for pre-filling an edit form: `65000` → `650`. */
export function paiseToRupeesInput(paise: string): string {
  const negative = paise.startsWith('-');
  const digits = (negative ? paise.slice(1) : paise).padStart(3, '0');
  const whole = digits.slice(0, -2).replace(/^0+(?=\d)/, '');
  const fraction = digits.slice(-2);
  const body = fraction === '00' ? whole : `${whole}.${fraction}`;
  return negative ? `-${body}` : body;
}
