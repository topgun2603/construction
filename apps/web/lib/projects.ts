import { daysBetweenInclusive, todayInIst, type IsoDate } from '@sitebook/shared';
import type { Tone } from '@/components/ui/badge';
import type { Page, ProjectSummary } from '@/lib/api-types';

export type { Page, ProjectSummary };

const STATUS_TONE: Record<string, Tone> = {
  active: 'done',
  on_hold: 'blocked',
  planning: 'neutral',
  completed: 'neutral',
};

const STATUS_LABEL: Record<string, string> = {
  active: 'On site',
  on_hold: 'On hold',
  planning: 'Planning',
  completed: 'Completed',
};

export function statusTone(status: string): Tone {
  return STATUS_TONE[status] ?? 'neutral';
}

export function statusLabel(status: string): string {
  return STATUS_LABEL[status] ?? status.replace(/_/g, ' ');
}

export interface Schedule {
  /** How far through the planned window today is, 0–100. */
  elapsedPercent: number;
  /** Negative once the target date has passed. */
  daysRemaining: number;
  label: string;
  tone: Tone;
}

/**
 * Where a project sits in its own planned window.
 *
 * This is schedule elapsed, not work completed — the two are different numbers and
 * the card labels it as such. Real progress needs milestone or DPR data, which
 * arrives with build order step 3; showing elapsed time as "progress" would flatter
 * a late site.
 */
export function schedule(project: ProjectSummary, today: IsoDate = todayInIst()): Schedule | null {
  const { start_date: start, target_end_date: end } = project;
  if (!start || !end || end < start) return null;

  const total = daysBetweenInclusive(start, end);
  const done = daysBetweenInclusive(start, today);
  const elapsedPercent = Math.min(100, Math.max(0, Math.round((done / total) * 100)));
  const daysRemaining = daysBetweenInclusive(today, end) - 1;

  if (project.status === 'completed') {
    return { elapsedPercent: 100, daysRemaining, label: 'Completed', tone: 'neutral' };
  }
  if (daysRemaining < 0) {
    const over = Math.abs(daysRemaining);
    return {
      elapsedPercent,
      daysRemaining,
      label: `${over} ${over === 1 ? 'day' : 'days'} past target`,
      tone: 'blocked',
    };
  }
  if (daysRemaining <= 14) {
    return {
      elapsedPercent,
      daysRemaining,
      label: `${daysRemaining} ${daysRemaining === 1 ? 'day' : 'days'} left`,
      tone: 'pending',
    };
  }
  return { elapsedPercent, daysRemaining, label: `${daysRemaining} days left`, tone: 'done' };
}

/**
 * Sorted by trouble, not alphabet (design note on artboard 3a): the sites that
 * need the owner float to the top, because that is the whole point of the screen.
 */
const TROUBLE_ORDER = ['on_hold', 'active', 'planning', 'completed'];

export function byTrouble(a: ProjectSummary, b: ProjectSummary): number {
  const rank = (p: ProjectSummary) => {
    const base = TROUBLE_ORDER.indexOf(p.status);
    const overdue = schedule(p)?.daysRemaining ?? Number.MAX_SAFE_INTEGER;
    // Within a status, the most overdue comes first.
    return (base < 0 ? TROUBLE_ORDER.length : base) * 1_000_000 + Math.min(overdue, 999_999);
  };
  return rank(a) - rank(b);
}

export function totalBudget(projects: readonly ProjectSummary[]): bigint {
  return projects.reduce((sum, project) => sum + BigInt(project.budget_amount ?? '0'), 0n);
}
