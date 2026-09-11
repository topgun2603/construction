import { Module, type MiddlewareConsumer, type NestModule } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { LoggerModule } from 'nestjs-pino';
import { CommonModule } from './common/common.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { PlanGuard } from './common/guards/plan.guard';
import { PermissionsGuard } from './common/guards/permissions.guard';
import { RolesGuard } from './common/guards/roles.guard';
import { RequestIdMiddleware } from './common/middleware/request-id.middleware';
import { PrismaModule } from './common/prisma/prisma.module';
import { env } from './config/env';
import { IntegrationsModule } from './integrations/integrations.module';
import { JobsModule } from './jobs/jobs.module';
import { AttendanceModule } from './modules/attendance/attendance.module';
import { AutomationModule } from './modules/automation/automation.module';
import { BillingModule } from './modules/billing/billing.module';
import { AuthModule } from './modules/auth/auth.module';
import { ContractorsModule } from './modules/contractors/contractors.module';
import { DashboardModule } from './modules/dashboard/dashboard.module';
import { DprModule } from './modules/dpr/dpr.module';
import { ExpensesModule } from './modules/expenses/expenses.module';
import { GeocodeModule } from './modules/geocode/geocode.module';
import { HealthController } from './modules/health/health.controller';
import { IndentsModule } from './modules/indents/indents.module';
import { LabourPaymentsModule } from './modules/labour-payments/labour-payments.module';
import { MaterialsModule } from './modules/materials/materials.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { PlatformModule } from './modules/platform/platform.module';
import { PortalModule } from './modules/portal/portal.module';
import { ProjectsModule } from './modules/projects/projects.module';
import { RolesModule } from './modules/roles/roles.module';
import { ReportsModule } from './modules/reports/reports.module';
import { StockModule } from './modules/stock/stock.module';
import { SyncModule } from './modules/sync/sync.module';
import { TenantsModule } from './modules/tenants/tenants.module';
import { UploadsModule } from './modules/uploads/uploads.module';
import { UsersModule } from './modules/users/users.module';
import { WagePeriodsModule } from './modules/wage-periods/wage-periods.module';
import { WorkersModule } from './modules/workers/workers.module';

@Module({
  imports: [
    LoggerModule.forRoot({
      pinoHttp: {
        // Silent under test: a passing suite should print assertions, not traffic.
        level:
          env().NODE_ENV === 'test' ? 'silent' : env().NODE_ENV === 'production' ? 'info' : 'debug',
        // Structured JSON in production, readable lines locally (spec §15).
        transport:
          env().NODE_ENV === 'development'
            ? { target: 'pino-pretty', options: { singleLine: true } }
            : undefined,
        customProps: (req) => ({ requestId: req.headers['x-request-id'] }),
        redact: ['req.headers.authorization', 'req.headers.cookie', 'req.body.firebase_token'],
        autoLogging: { ignore: (req) => req.url === '/v1/health' },
      },
    }),
    ThrottlerModule.forRoot({
      throttlers: [{ name: 'default', ttl: 60_000, limit: 120 }],
      /*
       * Off under test only.
       *
       * The e2e specs sign in dozens of times from one address in a few seconds,
       * which the OTP limit (10/min, spec §15) correctly refuses — the throttled
       * call returns 429 and the assertion that follows fails on a token that was
       * never issued. The limits themselves are unchanged for every other
       * environment; nothing here relaxes production.
       */
      skipIf: () => env().NODE_ENV === 'test',
    }),
    PrismaModule,
    CommonModule,
    IntegrationsModule,
    NotificationsModule,
    // Producers everywhere; processors only in the worker process.
    JobsModule.register(),
    AuthModule,
    AutomationModule,
    BillingModule,
    PlatformModule,
    RolesModule,
    TenantsModule,
    UsersModule,
    PortalModule,
    ProjectsModule,
    ContractorsModule,
    MaterialsModule,
    WorkersModule,
    AttendanceModule,
    WagePeriodsModule,
    LabourPaymentsModule,
    DprModule,
    IndentsModule,
    ExpensesModule,
    GeocodeModule,
    UploadsModule,
    DashboardModule,
    ReportsModule,
    StockModule,
    SyncModule,
  ],
  controllers: [HealthController],
  providers: [
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    // Guard order matters and follows the request's logical narrowing:
    // rate limit → who are you → is the module on your plan → is your role allowed.
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: PlanGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestIdMiddleware).forRoutes('*');
  }
}
