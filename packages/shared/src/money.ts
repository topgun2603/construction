/**
 * Money is always an integer count of paise held in a bigint (spec §17).
 * Never introduce a float anywhere in this file.
 */

export const PAISE_PER_RUPEE = 100n;

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

/** `formatPaise` with the rupee sign. */
export function formatInr(paise: bigint): string {
  const body = formatPaise(paise);
  return body.startsWith('-') ? `-₹${body.slice(1)}` : `₹${body}`;
}

/**
 * Short Indian form for headline figures: `₹4.2 Cr`, `₹94.2 L`.
 *
 * Dashboards show budgets in crores because that is how builders say them, and a
 * full `₹4,20,00,000.00` costs a tile its whole width. Below a lakh there is no
 * conventional short form, so it falls back to grouped rupees with no paise —
 * headline numbers never need them.
 */
export function formatInrCompact(paise: bigint): string {
  const negative = paise < 0n;
  const abs = negative ? -paise : paise;
  const rupees = abs / PAISE_PER_RUPEE;

  const sign = negative ? '-' : '';
  if (rupees >= 10_000_000n) return `${sign}₹${oneDecimal(rupees, 10_000_000n)} Cr`;
  if (rupees >= 100_000n) return `${sign}₹${oneDecimal(rupees, 100_000n)} L`;
  return `${sign}₹${groupIndian(rupees.toString())}`;
}

/** `rupees / unit` to one decimal place, without touching a float. */
function oneDecimal(rupees: bigint, unit: bigint): string {
  const tenths = (rupees * 10n) / unit;
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
