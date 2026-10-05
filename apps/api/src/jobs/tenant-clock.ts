import { parseExpression } from 'cron-parser';

/**
 * Scheduled jobs on each company's own clock (roadmap Phase 0, item 3).
 *
 * A cron like `0 19 * * *` means 7 pm *where the company is*. One repeatable per company would
 * need registering and unregistering as companies come, go and move zones; instead a single tick
 * runs every 15 minutes in UTC, and each run asks, per company, "did this cron fire in the
 * 15 minutes that just ended, on this company's clock?".
 *
 * Fifteen because that is the finest offset in use: India is +5:30 and Nepal +5:45, so an hourly
 * tick would send a Kathmandu summary at 6:45 or 7:45, never at 7.
 */
export const TICK_CRON = '*/15 * * * *';
const TICK_MS = 15 * 60_000;

/**
 * The quarter-hour that just ended: `(start, end]`.
 *
 * Floored rather than taken from `now`, so a tick that runs a little late — a busy worker, a
 * restart — still judges the boundary it was scheduled for, and two runs of the same tick agree.
 */
export function tickWindow(now: Date): { start: Date; end: Date } {
  const end = new Date(Math.floor(now.getTime() / TICK_MS) * TICK_MS);
  return { start: new Date(end.getTime() - TICK_MS), end };
}

/** Whether `cron`, read in `timezone`, fires inside `(start, end]`. */
export function firesIn(
  cron: string,
  timezone: string,
  window: { start: Date; end: Date },
): boolean {
  const next = parseExpression(cron, { currentDate: window.start, tz: timezone }).next().toDate();
  return next.getTime() <= window.end.getTime();
}

/** The next time `cron` fires after `now`, on `timezone`'s clock, as an ISO instant. */
export function nextRun(cron: string, timezone: string, now: Date = new Date()): string {
  return parseExpression(cron, { currentDate: now, tz: timezone }).next().toDate().toISOString();
}
