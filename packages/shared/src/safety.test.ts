import { describe, expect, it } from 'vitest';
import {
  SAFETY_PERMIT_CHECKLISTS,
  SAFETY_PERMIT_TYPES,
  safetyCountBy,
  safetyCoverage,
  safetyDaysSince,
  safetyDefaultChecklist,
  safetyInstantToLocal,
  safetyIsLti,
  safetyIsRecordable,
  safetyLocalToInstant,
  safetyLtifr,
  safetyManHours,
  safetyNumber,
  safetyOpenActionAges,
  safetySuggestFromNote,
  safetyTrir,
} from './safety';

describe('safety man-hours', () => {
  it('counts a shift per present day, half per half day, plus overtime, and nothing for absent', () => {
    expect(
      safetyManHours([
        { status: 'present', days: 10, overtimeHours: '6' },
        { status: 'half_day', days: 2, overtimeHours: 0 },
        { status: 'absent', days: 5, overtimeHours: '3' },
      ]),
    ).toBe(10 * 8 + 6 + 2 * 4);
  });

  it('takes a different shift length', () => {
    expect(safetyManHours([{ status: 'present', days: 3, overtimeHours: '0' }], 10)).toBe(30);
  });

  it('is zero for an empty roll', () => {
    expect(safetyManHours([])).toBe(0);
  });
});

describe('safety frequency rates', () => {
  it('LTIFR is LTIs per million hours', () => {
    expect(safetyLtifr(1, 500_000)).toBe(2);
    expect(safetyLtifr(2, 300_000)).toBe(6.67);
    expect(safetyLtifr(0, 1000)).toBe(0);
  });

  it('TRIR is recordables per 200,000 hours', () => {
    expect(safetyTrir(3, 600_000)).toBe(1);
    expect(safetyTrir(1, 160)).toBe(1250);
  });

  it('is null, not zero, with no hours worked', () => {
    expect(safetyLtifr(0, 0)).toBeNull();
    expect(safetyTrir(1, 0)).toBeNull();
  });

  it('counts fatalities as lost time and first aid as not recordable', () => {
    expect(safetyIsLti('fatality')).toBe(true);
    expect(safetyIsLti('medical_treatment')).toBe(false);
    expect(safetyIsRecordable('medical_treatment')).toBe(true);
    expect(safetyIsRecordable('first_aid')).toBe(false);
    expect(safetyIsRecordable('near_miss')).toBe(false);
  });
});

describe('days since', () => {
  it('counts whole calendar days, zero on the day itself', () => {
    expect(safetyDaysSince('2026-10-01', '2026-10-06')).toBe(5);
    expect(safetyDaysSince('2026-10-06', '2026-10-06')).toBe(0);
    expect(safetyDaysSince('2025-12-31', '2026-01-01')).toBe(1);
  });

  it('is null with nothing to count from', () => {
    expect(safetyDaysSince(null, '2026-10-06')).toBeNull();
  });
});

describe('open actions by age', () => {
  it('buckets open actions by how long they have been open and counts the late ones', () => {
    const ages = safetyOpenActionAges(
      [
        { status: 'open', raisedOn: '2026-10-05', dueOn: '2026-10-10' },
        { status: 'open', raisedOn: '2026-09-20', dueOn: '2026-10-01' },
        { status: 'open', raisedOn: '2026-08-01', dueOn: null },
        { status: 'open', raisedOn: '2026-01-01', dueOn: '2026-02-01' },
        { status: 'done', raisedOn: '2026-01-01', dueOn: '2026-02-01' },
      ],
      '2026-10-06',
    );
    expect(ages.buckets).toEqual({ '0_7': 1, '8_30': 1, '31_90': 1, '90_plus': 1 });
    expect(ages.open).toBe(4);
    expect(ages.overdue).toBe(2);
  });
});

describe('counting and coverage', () => {
  it('keeps every key, even at zero', () => {
    expect(safetyCountBy(['a', 'b', 'c'] as const, ['a', 'a', 'c', 'z'])).toEqual({ a: 2, b: 0, c: 1 });
  });

  it('coverage is the share of the roll that attended, null for nobody on the roll', () => {
    expect(safetyCoverage(3, 4)).toBe(75);
    expect(safetyCoverage(0, 0)).toBeNull();
    expect(safetyCoverage(5, 4)).toBe(100);
  });
});

describe('company clock', () => {
  it('reads a wall-clock time in the company zone', () => {
    expect(safetyLocalToInstant('2026-10-06T14:30', 'Asia/Dubai').toISOString()).toBe(
      '2026-10-06T10:30:00.000Z',
    );
    expect(safetyLocalToInstant('2026-10-06T00:15', 'Asia/Kolkata').toISOString()).toBe(
      '2026-10-05T18:45:00.000Z',
    );
    expect(safetyLocalToInstant('2026-10-06T08:00', 'Asia/Kathmandu').toISOString()).toBe(
      '2026-10-06T02:15:00.000Z',
    );
  });

  it('follows daylight saving', () => {
    expect(safetyLocalToInstant('2026-07-01T09:00', 'Europe/London').toISOString()).toBe(
      '2026-07-01T08:00:00.000Z',
    );
    expect(safetyLocalToInstant('2026-12-01T09:00', 'Europe/London').toISOString()).toBe(
      '2026-12-01T09:00:00.000Z',
    );
  });

  it('round-trips back to the wall clock', () => {
    const instant = safetyLocalToInstant('2026-10-06T23:50', 'Asia/Kolkata');
    expect(safetyInstantToLocal(instant, 'Asia/Kolkata')).toBe('2026-10-06T23:50');
  });

  it('refuses something that is not a wall-clock time', () => {
    expect(() => safetyLocalToInstant('2026-10-06', 'Asia/Dubai')).toThrow();
  });
});

describe('permit checklists', () => {
  it('ships a default checklist for every permit type, unticked', () => {
    for (const type of SAFETY_PERMIT_TYPES) {
      expect(SAFETY_PERMIT_CHECKLISTS[type].length).toBeGreaterThan(2);
      expect(safetyDefaultChecklist(type).every((item) => !item.checked)).toBe(true);
    }
  });
});

describe('quick-capture suggestion without a model', () => {
  it('reads a missing harness as an unsafe act at height', () => {
    expect(safetySuggestFromNote('Worker on the slab edge without harness')).toEqual({
      type: 'unsafe_act',
      category: 'work_at_height',
      severity: 'high',
    });
  });

  it('reads an unshored trench as a condition', () => {
    expect(safetySuggestFromNote('Trench 2m deep, sides not shored')).toMatchObject({
      type: 'unsafe_condition',
      category: 'excavation',
    });
  });

  it('reads praise as a positive observation', () => {
    expect(safetySuggestFromNote('Good housekeeping on level 3, well done')).toEqual({
      type: 'positive',
      category: 'housekeeping',
      severity: 'low',
    });
  });

  it('falls back to other', () => {
    expect(safetySuggestFromNote('Something looked off').category).toBe('other');
  });
});

describe('numbering', () => {
  it('pads so numbers sort as text', () => {
    expect(safetyNumber('INC', 7)).toBe('INC-0007');
  });
});
