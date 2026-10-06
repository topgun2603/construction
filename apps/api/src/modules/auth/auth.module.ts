import { Module } from '@nestjs/common';
import { SecurityModule } from '../security/security.module';
import { AuthController } from './auth.controller';
import { MfaController } from './mfa.controller';
import { AuthService } from './auth.service';
import { PhoneAuthService } from './phone-auth.service';
import { SsoPolicyService } from './sso-policy.service';

@Module({
  imports: [SecurityModule],
  controllers: [AuthController, MfaController],
  providers: [AuthService, PhoneAuthService, SsoPolicyService],
  exports: [AuthService, PhoneAuthService, SsoPolicyService],
})
export class AuthModule {}
