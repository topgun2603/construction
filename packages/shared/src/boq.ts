import { csvCell } from './cost-codes';
import { minorToDecimal, thousandthsToQuantity } from './money';
import { computeRaBill, lineAmount, roundedDivide, type RaBillFigures } from './subcontracts';

/**
 * Bill of quantities (roadmap Phase 2, module 5) — the client-side BOQ: what the builder bills the
 * client, item by item. Not a subcontract's schedule of rates, which is what a subcontractor bills
 * the builder; the two meet only in the margin.
 *
 * Everything here is pure and integer-only, so the API (which stores the figures) and the screens
 * (which show them live as quantities are typed or a sheet is mapped) cannot disagree. Money is minor
 * units, quantities are thousandths (`quantityToThousandths`), percentages are basis points.
 *
 * Every export is prefixed `boq` — other modules are being written beside this one, and a bare
 * `totals` or `Status` in the shared package is a collision waiting to happen.
 */

export const BOQ_BILL_STATUSES = ['draft', 'submitted', 'certified', 'invoiced'] as const;
export type BoqBillStatus = (typeof BOQ_BILL_STATUSES)[number];

export const BOQ_ITEM_KINDS = ['section', 'item'] as const;
export type BoqItemKind = (typeof BOQ_ITEM_KINDS)[number];

// --- reading numbers out of a sheet ---------------------------------------------------------------

/**
 * A number as a person typed it into a BOQ, scaled to `places` decimals: `"1,25,000.50"`, 2 →
 * `12500050n`. Thousands separators of either grouping, spaces and a currency sign or code at either
 * end are dropped. Extra decimals are rounded half up — a rate of 12.345 is 12.35, the way the sheet
 * would print it — because a spreadsheet's float can carry decimals nobody typed.
 *
 * Null when what is left is not a plain decimal.
 */
export function boqParseNumber(raw: string, places: number): bigint | null {
  const cleaned = raw
    .trim()
    .replace(/[\s,\u00a0\u202f']/g, '')
    // `₹`, `Rs.`, `AED`, `/-` — what people put around an amount in a sheet.
    .replace(/^[^\d.-]+/, '')
    .replace(/(\/-|[^\d.]+)$/, '');
  const match = /^(-?)(\d*)(?:\.(\d*))?$/.exec(cleaned);
  if (!match || (!match[2] && !match[3])) return null;
  const [, sign, whole = '', fraction = ''] = match;
  const scale = 10n ** BigInt(places);
  let value = BigInt(whole || '0') * scale;
  if (fraction.length <= places) {
    value += BigInt(fraction.padEnd(places, '0') || '0');
  } else {
    const kept = BigInt(fraction.slice(0, places) || '0');
    // Half up on the first dropped digit, which is what every spreadsheet does on display.
    value += kept + (Number(fraction[places]) >= 5 ? 1n : 0n);
  }
  return sign === '-' ? -value : value;
}

/**
 * A spreadsheet's numeric cell as decimal text, without float noise: `12.300000000000001` → `12.3`,
 * `1e-7` → `0.0000001`. Fifteen significant digits is all a double holds faithfully.
 */
export function boqNumberCellText(value: number): string {
  if (!Number.isFinite(value)) return '';
  const tidy = Number(value.toPrecision(15));
  const text = String(tidy);
  if (!/e/i.test(text)) return text;
  return tidy.toFixed(12).replace(/\.?0+$/, '');
}

// --- column mapping -------------------------------------------------------------------------------

export const BOQ_IMPORT_FIELDS = ['item_no', 'description', 'unit', 'quantity', 'rate', 'amount'] as const;
export type BoqImportField = (typeof BOQ_IMPORT_FIELDS)[number];

/** Which column (0-based) each field is read from. A field left out is not in the sheet. */
export type BoqColumnMapping = Partial<Record<BoqImportField, number>>;

export const BOQ_IMPORT_FIELD_LABELS: Readonly<Record<BoqImportField, string>> = Object.freeze({
  item_no: 'Item no.',
  description: 'Description',
  unit: 'Unit',
  quantity: 'Quantity',
  rate: 'Rate',
  amount: 'Amount',
});

/** Headings seen on real BOQs, normalised (lower case, letters and digits only, single spaces). */
const BOQ_HEADER_ALIASES: Readonly<Record<BoqImportField, readonly string[]>> = {
  item_no: ['item no', 'item number', 'item', 'item code', 'item ref', 'ref', 'ref no', 'boq ref', 'sl no', 's no', 'sr no', 'si no', 'no', 'code'],
  description: ['description', 'item description', 'description of work', 'description of item', 'particulars', 'details', 'work', 'scope'],
  unit: ['unit', 'units', 'uom', 'unit of measurement', 'unit of measure'],
  quantity: ['quantity', 'qty', 'contract qty', 'boq qty', 'contract quantity', 'est qty', 'estimated quantity'],
  rate: ['rate', 'unit rate', 'unit price', 'price', 'rate per unit'],
  amount: ['amount', 'total', 'value', 'total amount', 'contract amount'],
};

const normaliseHeading = (cell: string) =>
  cell
    .toLowerCase()
    .replace(/\(.*?\)/g, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();

/**
 * Guess the mapping from a header row. An exact heading wins over a heading that only starts with
 * an alias (`Rate in AED` is a rate), and no column is used twice.
 */
export function boqSuggestMapping(headers: readonly string[]): BoqColumnMapping {
  const mapping: BoqColumnMapping = {};
  const used = new Set<number>();
  const normalised = headers.map(normaliseHeading);
  for (const pass of ['exact', 'prefix'] as const) {
    for (const field of BOQ_IMPORT_FIELDS) {
      if (mapping[field] !== undefined) continue;
      const aliases = BOQ_HEADER_ALIASES[field];
      const at = normalised.findIndex(
        (heading, index) =>
          !used.has(index) &&
          heading !== '' &&
          aliases.some((alias) => (pass === 'exact' ? heading === alias : heading.startsWith(`${alias} `))),
      );
      if (at !== -1) {
        mapping[field] = at;
        used.add(at);
      }
    }
  }
  return mapping;
}

/**
 * The header row: the first of the top twenty that names a description and at least two other BOQ
 * columns. Real BOQs open with a project title and a contract number above the table. −1 when there
 * is none, and the columns are then read in the template's order.
 */
export function boqFindHeaderRow(grid: readonly (readonly string[])[]): number {
  for (let row = 0; row < Math.min(grid.length, 20); row += 1) {
    const mapping = boqSuggestMapping(grid[row] ?? []);
    if (mapping.description !== undefined && Object.keys(mapping).length >= 3) return row;
  }
  return -1;
}

/** The template's column order, which is also what `boqSheetRows` exports. */
export const BOQ_DEFAULT_MAPPING: Readonly<Required<BoqColumnMapping>> = Object.freeze({
  item_no: 0,
  description: 1,
  unit: 2,
  quantity: 3,
  rate: 4,
  amount: 5,
});

// --- parsing a sheet into items -------------------------------------------------------------------

/** One row as the import stores it. Quantities are thousandths and money minor units, as strings. */
export interface BoqImportRow {
  /** The row in the file, counted the way a person counts it (the first row is 1). */
  line: number;
  kind: BoqItemKind;
  item_no: string;
  parent_item_no: string | null;
  description: string;
  unit: string | null;
  quantity: string | null;
  rate: string | null;
  amount: string | null;
}

export interface BoqImportProblem {
  line: number;
  field: BoqImportField | null;
  message: string;
}

export interface BoqSheetResult {
  rows: BoqImportRow[];
  errors: BoqImportProblem[];
  /** Rows passed over on purpose — sub-totals, notes, a "carried to summary" line. */
  skipped: BoqImportProblem[];
  /** Sum of the items' amounts, minor units. */
  total: string;
}

/**
 * How far a sheet's amount may sit from quantity × rate and still be "the same", in minor units.
 *
 * A rate typed with more decimals than the currency has is rounded to the minor unit, so each unit of
 * quantity can carry up to half a minor unit of difference; plus one for the amount's own rounding.
 * Anything beyond that is a sheet whose amount and rate disagree, which is a question for whoever
 * priced it rather than something to pick a side on silently.
 */
export function boqAmountTolerance(quantityThousandths: bigint): bigint {
  const abs = quantityThousandths < 0n ? -quantityThousandths : quantityThousandths;
  return 1n + (abs + 1999n) / 2000n;
}

/**
 * The parent of an item number among the numbers already seen: `2.1.3` → `2.1`, else `2`. Separators
 * are `.`, `-`, `/` and spaces, so `B-12` sits under `B`. Null when no prefix is a known number.
 */
export function boqParentItemNo(itemNo: string, known: ReadonlySet<string>): string | null {
  const parts = itemNo.split(/[.\-/\s]+/).filter(Boolean);
  for (let length = parts.length - 1; length > 0; length -= 1) {
    const candidate = boqItemKey(parts.slice(0, length).join('.'));
    if (known.has(candidate)) return candidate;
  }
  return null;
}

/** The comparable form of an item number: `2.1`, `2-1` and ` 2 .1` are one item. */
export function boqItemKey(itemNo: string): string {
  return itemNo
    .trim()
    .toUpperCase()
    .split(/[.\-/\s]+/)
    .filter(Boolean)
    .join('.');
}

/**
 * A sheet (rows of cell text) → BOQ rows, with every problem found rather than the first.
 *
 * - A row with a quantity, rate or amount is an **item**: it needs a number, a description, a unit, a
 *   quantity above zero and a rate (worked out from the amount when only the amount is given), and its
 *   amount, when the sheet has one, must agree with quantity × rate within `boqAmountTolerance`.
 * - A row with a number and a description but no figures is a **section** heading.
 * - A row with neither a number nor figures — a note, a "Total carried forward" — is skipped and
 *   listed, so the preview shows what was left out rather than leaving it to be noticed later.
 *
 * Nesting comes from the numbers (`2.1.3` under `2.1` under `2`); an item whose number has no known
 * prefix goes under the last section above it, which is how a lettered BOQ ("Bill No. 2 — Concrete",
 * items 1, 2, 3) is laid out.
 */
export function boqParseSheet(
  grid: readonly (readonly string[])[],
  options: { mapping: BoqColumnMapping; headerRow: number; currencyDigits: number },
): BoqSheetResult {
  const { mapping, headerRow, currencyDigits } = options;
  const rows: BoqImportRow[] = [];
  const errors: BoqImportProblem[] = [];
  const skipped: BoqImportProblem[] = [];
  const seen = new Set<string>();
  let lastSection: string | null = null;
  let total = 0n;

  grid.forEach((record, index) => {
    if (index <= headerRow) return;
    const line = index + 1;
    const cell = (field: BoqImportField) => {
      const at = mapping[field];
      return at === undefined ? '' : String(record[at] ?? '').trim();
    };
    const itemNo = cell('item_no');
    const description = cell('description').replace(/\s+/g, ' ');
    const unit = cell('unit');
    const rawQty = cell('quantity');
    const rawRate = cell('rate');
    const rawAmount = cell('amount');
    if (!itemNo && !description && !unit && !rawQty && !rawRate && !rawAmount) return;

    const priced = rawQty !== '' || rawRate !== '';
    if (!itemNo) {
      skipped.push({
        line,
        field: 'item_no',
        message: description ? `"${description.slice(0, 60)}" has no item number` : 'no item number',
      });
      return;
    }
    const problem = (field: BoqImportField | null, message: string) =>
      errors.push({ line, field, message: `${itemNo}: ${message}` });

    if (itemNo.length > 30) return problem('item_no', 'the item number is longer than 30 characters');
    const key = boqItemKey(itemNo);
    if (!key) return problem('item_no', 'is not an item number');
    if (seen.has(key)) return problem('item_no', 'appears twice');
    if (!description) return problem('description', 'has no description');

    if (!priced && rawAmount === '') {
      seen.add(key);
      rows.push({
        line,
        kind: 'section',
        item_no: itemNo,
        parent_item_no: boqParentItemNo(itemNo, seen),
        description: description.slice(0, 1000),
        unit: null,
        quantity: null,
        rate: null,
        amount: null,
      });
      lastSection = key;
      return;
    }

    const before = errors.length;
    if (!unit) problem('unit', 'has no unit');
    else if (unit.length > 20) problem('unit', 'the unit is longer than 20 characters');
    const quantity = rawQty === '' ? null : boqParseNumber(rawQty, 3);
    if (rawQty === '') problem('quantity', 'has no quantity');
    else if (quantity === null) problem('quantity', `"${rawQty}" is not a quantity`);
    else if (quantity <= 0n) problem('quantity', 'the quantity must be more than zero');
    let rate = rawRate === '' ? null : boqParseNumber(rawRate, currencyDigits);
    const amount = rawAmount === '' ? null : boqParseNumber(rawAmount, currencyDigits);
    if (rawRate !== '' && rate === null) problem('rate', `"${rawRate}" is not a rate`);
    else if (rate !== null && rate < 0n) problem('rate', 'the rate cannot be negative');
    if (rawAmount !== '' && amount === null) problem('amount', `"${rawAmount}" is not an amount`);
    if (rawRate === '' && rawAmount === '') problem('rate', 'has no rate');
    if (errors.length > before || quantity === null || quantity <= 0n) return;

    // Only an amount: the rate is what makes the amount come out, to the minor unit.
    if (rate === null && amount !== null) rate = roundedDivide(amount * 1000n, quantity);
    if (rate === null || rate < 0n) return;
    const computed = lineAmount(quantity, rate);
    if (amount !== null && rawRate !== '') {
      const gap = amount > computed ? amount - computed : computed - amount;
      if (gap > boqAmountTolerance(quantity)) {
        return problem(
          'amount',
          `the amount ${minorToDecimal(amount, currencyDigits)} is not quantity × rate (${minorToDecimal(computed, currencyDigits)})`,
        );
      }
    }

    seen.add(key);
    rows.push({
      line,
      kind: 'item',
      item_no: itemNo,
      parent_item_no: boqParentItemNo(itemNo, seen) ?? lastSection,
      description: description.slice(0, 1000),
      unit,
      quantity: quantity.toString(),
      rate: rate.toString(),
      // Stored as quantity × rate, rounded once here; the sheet's own figure was only checked.
      amount: computed.toString(),
    });
    total += computed;
  });

  return { rows, errors, skipped, total: total.toString() };
}

// --- measurement ----------------------------------------------------------------------------------

/**
 * A measurement-book entry → a quantity in thousandths: the product of whichever of number, length,
 * breadth and height were given (each thousandths), rounded once at the end. A deduction (an opening
 * in a wall already measured whole) comes out negative.
 *
 * Null when nothing was given — a measurement of nothing is a mistake, not a zero.
 */
export function boqMeasuredQuantity(
  dims: { count?: bigint | null; length?: bigint | null; breadth?: bigint | null; height?: bigint | null },
  deduction = false,
): bigint | null {
  const factors = [dims.count, dims.length, dims.breadth, dims.height].filter(
    (value): value is bigint => value !== null && value !== undefined,
  );
  if (factors.length === 0) return null;
  const product = factors.reduce((acc, value) => acc * value, 1n);
  const quantity = factors.length === 1 ? product : roundedDivide(product, 1000n ** BigInt(factors.length - 1));
  return deduction ? -quantity : quantity;
}

export interface BoqProgress {
  /** Measured as a share of the contract quantity, in basis points; may exceed 10000. */
  percentBp: number;
  /** Measured beyond the contract quantity — work that needs a variation to be paid for. */
  over: boolean;
  /** How far beyond, thousandths. Zero when within. */
  excess: bigint;
}

export function boqProgress(contractQuantity: bigint, measuredQuantity: bigint): BoqProgress {
  const percentBp =
    contractQuantity > 0n ? Number(roundedDivide(measuredQuantity * 10_000n, contractQuantity)) : 0;
  const excess = measuredQuantity > contractQuantity ? measuredQuantity - contractQuantity : 0n;
  return { percentBp, over: excess > 0n, excess };
}

// --- one client bill ------------------------------------------------------------------------------

export interface BoqBillLineInput {
  id: string;
  /** Minor units per unit. */
  rate: bigint;
  contractQuantity: bigint;
  /** Certified to date on the previous certified bill, thousandths. Zero on the first. */
  previousQuantity: bigint;
  /** To date on this bill — claimed, or certified once it is. */
  quantityToDate: bigint;
  /** Measured to date in the measurement book. A claim cannot run ahead of it. */
  measuredQuantity?: bigint;
  /** What was claimed, when checking a certification: the client can cut a claim, not grow it. */
  claimedQuantity?: bigint;
}

export interface BoqBillInput {
  lines: readonly BoqBillLineInput[];
  /** The previous certified bill's cumulative figures; zeros for the first bill. */
  previous: { retentionToDate: bigint; advanceRecoveredToDate: bigint };
  /** Held back by the client from every bill, basis points. */
  retentionBp: number;
  /** The client's mobilisation advance is won back from each bill at this share of the work. */
  advanceRecoveryBp: number;
  /** Advance the client actually paid; recovery never exceeds it. */
  advanceAmount: bigint;
  /** GST or VAT charged to the client on top of the work. */
  taxRateBp: number;
}

export type BoqBillFigures = Omit<RaBillFigures, 'deductions'>;

/**
 * The figures of one running-account bill to the client.
 *
 * The same arithmetic as a subcontractor's RA bill — cumulative to date, this bill the increment —
 * pointed the other way, so it is the same function: one place where retention and advance recovery
 * are worked out, and one set of tests that proves it does not drift over a run of bills.
 *
 *   value to date      = Σ quantity to date × rate              (per item, rounded per item)
 *   this bill          = value to date − previous value to date
 *   retention          = retention % of the value to date, less what earlier bills held
 *   advance recovered  = recovery % of the value to date, capped at the advance, never handed back
 *   tax                = tax rate × this bill
 *   net receivable     = this bill + tax − retention − advance recovery
 */
export function boqComputeBill(input: BoqBillInput): BoqBillFigures {
  const { deductions: _none, ...figures } = computeRaBill({
    lines: input.lines,
    previous: input.previous,
    retentionBp: input.retentionBp,
    advanceRecoveryBp: input.advanceRecoveryBp,
    advancePaid: input.advanceAmount,
    taxRateBp: input.taxRateBp,
    deductions: 0n,
  });
  return figures;
}

export type BoqQuantityProblemKind = 'below_previous' | 'above_measured' | 'above_claimed';
export interface BoqQuantityProblem {
  itemId: string;
  problem: BoqQuantityProblemKind;
}

/**
 * What stops a bill's quantities, and what only needs pointing out.
 *
 * Errors: a quantity **below the previous certified bill** (work un-done is a correction, not a
 * bill); a claim **above what is measured** (the measurement book is the evidence a claim rests on);
 * a certified quantity **above the claim** (the client can cut a claim, not grow it).
 *
 * Warnings: **beyond the contract quantity**. A BOQ is a re-measurable contract — the quantities were
 * an estimate, and the work actually done is what is paid for — so it is billed, but flagged for the
 * variation it will need.
 */
export function boqQuantityProblems(lines: readonly BoqBillLineInput[]): {
  errors: BoqQuantityProblem[];
  overContract: string[];
} {
  const errors: BoqQuantityProblem[] = [];
  const overContract: string[] = [];
  for (const line of lines) {
    if (line.quantityToDate < line.previousQuantity) errors.push({ itemId: line.id, problem: 'below_previous' });
    if (line.measuredQuantity !== undefined && line.quantityToDate > line.measuredQuantity) {
      errors.push({ itemId: line.id, problem: 'above_measured' });
    }
    if (line.claimedQuantity !== undefined && line.quantityToDate > line.claimedQuantity) {
      errors.push({ itemId: line.id, problem: 'above_claimed' });
    }
    if (line.quantityToDate > line.contractQuantity) overContract.push(line.id);
  }
  return { errors, overContract };
}

/**
 * A certified bill as an instalment in the client's payment schedule: the work less what the client
 * keeps back, and the tax on top — which add up to the bill's net receivable. That is the one place a
 * BOQ bill becomes money owed, so the schedule, the receipts against it and the "outstanding" figure
 * the client sees all work exactly as they do for any other instalment.
 */
export function boqInvoiceSplit(figures: Pick<BoqBillFigures, 'gross' | 'retention' | 'advanceRecovery' | 'tax'>): {
  amount: bigint;
  taxAmount: bigint;
} {
  return { amount: figures.gross - figures.retention - figures.advanceRecovery, taxAmount: figures.tax };
}

// --- the abstract ---------------------------------------------------------------------------------

export interface BoqAbstractInput {
  id: string;
  parentId: string | null;
  kind: BoqItemKind;
  /** Contract amount, minor units; zero for a section. */
  amount: bigint;
  rate: bigint;
  /** Measured to date, thousandths. */
  measuredQuantity: bigint;
  /** Certified to date on the last certified bill, thousandths. */
  billedQuantity: bigint;
}

export interface BoqAbstractFigures {
  contract: bigint;
  measured: bigint;
  billed: bigint;
  /** Contract value not yet billed. Negative when billing has run past the contract. */
  balance: bigint;
  /** Measured value as a share of contract value, basis points. */
  percentBp: number;
}

/**
 * Contract, measured and billed value per item and rolled up through every section above it, plus
 * the whole BOQ under the key `''`. Values are worked per item (quantity × rate, rounded per item)
 * and summed, the same way a bill sums them, so a section's billed figure matches its bills.
 */
export function boqAbstract(items: readonly BoqAbstractInput[]): Map<string, BoqAbstractFigures> {
  const byId = new Map(items.map((item) => [item.id, item]));
  const sums = new Map<string, { contract: bigint; measured: bigint; billed: bigint }>();
  const add = (key: string, contract: bigint, measured: bigint, billed: bigint) => {
    const current = sums.get(key) ?? { contract: 0n, measured: 0n, billed: 0n };
    sums.set(key, {
      contract: current.contract + contract,
      measured: current.measured + measured,
      billed: current.billed + billed,
    });
  };
  for (const item of items) add(item.id, 0n, 0n, 0n);
  add('', 0n, 0n, 0n);
  for (const item of items) {
    if (item.kind !== 'item') continue;
    const measured = lineAmount(item.measuredQuantity, item.rate);
    const billed = lineAmount(item.billedQuantity, item.rate);
    // Up the tree, guarding against a cycle a bad edit could leave behind.
    const visited = new Set<string>();
    for (let at: BoqAbstractInput | undefined = item; at && !visited.has(at.id); at = at.parentId ? byId.get(at.parentId) : undefined) {
      visited.add(at.id);
      add(at.id, item.amount, measured, billed);
    }
    add('', item.amount, measured, billed);
  }
  const out = new Map<string, BoqAbstractFigures>();
  for (const [key, sum] of sums) {
    out.set(key, {
      ...sum,
      balance: sum.contract - sum.billed,
      percentBp: sum.contract > 0n ? Number(roundedDivide(sum.measured * 10_000n, sum.contract)) : 0,
    });
  }
  return out;
}

// --- cost codes -----------------------------------------------------------------------------------

const normaliseWords = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

/**
 * Suggest a cost code for each BOQ item: the code that **is** its item number, else the code whose
 * name **is** its description, else the longest code name its description **contains** as whole
 * words ("RCC M25 in columns" → "RCC"). An item nothing matches takes its section's code, the way a
 * QS would book it. Items already coded are left to the caller; this only proposes.
 */
export function boqAutoMapCostCodes(
  items: ReadonlyArray<{ id: string; parentId: string | null; itemNo: string; description: string }>,
  codes: ReadonlyArray<{ id: string; code: string; name: string }>,
): Map<string, string> {
  const byCode = new Map(codes.map((code) => [boqItemKey(code.code), code.id]));
  const byName = new Map(codes.map((code) => [normaliseWords(code.name), code.id]));
  const named = codes
    .map((code) => ({ id: code.id, words: normaliseWords(code.name) }))
    .filter((code) => code.words.length >= 3)
    .sort((a, b) => b.words.length - a.words.length);

  const direct = new Map<string, string>();
  for (const item of items) {
    const description = normaliseWords(item.description);
    const match =
      byCode.get(boqItemKey(item.itemNo)) ??
      byName.get(description) ??
      named.find((code) => ` ${description} `.includes(` ${code.words} `))?.id;
    if (match) direct.set(item.id, match);
  }

  const parents = new Map(items.map((item) => [item.id, item.parentId]));
  const out = new Map<string, string>();
  for (const item of items) {
    let found = direct.get(item.id);
    const visited = new Set<string>([item.id]);
    for (let up = parents.get(item.id) ?? null; !found && up && !visited.has(up); up = parents.get(up) ?? null) {
      visited.add(up);
      found = direct.get(up);
    }
    if (found) out.set(item.id, found);
  }
  return out;
}

// --- export ---------------------------------------------------------------------------------------

export interface BoqExportItem {
  depth: number;
  kind: BoqItemKind;
  item_no: string;
  description: string;
  unit: string | null;
  /** Decimal quantity strings, as the API sends them. */
  quantity: string | null;
  /** Minor-unit strings. */
  rate: string | null;
  amount: string;
  cost_code: string | null;
  measured_quantity: string | null;
  billed_quantity: string | null;
  measured_value: string;
  billed_value: string;
  percent_bp: number;
}

export const BOQ_EXPORT_HEADINGS = [
  'Item no.',
  'Description',
  'Unit',
  'Quantity',
  'Rate',
  'Amount',
  'Cost code',
  'Measured qty',
  'Billed qty',
  'Measured value',
  'Billed value',
  '% complete',
] as const;

/**
 * The BOQ as rows of text, headings first. The first six columns are the import template's, so an
 * exported BOQ can be edited and imported again. Amounts are plain decimals with no grouping, so a
 * spreadsheet reads them as numbers; a section's amount is its items' total.
 */
export function boqSheetRows(items: readonly BoqExportItem[], currencyDigits: number): string[][] {
  const money = (minor: string | null) => (minor === null ? '' : minorToDecimal(BigInt(minor), currencyDigits));
  return [
    [...BOQ_EXPORT_HEADINGS],
    ...items.map((item) => [
      item.item_no,
      item.description,
      item.unit ?? '',
      item.quantity ?? '',
      money(item.rate),
      item.kind === 'item' ? money(item.amount) : '',
      item.cost_code ?? '',
      item.measured_quantity ?? '',
      item.billed_quantity ?? '',
      money(item.measured_value),
      money(item.billed_value),
      (item.percent_bp / 100).toFixed(2),
    ]),
  ];
}

export function boqItemsCsv(items: readonly BoqExportItem[], currencyDigits: number): string {
  return boqSheetRows(items, currencyDigits).map((row) => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

export interface BoqAbstractCsvRow {
  item_no: string;
  description: string;
  depth: number;
  contract: string;
  measured: string;
  billed: string;
  balance: string;
  percent_bp: number;
}

/** The abstract — one row per section, then the total — as a sheet. */
export function boqAbstractCsv(
  rows: readonly BoqAbstractCsvRow[],
  total: Omit<BoqAbstractCsvRow, 'item_no' | 'description' | 'depth'>,
  currencyDigits: number,
): string {
  const money = (minor: string) => minorToDecimal(BigInt(minor), currencyDigits);
  const line = (row: Omit<BoqAbstractCsvRow, 'depth'>) => [
    row.item_no,
    row.description,
    money(row.contract),
    money(row.measured),
    money(row.billed),
    money(row.balance),
    (row.percent_bp / 100).toFixed(2),
  ];
  const table = [
    ['Item no.', 'Section', 'Contract value', 'Measured to date', 'Billed to date', 'Balance', '% complete'],
    ...rows.map(line),
    line({ item_no: '', description: 'Total', ...total }),
  ];
  return table.map((row) => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

/** Thousandths as the quantity text the API sends, or null. Re-exported under the module's prefix. */
export function boqQuantityText(thousandths: bigint | null): string | null {
  return thousandths === null ? null : thousandthsToQuantity(thousandths);
}
