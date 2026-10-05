import { quantityToThousandths } from './money';
import { taxOnTop } from './tax';

/**
 * Procurement arithmetic (roadmap Phase 2, module 2): line totals, the quote comparison and the
 * three-way match. Pure functions so the API, the web app and the tests all compute the same
 * figure — an order whose total the screen and the approval limit disagree on is worse than none.
 *
 * Money is integer minor units, quantities are decimal strings with up to three places (summed in
 * thousandths, never in floating point), and tax rates are basis points (500 = 5%).
 */

export const PURCHASE_ORDER_STATUSES = [
  'draft',
  'pending_approval',
  'approved',
  'sent',
  'partially_received',
  'received',
  'closed',
  'cancelled',
] as const;
export type PurchaseOrderStatus = (typeof PURCHASE_ORDER_STATUSES)[number];

export const RFQ_STATUSES = ['open', 'awarded', 'cancelled'] as const;
export type RfqStatus = (typeof RFQ_STATUSES)[number];

export const PURCHASE_INVOICE_STATUSES = ['matched', 'mismatch', 'approved', 'rejected'] as const;
export type PurchaseInvoiceStatus = (typeof PURCHASE_INVOICE_STATUSES)[number];

/**
 * An order somebody has agreed to spend on. Everything from `approved` on commits money against
 * the site's cost codes; a draft or an order waiting for approval does not yet.
 */
export const COMMITTED_PO_STATUSES: readonly PurchaseOrderStatus[] = [
  'approved',
  'sent',
  'partially_received',
  'received',
  'closed',
];

/** Goods can be received against these. A draft has not been agreed; a closed order is finished. */
export const RECEIVABLE_PO_STATUSES: readonly PurchaseOrderStatus[] = [
  'approved',
  'sent',
  'partially_received',
];

/** An invoice can be recorded against an order once it has been agreed, and until it is cancelled. */
export const INVOICEABLE_PO_STATUSES: readonly PurchaseOrderStatus[] = [
  'approved',
  'sent',
  'partially_received',
  'received',
  'closed',
];

/** The default tolerance for the three-way match: 2%, in basis points. */
export const DEFAULT_MATCH_TOLERANCE_BP = 200;

/**
 * Quantity × unit rate, rounded half up to the minor unit.
 *
 * 2.5 bags at ₹385.50 is ₹963.75; 0.333 m3 at ₹4,999 is ₹1,664.667, which a supplier's invoice
 * rounds to ₹1,664.67. Done in thousandths so the result never depends on floating point.
 */
export function lineAmount(quantity: string, unitRate: bigint): bigint {
  const product = quantityToThousandths(quantity) * unitRate;
  const negative = product < 0n;
  const abs = negative ? -product : product;
  const rounded = (abs + 500n) / 1000n;
  return negative ? -rounded : rounded;
}

export interface PricedLine {
  quantity: string;
  unit_rate: bigint;
  tax_rate_bp: number;
}

/** A line's net amount, its tax on top, and the two together. */
export function priceLine(line: PricedLine): { amount: bigint; tax: bigint; total: bigint } {
  const amount = lineAmount(line.quantity, line.unit_rate);
  const tax = taxOnTop(amount, line.tax_rate_bp);
  return { amount, tax, total: amount + tax };
}

/** An order's totals, added from its lines so they can never disagree with them. */
export function orderTotals(lines: readonly PricedLine[]): {
  subtotal: bigint;
  tax: bigint;
  total: bigint;
} {
  let subtotal = 0n;
  let tax = 0n;
  for (const line of lines) {
    const priced = priceLine(line);
    subtotal += priced.amount;
    tax += priced.tax;
  }
  return { subtotal, tax, total: subtotal + tax };
}

// ---------------------------------------------------------------------------------------------
// Quote comparison
// ---------------------------------------------------------------------------------------------

export interface ComparisonItem {
  id: string;
  quantity: string;
}

export interface ComparisonQuote {
  id: string;
  vendor_id: string;
  delivery_days: number | null;
  /** Per RFQ item the vendor priced. An item missing here is one the vendor did not quote. */
  lines: ReadonlyArray<{ rfq_item_id: string; unit_rate: bigint; tax_rate_bp: number }>;
}

export interface QuoteComparison {
  items: Array<{
    rfq_item_id: string;
    /** The quote with the lowest landed price (rate plus tax) for this item; null if nobody quoted. */
    lowest_quote_id: string | null;
    cells: Array<{
      quote_id: string;
      amount: bigint;
      tax: bigint;
      total: bigint;
    }>;
  }>;
  quotes: Array<{
    quote_id: string;
    subtotal: bigint;
    tax: bigint;
    total: bigint;
    /** Priced every item. Only a complete quote can be the cheapest overall. */
    complete: boolean;
    quoted_items: number;
  }>;
  /** The cheapest complete quote, ties going to the faster delivery. Null when none is complete. */
  lowest_quote_id: string | null;
  /**
   * What the job would cost buying each item from whoever is cheapest for it — what splitting the
   * order would save, so the buyer can see whether it is worth two deliveries.
   */
  best_split_total: bigint | null;
}

/**
 * Side by side: every vendor's price for every item, the cheapest per item, and the cheapest
 * overall.
 *
 * Compared on the landed price, tax included. A supplier who is not tax-registered can quote lower
 * and still cost more if the buyer could have reclaimed the other's tax — but whether they can is
 * the accountant's call, and the figure the site pays is the one a buyer compares first.
 */
export function compareQuotes(
  items: readonly ComparisonItem[],
  quotes: readonly ComparisonQuote[],
): QuoteComparison {
  const priced = quotes.map((quote) => {
    const byItem = new Map(quote.lines.map((line) => [line.rfq_item_id, line]));
    const cells = new Map<string, { amount: bigint; tax: bigint; total: bigint }>();
    for (const item of items) {
      const line = byItem.get(item.id);
      if (!line) continue;
      cells.set(
        item.id,
        priceLine({ quantity: item.quantity, unit_rate: line.unit_rate, tax_rate_bp: line.tax_rate_bp }),
      );
    }
    let subtotal = 0n;
    let tax = 0n;
    for (const cell of cells.values()) {
      subtotal += cell.amount;
      tax += cell.tax;
    }
    return {
      quote,
      cells,
      subtotal,
      tax,
      total: subtotal + tax,
      complete: items.length > 0 && cells.size === items.length,
    };
  });

  const comparisonItems = items.map((item) => {
    let lowest: { id: string; total: bigint; days: number } | null = null;
    const cells: QuoteComparison['items'][number]['cells'] = [];
    for (const entry of priced) {
      const cell = entry.cells.get(item.id);
      if (!cell) continue;
      cells.push({ quote_id: entry.quote.id, ...cell });
      const days = entry.quote.delivery_days ?? Number.MAX_SAFE_INTEGER;
      if (!lowest || cell.total < lowest.total || (cell.total === lowest.total && days < lowest.days)) {
        lowest = { id: entry.quote.id, total: cell.total, days };
      }
    }
    return { rfq_item_id: item.id, lowest_quote_id: lowest?.id ?? null, cells, lowestTotal: lowest?.total ?? null };
  });

  let lowestOverall: { id: string; total: bigint; days: number } | null = null;
  for (const entry of priced) {
    if (!entry.complete) continue;
    const days = entry.quote.delivery_days ?? Number.MAX_SAFE_INTEGER;
    if (
      !lowestOverall ||
      entry.total < lowestOverall.total ||
      (entry.total === lowestOverall.total && days < lowestOverall.days)
    ) {
      lowestOverall = { id: entry.quote.id, total: entry.total, days };
    }
  }

  const everyItemQuoted = comparisonItems.length > 0 && comparisonItems.every((item) => item.lowestTotal !== null);
  const bestSplit = everyItemQuoted
    ? comparisonItems.reduce((sum, item) => sum + (item.lowestTotal ?? 0n), 0n)
    : null;

  return {
    items: comparisonItems.map(({ lowestTotal: _lowestTotal, ...rest }) => rest),
    quotes: priced.map((entry) => ({
      quote_id: entry.quote.id,
      subtotal: entry.subtotal,
      tax: entry.tax,
      total: entry.total,
      complete: entry.complete,
      quoted_items: entry.cells.size,
    })),
    lowest_quote_id: lowestOverall?.id ?? null,
    best_split_total: bestSplit,
  };
}

// ---------------------------------------------------------------------------------------------
// Three-way match
// ---------------------------------------------------------------------------------------------

/**
 * What can be wrong with a supplier's invoice, checked against the order and the delivery.
 *
 * - `over_billed_qty`: billed (with earlier invoices) more than was ordered.
 * - `billed_not_received`: billed more than has been signed for at the gate — paying for goods
 *   that are not on site.
 * - `price_variance`: a rate different from the one the order agreed.
 * - `tax_variance`: tax different from the order's rate applied to the billed amount.
 */
export const MATCH_FLAG_TYPES = [
  'over_billed_qty',
  'billed_not_received',
  'price_variance',
  'tax_variance',
] as const;
export type MatchFlagType = (typeof MATCH_FLAG_TYPES)[number];

export interface MatchFlag {
  type: MatchFlagType;
  po_line_id: string;
  /** What the order or the delivery says, and what the invoice says, as display strings. */
  expected: string;
  actual: string;
}

export interface MatchOrderLine {
  id: string;
  quantity: string;
  unit_rate: bigint;
  tax_rate_bp: number;
  received_quantity: string;
  /** Billed on other invoices against this line that still stand (not rejected). */
  previously_billed_quantity: string;
}

export interface MatchInvoiceLine {
  po_line_id: string;
  quantity: string;
  unit_rate: bigint;
  tax_amount: bigint;
}

/** `value` within `tolerance` basis points of `target`, either side. */
function withinTolerance(value: bigint, target: bigint, toleranceBp: number): boolean {
  const diff = value > target ? value - target : target - value;
  // diff / |target| <= bp / 10000, cross-multiplied to stay in integers.
  const base = target < 0n ? -target : target;
  return diff * 10_000n <= base * BigInt(toleranceBp);
}

/** `value` no more than `tolerance` basis points above `limit`. */
function notAbove(value: bigint, limit: bigint, toleranceBp: number): boolean {
  return value * 10_000n <= limit * (10_000n + BigInt(toleranceBp));
}

/**
 * Matches an invoice against the order and what has been received: the three-way match.
 *
 * Quantities are compared cumulatively — this invoice plus every earlier one on the same line — so
 * three invoices for 40 bags each against an order of 100 are caught on the third, not waved
 * through because each alone is under. The tolerance applies to every comparison: a 2% tolerance
 * lets 101 bags through on an order of 100, and a rate of ₹386 on an agreed ₹385.
 *
 * Tax is checked with a floor of one minor unit, because a supplier rounding per line and the
 * order rounding per line can differ by a paisa on every line and nobody should chase that.
 */
export function matchInvoice(
  orderLines: readonly MatchOrderLine[],
  invoiceLines: readonly MatchInvoiceLine[],
  toleranceBp: number,
): MatchFlag[] {
  const flags: MatchFlag[] = [];
  const byId = new Map(orderLines.map((line) => [line.id, line]));

  for (const billed of invoiceLines) {
    const line = byId.get(billed.po_line_id);
    if (!line) continue;

    const ordered = quantityToThousandths(line.quantity);
    const received = quantityToThousandths(line.received_quantity);
    const cumulative =
      quantityToThousandths(line.previously_billed_quantity) + quantityToThousandths(billed.quantity);

    if (!notAbove(cumulative, ordered, toleranceBp)) {
      flags.push({
        type: 'over_billed_qty',
        po_line_id: line.id,
        expected: line.quantity,
        actual: thousandths(cumulative),
      });
    }
    if (!notAbove(cumulative, received, toleranceBp)) {
      flags.push({
        type: 'billed_not_received',
        po_line_id: line.id,
        expected: line.received_quantity,
        actual: thousandths(cumulative),
      });
    }
    if (!withinTolerance(billed.unit_rate, line.unit_rate, toleranceBp)) {
      flags.push({
        type: 'price_variance',
        po_line_id: line.id,
        expected: line.unit_rate.toString(),
        actual: billed.unit_rate.toString(),
      });
    }
    const expectedTax = taxOnTop(lineAmount(billed.quantity, billed.unit_rate), line.tax_rate_bp);
    const taxDiff = billed.tax_amount > expectedTax ? billed.tax_amount - expectedTax : expectedTax - billed.tax_amount;
    if (taxDiff > 1n && !withinTolerance(billed.tax_amount, expectedTax, toleranceBp)) {
      flags.push({
        type: 'tax_variance',
        po_line_id: line.id,
        expected: expectedTax.toString(),
        actual: billed.tax_amount.toString(),
      });
    }
  }
  return flags;
}

function thousandths(value: bigint): string {
  const whole = value / 1000n;
  const fraction = (value % 1000n).toString().padStart(3, '0').replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : `${whole}`;
}

/**
 * What an approved order still commits, per line: the order's value not yet billed.
 *
 * Billed money becomes actual cost through the expense the invoice creates, so it leaves
 * "committed" at the same moment it arrives in "actual" — never counted in both, never in neither.
 * A closed order commits only what was received and not yet billed: closing says nothing more is
 * coming, but the goods that did come still have an invoice to follow. Never negative: a line
 * billed over its order is a variance for the match to flag, not a negative commitment that would
 * quietly shrink the rest of the cost code's.
 */
export function outstandingCommitment(input: {
  status: PurchaseOrderStatus;
  quantity: string;
  received_quantity: string;
  unit_rate: bigint;
  tax_rate_bp: number;
  /** Amount plus tax of approved invoices on this line. */
  billed_total: bigint;
}): bigint {
  if (!COMMITTED_PO_STATUSES.includes(input.status)) return 0n;
  const quantity = input.status === 'closed' ? input.received_quantity : input.quantity;
  const { total } = priceLine({
    quantity,
    unit_rate: input.unit_rate,
    tax_rate_bp: input.tax_rate_bp,
  });
  const left = total - input.billed_total;
  return left > 0n ? left : 0n;
}

/**
 * Who may approve an order of this value.
 *
 * `null` is unlimited. A person's own limit, when the company set one, wins over their role's — the
 * senior PM trusted with more than the role, or the new one with less. With neither set the limit is
 * zero: until an owner decides what a manager may sign for, the owner signs for everything, which
 * is the safe way round for a new account.
 */
export function effectiveApprovalLimit(input: {
  isOwner: boolean;
  userLimit: bigint | null | undefined;
  roleLimit: bigint | null | undefined;
}): bigint | null {
  if (input.isOwner) return null;
  if (input.userLimit !== undefined) return input.userLimit;
  if (input.roleLimit !== undefined) return input.roleLimit;
  return 0n;
}

export function withinApprovalLimit(total: bigint, limit: bigint | null): boolean {
  return limit === null || total <= limit;
}
