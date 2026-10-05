import {
  currencyMinorDigits,
  formatMoney,
  formatMoneyCompact,
  INDIA_LOCALE,
  todayIn,
} from '@sitebook/shared';

/**
 * Display helpers.
 *
 * Money crosses the wire as a decimal string of minor units, so it is parsed straight to
 * `bigint` and never through `Number` — that is the whole point of the string form
 * (ADR 0003).
 *
 * Everything that depends on the company — currency, number and date conventions, time zone — is
 * on a `Format` built from its settings by `createFormat`. Server components get one from
 * `getFormat()` (lib/format-server.ts), client components from `useFormat()`
 * (components/format-provider.tsx). Only what reads the same everywhere is a bare export.
 */

/** The part of a tenant's settings that display depends on. A subset of `TenantLocale`. */
export interface FormatLocale {
  currency: string;
  locale: string;
  timezone: string;
  /** ISO country, for defaults that are not display — the calling code on a phone field. */
  country?: string;
  /** The tax regime (`vat_ae`, `gst_in`, `none`), for `taxRule()` — which tax fields a form shows. */
  taxRegime?: string;
}

export interface Format {
  readonly settings: FormatLocale;
  /** The currency's own sign — `₹`, `AED` — for a field label or an input prefix. */
  readonly currencySymbol: string;
  /** Minor-unit places for the currency: 2 for INR and AED, 3 for KWD. */
  readonly currencyDigits: number;
  /** Full precision: `₹1,250.50`. Use in ledgers and wage sheets. */
  money(value: string | null | undefined): string;
  /** Short form: `₹4.2 Cr`, `AED 4.2M`. Use in headline tiles. */
  moneyShort(value: string | null | undefined): string;
  /** A plain count in the company's grouping: `1,23,456` in India, `123,456` elsewhere. */
  count(value: number): string;
  /** `2026-03-02` → `2 Mar`. */
  shortDate(iso: string | null | undefined): string;
  /** `2026-03-02` → `Mon 2 Mar 2026`. */
  longDate(iso: string | null | undefined): string;
  /** `2026-03-02` → `Mon`. */
  weekday(iso: string | null | undefined): string;
  /** An instant → `9:52 am`, in the company's time zone. */
  timeOfDay(iso: string | null | undefined): string;
  /** An instant → `2 Mar`, on the day it happened in the company's time zone rather than UTC. */
  instantDate(iso: string | null | undefined): string;
  /** An instant → `just now`, `20m ago`, `3h ago`, then a date. */
  relativeTime(iso: string | null | undefined): string;
  /** Today in the company's time zone as `YYYY-MM-DD` — the default for any date input. */
  todayIso(): string;
}

/** Display for an Indian company: what every helper did before companies had settings. */
export const INDIA_FORMAT_LOCALE: FormatLocale = {
  currency: INDIA_LOCALE.currency,
  locale: INDIA_LOCALE.locale,
  timezone: INDIA_LOCALE.timezone,
  country: INDIA_LOCALE.country,
};

export function createFormat(settings: FormatLocale): Format {
  const { currency, locale, timezone } = settings;
  const moneyFormat = { currency, locale };

  // Dates arrive as `YYYY-MM-DD` and are formatted at UTC midnight, so the calendar day shown is
  // the one stored whatever the zone. Instants are formatted in the company's zone.
  const dayMonth = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', timeZone: 'UTC' });
  const fullDate = new Intl.DateTimeFormat(locale, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
  const dayName = new Intl.DateTimeFormat(locale, { weekday: 'short', timeZone: 'UTC' });
  const clock = new Intl.DateTimeFormat(locale, {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone: timezone,
  });
  const instantDayMonth = new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'short',
    timeZone: timezone,
  });
  const counter = new Intl.NumberFormat(locale);

  const calendarDate = (iso: string | null | undefined, formatter: Intl.DateTimeFormat) => {
    if (!iso) return '—';
    const parsed = new Date(`${iso}T00:00:00Z`);
    return Number.isNaN(parsed.getTime()) ? '—' : formatter.format(parsed);
  };
  const instant = (iso: string | null | undefined, formatter: Intl.DateTimeFormat) => {
    if (!iso) return '—';
    const parsed = new Date(iso);
    return Number.isNaN(parsed.getTime()) ? '—' : formatter.format(parsed);
  };

  const timeOfDay = (iso: string | null | undefined) => instant(iso, clock);
  const instantDate = (iso: string | null | undefined) => instant(iso, instantDayMonth);

  return {
    settings,
    currencySymbol:
      new Intl.NumberFormat(locale, { style: 'currency', currency })
        .formatToParts(0)
        .find((part) => part.type === 'currency')?.value ?? currency,
    currencyDigits: currencyMinorDigits(currency),
    money: (value) => formatMoney(paise(value), moneyFormat),
    moneyShort: (value) => formatMoneyCompact(paise(value), moneyFormat),
    count: (value) => counter.format(value),
    shortDate: (iso) => calendarDate(iso, dayMonth),
    longDate: (iso) => calendarDate(iso, fullDate),
    weekday: (iso) => calendarDate(iso, dayName),
    timeOfDay,
    instantDate,
    /*
     * Deliberately coarse. This renders on the server and again in the browser, and a unit finer
     * than a minute would disagree between the two often enough to matter; past a day it stops
     * being relative at all, because "6d ago" is not how anybody thinks about when a drawing was
     * sent.
     */
    relativeTime: (iso) => {
      if (!iso) return '—';
      const parsed = new Date(iso);
      if (Number.isNaN(parsed.getTime())) return '—';

      const minutes = Math.floor((Date.now() - parsed.getTime()) / 60_000);
      if (minutes < 1) return 'just now';
      if (minutes < 60) return `${minutes}m ago`;
      const hours = Math.floor(minutes / 60);
      if (hours < 24) return `${hours}h ago`;
      return `${instantDate(iso)}, ${timeOfDay(iso)}`;
    },
    todayIso: () => todayIn(timezone),
  };
}

/**
 * The platform's own figures — subscription revenue, which is billed in rupees — and pages with
 * no company behind them. Never for a company's data: use `getFormat()` or `useFormat()`.
 */
export const indiaFormat: Format = createFormat(INDIA_FORMAT_LOCALE);

export function paise(value: string | null | undefined): bigint {
  if (!value) return 0n;
  try {
    return BigInt(value);
  } catch {
    return 0n;
  }
}

export function titleCase(value: string): string {
  return value.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
}

/** The Monday on or before `iso`, for defaulting a weekly wage period. */
export function weekStart(iso: string): string {
  const date = new Date(`${iso}T00:00:00Z`);
  const day = date.getUTCDay();
  const offset = day === 0 ? 6 : day - 1;
  date.setUTCDate(date.getUTCDate() - offset);
  return date.toISOString().slice(0, 10);
}

export function addDaysIso(iso: string, days: number): string {
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
