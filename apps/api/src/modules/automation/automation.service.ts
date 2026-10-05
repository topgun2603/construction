import { Injectable } from '@nestjs/common';
import type { RequestUser } from '../../common/auth/request-user';
import { env } from '../../config/env';
import { nextRun } from '../../jobs/tenant-clock';

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

  list(actor: RequestUser): { timezone: string; jobs_enabled: boolean; jobs: ScheduledJobView[] } {
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
      {
        key: 'site_forecast',
        name: 'Cost forecasts',
        description:
          'Projects what each active site will cost by the end, and flags the ones heading over budget with the reason.',
        effect: null,
        cron: this.config.SITE_FORECAST_CRON,
      },
      {
        key: 'leak_checks',
        name: 'Leak and fraud checks',
        description:
          'Looks for workers marked on two sites at once, rolls with no day off, bills entered twice and expenses far above the usual, and lists them for you to confirm or dismiss.',
        effect: null,
        cron: this.config.LEAK_CHECK_CRON,
      },
      {
        key: 'document_expiry',
        name: 'Papers about to lapse',
        description:
          'Tells owners and accounts, once per paper, when a worker’s passport, visa, Emirates ID or labour card lapses within 30 days.',
        effect: null,
        cron: this.config.DOCUMENT_EXPIRY_CRON,
      },
    ].map((job) => ({
      ...job,
      // Each job runs on the company's own clock (jobs/tenant-clock.ts), so that is the zone shown.
      timezone: actor.timezone,
      readable: readableDaily(job.cron),
      next_run: enabled ? nextRun(job.cron, actor.timezone) : null,
      enabled,
    }));

    return { timezone: actor.timezone, jobs_enabled: enabled, jobs };
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
