import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import type { RequestUser } from '../../common/auth/request-user';
import { CurrentUser } from '../../common/decorators';
import { zodBody } from '../../common/pipes/zod-validation.pipe';
import { UsersService } from './users.service';

const fcmTokenSchema = z.object({ token: z.string().min(10).max(512) });
/** The Firebase ID token from a Google popup. The address is read out of it, never sent. */
const googleLinkSchema = z.object({ firebase_token: z.string().min(10).max(4096) });

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

  /**
   * Links the Google account whose token this is, so its owner can sign in with it next time.
   *
   * A write to one's own row, so no permission gates it — the same way a person may register this
   * phone for push without being an owner.
   */
  @Post('google')
  @ApiOperation({ summary: 'Link a Google account to this user' })
  async linkGoogle(
    @CurrentUser() user: RequestUser,
    @Body(zodBody(googleLinkSchema)) body: z.infer<typeof googleLinkSchema>,
  ) {
    return this.users.linkGoogle(user, body.firebase_token);
  }

  @Delete('google')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Unlink the Google account' })
  async unlinkGoogle(@CurrentUser() user: RequestUser): Promise<void> {
    await this.users.unlinkGoogle(user);
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
