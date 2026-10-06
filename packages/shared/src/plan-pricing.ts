import { currencyMinorDigits } from './locale';
import { decimalToMinor, minorToDecimal } from './money';

/**
 * Regional plan pricing (roadmap: "lower-priced plans in USD or local currency; these markets will
 * not pay Gulf prices").
 *
 * A plan's `prices` already holds any number of currencies — `{ AED: "399900", LKR: "1499900" }` —
 * so a South Asian price is just another key. What this file adds is the rule for which one a
 * company is quoted, and the checks a price has to pass before a payment provider is asked to
 * charge it.
 *
 * **No conversion, ever.** A company is quoted in its own currency if the catalogue has a price in
 * it, otherwise in US dollars if the catalogue has one of those, otherwise it is asked to contact
 * us. An exchange rate picked at checkout would be a price nobody agreed to.
 */

/** The currencies the console's region pricing view offers, local ones first. */
export const PLAN_REGION_CURRENCIES = ['LKR', 'BDT', 'NPR', 'USD'] as const;

/** Quoted when a company's own currency has no price. */
export const PLAN_FALLBACK_CURRENCY = 'USD';

/**
 * Countries offered a bank-transfer invoice instead of a card checkout: paying a foreign merchant
 * by card from Bangladesh or Nepal is restricted enough that most builders there cannot.
 */
export const PLAN_BANK_TRANSFER_COUNTRIES: readonly string[] = Object.freeze(['BD', 'NP']);

export function planBankTransferOffered(country: string): boolean {
  return PLAN_BANK_TRANSFER_COUNTRIES.includes(country);
}

export interface PlanQuote {
  currency: string;
  /** Minor units of `currency`, as a string like all money on the wire. */
  amount: string;
  /** `local` is the company's own currency; `fallback` is the US-dollar price. */
  basis: 'local' | 'fallback';
}

/**
 * What a company paying in `currency` is quoted for a plan, or null for "contact us".
 *
 * Rupees live in `price` (paise) for historical reasons; everything else in `prices`.
 */
export function planQuote(
  plan: { price: string; prices: Record<string, string> },
  currency: string,
): PlanQuote | null {
  if (currency === 'INR') return { currency, amount: plan.price, basis: 'local' };
  const local = plan.prices[currency];
  if (local && local !== '0') return { currency, amount: local, basis: 'local' };
  const fallback = plan.prices[PLAN_FALLBACK_CURRENCY];
  if (fallback && fallback !== '0') {
    return { currency: PLAN_FALLBACK_CURRENCY, amount: fallback, basis: 'fallback' };
  }
  return null;
}

/** True for an ISO 4217 code the runtime knows — "LKR" yes, "XYZ" no. */
export function planCurrencyKnown(currency: string): boolean {
  if (!/^[A-Z]{3}$/.test(currency)) return false;
  const supported = (Intl as { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf;
  if (supported) return supported('currency').includes(currency);
  try {
    new Intl.NumberFormat('en', { style: 'currency', currency });
    return true;
  } catch {
    return false;
  }
}

/**
 * Stripe's three-decimal currencies, charged in thousandths but only in multiples of ten: the
 * last digit must be zero. (Stripe docs, "Three-decimal currencies".)
 */
const STRIPE_THREE_DECIMAL = new Set(['BHD', 'JOD', 'KWD', 'OMR', 'TND']);

/**
 * Why a price could not be charged as entered, or null when it can.
 *
 * Every amount in the catalogue is in the currency's minor units, with the exponent from
 * `currencyMinorDigits` (ICU's ISO 4217 data). Stripe uses the same exponent for the currencies
 * sold here — LKR, BDT and NPR are two-decimal in Stripe as in ISO 4217, none of them on its
 * zero-decimal list — so `"149900"` LKR is Rs 1,499.00 to both. The one place they part is the
 * Gulf's three-decimal dinars, which Stripe rounds to tens.
 */
export function planPriceProblem(currency: string, minor: string): string | null {
  if (!planCurrencyKnown(currency)) return `${currency} is not a currency we know`;
  if (!/^\d+$/.test(minor)) return 'a price is whole minor units';
  if (BigInt(minor) <= 0n) return 'a price must be more than zero';
  if (STRIPE_THREE_DECIMAL.has(currency) && !minor.endsWith('0')) {
    return `${currency} prices must end in 0 — the card processor charges it in tens of fils`;
  }
  return null;
}

/** `"1499.00"` LKR → `"149900"`, or null when it is not an amount in that currency. */
export function planPriceToMinor(decimal: string, currency: string): string | null {
  const minor = decimalToMinor(decimal.replace(/,/g, ''), currencyMinorDigits(currency));
  return minor === null || minor < 0n ? null : minor.toString();
}

/** `"149900"` LKR → `"1499.00"`, for an input box. */
export function planPriceFromMinor(minor: string, currency: string): string {
  return minorToDecimal(BigInt(minor), currencyMinorDigits(currency));
}
