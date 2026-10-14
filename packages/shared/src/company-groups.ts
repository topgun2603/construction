import { currencyMinorDigits } from './locale';

/**
 * Company groups (roadmap Phase 2, module 11): a holding that owns several companies — a UAE
 * company in AED and an Indian one in INR — and wants one picture of them.
 *
 * Everything here is named `companyGroup…` / `COMPANY_GROUP_…` so it cannot collide with the
 * modules being built beside it.
 */

/**
 * What a person may do *in a group*, as opposed to inside a company.
 *
 * Kept apart from `PERMISSIONS` on purpose. A tenant role's permissions are about one company's
 * data and are resolved per request from that company's role row; a group grant is about the
 * group, is given by the group, and never opens anything inside a company. Folding these into
 * the tenant list would make "owner of the Indian company" quietly imply "can see the Dubai
 * company's figures", which is exactly the leak the separation exists to stop.
 */
export const COMPANY_GROUP_PERMISSIONS = ['group.view_reports', 'group.manage'] as const;
export type CompanyGroupPermission = (typeof COMPANY_GROUP_PERMISSIONS)[number];

export function isCompanyGroupPermission(value: string): value is CompanyGroupPermission {
  return (COMPANY_GROUP_PERMISSIONS as readonly string[]).includes(value);
}

export const COMPANY_GROUP_INVITATION_STATUSES = [
  'pending',
  'accepted',
  'declined',
  'cancelled',
] as const;
export type CompanyGroupInvitationStatus = (typeof COMPANY_GROUP_INVITATION_STATUSES)[number];

/**
 * Decimal places a stored exchange rate keeps (`numeric(20,10)`). Ten is enough for the smallest
 * real pair (1 IDR in KWD is about 0.0000196) to keep four significant figures.
 */
export const COMPANY_GROUP_RATE_DECIMALS = 10;
const RATE_SCALE = 10n ** BigInt(COMPANY_GROUP_RATE_DECIMALS);

/** `"0.0441"` → the rate as an integer at ten decimal places. Null when not a positive decimal. */
export function parseCompanyGroupRate(rate: string): bigint | null {
  const match = /^(\d{1,10})(?:\.(\d{1,10}))?$/.exec(rate.trim());
  if (!match) return null;
  const [, whole, fraction = ''] = match;
  const scaled = BigInt(whole!) * RATE_SCALE + BigInt(fraction.padEnd(COMPANY_GROUP_RATE_DECIMALS, '0'));
  return scaled > 0n ? scaled : null;
}

/** One manual rate: 1 unit of `currency` is worth `rate` units of the group's base currency. */
export interface CompanyGroupRate {
  currency: string;
  rate: string;
  /** ISO date the rate applies from, until a later row for the same currency replaces it. */
  effective_from: string;
}

/** The rate a conversion actually used — shown next to the total, so nobody has to trust it blind. */
export interface CompanyGroupRateUsed {
  currency: string;
  rate: string;
  /** Null for the base currency itself, which needs no rate. */
  effective_from: string | null;
}

/**
 * The rate for `currency` on `asOf`: the latest row whose `effective_from` is on or before it.
 *
 * Never a live market rate. A consolidated report is something a finance person signs off, and a
 * figure that moved between two exports of the same month because the market did is a figure
 * nobody can reconcile. The group types its rates in; this only picks which one applies.
 */
export function companyGroupRateOn(
  rates: readonly CompanyGroupRate[],
  currency: string,
  baseCurrency: string,
  asOf: string,
): CompanyGroupRateUsed | null {
  if (currency === baseCurrency) return { currency, rate: '1', effective_from: null };
  let best: CompanyGroupRate | null = null;
  for (const row of rates) {
    if (row.currency !== currency || row.effective_from > asOf) continue;
    if (!best || row.effective_from > best.effective_from) best = row;
  }
  return best ? { currency, rate: best.rate, effective_from: best.effective_from } : null;
}

/**
 * Converts an amount in minor units of `from` into minor units of `to` at `rate` (units of `to`
 * per unit of `from`), with integer arithmetic only.
 *
 * Minor units differ by currency — fils and paise are hundredths, a Kuwaiti fils a thousandth, a
 * yen has none — so the exponent difference is applied as well as the rate. Rounds half away from
 * zero, once, at the end: rounding each company before adding would let the group total drift
 * from the sum of its rows by a unit per company.
 */
export function convertCompanyGroupMinor(
  amountMinor: bigint,
  from: string,
  to: string,
  rate: string,
): bigint {
  if (from === to) return amountMinor;
  const scaledRate = parseCompanyGroupRate(rate);
  if (scaledRate === null) throw new RangeError(`not a usable exchange rate: ${rate}`);
  const numerator = amountMinor * scaledRate * 10n ** BigInt(currencyMinorDigits(to));
  const denominator = RATE_SCALE * 10n ** BigInt(currencyMinorDigits(from));
  return divideRounded(numerator, denominator);
}

function divideRounded(numerator: bigint, denominator: bigint): bigint {
  const negative = numerator < 0n !== denominator < 0n;
  const n = numerator < 0n ? -numerator : numerator;
  const d = denominator < 0n ? -denominator : denominator;
  const quotient = (n + d / 2n) / d;
  return negative ? -quotient : quotient;
}

export interface CompanyGroupConsolidation<K extends string> {
  /** Base-currency totals of every company whose currency had a rate. */
  totals: Record<K, bigint>;
  /** One per currency that appears, in first-seen order. */
  rates_used: CompanyGroupRateUsed[];
  /** Currencies with no rate on the date — their companies are left out of `totals`. */
  missing_currencies: string[];
  /** True when every company made it into the totals. */
  complete: boolean;
}

/**
 * Adds several companies' money figures into the group's base currency.
 *
 * A company whose currency has no rate on the date is *left out and named*, never converted at 1:
 * treating ₹10,00,000 as AED 10,00,000 would be off by a factor of twenty-two and look perfectly
 * plausible on a dashboard. The caller shows `missing_currencies` beside the total.
 */
export function consolidateCompanyGroup<K extends string>(input: {
  baseCurrency: string;
  asOf: string;
  rates: readonly CompanyGroupRate[];
  keys: readonly K[];
  companies: ReadonlyArray<{ currency: string; money: Record<K, bigint> }>;
}): CompanyGroupConsolidation<K> {
  const totals = Object.fromEntries(input.keys.map((key) => [key, 0n])) as Record<K, bigint>;
  const used = new Map<string, CompanyGroupRateUsed>();
  const missing: string[] = [];

  for (const company of input.companies) {
    const rate = companyGroupRateOn(input.rates, company.currency, input.baseCurrency, input.asOf);
    if (!rate) {
      if (!missing.includes(company.currency)) missing.push(company.currency);
      continue;
    }
    if (!used.has(company.currency)) used.set(company.currency, rate);
    for (const key of input.keys) {
      totals[key] += convertCompanyGroupMinor(
        company.money[key],
        company.currency,
        input.baseCurrency,
        rate.rate,
      );
    }
  }

  return {
    totals,
    rates_used: [...used.values()],
    missing_currencies: missing,
    complete: missing.length === 0,
  };
}

/** The money figures on the consolidated report, in the order its table shows them. */
export const COMPANY_GROUP_MONEY_KEYS = [
  'labour_cost',
  'expenses',
  'committed',
  'budget',
  'actual',
  'receivables',
] as const;
export type CompanyGroupMoneyKey = (typeof COMPANY_GROUP_MONEY_KEYS)[number];

/** The counts on the report: these add up across currencies as they are. */
export const COMPANY_GROUP_COUNT_KEYS = [
  'sites_active',
  'headcount_today',
  'open_incidents',
  'open_snags',
] as const;
export type CompanyGroupCountKey = (typeof COMPANY_GROUP_COUNT_KEYS)[number];
