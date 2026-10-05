import { csvCell } from './cost-codes';
import { minorToDecimal } from './money';
import { taxOnTop } from './tax';

/**
 * Subcontracts and progress billing (roadmap Phase 2, module 3) — the money maths.
 *
 * A running-account (RA) bill claims the work done **to date**, line by line; what it pays is the
 * increment since the last certified bill. Everything cumulative is worked out on the to-date
 * figure and the bill's share is the difference from the previous bill's to-date figure. That is
 * the whole trick against rounding drift: five bills that each round their own 5% of retention can
 * end a paisa away from 5% of the total, while five differences of a cumulative figure cannot.
 *
 * Pure and integer-only so the API (which stores the figures) and the bill editor (which shows them
 * live as quantities are typed) cannot disagree. Money is minor units; quantities are thousandths
 * (`quantityToThousandths`), the same as stock; rates and percentages are basis points.
 */

export const SUBCONTRACT_STATUSES = ['draft', 'active', 'completed', 'closed', 'terminated'] as const;
export type SubcontractStatus = (typeof SUBCONTRACT_STATUSES)[number];

/**
 * Where a subcontract may go next. Closed and terminated are final: a closed account reopened is
 * a statement that no longer agrees with the one the subcontractor signed.
 */
export const SUBCONTRACT_TRANSITIONS: Readonly<Record<SubcontractStatus, readonly SubcontractStatus[]>> =
  Object.freeze({
    draft: ['active'],
    active: ['completed', 'terminated'],
    completed: ['closed', 'terminated'],
    closed: [],
    terminated: [],
  });

export const RA_BILL_STATUSES = ['draft', 'submitted', 'certified', 'paid'] as const;
export type RaBillStatus = (typeof RA_BILL_STATUSES)[number];

export const SUBCONTRACT_DEDUCTION_KINDS = ['material', 'labour', 'damage', 'penalty', 'other'] as const;
export type SubcontractDeductionKind = (typeof SUBCONTRACT_DEDUCTION_KINDS)[number];

export const SUBCONTRACT_DEDUCTION_LABELS: Readonly<Record<SubcontractDeductionKind, string>> =
  Object.freeze({
    material: 'Material supplied by us',
    labour: 'Labour supplied by us',
    damage: 'Damage',
    penalty: 'Penalty',
    other: 'Other back-charge',
  });

export const SUBCONTRACT_PAYMENT_KINDS = ['advance', 'bill', 'retention'] as const;
export type SubcontractPaymentKind = (typeof SUBCONTRACT_PAYMENT_KINDS)[number];

/** 10000 basis points = 100%. */
export const BASIS_POINTS = 10_000n;

/**
 * `numerator / denominator`, rounded half away from zero — the way a printed bill rounds.
 * Integer only; the denominator must be positive.
 */
export function roundedDivide(numerator: bigint, denominator: bigint): bigint {
  if (denominator <= 0n) throw new RangeError('denominator must be positive');
  const negative = numerator < 0n;
  const abs = negative ? -numerator : numerator;
  const quotient = (abs * 2n + denominator) / (denominator * 2n);
  return negative ? -quotient : quotient;
}

/** `bp` basis points of an amount, rounded half up: 5% (500) of 1,000.00 is 50.00. */
export function basisPointsOf(amount: bigint, bp: number): bigint {
  return roundedDivide(amount * BigInt(bp), BASIS_POINTS);
}

/**
 * A quantity (thousandths) at a rate (minor units per unit), to the minor unit. 2.5 m³ at 4,000.00
 * is 10,000.00; 0.333 m² at 10.01 is 3.33.
 */
export function lineAmount(quantityThousandths: bigint, rate: bigint): bigint {
  return roundedDivide(quantityThousandths * rate, 1000n);
}

/** `"12.5"` per cent → 1250 basis points. Null when it is not 0–100 with at most two decimals. */
export function percentToBasisPoints(percent: string): number | null {
  const match = /^(\d{1,3})(?:\.(\d{1,2}))?$/.exec(percent.trim());
  if (!match) return null;
  const bp = Number(match[1]) * 100 + Number((match[2] ?? '').padEnd(2, '0') || '0');
  return bp <= 10_000 ? bp : null;
}

/** 1250 → `"12.5"`. */
export function basisPointsToPercent(bp: number): string {
  const whole = Math.trunc(bp / 100);
  const fraction = String(bp % 100).padStart(2, '0').replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : String(whole);
}

// --- one RA bill ---------------------------------------------------------------------------------

export interface RaBillLineInput {
  id: string;
  /** Minor units per unit. */
  rate: bigint;
  /** What the contract (or the variation that added it) says, in thousandths. */
  contractQuantity: bigint;
  /** Certified to date on the previous bill, in thousandths. Zero on the first. */
  previousQuantity: bigint;
  /** Done to date on this bill — claimed, or certified once it is. Thousandths. */
  quantityToDate: bigint;
}

export interface RaBillInput {
  lines: readonly RaBillLineInput[];
  /** The previous certified bill's cumulative figures; zeros for the first bill. */
  previous: {
    retentionToDate: bigint;
    advanceRecoveredToDate: bigint;
  };
  retentionBp: number;
  advanceRecoveryBp: number;
  /** Advance actually paid to the subcontractor so far — recovery never exceeds it. */
  advancePaid: bigint;
  /** Tax charged on top of the work value (GST, VAT). Zero when none. */
  taxRateBp: number;
  /** Back-charges on this bill: material and labour we supplied, damage, penalties. */
  deductions: bigint;
}

export interface RaBillLineFigures {
  id: string;
  previousValue: bigint;
  valueToDate: bigint;
  /** `valueToDate − previousValue`. */
  thisBill: bigint;
}

export interface RaBillFigures {
  lines: RaBillLineFigures[];
  grossToDate: bigint;
  previousGross: bigint;
  /** The work this bill pays for: gross to date less what earlier bills certified. */
  gross: bigint;
  retentionToDate: bigint;
  retention: bigint;
  advanceRecoveredToDate: bigint;
  advanceRecovery: bigint;
  deductions: bigint;
  /** On this bill's gross. Retention is money held back, not a discount, so it is still taxed. */
  tax: bigint;
  /** `gross + tax − retention − advanceRecovery − deductions`. Negative means the bill owes us. */
  netPayable: bigint;
}

/**
 * The figures of one RA bill.
 *
 *   gross to date      = Σ quantity to date × rate              (per line, rounded per line)
 *   this bill's gross  = gross to date − previous gross to date
 *   retention to date  = retention % × gross to date            → this bill's = the increment
 *   advance recovered  = min(recovery % × gross to date, advance paid), never less than before
 *   tax                = tax rate × this bill's gross
 *   net payable        = gross + tax − retention − advance recovery − deductions
 *
 * Validates nothing about the quantities; `raQuantityProblems` does that so a caller can show every
 * problem at once rather than the first.
 */
export function computeRaBill(input: RaBillInput): RaBillFigures {
  const lines = input.lines.map((line) => {
    const previousValue = lineAmount(line.previousQuantity, line.rate);
    const valueToDate = lineAmount(line.quantityToDate, line.rate);
    return { id: line.id, previousValue, valueToDate, thisBill: valueToDate - previousValue };
  });
  const grossToDate = lines.reduce((sum, line) => sum + line.valueToDate, 0n);
  const previousGross = lines.reduce((sum, line) => sum + line.previousValue, 0n);
  const gross = grossToDate - previousGross;

  const retentionToDate = basisPointsOf(grossToDate, input.retentionBp);
  const retention = retentionToDate - input.previous.retentionToDate;

  // Recovery is a share of the work done, capped at what was actually advanced, and never handed
  // back: an advance recovered on bill 2 stays recovered if bill 3 re-measures something down.
  let recoveredToDate = basisPointsOf(grossToDate, input.advanceRecoveryBp);
  if (recoveredToDate > input.advancePaid) recoveredToDate = input.advancePaid;
  if (recoveredToDate < input.previous.advanceRecoveredToDate) {
    recoveredToDate = input.previous.advanceRecoveredToDate;
  }
  const advanceRecovery = recoveredToDate - input.previous.advanceRecoveredToDate;

  const tax = gross > 0n ? taxOnTop(gross, input.taxRateBp) : 0n;
  const netPayable = gross + tax - retention - advanceRecovery - input.deductions;

  return {
    lines,
    grossToDate,
    previousGross,
    gross,
    retentionToDate,
    retention,
    advanceRecoveredToDate: recoveredToDate,
    advanceRecovery,
    deductions: input.deductions,
    tax,
    netPayable,
  };
}

export type RaQuantityProblem =
  | { lineId: string; problem: 'below_previous' }
  | { lineId: string; problem: 'above_contract' }
  | { lineId: string; problem: 'above_claimed' };

/**
 * What is wrong with a bill's quantities, line by line.
 *
 * - **Below the previous bill.** Each bill states work done *to date*; less than was certified
 *   before means work un-done, which is a correction to an earlier bill, not a new one.
 * - **Above the contract quantity.** More than was ordered needs a variation first, or the
 *   commitment and the budget report stop meaning anything.
 * - **Certified above claimed** (when `claimed` is given): a certifier can cut a claim, not grow it.
 */
export function raQuantityProblems(
  lines: ReadonlyArray<RaBillLineInput & { claimedQuantity?: bigint }>,
): RaQuantityProblem[] {
  const problems: RaQuantityProblem[] = [];
  for (const line of lines) {
    if (line.quantityToDate < line.previousQuantity) {
      problems.push({ lineId: line.id, problem: 'below_previous' });
    }
    if (line.quantityToDate > line.contractQuantity) {
      problems.push({ lineId: line.id, problem: 'above_contract' });
    }
    if (line.claimedQuantity !== undefined && line.quantityToDate > line.claimedQuantity) {
      problems.push({ lineId: line.id, problem: 'above_claimed' });
    }
  }
  return problems;
}

/** `percent` complete of a line, as a quantity in thousandths, rounded half up. */
export function percentOfQuantity(contractQuantity: bigint, percentBp: number): bigint {
  return basisPointsOf(contractQuantity, percentBp);
}

// --- retention -----------------------------------------------------------------------------------

/**
 * How the retention held is due back under the usual terms: a share at completion (half, say),
 * the rest when the defects liability period ends. Amounts only; dates are the subcontract's.
 */
export function retentionTranches(
  retentionToDate: bigint,
  releaseAtCompletionBp: number,
): { atCompletion: bigint; afterDefects: bigint } {
  const atCompletion = basisPointsOf(retentionToDate, releaseAtCompletionBp);
  return { atCompletion, afterDefects: retentionToDate - atCompletion };
}

// --- the statement -------------------------------------------------------------------------------

export interface StatementBill {
  gross: bigint;
  tax: bigint;
  retention: bigint;
  advanceRecovery: bigint;
  deductions: bigint;
  netPayable: bigint;
  /** Paid against this bill. */
  paid: bigint;
}

export interface StatementInput {
  /** Original lines' value. */
  originalValue: bigint;
  /** Approved variations' value. */
  variationsValue: bigint;
  /** Certified and paid bills only; drafts and bills awaiting certification promise nothing. */
  bills: readonly StatementBill[];
  advancePaid: bigint;
  retentionReleased: bigint;
  retentionPaid: bigint;
}

export interface SubcontractStatement {
  originalValue: bigint;
  variationsValue: bigint;
  currentValue: bigint;
  certifiedGross: bigint;
  /** Contract value not yet certified: what is still committed. Never negative. */
  remainingValue: bigint;
  tax: bigint;
  retentionHeld: bigint;
  retentionReleased: bigint;
  /** Held and not yet released. */
  retentionBalance: bigint;
  advancePaid: bigint;
  advanceRecovered: bigint;
  advanceOutstanding: bigint;
  deductions: bigint;
  netCertified: bigint;
  paidOnBills: bigint;
  retentionPaid: bigint;
  /** Everything handed over: bills, released retention, and the advance. */
  totalPaid: bigint;
  /** Owed now: certified bills not yet paid, plus retention released and not yet paid. */
  balanceDue: bigint;
}

/**
 * The account with one subcontractor: what the contract is worth, what has been certified, held,
 * recovered and paid, and what is owed now.
 */
export function subcontractStatement(input: StatementInput): SubcontractStatement {
  const sum = (pick: (bill: StatementBill) => bigint) =>
    input.bills.reduce((total, bill) => total + pick(bill), 0n);
  const currentValue = input.originalValue + input.variationsValue;
  const certifiedGross = sum((bill) => bill.gross);
  const retentionHeld = sum((bill) => bill.retention);
  const advanceRecovered = sum((bill) => bill.advanceRecovery);
  const netCertified = sum((bill) => bill.netPayable);
  const paidOnBills = sum((bill) => bill.paid);
  return {
    originalValue: input.originalValue,
    variationsValue: input.variationsValue,
    currentValue,
    certifiedGross,
    remainingValue: currentValue > certifiedGross ? currentValue - certifiedGross : 0n,
    tax: sum((bill) => bill.tax),
    retentionHeld,
    retentionReleased: input.retentionReleased,
    retentionBalance: retentionHeld - input.retentionReleased,
    advancePaid: input.advancePaid,
    advanceRecovered,
    advanceOutstanding: input.advancePaid - advanceRecovered,
    deductions: sum((bill) => bill.deductions),
    netCertified,
    paidOnBills,
    retentionPaid: input.retentionPaid,
    totalPaid: paidOnBills + input.retentionPaid + input.advancePaid,
    balanceDue: netCertified - paidOnBills + (input.retentionReleased - input.retentionPaid),
  };
}

// --- CSV -----------------------------------------------------------------------------------------

/** Statement figures as the wire carries them: minor-unit strings. */
export type SubcontractStatementView = { [K in keyof SubcontractStatement]: string };

export interface StatementCsvBill {
  number: number;
  period_to: string;
  status: string;
  gross: string;
  tax: string;
  retention: string;
  advance_recovery: string;
  deductions: string;
  net_payable: string;
  paid: string;
}

const STATEMENT_ROWS: ReadonlyArray<[keyof SubcontractStatement, string]> = [
  ['originalValue', 'Original contract value'],
  ['variationsValue', 'Approved variations'],
  ['currentValue', 'Current contract value'],
  ['certifiedGross', 'Work certified to date'],
  ['remainingValue', 'Value still to certify'],
  ['tax', 'Tax on certified work'],
  ['retentionHeld', 'Retention held'],
  ['retentionReleased', 'Retention released'],
  ['retentionBalance', 'Retention still held'],
  ['advancePaid', 'Advance paid'],
  ['advanceRecovered', 'Advance recovered'],
  ['advanceOutstanding', 'Advance still to recover'],
  ['deductions', 'Deductions and back-charges'],
  ['netCertified', 'Net certified payable'],
  ['paidOnBills', 'Paid against bills'],
  ['retentionPaid', 'Retention paid'],
  ['totalPaid', 'Total paid'],
  ['balanceDue', 'Balance due'],
];

/**
 * The statement as a spreadsheet: the summary, then one row per certified bill. Amounts are plain
 * decimals in the company's currency so a spreadsheet sums them; Excel wants `CSV_BOM` in front.
 */
export function subcontractStatementCsv(
  heading: { number: string; title: string; contractor: string },
  statement: SubcontractStatementView,
  bills: readonly StatementCsvBill[],
  currencyDigits: number,
): string {
  const money = (minor: string) => minorToDecimal(BigInt(minor), currencyDigits);
  const rows: string[][] = [
    ['Subcontract', heading.number],
    ['Title', heading.title],
    ['Subcontractor', heading.contractor],
    [],
    ['Item', 'Amount'],
    ...STATEMENT_ROWS.map(([key, label]) => [label, money(statement[key])]),
    [],
    ['RA bill', 'Period to', 'Status', 'Gross', 'Tax', 'Retention', 'Advance recovery', 'Deductions', 'Net payable', 'Paid'],
    ...bills.map((bill) => [
      `RA-${bill.number}`,
      bill.period_to,
      bill.status,
      money(bill.gross),
      money(bill.tax),
      money(bill.retention),
      money(bill.advance_recovery),
      money(bill.deductions),
      money(bill.net_payable),
      money(bill.paid),
    ]),
  ];
  return rows.map((row) => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
}
