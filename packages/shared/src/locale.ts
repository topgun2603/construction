import { z } from 'zod';

/**
 * A company's country, currency, time zone, display locale and tax regime.
 *
 * Every one of these used to be an India constant in code. They are per-tenant settings now, and
 * an Indian company's values are exactly the old constants — so nothing an Indian customer sees
 * changes, and code that has not been taught about tenants yet can keep using `INDIA_LOCALE`.
 */
export interface TenantLocale {
  /** ISO 3166-1 alpha-2, upper case: `IN`, `AE`, `SA`. */
  country: string;
  /** ISO 4217, upper case: `INR`, `AED`, `KWD`. Fixes how many minor units make one major unit. */
  currency: string;
  /** IANA zone: `Asia/Kolkata`, `Asia/Dubai`, `Asia/Kathmandu`. Decides what "today" means. */
  timezone: string;
  /** BCP 47 tag used for number and date display: `en-IN`, `ar-AE`. */
  locale: string;
  taxRegime: TaxRegime;
}

/**
 * Which tax rules a company's documents follow. Validation and rates per regime come later
 * (roadmap Phase 0 item 4); this is the key they will hang off.
 */
export const TAX_REGIMES = ['gst_in', 'vat_ae', 'vat_sa', 'none'] as const;
export type TaxRegime = (typeof TAX_REGIMES)[number];

export const INDIA_LOCALE: Readonly<TenantLocale> = Object.freeze({
  country: 'IN',
  currency: 'INR',
  timezone: 'Asia/Kolkata',
  locale: 'en-IN',
  taxRegime: 'gst_in',
});

/**
 * The countries a company can pick, with what a company there usually needs.
 *
 * Picking a country fills the other four settings from here; each can still be changed. Ordered
 * by the roadmap: India, then the Gulf, then South Asia. A Gulf country other than the UAE and
 * Saudi Arabia is `none` for tax until its VAT rules are built (roadmap Phase 0, item 4) — a
 * regime that claimed to handle them would be worse than one that says it does not.
 *
 * English display locales throughout, so numbers keep Latin digits; Arabic is offered beside
 * them for the Gulf (`localesFor`).
 */
export interface CountryPreset {
  country: string;
  name: string;
  currency: string;
  timezone: string;
  locale: string;
  taxRegime: TaxRegime;
}

export const COUNTRY_PRESETS: readonly CountryPreset[] = Object.freeze([
  {
    country: 'IN',
    name: 'India',
    currency: 'INR',
    timezone: 'Asia/Kolkata',
    locale: 'en-IN',
    taxRegime: 'gst_in',
  },
  {
    country: 'AE',
    name: 'United Arab Emirates',
    currency: 'AED',
    timezone: 'Asia/Dubai',
    locale: 'en-AE',
    taxRegime: 'vat_ae',
  },
  {
    country: 'SA',
    name: 'Saudi Arabia',
    currency: 'SAR',
    timezone: 'Asia/Riyadh',
    locale: 'en-SA',
    taxRegime: 'vat_sa',
  },
  {
    country: 'QA',
    name: 'Qatar',
    currency: 'QAR',
    timezone: 'Asia/Qatar',
    locale: 'en-QA',
    taxRegime: 'none',
  },
  {
    country: 'KW',
    name: 'Kuwait',
    currency: 'KWD',
    timezone: 'Asia/Kuwait',
    locale: 'en-KW',
    taxRegime: 'none',
  },
  {
    country: 'OM',
    name: 'Oman',
    currency: 'OMR',
    timezone: 'Asia/Muscat',
    locale: 'en-OM',
    taxRegime: 'none',
  },
  {
    country: 'BH',
    name: 'Bahrain',
    currency: 'BHD',
    timezone: 'Asia/Bahrain',
    locale: 'en-BH',
    taxRegime: 'none',
  },
  {
    country: 'LK',
    name: 'Sri Lanka',
    currency: 'LKR',
    timezone: 'Asia/Colombo',
    locale: 'en-LK',
    taxRegime: 'none',
  },
  {
    country: 'BD',
    name: 'Bangladesh',
    currency: 'BDT',
    timezone: 'Asia/Dhaka',
    locale: 'en-BD',
    taxRegime: 'none',
  },
  {
    country: 'NP',
    name: 'Nepal',
    currency: 'NPR',
    timezone: 'Asia/Kathmandu',
    locale: 'en-NP',
    taxRegime: 'none',
  },
]);

const GULF = new Set(['AE', 'SA', 'QA', 'KW', 'OM', 'BH']);

export function presetFor(country: string): CountryPreset | undefined {
  return COUNTRY_PRESETS.find((preset) => preset.country === country);
}

/** Display locales worth offering for a country: English, plus Arabic in the Gulf and Tamil where it is spoken. */
export function localesFor(country: string): string[] {
  const locales = [`en-${country}`];
  if (GULF.has(country)) locales.push(`ar-${country}`);
  if (country === 'IN' || country === 'LK') locales.push(`ta-${country}`);
  return locales;
}

/** True for a zone the runtime's tz database knows, so `Intl` will not throw on it later. */
export function isValidTimeZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat('en', { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

/** True for a well-formed BCP 47 tag. */
export function isValidLocale(tag: string): boolean {
  try {
    return Intl.getCanonicalLocales(tag).length === 1;
  } catch {
    return false;
  }
}

/**
 * Minor units per major unit, as a power of ten: INR 2, JPY 0, KWD/BHD/OMR 3.
 *
 * Read from ICU rather than a table here, so a currency is never stored with the wrong
 * exponent because somebody forgot to add a row.
 */
export function currencyMinorDigits(currency: string): number {
  return new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions()
    .maximumFractionDigits!;
}

const countrySchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{2}$/, 'country must be a two-letter ISO code');

const currencySchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{3}$/, 'currency must be a three-letter ISO code');

const timezoneSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .refine(isValidTimeZone, 'unknown time zone');

const localeSchema = z.string().trim().min(2).max(35).refine(isValidLocale, 'invalid locale');

/** The settings as they cross the wire — snake_case, like every other field in the API. */
export const tenantLocaleSchema = z.object({
  country: countrySchema,
  currency: currencySchema,
  timezone: timezoneSchema,
  locale: localeSchema,
  tax_regime: z.enum(TAX_REGIMES),
});
export type TenantLocaleInput = z.infer<typeof tenantLocaleSchema>;
