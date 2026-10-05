import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { APP_TIMEZONE } from '@sitebook/shared';
import { env } from '../config/env';
import { DEFAULT_JOB_OPTIONS, QUEUE } from './job-types';
import { TICK_CRON } from './tenant-clock';

/**
 * Registers the cron entries from spec §10.
 *
 * Repeatable jobs are keyed by name plus pattern plus timezone, so re-registering
 * on every boot is idempotent and two worker replicas cannot double-schedule.
 * Stale keys are removed first: changing a cron in config would otherwise leave
 * the old schedule running alongside the new one forever.
 *
 * The four per-company jobs register the 15-minute tick in UTC, not their own cron: each run
 * checks every company against the configured cron on that company's clock (tenant-clock.ts), so
 * a Dubai owner's 7 pm summary arrives at 7 pm in Dubai. The billing sweep is platform
 * housekeeping with no company's clock to follow, and stays on Asia/Kolkata.
 */
@Injectable()
export class SchedulerService implements OnApplicationBootstrap {
  private readonly logger = new Logger(SchedulerService.name);
  private readonly config = env();

  constructor(
    @InjectQueue(QUEUE.whatsapp) private readonly whatsapp: Queue,
    @InjectQueue(QUEUE.reports) private readonly reports: Queue,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    const schedules: Array<{ queue: Queue; name: string; pattern: string; tz: string }> = [
      { queue: this.whatsapp, name: 'fan-out-daily-summary', pattern: TICK_CRON, tz: 'UTC' },
      { queue: this.whatsapp, name: 'fan-out-dpr-reminder', pattern: TICK_CRON, tz: 'UTC' },
      { queue: this.reports, name: 'fan-out-labour-rollup', pattern: TICK_CRON, tz: 'UTC' },
      { queue: this.reports, name: 'fan-out-wage-period-draft', pattern: TICK_CRON, tz: 'UTC' },
      { queue: this.reports, name: 'fan-out-site-forecast', pattern: TICK_CRON, tz: 'UTC' },
      { queue: this.reports, name: 'fan-out-leak-checks', pattern: TICK_CRON, tz: 'UTC' },
      { queue: this.reports, name: 'fan-out-document-expiry', pattern: TICK_CRON, tz: 'UTC' },
      { queue: this.reports, name: 'fan-out-quality-tests-due', pattern: TICK_CRON, tz: 'UTC' },
      { queue: this.reports, name: 'fan-out-safety-permit-expiry', pattern: TICK_CRON, tz: 'UTC' },
      {
        queue: this.reports,
        name: 'drop-lapsed-subscriptions',
        pattern: this.config.BILLING_SWEEP_CRON,
        tz: APP_TIMEZONE,
      },
    ];

    try {
      await this.clearStale(schedules);

      for (const schedule of schedules) {
        await schedule.queue.add(
          schedule.name,
          {},
          {
            ...DEFAULT_JOB_OPTIONS,
            repeat: { pattern: schedule.pattern, tz: schedule.tz },
            jobId: schedule.name,
          },
        );
        this.logger.log(
          { job: schedule.name, cron: schedule.pattern, tz: schedule.tz },
          'Scheduled',
        );
      }
    } catch (error) {
      // A worker that cannot reach Redis should say so and stay up, not crashloop.
      this.logger.error({ err: error }, 'Could not register schedules');
    }
  }

  /** Drops repeatables whose cron no longer matches what config asks for. */
  private async clearStale(
    schedules: Array<{ queue: Queue; name: string; pattern: string; tz: string }>,
  ): Promise<void> {
    const wanted = new Map(schedules.map((s) => [s.name, s.pattern]));

    for (const queue of new Set(schedules.map((s) => s.queue))) {
      for (const existing of await queue.getRepeatableJobs()) {
        const pattern = wanted.get(existing.name);
        if (pattern === undefined || pattern === existing.pattern) continue;
        await queue.removeRepeatableByKey(existing.key);
        this.logger.log(
          { job: existing.name, was: existing.pattern, now: pattern },
          'Removed stale schedule',
        );
      }
    }
  }
}
