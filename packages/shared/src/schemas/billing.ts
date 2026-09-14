import { z } from 'zod';
import { planCodeSchema } from './plan';

/**
 * Subscription billing (spec §3 item 12).
 *
 * Nothing here accepts an amount from the caller. The price of a plan is a fact this system owns
 * (`PLAN_PRICES_PAISE`), and the authoritative charge is whatever Razorpay raises against the plan
 * id — a client that could name its own price would be a client that could buy Pro for a rupee.
 */
export const startSubscriptionSchema = z.object({
  plan: planCodeSchema,
  /**
   * Where Razorpay sends the builder after checkout. Validated as a URL and checked against the
   * configured origins server-side, so this cannot be turned into an open redirect.
   */
  return_url: z.string().url().max(500).optional(),
});
export type StartSubscriptionInput = z.infer<typeof startSubscriptionSchema>;

/** Cancelling keeps access until the period already paid for runs out. */
export const cancelSubscriptionSchema = z.object({
  /** False cancels at once and forfeits the remainder; the UI defaults to true. */
  at_period_end: z.boolean().default(true),
  reason: z.string().trim().max(500).optional(),
});
export type CancelSubscriptionInput = z.infer<typeof cancelSubscriptionSchema>;

export const BILLING_STATUSES = [
  /** No subscription has ever been started. */
  'none',
  'trialing',
  'active',
  /** A charge failed. Access continues through the grace period, then the plan drops. */
  'past_due',
  'cancelled',
] as const;
export type BillingStatus = (typeof BILLING_STATUSES)[number];
