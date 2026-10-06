import { Module } from '@nestjs/common';
import { MfaService } from './mfa.service';
import { SecurityAuditService } from './security-audit.service';
import { SecurityPolicyGuard } from './security-policy.guard';
import { SecuritySettingsController } from './security-settings.controller';
import { SecuritySettingsService } from './security-settings.service';
import { SessionService } from './session.service';

/**
 * Enforced two-factor, session timeouts and IP allow-lists per company (roadmap Phase 3, item 2).
 *
 * The services sit here and the sign-in endpoints that use them stay in AuthModule (which imports
 * this one): the two-factor and session routes need to mint tokens, and AuthService is where that
 * lives. SecurityPolicyGuard is registered globally from AppModule, straight after JwtAuthGuard.
 */
@Module({
  controllers: [SecuritySettingsController],
  providers: [SessionService, MfaService, SecurityAuditService, SecuritySettingsService, SecurityPolicyGuard],
  exports: [SessionService, MfaService, SecurityAuditService, SecurityPolicyGuard],
})
export class SecurityModule {}
