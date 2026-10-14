import { describe, expect, it } from 'vitest';
import { AI_FEATURES, aiAllOn, aiFeatureState, aiParseDisabledList } from './ai';
import { aiSettingsSchema } from './schemas/ai';

const base = {
  configured: true,
  platformDisabled: [] as string[],
  companyEnabled: true,
  companyDisabledFeatures: [] as string[],
  regionAvailable: true,
  feature: 'voice' as const,
};

describe('aiFeatureState', () => {
  it('is on with nothing switched off', () => {
    expect(aiFeatureState(base)).toBe('on');
  });

  it('says "not configured" before anything a company could change', () => {
    expect(aiFeatureState({ ...base, configured: false, companyEnabled: false })).toBe('not_configured');
  });

  it('puts the operator kill switch ahead of the company', () => {
    expect(aiFeatureState({ ...base, platformDisabled: ['voice'], companyEnabled: false })).toBe('off_platform');
    expect(aiFeatureState({ ...base, platformDisabled: ['all'] })).toBe('off_platform');
    expect(aiFeatureState({ ...base, platformDisabled: ['translation'] })).toBe('on');
  });

  it('honours the master switch and the per-feature switch', () => {
    expect(aiFeatureState({ ...base, companyEnabled: false })).toBe('off_company');
    expect(aiFeatureState({ ...base, companyDisabledFeatures: ['voice'] })).toBe('off_company');
    expect(aiFeatureState({ ...base, companyDisabledFeatures: ['translation'] })).toBe('on');
  });

  it('refuses rather than falling back when the chosen region has no endpoint', () => {
    expect(aiFeatureState({ ...base, regionAvailable: false })).toBe('region_unavailable');
  });
});

describe('aiParseDisabledList', () => {
  it('keeps known features and "all", ignoring case, spaces and typos', () => {
    expect(aiParseDisabledList(' Voice, translation ,nonsense')).toEqual(['voice', 'translation']);
    expect(aiParseDisabledList('ALL')).toEqual(['all']);
    expect(aiParseDisabledList(undefined)).toEqual([]);
  });
});

describe('aiAllOn / aiSettingsSchema', () => {
  it('lists every feature as on', () => {
    expect(Object.keys(aiAllOn()).sort()).toEqual([...AI_FEATURES].sort());
  });

  it('defaults the region and feature map, and rejects unknown regions', () => {
    expect(aiSettingsSchema.parse({ enabled: true })).toEqual({ enabled: true, features: {}, region: 'default' });
    expect(aiSettingsSchema.safeParse({ enabled: true, region: 'mars' }).success).toBe(false);
  });
});
