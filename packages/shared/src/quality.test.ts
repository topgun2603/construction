import { describe, expect, it } from 'vitest';
import {
  QUALITY_STANDARD_CHECKLISTS,
  qualityCompletionProblems,
  qualityCubeTarget,
  qualityMeasurementOutcome,
  qualityOverallResult,
  qualitySpecLabel,
  qualityTestDueOn,
  qualityTestOutcome,
  qualityTestState,
  qualityToleranceLabel,
  snagAgeBucket,
  snagCanTransition,
  suggestSnagFromNote,
} from './quality';
import { createQualityTemplateSchema, quickSnagSchema } from './schemas/quality';

describe('measurements against a tolerance', () => {
  const cover = { target: '25', minus: '0', plus: '10' };

  it('passes inside the band and on its edges, exactly', () => {
    expect(qualityMeasurementOutcome('25', cover)).toBe('pass');
    expect(qualityMeasurementOutcome('35', cover)).toBe('pass');
    expect(qualityMeasurementOutcome('35.001', cover)).toBe('fail');
    expect(qualityMeasurementOutcome('24.999', cover)).toBe('fail');
    // The float trap: 0.1 + 0.2 style sums must not decide a pour.
    expect(qualityMeasurementOutcome('40.1', { target: '40', minus: '0.1', plus: '0.1' })).toBe('pass');
  });

  it('leaves an open side open, and judges nothing without a target', () => {
    expect(qualityMeasurementOutcome('99', { target: '48', minus: '0', plus: null })).toBe('pass');
    expect(qualityMeasurementOutcome('47', { target: '48', minus: '0', plus: null })).toBe('fail');
    expect(qualityMeasurementOutcome('5', { target: null, minus: null, plus: null })).toBeNull();
  });

  it('labels a tolerance the way a site engineer writes it', () => {
    expect(qualityToleranceLabel(cover, 'mm')).toBe('25 mm (+10 / −0)');
    expect(qualityToleranceLabel({ target: '0', minus: '5', plus: '5' }, 'mm')).toBe('0 mm ±5');
  });
});

describe('completing an inspection', () => {
  const line = (over: Partial<Parameters<typeof qualityCompletionProblems>[0][number]>) => ({
    label: 'Cover blocks',
    kind: 'pass_fail' as const,
    required: true,
    photoRequired: false,
    outcome: 'pass' as const,
    photoCount: 0,
    comment: null,
    ...over,
  });

  it('refuses an unanswered required line and a photo line with no photo', () => {
    expect(qualityCompletionProblems([line({ outcome: null })])).toHaveLength(1);
    expect(qualityCompletionProblems([line({ outcome: null, required: false })])).toEqual([]);
    expect(qualityCompletionProblems([line({ kind: 'photo' })])).toEqual(['“Cover blocks” needs a photo']);
    expect(qualityCompletionProblems([line({ photoRequired: true, outcome: 'na' })])).toEqual([]);
    expect(qualityCompletionProblems([line({ photoRequired: true, photoCount: 1 })])).toEqual([]);
  });

  it('fails on any failed line, whatever the inspector asks for', () => {
    expect(qualityOverallResult([{ outcome: 'pass', comment: null }])).toBe('pass');
    expect(qualityOverallResult([{ outcome: 'pass', comment: 'one cover block loose, fixed' }])).toBe(
      'pass_with_comments',
    );
    expect(qualityOverallResult([{ outcome: 'pass', comment: null }], { requested: 'pass_with_comments' })).toBe(
      'pass_with_comments',
    );
    expect(qualityOverallResult([{ outcome: 'fail', comment: null }], { requested: 'pass' })).toBe('fail');
  });
});

describe('material tests', () => {
  it('works out cube due dates and the early-age target', () => {
    expect(qualityTestDueOn('2026-10-01', 7)).toBe('2026-10-08');
    expect(qualityTestDueOn('2026-10-01', 28)).toBe('2026-10-29');
    expect(qualityCubeTarget('25', 28)).toBe('25');
    expect(qualityCubeTarget('25', 7)).toBe('16.2');
    expect(qualityCubeTarget('30', 7)).toBe('19.5');
  });

  it('judges a result against a minimum, a maximum or a range', () => {
    expect(qualityTestOutcome('24.9', { min: '25', max: null })).toBe('fail');
    expect(qualityTestOutcome('25', { min: '25', max: null })).toBe('pass');
    expect(qualityTestOutcome('110', { min: '75', max: '100' })).toBe('fail');
    expect(qualityTestOutcome('3', { min: null, max: null })).toBeNull();
    expect(qualitySpecLabel({ min: '75', max: '100' }, 'mm')).toBe('75 – 100 mm');
  });

  it('knows a test with no result that is past its day is overdue', () => {
    const base = { result: null, testedOn: null };
    expect(qualityTestState({ ...base, dueOn: '2026-10-05' }, '2026-10-06')).toBe('overdue');
    expect(qualityTestState({ ...base, dueOn: '2026-10-06' }, '2026-10-06')).toBe('due');
    expect(qualityTestState({ ...base, dueOn: '2026-10-07' }, '2026-10-06')).toBe('scheduled');
    expect(qualityTestState({ dueOn: '2026-10-05', result: 'fail', testedOn: '2026-10-05' }, '2026-10-06')).toBe('fail');
  });
});

describe('snags', () => {
  it('moves only along its lifecycle', () => {
    expect(snagCanTransition('open', 'draft')).toBe(true);
    expect(snagCanTransition('fix', 'open')).toBe(true);
    expect(snagCanTransition('fix', 'draft')).toBe(false);
    expect(snagCanTransition('verify', 'open')).toBe(false);
    expect(snagCanTransition('reopen', 'closed')).toBe(true);
    expect(snagCanTransition('reopen', 'open')).toBe(false);
  });

  it('buckets age', () => {
    expect(snagAgeBucket(0)).toBe('0-7');
    expect(snagAgeBucket(8)).toBe('8-14');
    expect(snagAgeBucket(30)).toBe('15-30');
    expect(snagAgeBucket(400)).toBe('31+');
  });

  it('guesses trade and priority from a few words, without a model', () => {
    expect(suggestSnagFromNote('water leaking from the pipe joint under the basin')).toMatchObject({
      trade: 'Plumbing',
      priority: 'high',
    });
    expect(suggestSnagFromNote('hollow tiles near the kitchen, found by tapping')).toMatchObject({
      trade: 'Tiling',
    });
    expect(suggestSnagFromNote('paint touch-up needed on the lobby wall')).toMatchObject({
      trade: 'Painting',
      priority: 'low',
    });
    expect(suggestSnagFromNote('exposed rebar at the column base, honeycombing')).toMatchObject({
      trade: 'Concrete',
      priority: 'critical',
    });
    const long = suggestSnagFromNote('switch board loose. Also the cover plate is cracked');
    expect(long.title).toBe('Switch board loose.');
    expect(long.trade).toBe('Electrical');
    expect(suggestSnagFromNote('something odd here').trade).toBeNull();
  });

  it('wants a photo, a note or a voice note for quick capture', () => {
    const site = '7d7a0c1e-1d2b-4c47-9b1e-0f7c2f0e9d11';
    expect(quickSnagSchema.safeParse({ project_id: site }).success).toBe(false);
    expect(quickSnagSchema.safeParse({ project_id: site, note: 'crack' }).success).toBe(true);
    expect(quickSnagSchema.safeParse({ project_id: site, photo_keys: ['k'] }).success).toBe(true);
  });
});

describe('the standard checklist library', () => {
  it('ships the checklists a site starts with, each one valid as a template', () => {
    const names = QUALITY_STANDARD_CHECKLISTS.map((c) => c.name);
    for (const expected of [
      'Pre-pour concrete check',
      'Reinforcement inspection',
      'Formwork / shuttering',
      'Brickwork / blockwork',
      'Plastering',
      'Waterproofing',
      'Tiling',
      'Electrical first fix',
      'Plumbing pressure test',
    ]) {
      expect(names).toContain(expected);
    }
    for (const checklist of QUALITY_STANDARD_CHECKLISTS) {
      const parsed = createQualityTemplateSchema.safeParse(checklist);
      expect(parsed.success).toBe(true);
    }
  });
});
