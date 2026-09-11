import { Injectable } from '@nestjs/common';
import { APP_TIMEZONE } from '@sitebook/shared';
import { env } from '../../config/env';

export interface ScheduledJobView {
  key: string;
  name: string;
  /** What it does, in the owner's terms rather than the queue's. */
  description: string;
  /** What it changes in their data, or null when it only sends something. */
  effect: string | null;
  cron: string;
  timezone: string;
  /** "7:00 pm every day", or null when the cron is not a plain daily pattern. */
  readable: string | null;
  next_run: string | null;
  enabled: boolean;
}

/**
 * What the system does on its own.
 *
 * This exists because unattended work has to be visible. The nightly job drafts wage periods
 * into a builder's account with nobody logged in; an owner who finds a sheet they did not
 * create should be able to read, in one place, what runs, when, and what it touches — rather
 * than concluding somebody else has access to their account.
 *
 * It reports the configuration, not queue internals. Whether a particular run succeeded belongs
 * in operational logging; what an owner needs to know is "this is scheduled, it is on, and it
 * will next happen at this time in my timezone".
 */
@Injectable()
export class AutomationService {
  private readonly config = env();

  list(): { timezone: string; jobs_enabled: boolean; jobs: ScheduledJobView[] } {
    const enabled = this.config.JOBS_ENABLED;

    const jobs: ScheduledJobView[] = [
      {
        key: 'daily_site_summary',
        name: 'Daily site summary',
        description: 'Sends each owner a WhatsApp summary of the day across their sites.',
        effect: null,
        cron: this.config.WHATSAPP_SUMMARY_CRON,
      },
      {
        key: 'dpr_reminder',
        name: 'Missing report nudge',
        description:
          'Reminds supervisors who have not filed the daily report for a site that is still active.',
        effect: null,
        cron: this.config.WHATSAPP_DPR_REMINDER_CRON,
      },
      {
        key: 'labour_rollup',
        name: 'Labour cost rollup',
        description: 'Recalculates yesterday\'s labour totals so the dashboard opens instantly.',
        effect: null,
        cron: this.config.REPORTS_ROLLUP_CRON,
      },
      {
        key: 'wage_period_draft',
        name: 'Wage sheet drafts',
        description:
          'Drafts a wage period for every contractor whose pay cycle ended, so the sheet is waiting rather than remembered.',
        // The only scheduled job that writes records a person will act on, so it says so.
        effect:
          'Creates open wage periods marked “drafted automatically”. Nothing is finalised or paid — every figure still waits for you.',
        cron: this.config.WAGE_PERIOD_DRAFT_CRON,
      },
    ].map((job) => ({
      ...job,
      timezone: APP_TIMEZONE,
      readable: readableDaily(job.cron),
      next_run: enabled ? nextDailyRun(job.cron) : null,
      enabled,
    }));

    return { timezone: APP_TIMEZONE, jobs_enabled: enabled, jobs };
  }
}

/** `30 17 * * *` → `{ hour: 17, minute: 30 }`, or null for anything more complex. */
function parseDaily(cron: string): { hour: number; minute: number } | null {
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) return null;
  const [minute, hour, dom, month, dow] = parts;
  // Only the plain "every day at HH:MM" shape is described in words. Anything else is shown
  // as the raw expression rather than guessed at — a wrong description of when something runs
  // is worse than no description.
  if (dom !== '*' || month !== '*' || dow !== '*') return null;
  const h = Number(hour);
  const m = Number(minute);
  if (!Number.isInteger(h) || !Number.isInteger(m) || h < 0 || h > 23 || m < 0 || m > 59) {
    return null;
  }
  return { hour: h, minute: m };
}

function readableDaily(cron: string): string | null {
  const parsed = parseDaily(cron);
  if (!parsed) return null;
  const suffix = parsed.hour < 12 ? 'am' : 'pm';
  const hour12 = parsed.hour % 12 === 0 ? 12 : parsed.hour % 12;
  const minutes = parsed.minute.toString().padStart(2, '0');
  return `${hour12}:${minutes} ${suffix} every day`;
}

/**
 * The next time this cron fires, as an ISO instant.
 *
 * Computed against the app's own timezone rather than the server's. A schedule that says
 * 7:00 pm means 7:00 pm on the site, and a deployment in another zone must not shift it — the
 * same reason the queue registers its repeatables with `tz: Asia/Kolkata`.
 */
function nextDailyRun(cron: string): string | null {
  const parsed = parseDaily(cron);
  if (!parsed) return null;

  const now = new Date();
  // Today's date *in the app timezone*, which is not necessarily the server's today.
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: APP_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(now);
  const field = (type: string) => parts.find((part) => part.type === type)?.value ?? '00';

  // IST is a fixed +05:30 with no daylight saving, so the offset is written literally and a
  // day is exactly 24 hours. Any zone with DST would need a real tz library here.
  const todaysRun = new Date(
    `${field('year')}-${field('month')}-${field('day')}T` +
      `${String(parsed.hour).padStart(2, '0')}:${String(parsed.minute).padStart(2, '0')}:00+05:30`,
  );
  if (Number.isNaN(todaysRun.getTime())) return null;

  // Adding a day in epoch milliseconds rather than incrementing the date field: "the 31st of
  // September" is an invalid date, so on the last day of a month the naive version would
  // silently show no next run at all.
  const passed = Number(field('hour')) * 60 + Number(field('minute')) >=
    parsed.hour * 60 + parsed.minute;
  const next = passed ? new Date(todaysRun.getTime() + 86_400_000) : todaysRun;
  return next.toISOString();
}
