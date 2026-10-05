import { decimalToMinor, minorToDecimal } from './money';

/**
 * Cost codes and budgets (roadmap Phase 2, module 1).
 *
 * A cost code is a line of the work breakdown structure — `03.20 Footings & foundations` — and the
 * thing every later module posts against: an expense now, a purchase order or a subcontract later.
 * Budgets live on the codes; the report rolls them up the tree beside what has been committed, what
 * has been spent and what the line is now expected to cost.
 *
 * Everything here is pure so the web (CSV preview, export) and the API (import, report) cannot
 * disagree about what a file means or how a parent's figure is made. Money is integer minor units.
 */

/** `03.20`, `EW-01`, `A1.2.3`: letters and digits in segments joined by `.` or `-`. */
export const COST_CODE_PATTERN = /^[A-Za-z0-9]+(?:[.-][A-Za-z0-9]+)*$/;

/**
 * Order codes the way a person reads a WBS: `2` before `10`, `03.2` before `03.10`.
 *
 * Plain string order puts `10` before `2` and `03.10` before `03.2`, which turns a tree that was
 * typed in order into one that reads shuffled.
 */
export function compareCostCodes(a: string, b: string): number {
  const left = a.split(/[.-]/);
  const right = b.split(/[.-]/);
  for (let i = 0; i < Math.max(left.length, right.length); i += 1) {
    const x = left[i];
    const y = right[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    if (/^\d+$/.test(x) && /^\d+$/.test(y)) {
      const diff = Number(x) - Number(y);
      if (diff !== 0) return diff;
      continue;
    }
    const diff = x.localeCompare(y, 'en', { sensitivity: 'base' });
    if (diff !== 0) return diff;
  }
  return 0;
}

/**
 * An em space, for indenting a code by its depth inside a plain-text picker (a `<select>` option
 * cannot hold padding). Built from its code point so no invisible character sits in the source.
 */
export const COST_CODE_INDENT = String.fromCharCode(0x2003);

/**
 * The parent a code implies by its shape: `03.20` → `03`, `A1-2-3` → `A1-2`. Null at the top.
 * Used only when nobody named a parent, and only when that code actually exists.
 */
export function impliedParentCode(code: string): string | null {
  const cut = Math.max(code.lastIndexOf('.'), code.lastIndexOf('-'));
  return cut > 0 ? code.slice(0, cut) : null;
}

// --- the default template ---------------------------------------------------------------------

export interface CostCodeTemplateLine {
  code: string;
  name: string;
  parent_code: string | null;
  unit: string | null;
}

/** The built-in template's id. Not a uuid, so it can never collide with a company's own. */
export const STANDARD_TEMPLATE_ID = 'standard';
export const STANDARD_TEMPLATE_NAME = 'Standard building WBS';

const line = (code: string, name: string, unit: string | null = null): CostCodeTemplateLine => ({
  code,
  name,
  parent_code: impliedParentCode(code),
  unit,
});

/**
 * A building contractor's WBS that works for a villa or a mid-rise block without editing.
 *
 * Two levels, deliberately: a third level reads well in a bill of quantities and then nobody can
 * pick the right line from a phone while holding a diesel bill. A company that wants more depth
 * copies this into its own library and adds it.
 */
export const STANDARD_WBS: readonly CostCodeTemplateLine[] = Object.freeze([
  line('01', 'Preliminaries & general'),
  line('01.10', 'Site establishment & mobilisation'),
  line('01.20', 'Site staff & supervision'),
  line('01.30', 'Temporary works, power & water'),
  line('01.40', 'Insurance, permits & fees'),
  line('01.50', 'Plant & equipment hire'),
  line('02', 'Earthworks'),
  line('02.10', 'Site clearance'),
  line('02.20', 'Excavation', 'm3'),
  line('02.30', 'Backfilling & compaction', 'm3'),
  line('02.40', 'Dewatering'),
  line('02.50', 'Anti-termite treatment', 'm2'),
  line('03', 'Substructure'),
  line('03.10', 'PCC & blinding', 'm3'),
  line('03.20', 'Footings & foundations', 'm3'),
  line('03.30', 'Plinth & grade beams', 'm3'),
  line('03.40', 'Below-ground waterproofing', 'm2'),
  line('04', 'Concrete & RCC frame'),
  line('04.10', 'Columns', 'm3'),
  line('04.20', 'Beams & slabs', 'm3'),
  line('04.30', 'Staircases', 'm3'),
  line('04.40', 'Reinforcement steel', 'kg'),
  line('04.50', 'Formwork & shuttering', 'm2'),
  line('05', 'Masonry'),
  line('05.10', 'External walls', 'm2'),
  line('05.20', 'Internal partitions', 'm2'),
  line('05.30', 'Lintels, sills & copings', 'm'),
  line('06', 'Roofing & waterproofing'),
  line('06.10', 'Roof waterproofing', 'm2'),
  line('06.20', 'Roof insulation & screed', 'm2'),
  line('07', 'Doors & windows'),
  line('07.10', 'Doors & frames', 'nos'),
  line('07.20', 'Windows & glazing', 'm2'),
  line('07.30', 'Ironmongery'),
  line('08', 'Finishes'),
  line('08.10', 'Plastering', 'm2'),
  line('08.20', 'Flooring & floor tiling', 'm2'),
  line('08.30', 'Wall tiling & cladding', 'm2'),
  line('08.40', 'Painting', 'm2'),
  line('08.50', 'False ceilings', 'm2'),
  line('08.60', 'Joinery & fit-out'),
  line('09', 'MEP services'),
  line('09.10', 'Electrical'),
  line('09.20', 'Plumbing & drainage'),
  line('09.30', 'HVAC'),
  line('09.40', 'Fire fighting & alarm'),
  line('09.50', 'Lifts'),
  line('09.60', 'Low current & ELV'),
  line('10', 'External works'),
  line('10.10', 'Compound wall & gates', 'm'),
  line('10.20', 'Paving & driveways', 'm2'),
  line('10.30', 'Landscaping'),
  line('10.40', 'External drainage & connections'),
  line('10.50', 'External lighting'),
  line('11', 'Contingency'),
]);

// --- figures and the roll-up ------------------------------------------------------------------

export interface CostFigures {
  budget: bigint;
  /** Open purchase orders and subcontracts not yet billed. */
  committed: bigint;
  /** Spent: expenses and labour booked to the line. */
  actual: bigint;
  /** Expected cost at completion. */
  forecast: bigint;
}

export const ZERO_FIGURES: Readonly<CostFigures> = Object.freeze({
  budget: 0n,
  committed: 0n,
  actual: 0n,
  forecast: 0n,
});

/**
 * What one line is now expected to cost, from its own figures.
 *
 * The largest of three things, each a floor the final cost cannot come in under:
 * - the budget — a line nobody has started still costs what it was priced at; reporting it as
 *   free because nothing is spent yet would show every untouched line as a saving;
 * - actual plus committed — money spent, and money promised on an order that is still open;
 * - the projection — the site forecast's own arithmetic run on this line's spend
 *   (`forecastSite`), so a line burning faster than the job is progressing is caught early.
 *
 * Deliberately never below the budget: a cost report that forecasts an underspend on a line that
 * is half done is a promise, not a forecast. Savings show up when somebody closes a line.
 */
export function costCodeForecast(input: {
  budget: bigint;
  committed: bigint;
  actual: bigint;
  projected: bigint | null;
}): bigint {
  const exposure = input.actual + input.committed;
  let forecast = input.budget > exposure ? input.budget : exposure;
  if (input.projected !== null && input.projected > forecast) forecast = input.projected;
  return forecast;
}

export interface RollupNode {
  id: string;
  parentId: string | null;
  own: CostFigures;
}

/**
 * Each line's own figures plus everything beneath it.
 *
 * A parent may carry a budget of its own as well as its children's — "Finishes" priced as a lump
 * before anybody broke it down — so a total is own + descendants, never only the children. A
 * parent missing from the list is treated as a root rather than losing the branch.
 */
export function rollUpCostCodes(nodes: readonly RollupNode[]): Map<string, CostFigures> {
  const ids = new Set(nodes.map((node) => node.id));
  const children = new Map<string | null, RollupNode[]>();
  for (const node of nodes) {
    const parent = node.parentId && ids.has(node.parentId) ? node.parentId : null;
    children.set(parent, [...(children.get(parent) ?? []), node]);
  }

  const totals = new Map<string, CostFigures>();
  const visiting = new Set<string>();
  const total = (node: RollupNode): CostFigures => {
    const done = totals.get(node.id);
    if (done) return done;
    // A cycle cannot be stored (the API refuses one), but a report must not hang if it were.
    if (visiting.has(node.id)) return { ...node.own };
    visiting.add(node.id);
    const sum = { ...node.own };
    for (const child of children.get(node.id) ?? []) {
      const figures = total(child);
      sum.budget += figures.budget;
      sum.committed += figures.committed;
      sum.actual += figures.actual;
      sum.forecast += figures.forecast;
    }
    visiting.delete(node.id);
    totals.set(node.id, sum);
    return sum;
  };
  for (const node of nodes) total(node);
  return totals;
}

/**
 * Lines in reading order — each parent followed by its children, codes in WBS order — with depth.
 */
export function orderCostCodeTree<T extends { id: string; parentId: string | null; code: string }>(
  nodes: readonly T[],
): Array<T & { depth: number }> {
  const ids = new Set(nodes.map((node) => node.id));
  const children = new Map<string | null, T[]>();
  for (const node of nodes) {
    const parent = node.parentId && ids.has(node.parentId) ? node.parentId : null;
    children.set(parent, [...(children.get(parent) ?? []), node]);
  }
  const out: Array<T & { depth: number }> = [];
  const seen = new Set<string>();
  const walk = (parent: string | null, depth: number) => {
    const level = [...(children.get(parent) ?? [])].sort((a, b) => compareCostCodes(a.code, b.code));
    for (const node of level) {
      if (seen.has(node.id)) continue;
      seen.add(node.id);
      out.push({ ...node, depth });
      walk(node.id, depth + 1);
    }
  };
  walk(null, 0);
  return out;
}

// --- CSV --------------------------------------------------------------------------------------

/** One row of a cost code import, as the API takes it. `budget` is minor units. */
export interface CostCodeImportRow {
  code: string;
  name: string;
  parent_code: string | null;
  unit: string | null;
  budget: string | null;
}

export interface CostCodeCsvResult {
  rows: CostCodeImportRow[];
  /** One per rejected line, with its line number in the file as a person would count it. */
  errors: Array<{ line: number; message: string }>;
}

/** The byte-order mark Excel puts at the start of a UTF-8 CSV, and expects to find on one. */
const BOM = 0xfeff;
export const CSV_BOM = String.fromCharCode(BOM);

/**
 * Split CSV text into records. Handles quoted fields, doubled quotes, CRLF and a leading BOM —
 * which is everything Excel's "Save as CSV" produces.
 */
export function parseCsv(text: string): string[][] {
  const source = text.charCodeAt(0) === BOM ? text.slice(1) : text;
  const records: string[][] = [];
  let record: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < source.length; i += 1) {
    const char = source[i]!;
    if (quoted) {
      if (char === '"') {
        if (source[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        field += char;
      }
      continue;
    }
    if (char === '"') quoted = true;
    else if (char === ',') {
      record.push(field);
      field = '';
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && source[i + 1] === '\n') i += 1;
      record.push(field);
      records.push(record);
      record = [];
      field = '';
    } else field += char;
  }
  if (field !== '' || record.length > 0) {
    record.push(field);
    records.push(record);
  }
  return records;
}

const HEADER_ALIASES: Record<string, keyof CostCodeImportRow> = {
  code: 'code',
  'cost code': 'code',
  name: 'name',
  description: 'name',
  parent: 'parent_code',
  'parent code': 'parent_code',
  parent_code: 'parent_code',
  unit: 'unit',
  budget: 'budget',
  amount: 'budget',
};

/**
 * A cost code sheet → import rows.
 *
 * Columns are `code, name, parent code, budget, unit`, in that order when there is no header row;
 * with one, they are found by name, so a sheet with its columns in another order still reads.
 * Budgets are in major units as people type them — `1,25,000.50` included — and converted to minor
 * units here with the currency's own number of decimals.
 */
export function parseCostCodeCsv(text: string, currencyDigits: number): CostCodeCsvResult {
  const records = parseCsv(text);
  const rows: CostCodeImportRow[] = [];
  const errors: CostCodeCsvResult['errors'] = [];
  if (records.length === 0) return { rows, errors };

  const first = records[0]!.map((cell) => cell.trim().toLowerCase());
  const hasHeader = first.some((cell) => cell === 'code' || cell === 'cost code');
  const columns: Array<keyof CostCodeImportRow | null> = hasHeader
    ? first.map((cell) => HEADER_ALIASES[cell] ?? null)
    : ['code', 'name', 'parent_code', 'budget', 'unit'];

  const seen = new Set<string>();
  records.forEach((record, index) => {
    if (hasHeader && index === 0) return;
    const lineNo = index + 1;
    if (record.every((cell) => cell.trim() === '')) return;

    const value = (key: keyof CostCodeImportRow): string => {
      const at = columns.indexOf(key);
      return at === -1 ? '' : (record[at] ?? '').trim();
    };
    const code = value('code');
    const name = value('name');
    if (!code) return errors.push({ line: lineNo, message: 'no code' });
    if (code.length > 30 || !COST_CODE_PATTERN.test(code)) {
      return errors.push({ line: lineNo, message: `"${code}" is not a cost code` });
    }
    if (!name) return errors.push({ line: lineNo, message: `${code} has no name` });
    if (seen.has(code.toUpperCase())) {
      return errors.push({ line: lineNo, message: `${code} appears twice` });
    }

    const rawBudget = value('budget').replace(/[,\s]/g, '').replace(/^[^\d\-.]+/, '');
    let budget: string | null = null;
    if (rawBudget) {
      const minor = decimalToMinor(rawBudget, currencyDigits);
      if (minor === null || minor < 0n) {
        return errors.push({ line: lineNo, message: `${code}: "${value('budget')}" is not an amount` });
      }
      budget = minor.toString();
    }

    seen.add(code.toUpperCase());
    rows.push({
      code,
      name: name.slice(0, 120),
      parent_code: value('parent_code') || null,
      unit: value('unit').slice(0, 20) || null,
      budget,
    });
  });
  return { rows, errors };
}

/** Quote a CSV cell when it needs it. */
export function csvCell(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export interface CostReportCsvLine {
  code: string;
  name: string;
  depth: number;
  unit: string | null;
  total: { budget: string; committed: string; actual: string; forecast: string; variance: string };
}

/**
 * The budget report as a sheet. Amounts in major units with the currency's decimals and no
 * grouping, so a spreadsheet reads them as numbers rather than text.
 */
export function costReportCsv(
  lines: readonly CostReportCsvLine[],
  extra: ReadonlyArray<{ label: string; total: CostReportCsvLine['total'] }>,
  currencyDigits: number,
): string {
  const money = (minor: string) => minorToDecimal(BigInt(minor), currencyDigits);
  const header = ['Code', 'Name', 'Level', 'Unit', 'Budget', 'Committed', 'Actual', 'Forecast', 'Variance'];
  const body = lines.map((row) => [
    row.code,
    row.name,
    String(row.depth + 1),
    row.unit ?? '',
    money(row.total.budget),
    money(row.total.committed),
    money(row.total.actual),
    money(row.total.forecast),
    money(row.total.variance),
  ]);
  const tail = extra.map((row) => [
    '',
    row.label,
    '',
    '',
    money(row.total.budget),
    money(row.total.committed),
    money(row.total.actual),
    money(row.total.forecast),
    money(row.total.variance),
  ]);
  return [header, ...body, ...tail].map((cells) => cells.map(csvCell).join(',')).join('\r\n');
}
