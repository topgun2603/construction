import { describe, expect, it } from 'vitest';
import {
  MODULES,
  defaultModulesForPlan,
  effectiveModules,
  hasModule,
  isModuleName,
  planExpiryFrom,
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

describe('planExpiryFrom', () => {
  it('counts months, so a term ends on the day it started', () => {
    expect(planExpiryFrom('three_months', new Date('2026-09-15T00:00:00Z'))?.toISOString()).toBe(
      new Date('2026-12-15T00:00:00Z').toISOString(),
    );
    expect(planExpiryFrom('one_year', new Date('2026-09-15T00:00:00Z'))?.toISOString()).toBe(
      new Date('2027-09-15T00:00:00Z').toISOString(),
    );
  });

  it('pulls back to the last day when the target month is shorter', () => {
    // 31 January plus one month is 28 February, not 3 March — which is what plain month arithmetic
    // would give, and what anybody selling a term means by it.
    const end = planExpiryFrom('three_months', new Date('2026-11-30T00:00:00Z'));
    expect(end?.toISOString().slice(0, 10)).toBe('2027-02-28');
  });

  it('never ends a lifetime', () => {
    expect(planExpiryFrom('lifetime', new Date())).toBeNull();
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
