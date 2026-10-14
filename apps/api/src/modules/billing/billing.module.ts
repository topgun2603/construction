import { Module } from '@nestjs/common';
import { PlatformAdmins } from '../platform/platform-admins.service';
import { BillingController } from './billing.controller';
import { BillingService } from './billing.service';

/**
 * Exports the service so the nightly job can drop lapsed subscriptions.
 *
 * `PlatformAdmins` is provided here as well as in the console: it only reads the env allowlist
 * (no database, no privileged connection), and billing needs it to tell the platform team about a
 * bank-transfer request.
 */
@Module({
  controllers: [BillingController],
  providers: [BillingService, PlatformAdmins],
  exports: [BillingService],
})
export class BillingModule {}
