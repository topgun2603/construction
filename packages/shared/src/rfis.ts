/**
 * RFIs and submittals (roadmap Phase 2, module 9): questions to the designers with due dates, and
 * the contractor's documents sent for approval with their status. Builds on Documents.
 *
 * The vocabulary, the workflow rules and the small pieces of arithmetic (labels, due dates, overdue,
 * response times) that the API, the web and the CSV all share — so "overdue" means the same thing on
 * the register, in the reminder and in the export.
 *
 * Everything exported is prefixed `rfi`/`RFI_` or `submittal`/`SUBMITTAL_`: other modules are being
 * built alongside this one and a bare `STATUS_LABELS` would collide.
 */

import { addDays, daysBetweenInclusive } from './dates';

// --- RFI vocabulary --------------------------------------------------------------------------------

export const RFI_STATUSES = ['draft', 'open', 'answered', 'closed', 'void'] as const;
export type RfiStatus = (typeof RFI_STATUSES)[number];

export const RFI_STATUS_LABELS: Record<RfiStatus, string> = {
  draft: 'Draft',
  open: 'Open',
  answered: 'Answered',
  closed: 'Closed',
  void: 'Void',
};

export const RFI_DISCIPLINES = ['architectural', 'structural', 'mep', 'civil', 'other'] as const;
export type RfiDiscipline = (typeof RFI_DISCIPLINES)[number];

export const RFI_DISCIPLINE_LABELS: Record<RfiDiscipline, string> = {
  architectural: 'Architectural',
  structural: 'Structural',
  mep: 'MEP',
  civil: 'Civil',
  other: 'Other',
};

export const RFI_PRIORITIES = ['low', 'normal', 'high', 'urgent'] as const;
export type RfiPriority = (typeof RFI_PRIORITIES)[number];

export const RFI_PRIORITY_LABELS: Record<RfiPriority, string> = {
  low: 'Low',
  normal: 'Normal',
  high: 'High',
  urgent: 'Urgent',
};

/**
 * Where an RFI may go from each status.
 *
 * `answered → open` exists because an answer is sometimes not one ("see drawing" for a drawing that
 * does not show it); the RFI goes back to waiting rather than being closed on a non-answer. Nothing
 * leaves `closed` or `void`: they are the record of what was asked and decided.
 */
const RFI_MOVES: Record<RfiStatus, readonly RfiStatus[]> = {
  draft: ['open', 'void'],
  open: ['answered', 'void'],
  answered: ['open', 'closed', 'void'],
  closed: [],
  void: [],
};

export function rfiCanMove(from: RfiStatus, to: RfiStatus): boolean {
  return RFI_MOVES[from].includes(to);
}

/** Statuses in which the RFI is waiting on somebody outside the company. */
export const RFI_WAITING: readonly RfiStatus[] = ['open'];

/** `RFI-007`. Numbered per site: the consultant's own log for the job counts the same way. */
export function rfiLabel(number: number): string {
  return `RFI-${String(number).padStart(3, '0')}`;
}

// --- submittal vocabulary --------------------------------------------------------------------------

export const SUBMITTAL_STATUSES = [
  'draft',
  'submitted',
  'under_review',
  'approved',
  'approved_as_noted',
  'revise_resubmit',
  'rejected',
] as const;
export type SubmittalStatus = (typeof SUBMITTAL_STATUSES)[number];

export const SUBMITTAL_STATUS_LABELS: Record<SubmittalStatus, string> = {
  draft: 'Draft',
  submitted: 'Submitted',
  under_review: 'Under review',
  approved: 'Approved',
  approved_as_noted: 'Approved as noted',
  revise_resubmit: 'Revise and resubmit',
  rejected: 'Rejected',
};

/** The four answers a reviewer can stamp on a submittal. */
export const SUBMITTAL_OUTCOMES = ['approved', 'approved_as_noted', 'revise_resubmit', 'rejected'] as const;
export type SubmittalOutcome = (typeof SUBMITTAL_OUTCOMES)[number];

/** Waiting on the reviewer: what due dates and reminders apply to. */
export const SUBMITTAL_IN_REVIEW: readonly SubmittalStatus[] = ['submitted', 'under_review'];

/**
 * Outcomes after which the contractor sends a new revision. A rejection can still be resubmitted —
 * with a different product, usually — and it is the same submittal item on the register.
 */
export const SUBMITTAL_RESUBMITTABLE: readonly SubmittalStatus[] = ['revise_resubmit', 'rejected'];

/** Outcomes that let the work go ahead. */
export const SUBMITTAL_ACCEPTED: readonly SubmittalStatus[] = ['approved', 'approved_as_noted'];

export function submittalIsInReview(status: string): boolean {
  return (SUBMITTAL_IN_REVIEW as readonly string[]).includes(status);
}

export function submittalIsDecided(status: string): boolean {
  return (SUBMITTAL_OUTCOMES as readonly string[]).includes(status);
}

export const SUBMITTAL_TYPES = [
  'shop_drawing',
  'material_sample',
  'method_statement',
  'data_sheet',
  'other',
] as const;
export type SubmittalType = (typeof SUBMITTAL_TYPES)[number];

export const SUBMITTAL_TYPE_LABELS: Record<SubmittalType, string> = {
  shop_drawing: 'Shop drawing',
  material_sample: 'Material sample',
  method_statement: 'Method statement',
  data_sheet: 'Product data sheet',
  other: 'Other',
};

/**
 * Who reviews: somebody outside the company through a link (the consultant, the architect), or the
 * client through the portal's approvals, which already record who decided and when.
 */
export const SUBMITTAL_REVIEWER_KINDS = ['external', 'client'] as const;
export type SubmittalReviewerKind = (typeof SUBMITTAL_REVIEWER_KINDS)[number];

/** `SUB-004`, and `SUB-004 Rev 2` once it has been resubmitted. */
export function submittalLabel(number: number, revision?: number): string {
  const base = `SUB-${String(number).padStart(3, '0')}`;
  return revision === undefined || revision === 0 ? base : `${base} Rev ${revision}`;
}

// --- company defaults ------------------------------------------------------------------------------

/** What a company starts with until somebody changes it. */
export const RFI_DEFAULT_SETTINGS = {
  /** Days a designer is given to answer an RFI. Seven is the usual contract figure. */
  rfiDueDays: 7,
  /** Days a reviewer is given for a submittal. Fourteen is the usual contract figure. */
  submittalReviewDays: 14,
  /** How many days before the due date the "due soon" reminder goes out. */
  reminderDaysBefore: 2,
} as const;

// --- dates and figures -----------------------------------------------------------------------------

/** The default due date: `days` after the day it is sent, on the company's calendar. */
export function rfiDueDate(sentOn: string, days: number): string {
  return addDays(sentOn, days);
}

/**
 * Overdue: still waiting and the due date is before today on the company's clock. Due *today* is
 * not overdue — the designer has until the end of the day they were given.
 */
export function rfiIsOverdue(status: string, dueOn: string | null, today: string): boolean {
  return status === 'open' && dueOn !== null && dueOn < today;
}

export function submittalIsOverdue(status: string, dueOn: string | null, today: string): boolean {
  return submittalIsInReview(status) && dueOn !== null && dueOn < today;
}

/** Due within the reminder window (today included) and not yet overdue. */
export function rfiIsDueSoon(dueOn: string | null, today: string, withinDays: number): boolean {
  return dueOn !== null && dueOn >= today && dueOn <= addDays(today, withinDays);
}

/** Calendar days from one day to another: same day is 0. Negative when `to` is before `from`. */
export function rfiDaysBetween(from: string, to: string): number {
  return from <= to ? daysBetweenInclusive(from, to) - 1 : -(daysBetweenInclusive(to, from) - 1);
}

/**
 * Average response time in days, to one decimal, over the pairs that have both ends. Null when
 * nothing has been answered yet — "0 days" would read as instant answers.
 */
export function rfiAverageDays(pairs: ReadonlyArray<{ from: Date | null; to: Date | null }>): number | null {
  const spans = pairs
    .filter((pair): pair is { from: Date; to: Date } => pair.from !== null && pair.to !== null)
    .map((pair) => (pair.to.getTime() - pair.from.getTime()) / 86_400_000)
    .filter((days) => days >= 0);
  if (spans.length === 0) return null;
  return Math.round((spans.reduce((sum, days) => sum + days, 0) / spans.length) * 10) / 10;
}

// --- messages --------------------------------------------------------------------------------------

/**
 * The message that carries an RFI link, for WhatsApp or an email the builder sends themselves.
 * Written for somebody who has never heard of this software: who is asking, what, and by when.
 */
export function rfiLinkMessage(input: {
  recipientName: string | null;
  companyName: string;
  siteName: string;
  label: string;
  subject: string;
  dueOn: string | null;
  url: string;
  kind: 'rfi' | 'submittal';
}): string {
  const greeting = input.recipientName ? `Hello ${input.recipientName},` : 'Hello,';
  const what =
    input.kind === 'rfi'
      ? `${input.companyName} has a question for you on ${input.siteName}: ${input.label} — ${input.subject}.`
      : `${input.companyName} has sent ${input.label} — ${input.subject} for your review on ${input.siteName}.`;
  const due = input.dueOn ? ` A reply is needed by ${input.dueOn}.` : '';
  const action = input.kind === 'rfi' ? 'read it and answer' : 'see the documents and record your review';
  return [greeting, '', `${what}${due}`, '', `You can ${action} here, no sign-in needed: ${input.url}`].join('\n');
}
