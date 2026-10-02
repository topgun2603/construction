import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { MeController } from './me.controller';
import { UsersService } from './users.service';

@Module({
  // For `PhoneAuthService`: linking a Google account means verifying its token, which is the same
  // verification sign-in does and should not be a second implementation of it.
  imports: [AuthModule],
  controllers: [MeController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
