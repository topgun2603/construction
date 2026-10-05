import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ScheduleImportError } from './import-plan';
import { isoDurationMinutes } from './msproject';
import { parseScheduleXml } from './schedule-xml';

const fixture = (name: string) =>
  readFileSync(join(__dirname, '../../../../test/fixtures/schedule', name), 'utf8');

describe('Microsoft Project XML', () => {
  const plan = parseScheduleXml(fixture('msproject-villa.xml'));

  it('reads the outline, with the project summary row left out', () => {
    expect(plan.format).toBe('msproject');
    expect(plan.project_name).toBe('Villa 12, Al Barsha');
    expect(plan.start).toBe('2026-08-02');
    expect(plan.tasks.map((task) => [task.wbs, task.depth, task.is_summary])).toEqual([
      ['1', 0, true],
      ['1.1', 1, false],
      ['1.2', 1, false],
      ['1.3', 1, false],
      ['2', 0, true],
      ['2.1', 1, false],
      ['2.2', 1, false],
      ['2.3', 1, false],
      ['3', 0, false],
      ['4', 0, false],
    ]);
    expect(plan.tasks[2]!.name).toBe('Footings & PCC');
    expect(plan.tasks[2]!.parent_ref).toBe('1');
  });

  it('converts work time to days and keeps progress', () => {
    const byRef = new Map(plan.tasks.map((task) => [task.ref, task]));
    expect(byRef.get('2')).toMatchObject({
      duration_days: 5,
      percent_complete: 100,
      actual_start: '2026-08-02',
      actual_finish: '2026-08-06',
    });
    expect(byRef.get('3')).toMatchObject({ duration_days: 8, percent_complete: 25, actual_start: '2026-08-09' });
    expect(byRef.get('8')).toMatchObject({ kind: 'milestone', duration_days: 0 });
    expect(byRef.get('9')).toMatchObject({ constraint_type: 'snet', constraint_date: '2026-08-23' });
    expect(byRef.get('10')).toMatchObject({ kind: 'milestone', constraint_type: 'fnlt', constraint_date: '2026-10-29' });
  });

  it('reads link types and lags, and drops links to summaries with a warning', () => {
    expect(plan.links).toEqual([
      { predecessor_ref: '2', successor_ref: '3', type: 'FS', lag_days: 0 },
      { predecessor_ref: '3', successor_ref: '4', type: 'SS', lag_days: 2 },
      { predecessor_ref: '4', successor_ref: '6', type: 'FS', lag_days: 0 },
      { predecessor_ref: '6', successor_ref: '7', type: 'FF', lag_days: 1 },
      { predecessor_ref: '7', successor_ref: '8', type: 'FS', lag_days: 0 },
      { predecessor_ref: '8', successor_ref: '10', type: 'FS', lag_days: 0 },
      { predecessor_ref: '9', successor_ref: '10', type: 'FS', lag_days: 0 },
    ]);
    expect(plan.warnings.join(' ')).toMatch(/1 link\(s\) to or from summary tasks/);
  });

  it('takes the Gulf working week and the holiday from the base calendar', () => {
    expect(plan.calendar).toEqual({
      name: 'Gulf Standard',
      working_days: [0, 1, 2, 3, 4],
      holidays: ['2026-12-02', '2026-12-03'],
    });
  });

  it('parses ISO work durations', () => {
    expect(isoDurationMinutes('PT40H0M0S')).toBe(2400);
    expect(isoDurationMinutes('PT7H30M0S')).toBe(450);
    expect(isoDurationMinutes('P1DT2H')).toBe(1560);
    expect(isoDurationMinutes('nonsense')).toBe(0);
  });
});

describe('Primavera P6 XML', () => {
  const plan = parseScheduleXml(fixture('p6-tower.xml'));

  it('turns the breakdown into summaries and the activities into tasks under them', () => {
    expect(plan.format).toBe('p6');
    expect(plan.project_name).toBe('Tower A foundations');
    expect(plan.start).toBe('2026-08-03');
    expect(plan.tasks.map((task) => [task.wbs, task.name, task.depth])).toEqual([
      ['PIL', 'Piling', 0],
      ['A1000', 'Mobilisation', 1],
      ['A1010', 'Bored piles', 1],
      ['RFT', 'Raft', 0],
      ['A1020', 'Pile caps', 1],
      ['A1030', 'Raft concrete', 1],
      ['A1040', 'Raft complete', 1],
    ]);
    expect(plan.warnings.join(' ')).toMatch(/1 breakdown heading\(s\) with no activities/);
  });

  it('converts hours to days, fractions to percent, and keeps constraints and actuals', () => {
    const byWbs = new Map(plan.tasks.map((task) => [task.wbs, task]));
    expect(byWbs.get('A1000')).toMatchObject({ duration_days: 3, percent_complete: 100, actual_finish: '2026-08-05' });
    expect(byWbs.get('A1010')).toMatchObject({ duration_days: 12, percent_complete: 40, actual_start: '2026-08-06' });
    expect(byWbs.get('A1030')).toMatchObject({ constraint_type: 'snet', constraint_date: '2026-08-26' });
    expect(byWbs.get('A1040')).toMatchObject({ kind: 'milestone', duration_days: 0 });
  });

  it('reads relationships with their lags and drops the one to a missing activity', () => {
    expect(plan.links).toEqual([
      { predecessor_ref: 'act:2001', successor_ref: 'act:2002', type: 'FS', lag_days: 0 },
      { predecessor_ref: 'act:2002', successor_ref: 'act:2003', type: 'SS', lag_days: 4 },
      { predecessor_ref: 'act:2003', successor_ref: 'act:2004', type: 'FF', lag_days: 1 },
      { predecessor_ref: 'act:2004', successor_ref: 'act:2005', type: 'FS', lag_days: 0 },
    ]);
    expect(plan.warnings.join(' ')).toMatch(/1 link\(s\) to tasks that are not in the file/);
  });

  it('reads the six-day week and the holiday', () => {
    expect(plan.calendar).toEqual({
      name: 'India 6-day',
      working_days: [1, 2, 3, 4, 5, 6],
      holidays: ['2026-08-15'],
    });
  });
});

describe('what is not a schedule', () => {
  it('refuses other XML, broken XML and entity declarations', () => {
    expect(() => parseScheduleXml('<invoice><total>3</total></invoice>')).toThrow(ScheduleImportError);
    expect(() => parseScheduleXml('<Project><Tasks>')).toThrow(ScheduleImportError);
    expect(() =>
      parseScheduleXml('<?xml version="1.0"?><!DOCTYPE x [<!ENTITY a "aaaa">]><Project><Tasks/></Project>'),
    ).toThrow(/document type/);
  });

  it('refuses a file of the other format when one was chosen', () => {
    expect(() => parseScheduleXml(fixture('p6-tower.xml'), 'msproject')).toThrow(/Primavera P6 export/);
  });
});
