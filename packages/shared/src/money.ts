import { currencyMinorDigits, INDIA_LOCALE } from './locale';

/**
 * Money is always an integer count of minor units held in a bigint (spec §17) — paise for an
 * Indian company, fils for a Gulf one. Which currency is the tenant's setting, not the amount's.
 * Never introduce a float anywhere in this file.
 */

export const PAISE_PER_RUPEE = 100n;

/** What `formatMoney` needs from a tenant's locale settings. */
export interface MoneyFormat {
  currency: string;
  locale: string;
}

/**
 * `125050n` → `₹1,250.50` for INR in `en-IN`, `AED 1,250.50` in `en-AE`, `1.250 KWD` style for a
 * three-decimal currency. The amount reaches `Intl` as an exact decimal string, never a number.
 */
export function formatMoney(minor: bigint, format: MoneyFormat = INDIA_LOCALE): string {
  const digits = currencyMinorDigits(format.currency);
  return numberFormat(format.locale, {
    style: 'currency',
    currency: format.currency,
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(minorToDecimal(minor, digits) as Intl.StringNumericLiteral);
}

/**
 * Short form for headline figures. Lakh and crore for an Indian locale, because that is how
 * builders there say budgets (`₹4.2 Cr`); the locale's own compact notation everywhere else
 * (`AED 4.2M`). Truncates rather than rounds, so a figure is never overstated.
 */
export function formatMoneyCompact(minor: bigint, format: MoneyFormat = INDIA_LOCALE): string {
  const scale = 10n ** BigInt(currencyMinorDigits(format.currency));
  const negative = minor < 0n;
  const major = (negative ? -minor : minor) / scale;

  if (usesLakhCrore(format.locale)) {
    const symbol = currencySymbol(format);
    const sign = negative ? '-' : '';
    if (major >= 10_000_000n) return `${sign}${symbol}${oneDecimal(major, 10_000_000n)} Cr`;
    if (major >= 100_000n) return `${sign}${symbol}${oneDecimal(major, 100_000n)} L`;
    return `${sign}${symbol}${groupIndian(major.toString())}`;
  }

  return numberFormat(format.locale, {
    style: 'currency',
    currency: format.currency,
    notation: 'compact',
    // Currency style defaults to two minimum places; left alone, 450 would read "AED 450.0".
    minimumFractionDigits: 0,
    maximumFractionDigits: 1,
    roundingMode: 'trunc',
  }).format(negative ? -major : major);
}

/** `125050n`, 2 → `"1250.50"`. Exact, for handing to `Intl` or a CSV. */
export function minorToDecimal(minor: bigint, digits: number): string {
  const negative = minor < 0n;
  const abs = negative ? -minor : minor;
  const sign = negative ? '-' : '';
  if (digits === 0) return `${sign}${abs}`;
  const scale = 10n ** BigInt(digits);
  return `${sign}${abs / scale}.${(abs % scale).toString().padStart(digits, '0')}`;
}

/**
 * `"1250.5"`, 2 → `125050n`. The inverse of `minorToDecimal`, for an amount read as text — off a
 * bill, out of a CSV. Null when it is not a plain decimal or has more places than the currency.
 */
export function decimalToMinor(value: string, digits: number): bigint | null {
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(value.trim());
  if (!match) return null;
  const [, sign, whole, fraction = ''] = match;
  if (fraction.length > digits) return null;
  const minor = BigInt(whole!) * 10n ** BigInt(digits) + BigInt(fraction.padEnd(digits, '0') || '0');
  return sign === '-' ? -minor : minor;
}

/** Lakh and crore belong to India's locales (`en-IN`, `ta-IN`, `hi-IN`), not to the rupee. */
function usesLakhCrore(locale: string): boolean {
  return new Intl.Locale(locale).region === 'IN';
}

function currencySymbol(format: MoneyFormat): string {
  const parts = numberFormat(format.locale, { style: 'currency', currency: format.currency })
    .formatToParts(0);
  return parts.find((part) => part.type === 'currency')?.value ?? format.currency;
}

/** Building a formatter costs far more than using one, and a wage sheet formats hundreds. */
const formatters = new Map<string, Intl.NumberFormat>();
function numberFormat(locale: string, options: Intl.NumberFormatOptions): Intl.NumberFormat {
  const key = `${locale}|${JSON.stringify(options)}`;
  let formatter = formatters.get(key);
  if (!formatter) {
    formatter = new Intl.NumberFormat(locale, options);
    formatters.set(key, formatter);
  }
  return formatter;
}

export function rupeesToPaise(rupees: number): bigint {
  if (!Number.isFinite(rupees)) throw new RangeError('rupees must be finite');
  // Round at the paise boundary so 1234.565 does not drift.
  return BigInt(Math.round(rupees * 100));
}

export function paiseToRupees(paise: bigint): number {
  return Number(paise) / 100;
}

/** `125050n` → `"1,250.50"` — Indian grouping, always two decimals. */
export function formatPaise(paise: bigint): string {
  const negative = paise < 0n;
  const abs = negative ? -paise : paise;
  const whole = abs / PAISE_PER_RUPEE;
  const fraction = abs % PAISE_PER_RUPEE;
  const grouped = groupIndian(whole.toString());
  const text = `${grouped}.${fraction.toString().padStart(2, '0')}`;
  return negative ? `-${text}` : text;
}

/**
 * `formatMoney` for an Indian company. Kept so callers that have no tenant in hand yet keep
 * working; new code should pass the tenant's settings to `formatMoney`.
 */
export function formatInr(paise: bigint): string {
  return formatMoney(paise, INDIA_LOCALE);
}

/**
 * Short Indian form for headline figures: `₹4.2 Cr`, `₹94.2 L`.
 *
 * Dashboards show budgets in crores because that is how builders say them, and a
 * full `₹4,20,00,000.00` costs a tile its whole width. Below a lakh there is no
 * conventional short form, so it falls back to grouped rupees with no paise —
 * headline numbers never need them. `formatMoneyCompact` for an Indian company.
 */
export function formatInrCompact(paise: bigint): string {
  return formatMoneyCompact(paise, INDIA_LOCALE);
}

/** `major / unit` to one decimal place, truncated, without touching a float. */
function oneDecimal(major: bigint, unit: bigint): string {
  const tenths = (major * 10n) / unit;
  return `${tenths / 10n}.${tenths % 10n}`;
}

/** 2,2,3 grouping: 12345678 → 1,23,45,678. */
function groupIndian(digits: string): string {
  if (digits.length <= 3) return digits;
  const head = digits.slice(0, -3);
  const tail = digits.slice(-3);
  const grouped = head.replace(/\B(?=(\d{2})+(?!\d))/g, ',');
  return `${grouped},${tail}`;
}

/**
 * Half-day pay. Splitting an odd number of paise rounds down so the sum of the
 * lines can never exceed the full day's wage.
 */
export function halfDayAmount(dailyWagePaise: bigint): bigint {
  return dailyWagePaise / 2n;
}

/**
 * Overtime pay for a tenth-of-an-hour precise duration, without touching floats.
 * `overtimeHours` arrives as a decimal string (Postgres `numeric(4,1)`).
 */
export function overtimeAmount(overtimeHours: string, ratePerHourPaise: bigint): bigint {
  const tenths = decimalToTenths(overtimeHours);
  return (tenths * ratePerHourPaise) / 10n;
}

/** `"7.5"` → `75n` (tenths). Rejects anything finer than one decimal place. */
export function decimalToTenths(value: string): bigint {
  const match = /^(-?)(\d+)(?:\.(\d))?$/.exec(value.trim());
  if (!match) throw new RangeError(`not a one-decimal number: ${value}`);
  const [, sign, whole, tenth] = match;
  const magnitude = BigInt(whole ?? '0') * 10n + BigInt(tenth ?? '0');
  return sign === '-' ? -magnitude : magnitude;
}

export function tenthsToDecimal(tenths: bigint): string {
  const negative = tenths < 0n;
  const abs = negative ? -tenths : tenths;
  const text = `${abs / 10n}.${abs % 10n}`;
  return negative ? `-${text}` : text;
}

/**
 * Material quantities as integer thousandths.
 *
 * `numeric(14,3)` on the wire, and the same reasoning as `decimalToTenths`: stock is a running
 * sum of what arrived minus what was used, and doing that in floating point means 0.1 + 0.2
 * eventually disagrees with the ledger. Thousandths because a quantity can be 2.5 bags, 0.125
 * cum of concrete, or 1250.75 kg of steel, and three places covers every unit a site uses.
 *
 * Deliberately stricter than the column: more than three decimals throws rather than rounding
 * silently, because a caller sending 0.3333 has a unit conversion wrong and should be told.
 */
export function quantityToThousandths(value: string): bigint {
  const match = /^(-?)(\d+)(?:\.(\d{1,3}))?$/.exec(value.trim());
  if (!match) throw new RangeError(`not a quantity with up to three decimals: ${value}`);
  const [, sign, whole, fraction] = match;
  const padded = (fraction ?? '').padEnd(3, '0');
  const magnitude = BigInt(whole ?? '0') * 1000n + BigInt(padded || '0');
  return sign === '-' ? -magnitude : magnitude;
}

/**
 * Back to a decimal string, trailing zeros trimmed.
 *
 * "40" rather than "40.000": a quantity is usually whole, the unit is displayed beside it, and
 * three forced decimals on a bag count is noise. Unlike days present — where the wage sheet
 * needs a fixed column and `decimalToTenths` has to parse it back — nothing compares these as
 * strings, because every sum is done here in thousandths.
 */
export function thousandthsToQuantity(thousandths: bigint): string {
  const negative = thousandths < 0n;
  const abs = negative ? -thousandths : thousandths;
  const whole = abs / 1000n;
  const fraction = (abs % 1000n).toString().padStart(3, '0').replace(/0+$/, '');
  const text = fraction ? `${whole}.${fraction}` : `${whole}`;
  return negative ? `-${text}` : text;
}
