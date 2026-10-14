import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DataPortabilityModule } from '../data-portability/data-portability.module';
import { PlatformDeletions } from './platform-deletions.service';
import { PlatformAdmins } from './platform-admins.service';
import { PlatformAnalytics } from './platform-analytics.service';
import { PlatformAuthService } from './platform-auth.service';
import { PlatformController } from './platform.controller';
import { PlatformDb } from './platform-db.service';
import { PlatformGuard } from './platform.guard';
import { PlatformOperators } from './platform-operators.service';
import { PlatformService } from './platform.service';

/**
 * The platform console.
 *
 * `PlatformDb` is provided here and exported nowhere: the BYPASSRLS connection must not
 * be injectable into a tenant-facing service, because the whole tenancy model rests on
 * the application role being unable to read across tenants.
 */
@Module({
  // Data portability for cancelling and expediting company deletions (PlatformDeletions).
  imports: [AuthModule, DataPortabilityModule],
  controllers: [PlatformController],
  providers: [
    PlatformDb,
    PlatformAdmins,
    PlatformOperators,
    PlatformService,
    PlatformAnalytics,
    PlatformAuthService,
    PlatformGuard,
    PlatformDeletions,
  ],
})
export class PlatformModule {}
