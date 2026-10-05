import type {
  IsoDate,
  ScheduleConstraintType,
  ScheduleLinkType,
  ScheduleTaskKind,
} from '@sitebook/shared';

/**
 * What an imported file becomes, whichever tool wrote it: a tree of tasks in outline order, the
 * links between them, and the working week. Both importers produce this and nothing downstream
 * knows which one ran.
 */
export interface ImportedTask {
  /** The task's id in the file — an MSP UID, `wbs:<id>` or `act:<id>` for P6. */
  ref: string;
  parent_ref: string | null;
  depth: number;
  wbs: string | null;
  name: string;
  kind: ScheduleTaskKind;
  /** Has subtasks in the file. Its own duration and links are not imported. */
  is_summary: boolean;
  duration_days: number;
  /** The dates the file had, for the preview. The schedule recomputes its own. */
  start: IsoDate | null;
  finish: IsoDate | null;
  percent_complete: number;
  actual_start: IsoDate | null;
  actual_finish: IsoDate | null;
  constraint_type: ScheduleConstraintType;
  constraint_date: IsoDate | null;
  notes: string | null;
}

export interface ImportedLink {
  predecessor_ref: string;
  successor_ref: string;
  type: ScheduleLinkType;
  lag_days: number;
}

export interface ImportedCalendar {
  name: string;
  working_days: number[];
  holidays: IsoDate[];
}

export interface ScheduleImportPlan {
  format: 'msproject' | 'p6';
  project_name: string | null;
  /** The plan's start in the file. */
  start: IsoDate | null;
  calendar: ImportedCalendar | null;
  tasks: ImportedTask[];
  links: ImportedLink[];
  /** Everything approximated or left out, in a sentence each. */
  warnings: string[];
}

/** Thrown for a file that is not one of the two formats, or not XML at all. */
export class ScheduleImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ScheduleImportError';
  }
}

/** `2026-11-01T08:00:00` → `2026-11-01`. Null for anything that is not a date. */
export function xmlDate(value: unknown): IsoDate | null {
  if (typeof value !== 'string') return null;
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(value.trim());
  return match ? match[1]! : null;
}

export function xmlText(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value === 'object') {
    // An element with attributes parses to an object whose text is under `#text`.
    const text = (value as Record<string, unknown>)['#text'];
    return text === undefined ? null : String(text).trim() || null;
  }
  const text = String(value).trim();
  return text.length ? text : null;
}

export function xmlNumber(value: unknown): number | null {
  const text = xmlText(value);
  if (text === null) return null;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Repeated elements always as an array, however many the file had. */
export function xmlList<T = Record<string, unknown>>(value: unknown): T[] {
  if (value === undefined || value === null || value === '') return [];
  return (Array.isArray(value) ? value : [value]) as T[];
}

/** Every date from `from` to `to` inclusive, capped so a mistyped year cannot run away. */
export function datesInRange(from: IsoDate, to: IsoDate, cap = 366): IsoDate[] {
  const out: IsoDate[] = [];
  const day = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  while (day <= end && out.length < cap) {
    out.push(day.toISOString().slice(0, 10));
    day.setUTCDate(day.getUTCDate() + 1);
  }
  return out;
}

/** Puts a flat list into outline order — every parent before its children — and sets the depth. */
export function outlineOrder(tasks: ImportedTask[]): ImportedTask[] {
  const children = new Map<string | null, ImportedTask[]>();
  const known = new Set(tasks.map((task) => task.ref));
  for (const task of tasks) {
    const parent = task.parent_ref && known.has(task.parent_ref) ? task.parent_ref : null;
    task.parent_ref = parent;
    const list = children.get(parent) ?? [];
    list.push(task);
    children.set(parent, list);
  }
  const ordered: ImportedTask[] = [];
  const walk = (parent: string | null, depth: number) => {
    for (const task of children.get(parent) ?? []) {
      task.depth = depth;
      task.is_summary = (children.get(task.ref)?.length ?? 0) > 0;
      ordered.push(task);
      walk(task.ref, depth + 1);
    }
  };
  walk(null, 0);
  return ordered;
}

/**
 * Links a summary task cannot carry here — they are scheduled by their subtasks — and links to
 * tasks the file does not have are dropped, with one warning each kind, not one per link.
 */
export function keepSchedulableLinks(
  tasks: readonly ImportedTask[],
  links: readonly ImportedLink[],
  warnings: string[],
): ImportedLink[] {
  const byRef = new Map(tasks.map((task) => [task.ref, task]));
  let missing = 0;
  let summary = 0;
  let duplicate = 0;
  const seen = new Set<string>();
  const kept: ImportedLink[] = [];
  for (const link of links) {
    const from = byRef.get(link.predecessor_ref);
    const to = byRef.get(link.successor_ref);
    if (!from || !to || from === to) {
      missing += 1;
      continue;
    }
    if (from.is_summary || to.is_summary) {
      summary += 1;
      continue;
    }
    const key = `${link.predecessor_ref}>${link.successor_ref}`;
    if (seen.has(key)) {
      duplicate += 1;
      continue;
    }
    seen.add(key);
    kept.push(link);
  }
  if (missing) warnings.push(`${missing} link(s) to tasks that are not in the file were left out.`);
  if (summary) {
    warnings.push(
      `${summary} link(s) to or from summary tasks were left out; link the tasks under them instead.`,
    );
  }
  if (duplicate) warnings.push(`${duplicate} repeated link(s) were left out.`);
  return kept;
}
