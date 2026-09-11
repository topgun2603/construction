import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import type { RequestUser } from '../../common/auth/request-user';
import { CurrentUser } from '../../common/decorators';
import { zodBody } from '../../common/pipes/zod-validation.pipe';
import { UsersService } from './users.service';

const fcmTokenSchema = z.object({ token: z.string().min(10).max(512) });

@ApiTags('me')
@Controller('me')
export class MeController {
  constructor(private readonly users: UsersService) {}

  /**
   * Everything a client needs on boot: who I am, the tenant's branding, the module
   * list that drives navigation (spec §6.3, §12) and the unread badge.
   */
  @Get()
  @ApiOperation({ summary: 'Current user, tenant and enabled modules' })
  async me(@CurrentUser() user: RequestUser) {
    return this.users.describeSelf(user);
  }

  @Post('fcm-tokens')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Register this device for push' })
  async addFcmToken(
    @CurrentUser() user: RequestUser,
    @Body(zodBody(fcmTokenSchema)) body: z.infer<typeof fcmTokenSchema>,
  ): Promise<void> {
    await this.users.addFcmToken(user, body.token);
  }

  @Delete('fcm-tokens')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Unregister this device from push' })
  async removeFcmToken(
    @CurrentUser() user: RequestUser,
    @Body(zodBody(fcmTokenSchema)) body: z.infer<typeof fcmTokenSchema>,
  ): Promise<void> {
    await this.users.removeFcmToken(user, body.token);
  }
}
