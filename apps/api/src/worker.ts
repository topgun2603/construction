import 'reflect-metadata';

/*
 * Background job process (spec §10).
 *
 * Set before anything else loads: `JobsModule` reads this at import time to decide
 * whether to attach processors, and `env()` memoises on first call. AppModule is
 * therefore imported dynamically, after the assignment — a static import would be
 * hoisted above it and the worker would come up as an API.
 */
process.env['SITEBOOK_ROLE'] = 'worker';

async function bootstrap(): Promise<void> {
  const { Logger } = await import('@nestjs/common');
  const { NestFactory } = await import('@nestjs/core');
  const { AppModule } = await import('./app.module');

  const logger = new Logger('Worker');
  const app = await NestFactory.createApplicationContext(AppModule, { bufferLogs: false });
  app.enableShutdownHooks();

  const { env } = await import('./config/env');
  const config = env();

  logger.log(
    `Worker started - queues ${config.JOBS_ENABLED ? 'on' : 'off'}, redis ${config.REDIS_URL}`,
  );
  logger.log(
    `Schedules (Asia/Kolkata): summary ${config.WHATSAPP_SUMMARY_CRON}, ` +
      `dpr reminder ${config.WHATSAPP_DPR_REMINDER_CRON}, ` +
      `rollup ${config.REPORTS_ROLLUP_CRON}, wage drafts ${config.WAGE_PERIOD_DRAFT_CRON}`,
  );

  if (!config.JOBS_ENABLED) {
    logger.warn('JOBS_ENABLED=false - this process will not consume any jobs');
  }
}

void bootstrap();
