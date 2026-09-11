import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { APP_TIMEZONE } from '@sitebook/shared';
import { env } from '../config/env';
import { DEFAULT_JOB_OPTIONS, QUEUE } from './job-types';

/**
 * Registers the cron entries from spec §10.
 *
 * Repeatable jobs are keyed by name plus pattern plus timezone, so re-registering
 * on every boot is idempotent and two worker replicas cannot double-schedule.
 * Stale keys are removed first: changing a cron in config would otherwise leave
 * the old schedule running alongside the new one forever.
 *
 * Every schedule is expressed in Asia/Kolkata. A summary that says "today" has to
 * mean the builder's today, not the server's.
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
    const schedules: Array<{ queue: Queue; name: string; pattern: string }> = [
      {
        queue: this.whatsapp,
        name: 'fan-out-daily-summary',
        pattern: this.config.WHATSAPP_SUMMARY_CRON,
      },
      {
        queue: this.whatsapp,
        name: 'fan-out-dpr-reminder',
        pattern: this.config.WHATSAPP_DPR_REMINDER_CRON,
      },
      {
        queue: this.reports,
        name: 'fan-out-labour-rollup',
        pattern: this.config.REPORTS_ROLLUP_CRON,
      },
      {
        queue: this.reports,
        name: 'fan-out-wage-period-draft',
        pattern: this.config.WAGE_PERIOD_DRAFT_CRON,
      },
      {
        queue: this.reports,
        name: 'drop-lapsed-subscriptions',
        pattern: this.config.BILLING_SWEEP_CRON,
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
            repeat: { pattern: schedule.pattern, tz: APP_TIMEZONE },
            jobId: schedule.name,
          },
        );
        this.logger.log(
          { job: schedule.name, cron: schedule.pattern, tz: APP_TIMEZONE },
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
    schedules: Array<{ queue: Queue; name: string; pattern: string }>,
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
