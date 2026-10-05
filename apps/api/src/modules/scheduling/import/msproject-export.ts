import type { ScheduleLinkType, ScheduleResult } from '@sitebook/shared';
import { utcDateToIsoDate } from '@sitebook/shared';
import { linkedMilestone, type ScheduleContext } from '../schedule-context';

/**
 * The schedule as Microsoft Project XML (MSPDI), which Project opens with File → Open and which
 * Primavera, Asta and most other planning tools also read.
 *
 * Eight-hour days, so a working day here is 480 minutes there. Tasks are written as automatically
 * scheduled with their constraints, so Project lays them out the way this schedule does.
 */

const LINK_CODES: Record<ScheduleLinkType, number> = { FF: 0, FS: 1, SF: 2, SS: 3 };
const MINUTES_PER_DAY = 480;

function escape(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

const tag = (name: string, value: string | number) => `<${name}>${typeof value === 'number' ? value : escape(value)}</${name}>`;
const startOf = (day: string) => `${day}T08:00:00`;
const finishOf = (day: string) => `${day}T17:00:00`;
const hours = (days: number) => `PT${days * 8}H0M0S`;

export function msProjectXml(ctx: ScheduleContext, result: ScheduleResult): string {
  // MSP wants small integer UIDs; number the tasks in outline order.
  const uid = new Map(ctx.tasks.map((task, index) => [task.id, index + 1]));
  const outline = new Map<string, string>();
  const counters = new Map<string | null, number>();
  for (const task of ctx.tasks) {
    const parent = task.parentId && uid.has(task.parentId) ? task.parentId : null;
    const next = (counters.get(parent) ?? 0) + 1;
    counters.set(parent, next);
    outline.set(task.id, parent ? `${outline.get(parent)}.${next}` : String(next));
  }
  const predecessors = new Map<string, typeof ctx.links>();
  for (const link of ctx.links) {
    const list = predecessors.get(link.successorId) ?? [];
    list.push(link);
    predecessors.set(link.successorId, list);
  }

  const weekDays = [1, 2, 3, 4, 5, 6, 7]
    .map((dayType) => {
      const works = ctx.calendar.working_days.includes(dayType - 1);
      const times = works
        ? '<WorkingTimes><WorkingTime><FromTime>08:00:00</FromTime><ToTime>12:00:00</ToTime></WorkingTime>' +
          '<WorkingTime><FromTime>13:00:00</FromTime><ToTime>17:00:00</ToTime></WorkingTime></WorkingTimes>'
        : '';
      return `<WeekDay>${tag('DayType', dayType)}${tag('DayWorking', works ? 1 : 0)}${times}</WeekDay>`;
    })
    .join('');
  const exceptions = ctx.calendar.holidays
    .map(
      (day) =>
        `<Exception><EnteredByOccurrences>0</EnteredByOccurrences><TimePeriod>${tag('FromDate', `${day}T00:00:00`)}${tag(
          'ToDate',
          `${day}T23:59:00`,
        )}</TimePeriod>${tag('Name', 'Holiday')}<Type>1</Type><DayWorking>0</DayWorking></Exception>`,
    )
    .join('');

  const tasks = ctx.tasks
    .map((task) => {
      const computed = result.tasks[task.id]!;
      const depth = (outline.get(task.id) ?? '1').split('.').length;
      const milestone = task.kind === 'milestone' && !computed.is_summary;
      const reached = linkedMilestone(task)?.actualDate ?? task.actualFinish;
      const parts = [
        tag('UID', uid.get(task.id)!),
        tag('ID', uid.get(task.id)!),
        tag('Name', task.name),
        tag('WBS', ctx.wbs.get(task.id) ?? outline.get(task.id)!),
        tag('OutlineNumber', outline.get(task.id)!),
        tag('OutlineLevel', depth),
        tag('Summary', computed.is_summary ? 1 : 0),
        tag('Milestone', milestone ? 1 : 0),
        tag('Manual', 0),
        tag('Start', startOf(computed.start)),
        tag('Finish', finishOf(computed.finish)),
        tag('Duration', hours(computed.is_summary ? computed.duration_days : milestone ? 0 : task.durationDays)),
        tag('DurationFormat', 7),
        tag('PercentComplete', computed.percent_complete),
        tag('Critical', computed.critical ? 1 : 0),
        tag('TotalSlack', computed.total_float * MINUTES_PER_DAY * 10),
      ];
      if (!computed.is_summary) {
        const constraint = task.constraintType === 'snet' ? 4 : task.constraintType === 'fnlt' ? 7 : 0;
        parts.push(tag('ConstraintType', constraint));
        if (constraint && task.constraintDate) {
          const day = utcDateToIsoDate(task.constraintDate);
          parts.push(tag('ConstraintDate', constraint === 4 ? startOf(day) : finishOf(day)));
        }
        if (task.actualStart) parts.push(tag('ActualStart', startOf(utcDateToIsoDate(task.actualStart))));
        if (reached) parts.push(tag('ActualFinish', finishOf(utcDateToIsoDate(reached))));
      }
      if (task.notes) parts.push(tag('Notes', task.notes));
      for (const link of predecessors.get(task.id) ?? []) {
        const from = uid.get(link.predecessorId);
        if (!from) continue;
        parts.push(
          `<PredecessorLink>${tag('PredecessorUID', from)}${tag('Type', LINK_CODES[link.type])}<CrossProject>0</CrossProject>` +
            `${tag('LinkLag', link.lagDays * MINUTES_PER_DAY * 10)}${tag('LagFormat', 7)}</PredecessorLink>`,
        );
      }
      return `<Task>${parts.join('')}</Task>`;
    })
    .join('\n    ');

  const start = result.project_start;
  return [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<Project xmlns="http://schemas.microsoft.com/project">',
    `  ${tag('SaveVersion', 14)}`,
    `  ${tag('Name', `${ctx.project.name}.xml`)}`,
    `  ${tag('Title', ctx.project.name)}`,
    `  ${tag('ScheduleFromStart', 1)}`,
    `  ${tag('StartDate', startOf(start))}`,
    `  ${tag('FinishDate', finishOf(result.finish_date))}`,
    `  ${tag('CalendarUID', 1)}`,
    `  ${tag('MinutesPerDay', MINUTES_PER_DAY)}`,
    `  ${tag('MinutesPerWeek', MINUTES_PER_DAY * ctx.calendar.working_days.length)}`,
    `  ${tag('DaysPerMonth', 20)}`,
    '  <Calendars>',
    `    <Calendar>${tag('UID', 1)}${tag('Name', ctx.calendar.name)}${tag('IsBaseCalendar', 1)}<WeekDays>${weekDays}</WeekDays>${
      exceptions ? `<Exceptions>${exceptions}</Exceptions>` : ''
    }</Calendar>`,
    '  </Calendars>',
    '  <Tasks>',
    `    <Task>${tag('UID', 0)}${tag('ID', 0)}${tag('Name', ctx.project.name)}${tag('OutlineNumber', '0')}${tag(
      'OutlineLevel',
      0,
    )}${tag('Summary', 1)}</Task>`,
    tasks ? `    ${tasks}` : '',
    '  </Tasks>',
    '</Project>',
    '',
  ].join('\n');
}
