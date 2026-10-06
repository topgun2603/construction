import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { PhoneAuthService } from './phone-auth.service';
import { SsoPolicyService } from './sso-policy.service';

@Module({
  controllers: [AuthController],
  providers: [AuthService, PhoneAuthService, SsoPolicyService],
  exports: [AuthService, PhoneAuthService, SsoPolicyService],
})
export class AuthModule {}
