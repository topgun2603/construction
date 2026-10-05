import { isValidGstin } from './gstin';
import type { TaxRegime } from './locale';

/**
 * Tax rules per regime, as data (roadmap Phase 0, item 4).
 *
 * What differs between countries is kept here, not scattered through the code that uses it: what
 * the registration number is called, how to tell a real one from a misread one, and the standard
 * rate. Adding a country is adding an entry.
 *
 * Rates are the standard rate only, and only where it is a single well-established figure. India's
 * GST has several slabs that were restructured in 2025 and depend on the item, so it has none here
 * rather than a number that would be wrong for most bills. Confirm every rate with a local
 * accountant before anything is calculated from it (roadmap: Phase 1, item 5).
 */
export interface TaxRule {
  regime: TaxRegime;
  /** What the tax is called on a bill: GST, VAT. Null when the company is under none. */
  taxName: string | null;
  /** What a supplier's registration number is called: GSTIN, TRN, VAT number. */
  idLabel: string | null;
  /** Upper-cased, spaces and dashes removed: the form numbers are stored and compared in. */
  normaliseId: (raw: string) => string;
  /** Whether a number could actually have been issued — a check digit where one exists. */
  isValidId: (id: string) => boolean;
  /** Standard rate in basis points (500 = 5%), or null where there is no single rate. */
  standardRateBp: number | null;
}

const compact = (raw: string) => raw.toUpperCase().replace(/[\s-]/g, '');

/**
 * UAE Tax Registration Number: fifteen digits, beginning `100` for VAT registrants. There is no
 * published check digit, so this is a shape check — enough to reject a misread length or letter.
 */
export function isValidUaeTrn(candidate: string): boolean {
  return /^100\d{12}$/.test(compact(candidate));
}

/**
 * Saudi VAT registration number: fifteen digits that begin and end with 3. Shape only, for the
 * same reason as the TRN.
 */
export function isValidSaudiVatNumber(candidate: string): boolean {
  return /^3\d{13}3$/.test(compact(candidate));
}

export const TAX_RULES: Readonly<Record<TaxRegime, TaxRule>> = Object.freeze({
  gst_in: {
    regime: 'gst_in',
    taxName: 'GST',
    idLabel: 'GSTIN',
    normaliseId: compact,
    isValidId: isValidGstin,
    standardRateBp: null,
  },
  vat_ae: {
    regime: 'vat_ae',
    taxName: 'VAT',
    idLabel: 'TRN',
    normaliseId: compact,
    isValidId: isValidUaeTrn,
    standardRateBp: 500,
  },
  vat_sa: {
    regime: 'vat_sa',
    taxName: 'VAT',
    idLabel: 'VAT number',
    normaliseId: compact,
    isValidId: isValidSaudiVatNumber,
    standardRateBp: 1500,
  },
  none: {
    regime: 'none',
    taxName: null,
    idLabel: null,
    normaliseId: compact,
    isValidId: () => false,
    standardRateBp: null,
  },
});

export function taxRule(regime: string): TaxRule {
  return TAX_RULES[regime as TaxRegime] ?? TAX_RULES.none;
}

/**
 * The tax inside a tax-inclusive amount: AED 105 at 5% holds AED 5 of VAT. Rounded half up to the
 * minor unit, the way a supplier's invoice rounds it.
 */
export function taxIncluded(gross: bigint, rateBp: number): bigint {
  const rate = BigInt(rateBp);
  return (gross * rate * 2n + (10_000n + rate)) / ((10_000n + rate) * 2n);
}

/** The tax to add on top of a net amount: 5% of AED 100 is AED 5. Rounded half up. */
export function taxOnTop(net: bigint, rateBp: number): bigint {
  return (net * BigInt(rateBp) * 2n + 10_000n) / 20_000n;
}

/** A supplier's registration number in the regime's stored form, or null if it is not a real one. */
export function validTaxIdOrNull(regime: string, raw: string | null | undefined): string | null {
  if (!raw) return null;
  const rule = taxRule(regime);
  const id = rule.normaliseId(raw);
  return rule.isValidId(id) ? id : null;
}
