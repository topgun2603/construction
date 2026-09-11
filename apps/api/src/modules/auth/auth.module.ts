import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { PhoneAuthService } from './phone-auth.service';

@Module({
  controllers: [AuthController],
  providers: [AuthService, PhoneAuthService],
  exports: [AuthService, PhoneAuthService],
})
export class AuthModule {}
