/**
 * Reading a date off an Indian bill.
 *
 * This exists because a model asked for "the date in YYYY-MM-DD" quietly got it wrong: an invoice
 * printed 25/09/2026 came back as 2026-08-25. The amount was right, the vendor was right, and the
 * expense would have landed in the wrong month's spend with nothing to show that it had.
 *
 * The fix is the same one the amount already uses: the model transcribes what is printed, and the
 * interpretation happens here, in code that can be tested. A machine reading `25/09/2026` cannot
 * put it in August.
 *
 * Day first, always. `05/06/2026` is the fifth of June on every bill printed in India, and the one
 * place a parser must not be clever is the ambiguous case.
 */

const MONTHS: Record<string, number> = {
  jan: 1, january: 1,
  feb: 2, february: 2,
  mar: 3, march: 3,
  apr: 4, april: 4,
  may: 5,
  jun: 6, june: 6,
  jul: 7, july: 7,
  aug: 8, august: 8,
  sep: 9, sept: 9, september: 9,
  oct: 10, october: 10,
  nov: 11, november: 11,
  dec: 12, december: 12,
};

/** Two-digit years are this century: a bill from 1998 is not being entered into this system. */
function fullYear(raw: string): number {
  const year = Number(raw);
  if (raw.length === 4) return year;
  return 2000 + year;
}

function iso(year: number, month: number, day: number): string | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  // Round-tripped through Date so 31 April and 29 February in a common year are refused rather
  // than rolling silently into the next month.
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return date.toISOString().slice(0, 10);
}

/**
 * A date as printed on a bill, as an ISO date — or null when it cannot be read with confidence.
 *
 * Null is a useful answer. The form says which fields it could not read and somebody fills them in;
 * a wrong date that looks right is the outcome worth avoiding.
 */
export function parseIndianDate(printed: string): string | null {
  const text = printed
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    // Spaces around a separator are the printer's spacing, not part of the date: "25 / 09 / 2026"
    // and "25/09/2026" are the same bill.
    .replace(/\s*([/\-.])\s*/g, '$1');
  if (text === '') return null;

  // Already ISO, which is what a well-behaved system prints.
  const isoMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (isoMatch) return iso(Number(isoMatch[1]), Number(isoMatch[2]), Number(isoMatch[3]));

  // 25/09/2026, 25-9-26, 25.09.2026 — the common case, day first.
  const numeric = /^(\d{1,2})[/\-. ](\d{1,2})[/\-. ](\d{2}|\d{4})$/.exec(text);
  if (numeric) {
    return iso(fullYear(numeric[3] ?? ''), Number(numeric[2]), Number(numeric[1]));
  }

  // 25 Sep 2026, 25 September 2026, 25-Sep-2026
  const dayFirst = /^(\d{1,2})[ \-/]?([a-z]+)[ \-/]?(\d{2}|\d{4})$/.exec(text);
  if (dayFirst) {
    const month = MONTHS[dayFirst[2] ?? ''];
    if (month) return iso(fullYear(dayFirst[3] ?? ''), month, Number(dayFirst[1]));
  }

  // Sep 25, 2026 — an American ordering that turns up on software-generated invoices.
  const monthFirst = /^([a-z]+)[ \-/]?(\d{1,2}),? ?(\d{2}|\d{4})$/.exec(text);
  if (monthFirst) {
    const month = MONTHS[monthFirst[1] ?? ''];
    if (month) return iso(fullYear(monthFirst[3] ?? ''), month, Number(monthFirst[2]));
  }

  return null;
}

/**
 * The same, refusing a date that cannot be a bill's.
 *
 * A bill dated next year is a misread, not a prediction, and one dated five years ago is not what
 * somebody is entering into this month's expenses. Both become null rather than an entry that
 * lands in a closed period.
 */
export function parseBillDate(printed: string, today: Date): string | null {
  const parsed = parseIndianDate(printed);
  if (!parsed) return null;

  const when = new Date(`${parsed}T00:00:00Z`).getTime();
  const now = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());

  // A day ahead, for a bill raised in a timezone that is already tomorrow.
  if (when > now + 86_400_000) return null;
  if (when < now - 3 * 365 * 86_400_000) return null;
  return parsed;
}
