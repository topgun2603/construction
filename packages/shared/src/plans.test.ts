import { describe, expect, it } from 'vitest';
import { defaultModulesForPlan, effectiveModules, hasModule, isModuleName } from './plans';

describe('defaultModulesForPlan', () => {
  it('gives starter the Phase 1 core only', () => {
    const starter = defaultModulesForPlan('starter');
    expect(starter).toContain('attendance');
    expect(starter).toContain('labour');
    expect(starter).not.toContain('expenses');
    expect(starter).not.toContain('reports');
  });

  it('gives pro the Phase 2 and 3 modules as well', () => {
    const pro = defaultModulesForPlan('pro');
    expect(pro).toContain('expenses');
    expect(pro).toContain('reports');
    expect(pro).toContain('client_portal');
  });
});

describe('effectiveModules', () => {
  it('falls back to the plan defaults when the tenant has no override', () => {
    expect(effectiveModules('starter', [])).toEqual(defaultModulesForPlan('starter'));
  });

  it('lets a stored override grant a module outside the plan', () => {
    expect(effectiveModules('starter', ['projects', 'reports'])).toEqual(['projects', 'reports']);
  });

  it('drops unknown module names rather than trusting stored text', () => {
    expect(effectiveModules('pro', ['projects', 'not_a_module'])).toEqual(['projects']);
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
