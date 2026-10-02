import { z } from 'zod';

/**
 * Asking the product a question in words.
 *
 * The safety property of this whole feature is in the shape below: **the model parses the question
 * and nothing else.** It never sees a row, never writes a query, and never produces a number. It
 * turns "how much on steel at Lakeview last month" into a metric name, a site name, a material
 * word and a period keyword — and then deterministic code resolves those against the tenant's own
 * data, computes the figure, and writes the sentence from a template.
 *
 * That is what makes the answer trustworthy. A model asked to "query the database" would sooner or
 * later invent a plausible total, and a plausible total in a construction ledger is worse than no
 * answer at all.
 */

/** What can be asked for. Each one maps to a function over the tenant's data, nothing more. */
export const ASK_METRICS = [
  /** Money out on expenses: materials bought, hire, fuel, repairs. */
  'expense_total',
  /** Wages earned, from attendance at the frozen rate. */
  'labour_cost',
  /** Man-days on site. */
  'headcount',
  /** How much of a material was consumed — issued to the work, not merely delivered. */
  'material_consumed',
  /** Indents still waiting on a decision. */
  'indents_pending',
  /** Daily reports filed. */
  'reports_filed',
] as const;
export type AskMetric = (typeof ASK_METRICS)[number];

/**
 * Periods are keywords, not dates.
 *
 * The model saying "last month" and this code working out which dates that means keeps the two
 * jobs apart — and a model that computes dates gets them wrong at month boundaries, which is
 * exactly where a spend question lands.
 */
export const ASK_PERIODS = [
  'today',
  /*
   * Named by what they cover, not by "this" and "last".
   *
   * The first version had `this_week` and `last_week`, and a question asking about "last week" came
   * back labelled "the week before last" — the model's word and the code's word for the same seven
   * days disagreed, and the answer contradicted the question in the one line meant to show it had
   * been read correctly.
   */
  'last_7_days',
  'previous_7_days',
  'this_month',
  'last_month',
  'last_30_days',
  'last_90_days',
  'this_year',
  'all_time',
] as const;
export type AskPeriod = (typeof ASK_PERIODS)[number];

/** What the model is asked to produce. Anything outside this shape is refused, not repaired. */
export const askIntentSchema = z.object({
  metric: z.enum(ASK_METRICS),
  /** A site as the person named it — "Lakeview", "the villas". Resolved against real sites here. */
  project: z.string().trim().max(120).nullable(),
  /**
   * The thing being asked about within the metric: an expense category for `expense_total`, a
   * material for `material_consumed`. Free text, matched against what the tenant actually has.
   */
  subject: z.string().trim().max(80).nullable(),
  period: z.enum(ASK_PERIODS),
});
export type AskIntent = z.infer<typeof askIntentSchema>;

export const askSchema = z.object({
  question: z.string().trim().min(3).max(300),
});
export type AskInput = z.infer<typeof askSchema>;

/** What comes back. `answer` is composed from a template around a computed figure. */
export interface AskResult {
  answer: string;
  /** The figure itself, for a client that wants to render it rather than read the sentence. */
  value: string;
  /** `paise`, `man-days`, `count`, or a material's own unit. */
  unit: string;
  /** What was understood, so somebody can see the question was read correctly. */
  understood: {
    metric: AskMetric;
    project: string | null;
    subject: string | null;
    period: string;
    from: string;
    to: string;
  };
  /** Where to go to see the rows behind the figure. */
  href: string | null;
  /** Said out loud when a named site or material could not be found, rather than silently ignored. */
  caveat: string | null;
}
