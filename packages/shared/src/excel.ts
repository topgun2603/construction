import { addDays, todayIn } from './dates';
import { parseIndianDate } from './indian-date';
import { decimalToMinor } from './money';
import { toE164 } from './phone';

/**
 * Excel export and import (roadmap Phase 3, item 4): the pure half.
 *
 * Everything here is free of exceljs and of the database, so the rules that decide what a cell
 * becomes — a header matched to a field, "1,25,000.50" read as money, 25/09/2026 read as a date —
 * are tested once, here, and used the same way by the API that reads the file and the web screen
 * that shows the mapping.
 */

// --- limits ---------------------------------------------------------------------------------------

/**
 * Rows in one export. Past this the answer is a narrower filter: the cap keeps one click from
 * holding a connection and a few hundred megabytes of workbook in memory for minutes. The same
 * figure the audit log's CSV export already used.
 */
export const EXCEL_EXPORT_MAX_ROWS = 50_000;

/**
 * The largest file an import takes. It travels as base64 (a third bigger) in a JSON body, which is
 * why the API reads the import route with its own, larger body limit — see `app-setup.ts`.
 */
export const IMPORT_MAX_BYTES = 5 * 1024 * 1024;

/** Rows in one import. A company's whole crew or catalogue fits; a database dump does not. */
export const IMPORT_MAX_ROWS = 5_000;

/** Columns read from a sheet. A real register has a few dozen; more is something else. */
export const IMPORT_MAX_COLUMNS = 80;

// --- export columns ---------------------------------------------------------------------------------

/**
 * What a column holds, which decides the cell type and number format in the workbook — so a sum
 * in Excel works on money, a filter on dates sorts by date, and nothing has to be retyped.
 */
export const EXCEL_CELL_TYPES = [
  'text',
  /** Whole numbers: counts, days, a year. */
  'integer',
  /** Decimals as they are, for quantities, hours and litres. */
  'number',
  /** Integer minor units on the way in; a number in major units with the currency's format out. */
  'money',
  /** 0–100 on the way in; a real percentage (0.125 shown as 12.5%) out. */
  'percent',
  /** A `YYYY-MM-DD` calendar date. */
  'date',
  /** An instant, shown on the company's clock. */
  'datetime',
  'boolean',
] as const;
export type ExcelCellType = (typeof EXCEL_CELL_TYPES)[number];

/** A column of an export, without the code that reads a row — the part the web and tests share. */
export interface ExcelColumnSpec {
  key: string;
  header: string;
  type: ExcelCellType;
  /** Characters; a sensible width is worked out from the header and type when left out. */
  width?: number;
}

/** A width that shows the header and a typical value without the reader dragging columns. */
export function excelColumnWidth(column: ExcelColumnSpec): number {
  if (column.width) return column.width;
  const byType: Record<ExcelCellType, number> = {
    text: 18,
    integer: 10,
    number: 12,
    money: 16,
    percent: 10,
    date: 12,
    datetime: 18,
    boolean: 8,
  };
  return Math.min(60, Math.max(byType[column.type], column.header.length + 2));
}

/**
 * The number format for money in `currency`: grouped, the currency's own number of decimals, the
 * code beside it so a sheet with two currencies in it cannot be misread. `[$AED]` is Excel's
 * literal-text token, which every spreadsheet reads.
 */
export function excelMoneyFormat(currency: string, digits: number): string {
  const decimals = digits > 0 ? `.${'0'.repeat(digits)}` : '';
  const body = `#,##0${decimals}`;
  return `[$${currency}] ${body};-[$${currency}] ${body}`;
}

/**
 * Minor units → the number a cell holds. A double is exact for any amount a construction company
 * will ever see (up to 2^53 minor units); the format restores the decimals.
 */
export function excelMoneyValue(minor: bigint | string | number | null | undefined, digits: number): number | null {
  if (minor === null || minor === undefined || minor === '') return null;
  const value = typeof minor === 'bigint' ? minor : BigInt(minor);
  const scale = 10n ** BigInt(digits);
  const whole = value / scale;
  const fraction = value % scale;
  return Number(whole) + Number(fraction) / Number(scale);
}

/**
 * An instant as the wall-clock time it was in `timeZone`, encoded as a UTC `Date`.
 *
 * A spreadsheet has no time zones: a cell is "6 October 2026 09:30" with nothing after it. exceljs
 * writes a `Date` by its UTC fields, so to make the cell read what the company's clock read, the
 * UTC fields have to *be* the company's clock — 04:00Z in Dubai becomes a Date whose UTC hour is 8.
 */
export function excelWallClock(instant: Date | string, timeZone: string): Date {
  const date = typeof instant === 'string' ? new Date(instant) : instant;
  const parts = wallClockFormatter(timeZone).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  // `hour: '2-digit'` with `hourCycle: 'h23'` still says 24 at midnight in some ICU builds.
  const hour = part('hour') % 24;
  return new Date(
    Date.UTC(part('year'), part('month') - 1, part('day'), hour, part('minute'), part('second'), date.getUTCMilliseconds()),
  );
}

const wallClockFormatters = new Map<string, Intl.DateTimeFormat>();
function wallClockFormatter(timeZone: string): Intl.DateTimeFormat {
  let formatter = wallClockFormatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
      calendar: 'gregory',
      numberingSystem: 'latn',
    });
    wallClockFormatters.set(timeZone, formatter);
  }
  return formatter;
}

/** `2026-10-06` → the UTC-midnight Date exceljs writes as that calendar day, with no time. */
export function excelDateValue(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  const date = new Date(`${iso.slice(0, 10)}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** A worksheet name Excel accepts: 31 characters, none of `[]:*?/\`. */
export function excelSheetName(name: string): string {
  const cleaned = name.replace(/[[\]:*?/\\]/g, ' ').replace(/\s+/g, ' ').trim();
  return (cleaned || 'Sheet').slice(0, 31);
}

/** A file name safe in a Content-Disposition header and on every operating system. */
export function excelFileName(base: string, extension: 'xlsx' | 'csv', today: string): string {
  const slug = base
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return `${slug || 'export'}-${today}.${extension}`;
}

// --- header matching ----------------------------------------------------------------------------------

/**
 * A header as compared: case, spacing, punctuation, a required-field star and anything in brackets
 * (`Daily wage (₹)`) dropped. NFKC first, so full-width and compatibility forms compare equal; Tamil
 * and Arabic letters are kept as they are.
 */
export function excelNormaliseHeader(text: string): string {
  return text
    .normalize('NFKC')
    .replace(/^\uFEFF/, '')
    .replace(/\([^)]*\)|\[[^\]]*\]/g, '')
    .toLowerCase()
    .replace(/[\s_\-./\\:*#'"’`,;|?!]+/g, '')
    .trim();
}

/** A field an import reads, as the column mapping and template see it. */
export interface ImportFieldSpec {
  key: string;
  /** The template's header, and the label in the mapping screen. */
  label: string;
  type: 'text' | 'money' | 'date' | 'phone' | 'enum' | 'integer' | 'decimal' | 'boolean' | 'email' | 'reference';
  required?: boolean;
  /** For an enum: the stored values, offered as a dropdown in the template. */
  options?: readonly string[];
  /** Other headers that mean this field — including the Tamil and Arabic a crew's sheet may use. */
  aliases?: readonly string[];
  /** What the template's example row holds. */
  example?: string;
  /** One line for the instructions sheet. */
  help?: string;
}

/**
 * Which column each field is in, guessed from a header row: the field's key, label or an alias,
 * compared normalised. Each column is used once, by the first field that claims it, so `Phone` and
 * `Phone 2` cannot both land on one field. Fields with no match are left out of the result.
 */
export function importMatchColumns(headers: readonly string[], fields: readonly ImportFieldSpec[]): Record<string, number> {
  const normalised = headers.map((header) => excelNormaliseHeader(header ?? ''));
  const taken = new Set<number>();
  const mapping: Record<string, number> = {};
  for (const field of fields) {
    const names = new Set(
      [field.key, field.label, ...(field.aliases ?? [])].map(excelNormaliseHeader).filter((name) => name !== ''),
    );
    const at = normalised.findIndex((header, index) => !taken.has(index) && header !== '' && names.has(header));
    if (at !== -1) {
      mapping[field.key] = at;
      taken.add(at);
    }
  }
  return mapping;
}

/**
 * The row holding the headers: of the first ten, the one that names the most fields. A title row or
 * two above the table ("Workers — Harbour Point") is common in a sheet someone made by hand.
 * −1 when no row names any field, and the caller maps columns by hand.
 */
export function importFindHeaderRow(rows: readonly (readonly string[])[], fields: readonly ImportFieldSpec[]): number {
  let best = -1;
  let bestCount = 0;
  rows.slice(0, 10).forEach((row, index) => {
    const count = Object.keys(importMatchColumns(row, fields)).length;
    if (count > bestCount) {
      best = index;
      bestCount = count;
    }
  });
  return best;
}

// --- reading cells ------------------------------------------------------------------------------------

/** A cell as the reader hands it over: text from a CSV, a typed value from a workbook. */
export type ImportCell = string | number | boolean | Date | null | undefined;

export type ImportCoerced<T> = { ok: true; value: T | null } | { ok: false; error: string };

const ok = <T>(value: T | null): ImportCoerced<T> => ({ ok: true, value });
const fail = (error: string): ImportCoerced<never> => ({ ok: false, error });

/** Arabic-Indic and Eastern Arabic-Indic digits, and the Arabic separators, as ASCII. */
function westernDigits(text: string): string {
  return text
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/٫/g, '.')
    .replace(/٬/g, ',');
}

/** A number the way a person reads it: no float noise (0.1 + 0.2), no exponent. */
function numberText(value: number): string {
  if (Number.isInteger(value)) return value.toFixed(0);
  return String(Number.parseFloat(value.toPrecision(15)));
}

/** True when nothing is in the cell. */
export function importIsBlank(cell: ImportCell): boolean {
  return cell === null || cell === undefined || (typeof cell === 'string' && cell.trim() === '');
}

export function importCoerceText(cell: ImportCell, max = 500): ImportCoerced<string> {
  if (importIsBlank(cell)) return ok(null);
  let text: string;
  if (cell instanceof Date) text = cell.toISOString().slice(0, 10);
  else if (typeof cell === 'number') text = numberText(cell);
  else if (typeof cell === 'boolean') text = cell ? 'Yes' : 'No';
  else text = String(cell).trim();
  if (text.length > max) return fail(`is longer than ${max} characters`);
  return ok(text);
}

/**
 * Money in major units as people type it → integer minor units as a string. Takes `1,25,000.50`
 * (Indian grouping), `1,250,000.50`, `₹ 1,250`, `AED 1,250.00`, Arabic-Indic digits, and a number
 * cell. Refuses more decimals than the currency has rather than rounding someone's money.
 */
export function importCoerceMoney(cell: ImportCell, digits: number): ImportCoerced<string> {
  if (importIsBlank(cell)) return ok(null);
  let text: string;
  if (typeof cell === 'number') {
    if (!Number.isFinite(cell)) return fail('is not an amount');
    text = numberText(cell);
  } else if (typeof cell === 'string') {
    text = westernDigits(cell)
      .trim()
      // A currency code or symbol either side, and the grouping, are how it was typed, not its value.
      // Only a code or symbol: "about 500" is a note, not an amount.
      .replace(/^(?:[A-Za-z]{2,3}\.?|\p{Sc})\s*/u, '')
      .replace(/\s*(?:[A-Za-z]{2,3}|\p{Sc})$/u, '')
      .replace(/[,\s\u00A0\u202F']/g, '');
    // (1,250.00) is how an accountant writes a negative amount.
    const bracketed = /^\((.*)\)$/.exec(text);
    if (bracketed) text = `-${bracketed[1]}`;
  } else {
    return fail('is not an amount');
  }
  const minor = decimalToMinor(text, digits);
  if (minor === null) {
    return fail(digits === 0 ? 'is not a whole amount' : `is not an amount with at most ${digits} decimals`);
  }
  return ok(minor.toString());
}

/** A whole number. */
export function importCoerceInteger(cell: ImportCell): ImportCoerced<number> {
  if (importIsBlank(cell)) return ok(null);
  const text = typeof cell === 'number' ? numberText(cell) : typeof cell === 'string' ? westernDigits(cell).trim().replace(/,/g, '') : '';
  if (!/^-?\d{1,15}$/.test(text)) return fail('is not a whole number');
  return ok(Number(text));
}

/** A decimal with at most `places` decimals, as the string the create endpoints take. */
export function importCoerceDecimal(cell: ImportCell, places: number): ImportCoerced<string> {
  if (importIsBlank(cell)) return ok(null);
  const text =
    typeof cell === 'number' ? numberText(cell) : typeof cell === 'string' ? westernDigits(cell).trim().replace(/,/g, '') : '';
  const match = /^(\d+)(?:\.(\d+))?$/.exec(text);
  if (!match) return fail('is not a number');
  const fraction = (match[2] ?? '').replace(/0+$/, '');
  if (fraction.length > places) {
    return fail(places === 0 ? 'is not a whole number' : `has more than ${places} decimal${places === 1 ? '' : 's'}`);
  }
  return ok(fraction ? `${match[1]}.${fraction}` : match[1]!);
}

/** First and last date a spreadsheet serial can be: 1900-01-01 to 9999-12-31. */
const EXCEL_EPOCH_MS = Date.UTC(1899, 11, 30);

/**
 * A calendar date. A date cell is that day — a spreadsheet date has no time zone, and exceljs hands
 * it over as UTC midnight of the day shown. Text is read day first (`05/06/2026` is 5 June, as on
 * every sheet in the countries this product serves), and `today` / `yesterday` mean the company's
 * today, in its own time zone.
 */
export function importCoerceDate(cell: ImportCell, timeZone: string, now: Date = new Date()): ImportCoerced<string> {
  if (importIsBlank(cell)) return ok(null);
  if (cell instanceof Date) {
    if (Number.isNaN(cell.getTime())) return fail('is not a date');
    return ok(cell.toISOString().slice(0, 10));
  }
  if (typeof cell === 'number') {
    // A serial number: a date cell that lost its format on the way through another program.
    if (!Number.isFinite(cell) || cell < 1 || cell > 2_958_465) return fail('is not a date');
    return ok(new Date(EXCEL_EPOCH_MS + Math.floor(cell) * 86_400_000).toISOString().slice(0, 10));
  }
  if (typeof cell !== 'string') return fail('is not a date');
  const text = westernDigits(cell).trim();
  const lower = text.toLowerCase();
  if (lower === 'today') return ok(todayIn(timeZone, now));
  if (lower === 'yesterday') return ok(addDays(todayIn(timeZone, now), -1));
  // `2026-10-06T00:00:00` from a system export: the date part is the date.
  const stamped = /^(\d{4}-\d{2}-\d{2})[T ]/.exec(text);
  const parsed = parseIndianDate(stamped ? stamped[1]! : text);
  return parsed ? ok(parsed) : fail('is not a date — use DD/MM/YYYY or YYYY-MM-DD');
}

/**
 * A mobile number, read in the company's country when it has no country code — a UAE crew's
 * `050 123 4567` is a UAE number. A number cell (Excel drops the leading zero and the `+`) is read
 * as its digits. Returns the stored form, E.164 without the plus.
 */
export function importCoercePhone(cell: ImportCell, country: string): ImportCoerced<string> {
  if (importIsBlank(cell)) return ok(null);
  const raw = typeof cell === 'number' ? numberText(cell) : typeof cell === 'string' ? westernDigits(cell) : '';
  const stored = toE164(raw, country);
  if (stored === null) return fail('is not a mobile number — include the country code if it is from another country');
  return ok(stored);
}

export function importCoerceEmail(cell: ImportCell): ImportCoerced<string> {
  const text = importCoerceText(cell, 200);
  if (!text.ok || text.value === null) return text;
  const email = text.value.toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? ok(email) : fail('is not an email address');
}

const YES = new Set(['yes', 'y', 'true', '1', 'x', '✓', 'ஆம்', 'نعم']);
const NO = new Set(['no', 'n', 'false', '0', 'இல்லை', 'لا']);

export function importCoerceBoolean(cell: ImportCell): ImportCoerced<boolean> {
  if (importIsBlank(cell)) return ok(null);
  if (typeof cell === 'boolean') return ok(cell);
  if (typeof cell === 'number') return cell === 1 ? ok(true) : cell === 0 ? ok(false) : fail('is not yes or no');
  const text = String(cell).trim().toLowerCase();
  if (YES.has(text)) return ok(true);
  if (NO.has(text)) return ok(false);
  return fail('is not yes or no');
}

/**
 * One of a fixed list. Matched on the stored value or how it reads (`Semi skilled`, `semi-skilled`
 * and `semi` are all `semi`), compared normalised; extra spellings can be given per option.
 */
export function importCoerceEnum(
  cell: ImportCell,
  options: readonly string[],
  aliases: Readonly<Record<string, readonly string[]>> = {},
): ImportCoerced<string> {
  if (importIsBlank(cell)) return ok(null);
  const wanted = excelNormaliseHeader(String(cell));
  for (const option of options) {
    const names = [option, option.replace(/_/g, ' '), ...(aliases[option] ?? [])].map(excelNormaliseHeader);
    if (names.includes(wanted)) return ok(option);
  }
  return fail(`must be one of: ${options.map((option) => option.replace(/_/g, ' ')).join(', ')}`);
}

/** The template's dropdown text for an enum value: what a person picks, read back by `importCoerceEnum`. */
export function importOptionLabel(option: string): string {
  const spaced = option.replace(/_/g, ' ');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}
