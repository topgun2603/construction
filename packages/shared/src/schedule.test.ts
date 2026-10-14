import { describe, expect, it } from 'vitest';
import { COUNTRY_PRESETS } from './locale';
import {
  ScheduleCycleError,
  ScheduleInputError,
  ScheduleWorkCalendar,
  scheduleCompute,
  scheduleDefaultWorkingDays,
  scheduleFindCycle,
  scheduleLookAheadCsv,
  scheduleLookAheadEvent,
  scheduleVarianceOf,
  type ScheduleEngineInput,
  type ScheduleEngineLink,
  type ScheduleEngineTask,
} from './schedule';

/*
 * Reference week: Sunday 4 October 2026 to Saturday 10 October.
 *   Sun 04 · Mon 05 · Tue 06 · Wed 07 · Thu 08 · Fri 09 · Sat 10
 */
const MON_FRI = { working_days: [1, 2, 3, 4, 5], holidays: [] };
const INDIA = { working_days: scheduleDefaultWorkingDays('IN'), holidays: [] };
const SAUDI = { working_days: scheduleDefaultWorkingDays('SA'), holidays: [] };

function task(id: string, duration: number, extra: Partial<ScheduleEngineTask> = {}): ScheduleEngineTask {
  return {
    id,
    name: id,
    parent_id: null,
    kind: 'task',
    duration_days: duration,
    constraint_type: 'asap',
    constraint_date: null,
    percent_complete: 0,
    actual_start: null,
    actual_finish: null,
    ...extra,
  };
}

function link(
  predecessor_id: string,
  successor_id: string,
  type: ScheduleEngineLink['type'] = 'FS',
  lag_days = 0,
): ScheduleEngineLink {
  return { predecessor_id, successor_id, type, lag_days };
}

function run(partial: Partial<ScheduleEngineInput> & Pick<ScheduleEngineInput, 'tasks'>) {
  return scheduleCompute({
    project_start: '2026-10-05',
    calendar: MON_FRI,
    links: [],
    ...partial,
  });
}

describe('working calendar', () => {
  it('starts each country from its own weekend', () => {
    expect(scheduleDefaultWorkingDays('IN')).toEqual([1, 2, 3, 4, 5, 6]);
    expect(scheduleDefaultWorkingDays('SA')).toEqual([0, 1, 2, 3, 4]);
    expect(scheduleDefaultWorkingDays('QA')).toEqual([0, 1, 2, 3, 4]);
    // The UAE moved its weekend to Saturday–Sunday in 2022.
    expect(scheduleDefaultWorkingDays('AE')).toEqual([1, 2, 3, 4, 5]);
    expect(scheduleDefaultWorkingDays('NP')).toEqual([0, 1, 2, 3, 4, 5]);
    expect(scheduleDefaultWorkingDays('ZZ')).toEqual([1, 2, 3, 4, 5]);
  });

  it('has a working week for every country a company can pick', () => {
    for (const preset of COUNTRY_PRESETS) {
      const days = scheduleDefaultWorkingDays(preset.country);
      expect(days.length).toBeGreaterThanOrEqual(5);
    }
  });

  it('counts a Gulf week Sunday to Thursday and an Indian one Monday to Saturday', () => {
    const gulf = new ScheduleWorkCalendar(SAUDI, '2026-10-01');
    expect(gulf.finishFor('2026-10-04', 5)).toBe('2026-10-08');
    expect(gulf.isWorkday('2026-10-09')).toBe(false);
    expect(gulf.workdaysInclusive('2026-10-04', '2026-10-10')).toBe(5);

    const india = new ScheduleWorkCalendar(INDIA, '2026-10-01');
    expect(india.finishFor('2026-10-05', 6)).toBe('2026-10-10');
    expect(india.finishFor('2026-10-05', 7)).toBe('2026-10-12');
    expect(india.workdaysInclusive('2026-10-04', '2026-10-10')).toBe(6);
  });

  it('skips holidays and starts work on the next working day', () => {
    const calendar = new ScheduleWorkCalendar(
      { working_days: [1, 2, 3, 4, 5], holidays: ['2026-10-07'] },
      '2026-10-01',
    );
    expect(calendar.isWorkday('2026-10-07')).toBe(false);
    expect(calendar.finishFor('2026-10-05', 3)).toBe('2026-10-08');
    expect(calendar.finishFor('2026-10-03', 1)).toBe('2026-10-05');
  });

  it('measures signed working days and reaches back before its origin', () => {
    const calendar = new ScheduleWorkCalendar(MON_FRI, '2026-10-05');
    expect(calendar.workdaysBetween('2026-10-05', '2026-10-12')).toBe(5);
    expect(calendar.workdaysBetween('2026-10-12', '2026-10-05')).toBe(-5);
    // Both in the same weekend: no working days apart.
    expect(calendar.workdaysBetween('2026-10-10', '2026-10-11')).toBe(0);
    expect(calendar.indexOnOrAfter('2026-10-01')).toBe(-2);
    expect(calendar.dateAt(-2)).toBe('2026-10-01');
    expect(calendar.indexOnOrAfter('2026-10-03')).toBe(0);
    expect(calendar.indexOnOrBefore('2026-10-04')).toBe(-1);
    expect(calendar.dateAt(-1)).toBe('2026-10-02');
  });

  it('refuses a week with no working days', () => {
    expect(() => new ScheduleWorkCalendar({ working_days: [], holidays: [] }, '2026-10-05')).toThrow(
      /at least one working weekday/,
    );
  });
});

describe('critical path', () => {
  /*
   *   A(3) ─┬─> B(2) ──┐
   *         └─> C(4) ──┴─> D(1)
   * A–C–D is eight days; B has two days of float.
   */
  const network = {
    tasks: [task('A', 3), task('B', 2), task('C', 4), task('D', 1)],
    links: [link('A', 'B'), link('A', 'C'), link('B', 'D'), link('C', 'D')],
  };

  it('finds the longest path and the float everywhere else', () => {
    const result = run(network);
    expect(result.critical_path).toEqual(['A', 'C', 'D']);
    expect(result.tasks['A']).toMatchObject({ start: '2026-10-05', finish: '2026-10-07', total_float: 0 });
    expect(result.tasks['C']).toMatchObject({ start: '2026-10-08', finish: '2026-10-13', critical: true });
    expect(result.tasks['B']).toMatchObject({
      start: '2026-10-08',
      finish: '2026-10-09',
      late_start: '2026-10-12',
      late_finish: '2026-10-13',
      total_float: 2,
      free_float: 2,
      critical: false,
    });
    expect(result.tasks['D']).toMatchObject({ start: '2026-10-14', finish: '2026-10-14' });
    expect(result.finish_date).toBe('2026-10-14');
  });

  it('gives the same answer on a Gulf calendar, shifted onto its working days', () => {
    const result = run({ ...network, project_start: '2026-10-04', calendar: SAUDI });
    expect(result.tasks['A']).toMatchObject({ start: '2026-10-04', finish: '2026-10-06' });
    // Thursday, then the weekend, then Sunday.
    expect(result.tasks['C']).toMatchObject({ start: '2026-10-07', finish: '2026-10-12' });
    expect(result.finish_date).toBe('2026-10-13');
  });

  it('starts work on the first working day when the project starts on a weekend', () => {
    const result = run({ tasks: [task('A', 1)], project_start: '2026-10-03' });
    expect(result.tasks['A']!.start).toBe('2026-10-05');
    expect(result.project_start).toBe('2026-10-05');
  });

  it('honours start-to-start, finish-to-finish and start-to-finish with lags and leads', () => {
    const result = run({
      tasks: [task('A', 5), task('SS', 3), task('FF', 2), task('SF', 2), task('LEAD', 2)],
      links: [
        link('A', 'SS', 'SS', 2),
        link('A', 'FF', 'FF', 1),
        link('A', 'SF', 'SF', 3),
        link('A', 'LEAD', 'FS', -2),
      ],
    });
    // A: Mon 05 – Fri 09.
    expect(result.tasks['SS']).toMatchObject({ start: '2026-10-07', finish: '2026-10-09' });
    // FF+1: finishes one working day after A, Monday 12th; two days long so starts Fri 9th.
    expect(result.tasks['FF']).toMatchObject({ start: '2026-10-09', finish: '2026-10-12' });
    // SF+3: finishes by A's start + 3 → boundary index 3 → occupies Tue–Wed.
    expect(result.tasks['SF']).toMatchObject({ start: '2026-10-06', finish: '2026-10-07' });
    // Two-day lead: starts two days before A finishes.
    expect(result.tasks['LEAD']).toMatchObject({ start: '2026-10-08', finish: '2026-10-09' });
  });

  it('holds a task to its start-no-earlier-than date and the chain behind it', () => {
    const result = run({
      tasks: [task('A', 2), task('B', 2, { constraint_type: 'snet', constraint_date: '2026-10-14' }), task('C', 1)],
      links: [link('A', 'B'), link('B', 'C')],
    });
    expect(result.tasks['B']).toMatchObject({ start: '2026-10-14', finish: '2026-10-15', critical: true });
    expect(result.tasks['C']!.start).toBe('2026-10-16');
    // A now has float up to the constraint.
    expect(result.tasks['A']!.total_float).toBe(5);
  });

  it('shows negative float when a finish-no-later-than date cannot be met', () => {
    const result = run({
      tasks: [task('A', 5), task('B', 5, { constraint_type: 'fnlt', constraint_date: '2026-10-14' })],
      links: [link('A', 'B')],
    });
    expect(result.tasks['B']!.finish).toBe('2026-10-16');
    expect(result.tasks['B']!.total_float).toBe(-2);
    expect(result.tasks['A']!.total_float).toBe(-2);
    expect(result.critical_path).toEqual(['A', 'B']);
  });

  it('puts a milestone on the day its predecessor finishes, and an unlinked one at the start', () => {
    const result = run({
      tasks: [
        task('Pour', 3),
        task('Slab cast', 0, { kind: 'milestone' }),
        task('Kick-off', 0, { kind: 'milestone' }),
        task('Strip', 2),
        task('Permit', 0, { kind: 'milestone', constraint_type: 'snet', constraint_date: '2026-10-12' }),
      ],
      links: [link('Pour', 'Slab cast'), link('Slab cast', 'Strip')],
    });
    expect(result.tasks['Slab cast']).toMatchObject({ start: '2026-10-07', finish: '2026-10-07' });
    expect(result.tasks['Strip']!.start).toBe('2026-10-08');
    expect(result.tasks['Kick-off']!.start).toBe('2026-10-05');
    expect(result.tasks['Permit']!.start).toBe('2026-10-12');
    expect(result.tasks['Permit']!.duration_days).toBe(0);
  });
});

describe('cycles', () => {
  it('names the loop in order', () => {
    const loop = scheduleFindCycle(['A', 'B', 'C', 'D'], [link('A', 'B'), link('B', 'C'), link('C', 'A'), link('C', 'D')]);
    expect(loop).not.toBeNull();
    expect(loop).toHaveLength(4);
    expect(loop![0]).toBe(loop![3]);
    // Each step follows a real link.
    const edges = new Set(['A>B', 'B>C', 'C>A']);
    for (let i = 0; i < 3; i += 1) expect(edges.has(`${loop![i]}>${loop![i + 1]}`)).toBe(true);
  });

  it('finds none in a network that only branches and joins', () => {
    expect(scheduleFindCycle(['A', 'B', 'C'], [link('A', 'B'), link('A', 'C'), link('B', 'C')])).toBeNull();
  });

  it('refuses to schedule a loop', () => {
    expect(() =>
      run({ tasks: [task('A', 1), task('B', 1)], links: [link('A', 'B'), link('B', 'A', 'SS')] }),
    ).toThrow(ScheduleCycleError);
    try {
      run({ tasks: [task('A', 1), task('B', 1)], links: [link('A', 'B'), link('B', 'A')] });
    } catch (error) {
      expect((error as ScheduleCycleError).message).toMatch(/A → B → A|B → A → B/);
    }
    expect(() => run({ tasks: [task('A', 1)], links: [link('A', 'A')] })).toThrow(ScheduleCycleError);
  });

  it('refuses a link to a summary task', () => {
    expect(() =>
      run({
        tasks: [task('S', 1), task('A', 1, { parent_id: 'S' }), task('B', 1)],
        links: [link('S', 'B')],
      }),
    ).toThrow(ScheduleInputError);
  });
});

describe('progress', () => {
  it('uses actual dates over the logic, and successors follow what happened', () => {
    const result = run({
      tasks: [
        task('A', 3, { actual_start: '2026-10-05', actual_finish: '2026-10-09', percent_complete: 100 }),
        task('B', 2),
      ],
      links: [link('A', 'B')],
    });
    expect(result.tasks['A']).toMatchObject({
      start: '2026-10-05',
      finish: '2026-10-09',
      status: 'complete',
      duration_days: 5,
      critical: false,
    });
    expect(result.tasks['B']).toMatchObject({ start: '2026-10-12', critical: true });
  });

  it('does not leave the remaining work of a late task in the past', () => {
    const tasks = [task('A', 4, { actual_start: '2026-10-05', percent_complete: 50 }), task('B', 1)];
    const links = [link('A', 'B')];
    // Without a status date the task keeps its planned four days.
    expect(run({ tasks, links }).tasks['A']!.finish).toBe('2026-10-08');
    // Reported on the 14th with half to do: two more days from the 14th.
    const late = run({ tasks, links, status_date: '2026-10-14' });
    expect(late.tasks['A']).toMatchObject({ status: 'in_progress', finish: '2026-10-15', behind: false });
    expect(late.tasks['B']!.start).toBe('2026-10-16');
  });

  it('flags work that should have started or finished by the status date', () => {
    const result = run({
      tasks: [task('A', 2), task('B', 2), task('C', 2, { constraint_type: 'snet', constraint_date: '2026-10-20' })],
      links: [link('A', 'B')],
      status_date: '2026-10-07',
    });
    expect(result.tasks['A']!.behind).toBe(true);
    expect(result.tasks['B']!.behind).toBe(false);
    expect(result.tasks['C']!.behind).toBe(false);
  });

  it('accepts a start date before the project start for work already done', () => {
    const result = run({
      tasks: [task('Survey', 2, { actual_start: '2026-09-28', actual_finish: '2026-09-29' }), task('B', 1)],
      links: [link('Survey', 'B')],
    });
    expect(result.tasks['Survey']).toMatchObject({ start: '2026-09-28', finish: '2026-09-29' });
    // Not before the project start, even though its predecessor finished earlier.
    expect(result.tasks['B']!.start).toBe('2026-10-05');
  });

  it('places a finished milestone on the day it was reached', () => {
    const result = run({
      tasks: [task('Handover', 0, { kind: 'milestone', actual_finish: '2026-10-07' })],
    });
    expect(result.tasks['Handover']).toMatchObject({ start: '2026-10-07', status: 'complete', percent_complete: 100 });
  });
});

describe('summary tasks', () => {
  it('roll up dates, float, criticality and progress by duration', () => {
    const result = run({
      tasks: [
        task('Frame', 0),
        task('Columns', 2, { parent_id: 'Frame', actual_start: '2026-10-05', actual_finish: '2026-10-06' }),
        task('Beams', 6, { parent_id: 'Frame' }),
        task('Finishes', 0),
        task('Paint', 2, { parent_id: 'Finishes' }),
      ],
      links: [link('Columns', 'Beams'), link('Columns', 'Paint')],
    });
    expect(result.tasks['Frame']).toMatchObject({
      is_summary: true,
      start: '2026-10-05',
      finish: '2026-10-14',
      // Two of eight working days done.
      percent_complete: 25,
      status: 'in_progress',
      critical: true,
    });
    expect(result.tasks['Finishes']).toMatchObject({ is_summary: true, critical: false, total_float: 4 });
    // Summaries are never on the critical path list itself; their work is.
    expect(result.critical_path).toEqual(['Beams']);
  });
});

describe('baseline variance', () => {
  it('counts the slip in working days', () => {
    const calendar = new ScheduleWorkCalendar(MON_FRI, '2026-10-01');
    expect(
      scheduleVarianceOf(
        calendar,
        { start: '2026-10-05', finish: '2026-10-09' },
        { start: '2026-10-07', finish: '2026-10-13' },
      ),
    ).toEqual({ start_variance: 2, finish_variance: 2, slipped: true });
    expect(
      scheduleVarianceOf(
        calendar,
        { start: '2026-10-07', finish: '2026-10-09' },
        { start: '2026-10-06', finish: '2026-10-08' },
      ),
    ).toEqual({ start_variance: -1, finish_variance: -1, slipped: false });
  });
});

describe('look-ahead', () => {
  it('picks out what starts or finishes in the window', () => {
    expect(scheduleLookAheadEvent({ start: '2026-10-07', finish: '2026-10-30' }, '2026-10-06', '2026-10-19')).toBe('starts');
    expect(scheduleLookAheadEvent({ start: '2026-09-01', finish: '2026-10-19' }, '2026-10-06', '2026-10-19')).toBe('finishes');
    expect(scheduleLookAheadEvent({ start: '2026-10-06', finish: '2026-10-08' }, '2026-10-06', '2026-10-19')).toBe(
      'starts_and_finishes',
    );
    expect(scheduleLookAheadEvent({ start: '2026-09-01', finish: '2026-11-01' }, '2026-10-06', '2026-10-19')).toBeNull();
  });

  it('writes a sheet with quoted cells', () => {
    const csv = scheduleLookAheadCsv([
      {
        site: 'Lake View',
        wbs: '1.2',
        task: 'Shuttering, level 2',
        start: '2026-10-07',
        finish: '2026-10-09',
        percent_complete: 0,
        critical: true,
        responsible: 'Ravi',
        event: 'starts_and_finishes',
      },
    ]);
    const [header, row] = csv.trim().split('\r\n');
    expect(header).toBe('Site,WBS,Task,Start,Finish,Percent complete,Critical,Responsible,In window');
    expect(row).toBe('Lake View,1.2,"Shuttering, level 2",2026-10-07,2026-10-09,0,Yes,Ravi,Starts and finishes');
  });
});
