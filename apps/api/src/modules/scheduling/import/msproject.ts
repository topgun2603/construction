import type { ScheduleConstraintType, ScheduleLinkType } from '@sitebook/shared';
import {
  datesInRange,
  keepSchedulableLinks,
  outlineOrder,
  xmlDate,
  xmlList,
  xmlNumber,
  xmlText,
  type ImportedCalendar,
  type ImportedLink,
  type ImportedTask,
  type ScheduleImportPlan,
} from './import-plan';

/**
 * Microsoft Project XML (MSPDI) — what File → Save As → XML writes, from Project 2003 on.
 *
 * Durations are ISO 8601 work time (`PT40H0M0S`) and lags are tenths of a minute, both converted
 * to days through the file's own minutes-per-day. The outline comes from `OutlineLevel`, which
 * every version writes; `OutlineNumber` and `WBS` are kept as the task's code.
 */

/** MSPDI link types: 0 FF, 1 FS, 2 SF, 3 SS. */
const LINK_TYPES: Record<number, ScheduleLinkType> = { 0: 'FF', 1: 'FS', 2: 'SF', 3: 'SS' };

/** Percentage lag formats (19, 20 and their elapsed twins) cannot be converted without the duration. */
const PERCENT_LAG_FORMATS = new Set([19, 20]);

type Node = Record<string, unknown>;

export function parseMsProject(root: Node): ScheduleImportPlan {
  const warnings: string[] = [];
  const minutesPerDay = xmlNumber(root['MinutesPerDay']) || 480;

  const calendar = projectCalendar(root, warnings);

  const raw = xmlList<Node>((root['Tasks'] as Node | undefined)?.['Task']);
  // UID 0 is the project summary row MSP writes above everything; null tasks are blank lines.
  const rows = raw.filter((task) => xmlNumber(task['OutlineLevel']) !== 0 && xmlText(task['IsNull']) !== '1');

  let approximated = 0;
  let percentLags = 0;
  const tasks: ImportedTask[] = [];
  const links: ImportedLink[] = [];
  /** The latest task seen at each outline level: a task's parent is the last one a level up. */
  const lastAtLevel: string[] = [];

  for (const row of rows) {
    const ref = xmlText(row['UID']);
    if (!ref) continue;
    const level = Math.max(1, xmlNumber(row['OutlineLevel']) ?? 1);
    lastAtLevel[level] = ref;
    lastAtLevel.length = level + 1;
    const parentRef = level > 1 ? (lastAtLevel[level - 1] ?? null) : null;

    const milestone = xmlText(row['Milestone']) === '1';
    const minutes = isoDurationMinutes(xmlText(row['Duration']));
    const days = Math.round(minutes / minutesPerDay);
    const { type: constraintType, date: constraintDate, approximate } = constraintOf(row);
    if (approximate) approximated += 1;

    const start = xmlDate(row['Start']);
    let pinned = { type: constraintType, date: constraintDate };
    // A manually scheduled task sits where it was put, whatever its links say.
    if (xmlText(row['Manual']) === '1' && start && constraintType === 'asap') {
      pinned = { type: 'snet', date: start };
    }

    tasks.push({
      ref,
      parent_ref: parentRef,
      depth: 0,
      wbs: xmlText(row['WBS']) ?? xmlText(row['OutlineNumber']),
      name: xmlText(row['Name']) ?? `Task ${ref}`,
      kind: milestone || days === 0 ? 'milestone' : 'task',
      is_summary: false,
      duration_days: milestone ? 0 : Math.max(days, 0),
      start,
      finish: xmlDate(row['Finish']),
      percent_complete: clamp(xmlNumber(row['PercentComplete']) ?? 0),
      actual_start: xmlDate(row['ActualStart']),
      actual_finish: xmlDate(row['ActualFinish']),
      constraint_type: pinned.type,
      constraint_date: pinned.type === 'asap' ? null : pinned.date,
      notes: xmlText(row['Notes']),
    });

    for (const link of xmlList<Node>(row['PredecessorLink'])) {
      const predecessor = xmlText(link['PredecessorUID']);
      if (!predecessor) continue;
      const format = xmlNumber(link['LagFormat']) ?? 7;
      let lag = 0;
      if (PERCENT_LAG_FORMATS.has(format)) percentLags += 1;
      // LinkLag is in tenths of a minute whatever format it is displayed in.
      else lag = Math.round((xmlNumber(link['LinkLag']) ?? 0) / 10 / minutesPerDay);
      links.push({
        predecessor_ref: predecessor,
        successor_ref: ref,
        type: LINK_TYPES[xmlNumber(link['Type']) ?? 1] ?? 'FS',
        lag_days: lag,
      });
    }
  }

  const ordered = outlineOrder(tasks);
  // A summary with nothing under it in the file is just a task; one with children is scheduled by them.
  for (const task of ordered) {
    if (!task.is_summary && task.kind === 'task' && task.duration_days === 0) task.kind = 'milestone';
  }
  if (approximated) {
    warnings.push(
      `${approximated} constraint(s) other than "start no earlier than" and "finish no later than" were approximated.`,
    );
  }
  if (percentLags) warnings.push(`${percentLags} percentage lag(s) were imported as no lag.`);

  return {
    format: 'msproject',
    project_name: xmlText(root['Title']) ?? stripXml(xmlText(root['Name'])),
    start: xmlDate(root['StartDate']),
    calendar,
    tasks: ordered,
    links: keepSchedulableLinks(ordered, links, warnings),
    warnings,
  };
}

/**
 * The project's base calendar: which weekdays are worked, and the exceptions that are days off.
 * `DayType` 1 is Sunday through 7 Saturday; 0 is an exception in the 2003 format.
 */
function projectCalendar(root: Node, warnings: string[]): ImportedCalendar | null {
  const calendars = xmlList<Node>((root['Calendars'] as Node | undefined)?.['Calendar']);
  if (calendars.length === 0) return null;
  const wanted = xmlText(root['CalendarUID']);
  const calendar =
    calendars.find((entry) => xmlText(entry['UID']) === wanted) ??
    calendars.find((entry) => xmlText(entry['IsBaseCalendar']) === '1') ??
    calendars[0]!;

  const working = new Set([1, 2, 3, 4, 5]);
  const holidays: string[] = [];
  for (const day of xmlList<Node>((calendar['WeekDays'] as Node | undefined)?.['WeekDay'])) {
    const type = xmlNumber(day['DayType']);
    const works = xmlText(day['DayWorking']) === '1';
    if (type !== null && type >= 1 && type <= 7) {
      if (works) working.add(type - 1);
      else working.delete(type - 1);
    } else if (type === 0 && !works) {
      holidays.push(...periodDates(day['TimePeriod']));
    }
  }
  for (const exception of xmlList<Node>((calendar['Exceptions'] as Node | undefined)?.['Exception'])) {
    if (xmlText(exception['DayWorking']) === '1') continue;
    holidays.push(...periodDates(exception['TimePeriod']));
  }
  if (working.size === 0) {
    warnings.push('The file’s calendar works no weekdays; the company calendar was kept.');
    return null;
  }
  return {
    name: xmlText(calendar['Name']) ?? 'Imported calendar',
    working_days: [...working].sort((a, b) => a - b),
    holidays: [...new Set(holidays)].sort(),
  };
}

function periodDates(period: unknown): string[] {
  const node = xmlList<Node>(period)[0];
  if (!node) return [];
  const from = xmlDate(node['FromDate']);
  const to = xmlDate(node['ToDate']) ?? from;
  return from && to ? datesInRange(from, to) : [];
}

/** MSPDI constraint types: 0 ASAP, 1 ALAP, 2 MSO, 3 MFO, 4 SNET, 5 SNLT, 6 FNET, 7 FNLT. */
function constraintOf(row: Node): {
  type: ScheduleConstraintType;
  date: string | null;
  approximate: boolean;
} {
  const code = xmlNumber(row['ConstraintType']) ?? 0;
  const date = xmlDate(row['ConstraintDate']);
  if (!date || code === 0) return { type: 'asap', date: null, approximate: code !== 0 && !date };
  switch (code) {
    case 4:
      return { type: 'snet', date, approximate: false };
    case 7:
      return { type: 'fnlt', date, approximate: false };
    case 2: // Must start on: the earliest it may start is the date.
      return { type: 'snet', date, approximate: true };
    case 3: // Must finish on: the latest it may finish is the date.
      return { type: 'fnlt', date, approximate: true };
    default:
      return { type: 'asap', date: null, approximate: true };
  }
}

/** `PT40H0M0S`, `P2DT4H`, `PT0H0M0S` → minutes of work. */
export function isoDurationMinutes(value: string | null): number {
  if (!value) return 0;
  const match = /^-?P(?:(\d+(?:\.\d+)?)D)?(?:T(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?)?$/.exec(
    value.trim(),
  );
  if (!match) return 0;
  const [, days, hours, minutes, seconds] = match;
  // A "day" inside an MSPDI duration is 24 elapsed hours; the work-time part is what matters.
  return (
    Number(days ?? 0) * 24 * 60 + Number(hours ?? 0) * 60 + Number(minutes ?? 0) + Number(seconds ?? 0) / 60
  );
}

function clamp(value: number): number {
  return Math.min(100, Math.max(0, Math.round(value)));
}

/** MSP writes the file name as the project name when there is no title. */
function stripXml(name: string | null): string | null {
  return name ? name.replace(/\.(xml|mpp)$/i, '') : null;
}
