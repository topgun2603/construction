import { csvCell } from './cost-codes';
import { minorToDecimal, quantityToThousandths } from './money';
import { basisPointsOf, lineAmount } from './subcontracts';

/**
 * Change orders — variations to the client's contract (roadmap Phase 2, module 4).
 *
 * A change order is the builder asking the client for more money, more time, or both, because the
 * job changed: the client asked for something, the design moved, the ground was not what the
 * drawings said, or somebody's drawing was wrong. Everything here is pure so the editor's live
 * totals and the API's stored figures are the same arithmetic.
 *
 * Every export is prefixed `changeOrder…` / `CHANGE_ORDER_…`: four other modules are being written
 * beside this one, and a generic `lineAmount` or `Status` from two of them would collide in the
 * package index.
 */

// --- workflow ------------------------------------------------------------------------------------

/**
 * draft → submitted (asked internally) → sent (internally approved, waiting on the client) →
 * approved / rejected by the client → implemented. A rejected one is either revised (back to
 * draft, next revision) or cancelled. Once approved it has moved budgets, the handover date and
 * the contract value, so it can no longer be cancelled — only implemented.
 */
export const CHANGE_ORDER_STATUSES = [
  'draft',
  'submitted',
  'sent',
  'approved',
  'rejected',
  'implemented',
  'cancelled',
] as const;
export type ChangeOrderStatus = (typeof CHANGE_ORDER_STATUSES)[number];

/** What each status may become, and through which action. The API checks every move against it. */
export const CHANGE_ORDER_TRANSITIONS: Readonly<Record<ChangeOrderStatus, readonly ChangeOrderStatus[]>> =
  Object.freeze({
    draft: ['submitted', 'cancelled'],
    // Returned to draft by the approver, or approved and sent to the client.
    submitted: ['draft', 'sent', 'cancelled'],
    // Decided by the client; withdrawing it cancels the request.
    sent: ['approved', 'rejected', 'cancelled'],
    approved: ['implemented'],
    // Revised (a new revision, back to draft) or dropped.
    rejected: ['draft', 'cancelled'],
    implemented: [],
    cancelled: [],
  });

export function changeOrderCanMove(from: ChangeOrderStatus, to: ChangeOrderStatus): boolean {
  return CHANGE_ORDER_TRANSITIONS[from].includes(to);
}

/** Statuses whose figures count as agreed: the client said yes. */
export const CHANGE_ORDER_AGREED: readonly ChangeOrderStatus[] = ['approved', 'implemented'];

/** Statuses still in play — not yet agreed, not dropped. */
export const CHANGE_ORDER_PENDING: readonly ChangeOrderStatus[] = ['draft', 'submitted', 'sent', 'rejected'];

export const CHANGE_ORDER_REASONS = [
  'client_request',
  'design_change',
  'site_condition',
  'error_omission',
] as const;
export type ChangeOrderReason = (typeof CHANGE_ORDER_REASONS)[number];

export const CHANGE_ORDER_REASON_LABELS: Readonly<Record<ChangeOrderReason, string>> = Object.freeze({
  client_request: 'Client request',
  design_change: 'Design change',
  site_condition: 'Site condition',
  error_omission: 'Error or omission',
});

/** `3` → `CO-003`; a revision is shown after it: `CO-003 rev 1`. */
export function changeOrderLabel(number: number, revision = 0): string {
  const base = `CO-${String(number).padStart(3, '0')}`;
  return revision > 0 ? `${base} rev ${revision}` : base;
}

// --- figures -------------------------------------------------------------------------------------

/**
 * One line's cost to the builder, in minor units.
 *
 * Measured (`quantity` × `rate`) or a lump sum (`amount`). Either may be negative: an omission —
 * the client dropping the second-floor balcony — is a change order too, and it credits the budget.
 * Returns null when the line gives neither, so the editor can show "—" while it is being typed.
 */
export function changeOrderLineCost(line: {
  quantity?: string | null;
  rate?: bigint | string | null;
  amount?: bigint | string | null;
}): bigint | null {
  const quantity = line.quantity?.trim();
  if (quantity && line.rate !== null && line.rate !== undefined && `${line.rate}` !== '') {
    return lineAmount(quantityToThousandths(quantity), BigInt(line.rate));
  }
  if (line.amount !== null && line.amount !== undefined && `${line.amount}` !== '') {
    return BigInt(line.amount);
  }
  return null;
}

export interface ChangeOrderPricingInput {
  /** The lines' costs, already worked out. */
  lineCosts: readonly bigint[];
  /** Markup on cost, basis points (1500 = 15%). Ignored when `enteredPrice` is set. */
  markupBp: number;
  /** A price agreed or quoted outright, instead of cost plus markup. */
  enteredPrice: bigint | null;
  /** The client's tax on the price — GST or VAT — in basis points. */
  taxRateBp: number;
}

export interface ChangeOrderFigures {
  /** What the change costs the builder: the budget moves by this. */
  cost: bigint;
  /** Cost plus markup, or the entered price: what the contract moves by. */
  price: bigint;
  /** Price minus cost. */
  margin: bigint;
  tax: bigint;
  /** What the client is asked to pay, tax included. */
  total: bigint;
}

/** The figures a change order carries. Integer minor units throughout; tax rounds half up. */
export function changeOrderFigures(input: ChangeOrderPricingInput): ChangeOrderFigures {
  const cost = input.lineCosts.reduce((sum, amount) => sum + amount, 0n);
  const price = input.enteredPrice ?? cost + basisPointsOf(cost, input.markupBp);
  const tax = basisPointsOf(price, input.taxRateBp);
  return { cost, price, margin: price - cost, tax, total: price + tax };
}

/**
 * How much of a budget change can actually be applied to a cost code's budget.
 *
 * A budget never goes below zero (the database refuses it). A credit larger than what is left on
 * the line takes the line to zero and no further; the revision row records what was applied, so
 * the history still adds up.
 */
export function changeOrderApplicableDelta(budget: bigint, delta: bigint): bigint {
  return budget + delta < 0n ? -budget : delta;
}

// --- the scope-creep catcher ---------------------------------------------------------------------

/**
 * Phrases that on their own say the work changed. Matched on word boundaries, case-insensitive.
 * Deliberately specific: "extra" alone fires on "extra cement bags arrived", which is a delivery.
 */
const STRONG_PHRASES: readonly RegExp[] = [
  /\b(?:extra|additional)\s+(?:work|works|scope|job|items?)\b/,
  /\bnot\s+in\s+(?:the\s+)?(?:scope|drawings?|contract|boq|estimate)\b/,
  /\bout\s+of\s+(?:the\s+)?scope\b/,
  /\bscope\s+(?:change|creep|increase)\b/,
  /\bvariation\b/,
  /\bchange\s+order\b/,
  /\brevised\s+(?:drawing|drawings|design|layout|plan)\b/,
  /\bdesign\s+change\b/,
  /\b(?:client|owner|customer|architect|consultant)\s+(?:has\s+)?(?:asked|wants|requested|instructed|told|changed|added)\b/,
  /\bas\s+per\s+(?:the\s+)?(?:client|owner|customer)(?:'s)?\s+(?:request|instruction)/,
];

/** A change word, which counts only next to somebody asking for it (`REQUEST_CUE`). */
const CHANGE_WORD =
  /\b(?:extra|additional|added|add|changed?|modif(?:y|ied|ication)|relocat(?:e|ed|ion)|shift(?:ed)?|upgrade[ds]?|instead\s+of|enlarge[ds]?|demolish(?:ed)?|redo(?:ne)?)\b/;
const REQUEST_CUE =
  /\b(?:client|owner|customer|architect|consultant|engineer|asked|requested|instructed|wants|wanted|insisted)\b/;
/** "No extra work today" is the opposite of what the catcher is looking for. */
const NEGATED = /\b(?:no|without|nil|zero)\s+(?:extra|additional|change|changes|variation|variations)\b/;

export interface ChangeOrderScopeCreepHit {
  /** The sentence that triggered it, trimmed to something a notification can show. */
  excerpt: string;
  /** What matched, for the person deciding whether it really is extra work. */
  matched: string[];
}

/**
 * Does this text — a daily report, a site message, a note — read like extra or changed work?
 *
 * Keyword rules, sentence by sentence, so it works with no AI key and a test can say exactly what
 * fires. A sentence counts when it has a strong phrase ("extra work", "not in scope", "client
 * asked"), or a change word ("shifted", "upgrade", "instead of") together with somebody asking for
 * it. Returns the first sentence that counts, or null.
 *
 * `fromClient`: the client wrote it, so they are the one asking — "can you add a window in the
 * study" needs no "client asked" to be a request.
 */
export function changeOrderScopeCreepMatch(
  text: string | null | undefined,
  options: { fromClient?: boolean } = {},
): ChangeOrderScopeCreepHit | null {
  if (!text) return null;
  const sentences = text
    .split(/(?<=[.!?\n])\s+|\n+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
  for (const sentence of sentences) {
    const lower = sentence.toLowerCase();
    if (NEGATED.test(lower)) continue;
    const matched: string[] = [];
    for (const phrase of STRONG_PHRASES) {
      const found = phrase.exec(lower);
      if (found) matched.push(found[0]);
    }
    if (matched.length === 0) {
      const change = CHANGE_WORD.exec(lower);
      const cue = REQUEST_CUE.exec(lower);
      if (change && cue) matched.push(change[0], cue[0]);
      else if (change && options.fromClient) matched.push(change[0]);
    }
    if (matched.length > 0) {
      return { excerpt: changeOrderExcerpt(sentence), matched: [...new Set(matched)] };
    }
  }
  return null;
}

/** At most 240 characters, cut on a word. */
export function changeOrderExcerpt(text: string, limit = 240): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  if (flat.length <= limit) return flat;
  const cut = flat.slice(0, limit);
  const space = cut.lastIndexOf(' ');
  return `${(space > limit / 2 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

// --- the register as a spreadsheet ---------------------------------------------------------------

export interface ChangeOrderCsvRow {
  number: number;
  revision: number;
  site: string;
  title: string;
  reason: ChangeOrderReason;
  status: ChangeOrderStatus;
  raised_on: string;
  cost_impact: string;
  client_price: string;
  tax: string;
  client_total: string;
  time_impact_days: number;
  decided_at: string | null;
}

/**
 * The change order register as CSV: one row per change order, then the agreed totals. Amounts are
 * plain decimals in the company's currency so a spreadsheet sums them; Excel wants `CSV_BOM` first.
 */
export function changeOrderRegisterCsv(rows: readonly ChangeOrderCsvRow[], currencyDigits: number): string {
  const money = (minor: string) => minorToDecimal(BigInt(minor), currencyDigits);
  const agreed = rows.filter((row) => CHANGE_ORDER_AGREED.includes(row.status));
  const sum = (pick: (row: ChangeOrderCsvRow) => string) =>
    money(agreed.reduce((total, row) => total + BigInt(pick(row)), 0n).toString());
  const lines: string[][] = [
    [
      'Change order',
      'Site',
      'Title',
      'Reason',
      'Status',
      'Raised on',
      'Cost impact',
      'Client price',
      'Tax',
      'Client total',
      'Time impact (days)',
      'Client decision',
    ],
    ...rows.map((row) => [
      changeOrderLabel(row.number, row.revision),
      row.site,
      row.title,
      CHANGE_ORDER_REASON_LABELS[row.reason],
      row.status,
      row.raised_on,
      money(row.cost_impact),
      money(row.client_price),
      money(row.tax),
      money(row.client_total),
      String(row.time_impact_days),
      row.decided_at ?? '',
    ]),
    [],
    [
      'Approved total',
      '',
      `${agreed.length} change orders`,
      '',
      '',
      '',
      sum((row) => row.cost_impact),
      sum((row) => row.client_price),
      sum((row) => row.tax),
      sum((row) => row.client_total),
      String(agreed.reduce((total, row) => total + row.time_impact_days, 0)),
      '',
    ],
  ];
  return lines.map((cells) => cells.map(csvCell).join(',')).join('\r\n') + '\r\n';
}
