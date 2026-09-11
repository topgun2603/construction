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

/** Modules every tenant gets regardless of plan — the Phase 1 core. */
const CORE_MODULES: readonly ModuleName[] = [
  'projects',
  'dpr',
  'attendance',
  'labour',
  'indents',
  'materials',
  'notifications',
  'dashboard',
];

/** Plan → default enabled modules. Source of truth for onboarding and upgrades. */
export const PLAN_MODULES: Record<Plan, readonly ModuleName[]> = {
  starter: CORE_MODULES,
  pro: [...CORE_MODULES, 'expenses', 'stock', 'reports', 'client_portal', 'documents'],
};

export function defaultModulesForPlan(plan: Plan): ModuleName[] {
  return [...PLAN_MODULES[plan]];
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
  starter: 99_900n,
  pro: 249_900n,
};

/** Monthly price for a plan, in paise. */
export function planPricePaise(plan: Plan): bigint {
  return PLAN_PRICES_PAISE[plan] ?? 0n;
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
