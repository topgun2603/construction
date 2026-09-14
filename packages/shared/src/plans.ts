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
export const PLAN_PRICES_PAISE: Record<Plan, bigint> = {
  three_months: 299_900n,
  six_months: 549_900n,
  one_year: 999_900n,
  lifetime: 2_499_900n,
};

/** What a term costs outright, in paise. Not a monthly rate — a term is bought whole. */
export function planPricePaise(plan: Plan): bigint {
  return PLAN_PRICES_PAISE[plan] ?? 0n;
}

/** How many months a term runs. Null for `lifetime`, which does not end. */
export const PLAN_MONTHS: Record<Plan, number | null> = {
  three_months: 3,
  six_months: 6,
  one_year: 12,
  lifetime: null,
};

/** `three_months` → `3 months`, for anywhere a plan is named to a person. */
export const PLAN_LABELS: Record<Plan, string> = {
  three_months: '3 months',
  six_months: '6 months',
  one_year: '1 year',
  lifetime: 'Lifetime',
};

/**
 * When a term bought on `from` runs out, or null for one that never does.
 *
 * Month arithmetic, not 90 days: somebody who buys three months on the 15th expects it to end on
 * the 15th. JavaScript rolls 31 January + 1 month into 3 March, so a day that does not exist in
 * the target month is pulled back to that month's last day — 31 Jan + 1 month is 28 Feb, which is
 * what anybody selling a subscription means by it.
 */
export function planExpiryFrom(plan: Plan, from: Date): Date | null {
  const months = PLAN_MONTHS[plan];
  if (months === null) return null;

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
 * Monthly recurring revenue across a set of subscribed tenants, in paise.
 *
 * Counts only what is actually being billed. A tenant on a trial, past due, cancelled or suspended
 * is not revenue, and an MRR that includes them is the number that makes a business think it is
 * twice the size it is.
 */
export function monthlyRecurringPaise(
  tenants: ReadonlyArray<{ plan: Plan; billing_status: string }>,
): bigint {
  return tenants
    .filter((tenant) => tenant.billing_status === 'active')
    .reduce((sum, tenant) => sum + planPricePaise(tenant.plan), 0n);
}
