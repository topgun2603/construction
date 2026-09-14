import type { Plan } from './enums';

/**
 * Gateable modules. `@RequiresModule(<module>)` on an API controller is checked
 * against `tenants.enabled_modules` by PlanGuard (spec §6.3).
 */
export const MODULES = [
  'projects',
  'dpr',
  'attendance',
  'labour',
  'indents',
  'materials',
  'notifications',
  'dashboard',
  'expenses',
  'stock',
  'reports',
  'billing',
  'client_portal',
  'documents',
] as const;

export type ModuleName = (typeof MODULES)[number];

/**
 * Every module, for every plan.
 *
 * Kept as a function of the plan rather than inlined, because `@RequiresModule` and the console's
 * per-tenant toggles both still exist and still work: an operator can turn a module off for one
 * account that is misbehaving, and the guard will honour it. What no longer happens is a module
 * being off because of what somebody paid.
 */
export function defaultModulesForPlan(_plan: Plan): ModuleName[] {
  return [...MODULES];
}

export function isModuleName(value: string): value is ModuleName {
  return (MODULES as readonly string[]).includes(value);
}

/**
 * A tenant's effective module list. Stored `enabled_modules` wins so an owner can
 * be granted a module outside their plan, but unknown strings are dropped.
 */
export function effectiveModules(plan: Plan, enabled: readonly string[]): ModuleName[] {
  if (enabled.length === 0) return defaultModulesForPlan(plan);
  return enabled.filter(isModuleName);
}

export function hasModule(enabled: readonly string[], moduleName: ModuleName): boolean {
  return enabled.includes(moduleName);
}

/**
 * What each plan costs, in paise per month.
 *
 * Money lives in paise as integers everywhere in this system (spec §17), and a price is money —
 * `49900` not `499.00`. Keeping it here rather than only in Razorpay means the plan picker and the
 * platform console can state a figure without a round trip, and the two cannot disagree about what
 * a builder is being charged.
 *
 * Razorpay holds the authoritative *billing* plan; these are the amounts those plans were created
 * with. `RAZORPAY_PLAN_ID_STARTER` / `_PRO` map each to its Razorpay plan, and the webhook never
 * trusts an amount from the client.
 */
/**
 * One plan as both clients receive it.
 *
 * Money is a string of paise on the wire like everything else here, and `months` is null for a
 * plan that never ends — not zero, which would read as a term that expired the instant it started.
 */
export interface PlanView {
  id: string;
  code: string;
  name: string;
  months: number | null;
  price: string;
  description: string | null;
  /** A ribbon on the card — "Best value" — or null for a plan that is not called out. */
  badge: string | null;
  highlights: string[];
  is_active: boolean;
  sort_order: number;
}

/**
 * When a term of `months` bought on `from` runs out, or null for one that never does.
 *
 * Takes the length rather than looking a plan up, because there is no longer a table to look in —
 * the caller has the plan row and passes what it says.
 *
 * Month arithmetic, not 90 days: somebody who buys three months on the 15th expects it to end on
 * the 15th. JavaScript rolls 31 January + 1 month into 3 March, so a day that does not exist in
 * the target month is pulled back to that month's last day — 31 Jan + 1 month is 28 Feb, which is
 * what anybody selling a term means by it.
 */
export function expiryAfterMonths(months: number | null | undefined, from: Date): Date | null {
  if (months === null || months === undefined) return null;

  const day = from.getUTCDate();
  const target = new Date(from);
  target.setUTCDate(1);
  target.setUTCMonth(target.getUTCMonth() + months);

  const lastDayOfTarget = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0),
  ).getUTCDate();
  target.setUTCDate(Math.min(day, lastDayOfTarget));
  return target;
}

/** Where an account stands against its term. */
export type PlanStanding = 'active' | 'grace' | 'expired';

/**
 * Whether a term still entitles the account to write.
 *
 * Three states rather than two, because the day after a term ends is not the day somebody loses
 * their site's attendance. Within the grace period everything still works and the app says so;
 * past it the account reads but does not write.
 */
export function planStanding(
  expiresOn: Date | null | undefined,
  now: Date,
  graceDays: number,
): PlanStanding {
  // No expiry is lifetime, which is always active.
  if (!expiresOn) return 'active';
  if (now <= expiresOn) return 'active';

  const graceEnds = new Date(expiresOn);
  graceEnds.setUTCDate(graceEnds.getUTCDate() + graceDays);
  return now <= graceEnds ? 'grace' : 'expired';
}

/**
 * Monthly recurring revenue, in paise.
 *
 * A term is bought whole, so its monthly value is the price divided by its length: a ₹9,999 year
 * is ₹833 a month, not ₹9,999. Summing whole-term prices — which this did while plans were tiers
 * and prices monthly — would report a business four times the size it is the moment anybody bought
 * a year.
 *
 * **Lifetime contributes nothing.** It is real money and it is not recurring, and folding a
 * one-off into MRR is how a company talks itself into a run rate it does not have. Count those
 * separately.
 *
 * Integer division, floored, because the alternative is a float in a money figure.
 */
export function monthlyRecurringPaise(
  tenants: ReadonlyArray<{ price: bigint; months: number | null; billing_status: string }>,
): bigint {
  return tenants
    .filter((tenant) => tenant.billing_status === 'active')
    .filter((tenant) => tenant.months !== null && tenant.months > 0)
    .reduce((sum, tenant) => sum + tenant.price / BigInt(tenant.months as number), 0n);
}
