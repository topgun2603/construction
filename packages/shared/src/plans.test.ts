import { describe, expect, it } from 'vitest';
import {
  MODULES,
  defaultModulesForPlan,
  effectiveModules,
  hasModule,
  isModuleName,
  monthlyRecurringPaise,
  expiryAfterMonths,
  planStanding,
} from './plans';

describe('defaultModulesForPlan', () => {
  it('gives every plan every module', () => {
    // The product is no longer sold in tiers. A builder on three months and one on lifetime differ
    // in how long they have paid for, not in what they can do.
    for (const plan of ['three_months', 'six_months', 'one_year', 'lifetime'] as const) {
      expect(defaultModulesForPlan(plan).sort()).toEqual([...MODULES].sort());
    }
  });
});

describe('expiryAfterMonths', () => {
  it('counts months, so a term ends on the day it started', () => {
    expect(expiryAfterMonths(3, new Date('2026-09-15T00:00:00Z'))?.toISOString()).toBe(
      new Date('2026-12-15T00:00:00Z').toISOString(),
    );
    expect(expiryAfterMonths(12, new Date('2026-09-15T00:00:00Z'))?.toISOString()).toBe(
      new Date('2027-09-15T00:00:00Z').toISOString(),
    );
  });

  it('pulls back to the last day when the target month is shorter', () => {
    // 30 November plus three months is 28 February, not 2 March — which is what plain month
    // arithmetic would give, and what anybody selling a term means by it.
    const end = expiryAfterMonths(3, new Date('2026-11-30T00:00:00Z'));
    expect(end?.toISOString().slice(0, 10)).toBe('2027-02-28');
  });

  it('never ends a plan with no length', () => {
    // Null months is the lifetime plan. Zero would be a term that expired the instant it started.
    expect(expiryAfterMonths(null, new Date())).toBeNull();
    expect(expiryAfterMonths(undefined, new Date())).toBeNull();
  });
});

describe('monthlyRecurringPaise', () => {
  it('spreads a term over its months rather than counting it whole', () => {
    // A ₹9,999 year is ₹833 a month. Counting the whole term would report a business twelve times
    // the size it is the moment somebody bought one.
    const mrr = monthlyRecurringPaise([
      { price: 999_900n, months: 12, billing_status: 'active' },
    ]);
    expect(mrr).toBe(83_325n);
  });

  it('leaves lifetime out, because it is not recurring', () => {
    const mrr = monthlyRecurringPaise([
      { price: 2_499_900n, months: null, billing_status: 'active' },
    ]);
    expect(mrr).toBe(0n);
  });

  it('counts only what is actually being billed', () => {
    const mrr = monthlyRecurringPaise([
      { price: 999_900n, months: 12, billing_status: 'past_due' },
      { price: 299_900n, months: 3, billing_status: 'cancelled' },
    ]);
    expect(mrr).toBe(0n);
  });
});

describe('planStanding', () => {
  const expires = new Date('2026-09-15T00:00:00Z');

  it('is active up to and including the last day', () => {
    expect(planStanding(expires, new Date('2026-09-14T12:00:00Z'), 7)).toBe('active');
    expect(planStanding(expires, expires, 7)).toBe('active');
  });

  it('is in grace for the days that follow, where everything still works', () => {
    expect(planStanding(expires, new Date('2026-09-16T00:00:00Z'), 7)).toBe('grace');
    expect(planStanding(expires, new Date('2026-09-22T00:00:00Z'), 7)).toBe('grace');
  });

  it('expires once the grace is used up', () => {
    expect(planStanding(expires, new Date('2026-09-23T00:00:00Z'), 7)).toBe('expired');
  });

  it('treats no expiry as a lifetime rather than as something long overdue', () => {
    // The dangerous reading: null meaning "expired at the epoch" would lock out every lifetime
    // customer the moment this ran.
    expect(planStanding(null, new Date('2099-01-01T00:00:00Z'), 7)).toBe('active');
  });
});

describe('effectiveModules', () => {
  it('falls back to the plan defaults when the tenant has no override', () => {
    expect(effectiveModules('one_year', [])).toEqual(defaultModulesForPlan('one_year'));
  });

  it('lets a stored override grant a module outside the plan', () => {
    expect(effectiveModules('three_months', ['projects', 'reports'])).toEqual(['projects', 'reports']);
  });

  it('drops unknown module names rather than trusting stored text', () => {
    expect(effectiveModules('lifetime', ['projects', 'not_a_module'])).toEqual(['projects']);
  });
});

describe('isModuleName', () => {
  it('guards arbitrary strings', () => {
    expect(isModuleName('expenses')).toBe(true);
    expect(isModuleName('Expenses')).toBe(false);
  });
});

describe('hasModule', () => {
  it('checks membership', () => {
    expect(hasModule(['projects', 'dpr'], 'dpr')).toBe(true);
    expect(hasModule(['projects', 'dpr'], 'expenses')).toBe(false);
  });
});
