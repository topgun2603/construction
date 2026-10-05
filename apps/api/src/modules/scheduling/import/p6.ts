import type { ScheduleConstraintType, ScheduleLinkType } from '@sitebook/shared';
import {
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
 * Primavera P6 XML (`APIBusinessObjects`) — what P6 Professional and EPPM export.
 *
 * P6 keeps the breakdown (WBS) and the work (activities) apart; here the WBS nodes become summary
 * tasks and the activities sit under them. Durations and lags are hours, converted through the
 * calendar's hours per day. Only the first project in the file is imported.
 */

const LINK_TYPES: Record<string, ScheduleLinkType> = {
  'finish to start': 'FS',
  'start to start': 'SS',
  'finish to finish': 'FF',
  'start to finish': 'SF',
  pr_fs: 'FS',
  pr_ss: 'SS',
  pr_ff: 'FF',
  pr_sf: 'SF',
};

const WEEKDAYS: Record<string, number> = {
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
};

type Node = Record<string, unknown>;

export function parseP6(root: Node): ScheduleImportPlan {
  const warnings: string[] = [];
  const projects = xmlList<Node>(root['Project']);
  if (projects.length === 0) {
    return {
      format: 'p6',
      project_name: null,
      start: null,
      calendar: null,
      tasks: [],
      links: [],
      warnings: ['The file has no project in it.'],
    };
  }
  if (projects.length > 1) warnings.push(`The file has ${projects.length} projects; only the first was read.`);
  const project = projects[0]!;
  const projectId = xmlText(project['ObjectId']);

  // Calendars live at the top of the file, or inside the project for project calendars.
  const calendars = [...xmlList<Node>(root['Calendar']), ...xmlList<Node>(project['Calendar'])];
  const calendarId = xmlText(project['ActivityDefaultCalendarObjectId']);
  const calendarNode =
    calendars.find((entry) => xmlText(entry['ObjectId']) === calendarId) ??
    calendars.find((entry) => xmlText(entry['IsDefault']) === '1' || xmlText(entry['IsDefault']) === 'true') ??
    calendars[0];
  const hoursPerDay = (calendarNode && xmlNumber(calendarNode['HoursPerDay'])) || 8;
  const calendar = calendarNode ? calendarOf(calendarNode, warnings) : null;

  // --- the breakdown ---
  const wbsNodes = xmlList<Node>(project['WBS']);
  const wbsIds = new Set(wbsNodes.map((node) => xmlText(node['ObjectId'])));
  const wbsCode = new Map<string, string>();
  const codeOf = (id: string, seen = new Set<string>()): string => {
    const known = wbsCode.get(id);
    if (known !== undefined) return known;
    const node = wbsNodes.find((entry) => xmlText(entry['ObjectId']) === id);
    if (!node || seen.has(id)) return '';
    seen.add(id);
    const own = xmlText(node['Code']) ?? id;
    const parent = xmlText(node['ParentObjectId']);
    const code = parent && wbsIds.has(parent) && parent !== projectId ? `${codeOf(parent, seen)}.${own}` : own;
    wbsCode.set(id, code);
    return code;
  };

  const tasks: ImportedTask[] = [];
  const sequence = new Map<string, number>();
  for (const node of wbsNodes) {
    const id = xmlText(node['ObjectId']);
    if (!id) continue;
    const parent = xmlText(node['ParentObjectId']);
    sequence.set(`wbs:${id}`, xmlNumber(node['SequenceNumber']) ?? 0);
    tasks.push(blankTask({
      ref: `wbs:${id}`,
      parent_ref: parent && wbsIds.has(parent) ? `wbs:${parent}` : null,
      wbs: codeOf(id),
      name: xmlText(node['Name']) ?? codeOf(id),
    }));
  }

  // --- the work ---
  const activities = xmlList<Node>(project['Activity']);
  // P6 writes percent complete as 0–1 in some exports and 0–100 in others. A file whose every
  // value is at most one is read as fractions.
  const percents = activities.map(percentOf).filter((value): value is number => value !== null);
  const fractions = percents.length > 0 && percents.every((value) => value <= 1);
  let approximated = 0;
  let levelOfEffort = 0;

  for (const node of activities) {
    const id = xmlText(node['ObjectId']);
    if (!id) continue;
    const type = (xmlText(node['Type']) ?? '').toLowerCase();
    if (type.includes('level of effort') || type === 'tt_loe' || type.includes('wbs summary') || type === 'tt_wbs') {
      // These stretch to fit other activities rather than having a length of their own.
      levelOfEffort += 1;
      continue;
    }
    const milestone = type.includes('milestone') || type === 'tt_mile' || type === 'tt_finmile';
    const hours = xmlNumber(node['PlannedDuration']) ?? xmlNumber(node['OriginalDuration']) ?? 0;
    const days = Math.round(hours / hoursPerDay);
    const wbs = xmlText(node['WBSObjectId']);
    const { type: constraintType, date: constraintDate, approximate } = constraintOf(node);
    if (approximate) approximated += 1;
    const raw = percentOf(node) ?? 0;
    const percent = fractions ? raw * 100 : raw;

    tasks.push({
      ...blankTask({
        ref: `act:${id}`,
        parent_ref: wbs && wbsIds.has(wbs) ? `wbs:${wbs}` : null,
        wbs: xmlText(node['Id']),
        name: xmlText(node['Name']) ?? xmlText(node['Id']) ?? `Activity ${id}`,
      }),
      kind: milestone || days === 0 ? 'milestone' : 'task',
      duration_days: milestone ? 0 : Math.max(days, 1),
      start: xmlDate(node['PlannedStartDate']) ?? xmlDate(node['StartDate']),
      finish: xmlDate(node['PlannedFinishDate']) ?? xmlDate(node['FinishDate']),
      percent_complete: Math.min(100, Math.max(0, Math.round(percent))),
      actual_start: xmlDate(node['ActualStartDate']),
      actual_finish: xmlDate(node['ActualFinishDate']),
      constraint_type: constraintType,
      constraint_date: constraintDate,
    });
  }

  // Order siblings as P6 shows them: breakdown by sequence number, activities by id, breakdown first.
  tasks.sort((a, b) => {
    const kind = Number(a.ref.startsWith('act:')) - Number(b.ref.startsWith('act:'));
    if (kind !== 0) return kind;
    const bySequence = (sequence.get(a.ref) ?? 0) - (sequence.get(b.ref) ?? 0);
    return bySequence !== 0 ? bySequence : (a.wbs ?? '').localeCompare(b.wbs ?? '', 'en', { numeric: true });
  });

  // A breakdown node with no work anywhere under it is a heading nobody has planned yet.
  let ordered = outlineOrder(tasks);
  const parentOf = new Map(ordered.map((task) => [task.ref, task.parent_ref]));
  const hasWork = new Set<string>();
  for (const task of ordered) {
    if (!task.ref.startsWith('act:')) continue;
    let at = task.parent_ref;
    while (at && !hasWork.has(at)) {
      hasWork.add(at);
      at = parentOf.get(at) ?? null;
    }
  }
  const empty = ordered.filter((task) => task.ref.startsWith('wbs:') && !hasWork.has(task.ref)).length;
  ordered = outlineOrder(ordered.filter((task) => task.ref.startsWith('act:') || hasWork.has(task.ref)));
  if (empty) warnings.push(`${empty} breakdown heading(s) with no activities were left out.`);

  const links: ImportedLink[] = [];
  const relationships = [...xmlList<Node>(root['Relationship']), ...xmlList<Node>(project['Relationship'])];
  for (const node of relationships) {
    const from = xmlText(node['PredecessorActivityObjectId']);
    const to = xmlText(node['SuccessorActivityObjectId']);
    if (!from || !to) continue;
    links.push({
      predecessor_ref: `act:${from}`,
      successor_ref: `act:${to}`,
      type: LINK_TYPES[(xmlText(node['Type']) ?? '').toLowerCase()] ?? 'FS',
      lag_days: Math.round((xmlNumber(node['Lag']) ?? 0) / hoursPerDay),
    });
  }

  if (levelOfEffort) warnings.push(`${levelOfEffort} level-of-effort or WBS-summary activit(ies) were left out.`);
  if (approximated) {
    warnings.push(
      `${approximated} constraint(s) other than "start on or after" and "finish on or before" were approximated.`,
    );
  }

  return {
    format: 'p6',
    project_name: xmlText(project['Name']) ?? xmlText(project['Id']),
    start: xmlDate(project['PlannedStartDate']) ?? xmlDate(project['StartDate']),
    calendar,
    tasks: ordered,
    links: keepSchedulableLinks(ordered, links, warnings),
    warnings,
  };
}

function blankTask(fields: Pick<ImportedTask, 'ref' | 'parent_ref' | 'wbs' | 'name'>): ImportedTask {
  return {
    ...fields,
    depth: 0,
    kind: 'task',
    is_summary: false,
    duration_days: 1,
    start: null,
    finish: null,
    percent_complete: 0,
    actual_start: null,
    actual_finish: null,
    constraint_type: 'asap',
    constraint_date: null,
    notes: null,
  };
}

function percentOf(node: Node): number | null {
  return (
    xmlNumber(node['PercentComplete']) ??
    xmlNumber(node['PhysicalPercentComplete']) ??
    xmlNumber(node['DurationPercentComplete'])
  );
}

/**
 * P6 names constraints in words in XML exports ("Start On or After") and as codes in older ones
 * (`CS_MSOA`). The two this schedule keeps exactly are start-on-or-after and finish-on-or-before.
 */
function constraintOf(node: Node): { type: ScheduleConstraintType; date: string | null; approximate: boolean } {
  const name = (xmlText(node['PrimaryConstraintType']) ?? '').toLowerCase();
  const date = xmlDate(node['PrimaryConstraintDate']);
  if (!name || name === '<none>' || name === 'none') return { type: 'asap', date: null, approximate: false };
  if (!date) return { type: 'asap', date: null, approximate: true };
  if (name === 'start on or after' || name === 'cs_msoa') return { type: 'snet', date, approximate: false };
  if (name === 'finish on or before' || name === 'cs_mefob') return { type: 'fnlt', date, approximate: false };
  if (name === 'start on' || name === 'mandatory start' || name === 'cs_mso' || name === 'cs_mandstart') {
    return { type: 'snet', date, approximate: true };
  }
  if (name === 'finish on' || name === 'mandatory finish' || name === 'cs_meo' || name === 'cs_mandfin') {
    return { type: 'fnlt', date, approximate: true };
  }
  return { type: 'asap', date: null, approximate: true };
}

/** A weekday is worked when its standard hours have any work time; a holiday is an exception with none. */
function calendarOf(node: Node, warnings: string[]): ImportedCalendar | null {
  const week = xmlList<Node>((node['StandardWorkWeek'] as Node | undefined)?.['StandardWorkHours']);
  const working = new Set<number>();
  for (const day of week) {
    const index = WEEKDAYS[(xmlText(day['DayOfWeek']) ?? '').toLowerCase()];
    if (index === undefined) continue;
    if (xmlList<Node>(day['WorkTime']).some((time) => xmlText((time as Node)['Start']) !== null)) working.add(index);
  }
  if (week.length === 0) return null;
  if (working.size === 0) {
    warnings.push('The file’s calendar works no weekdays; the company calendar was kept.');
    return null;
  }
  const holidays: string[] = [];
  const exceptions = xmlList<Node>((node['HolidayOrExceptions'] as Node | undefined)?.['HolidayOrException']);
  for (const exception of exceptions) {
    const date = xmlDate(exception['Date']);
    const works = xmlList<Node>(exception['WorkTime']).some((time) => xmlText((time as Node)['Start']) !== null);
    if (date && !works) holidays.push(date);
  }
  return {
    name: xmlText(node['Name']) ?? 'Imported calendar',
    working_days: [...working].sort((a, b) => a - b),
    holidays: [...new Set(holidays)].sort(),
  };
}
