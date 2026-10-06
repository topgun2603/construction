import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Put, Req } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import {
  securityIpPolicySchema,
  securityMfaPolicySchema,
  securitySessionPolicySchema,
  type SecurityIpPolicyInput,
  type SecurityMfaPolicyInput,
  type SecuritySessionPolicyInput,
} from '@sitebook/shared';
import type { RequestUser } from '../../common/auth/request-user';
import { CurrentUser, RequiresPermission } from '../../common/decorators';
import { clientIpOf } from '../../common/net/client-ip';
import { zodBody } from '../../common/pipes/zod-validation.pipe';
import { SecuritySettingsService } from './security-settings.service';

/**
 * Settings → Security: two-factor policy, session timeouts, IP allow-list, and signing a team
 * member out. `tenant.manage` at the route; the service insists on an owner on top.
 */
@ApiTags('security')
@RequiresPermission('tenant.manage')
@Controller('security')
export class SecuritySettingsController {
  constructor(private readonly settings: SecuritySettingsService) {}

  @Get('settings')
  @ApiOperation({ summary: 'Sign-in security settings, with your current IP address' })
  async overview(@CurrentUser() user: RequestUser, @Req() req: Request) {
    return this.settings.overview(user, clientIpOf(req));
  }

  @Put('mfa-policy')
  @ApiOperation({ summary: 'Who must use two-factor authentication' })
  async saveMfaPolicy(
    @CurrentUser() user: RequestUser,
    @Req() req: Request,
    @Body(zodBody(securityMfaPolicySchema)) body: SecurityMfaPolicyInput,
  ) {
    return this.settings.saveMfaPolicy(user, body, clientIpOf(req));
  }

  @Put('session-policy')
  @ApiOperation({ summary: 'Idle timeout and absolute session lifetime' })
  async saveSessionPolicy(
    @CurrentUser() user: RequestUser,
    @Req() req: Request,
    @Body(zodBody(securitySessionPolicySchema)) body: SecuritySessionPolicyInput,
  ) {
    return this.settings.saveSessionPolicy(user, body, clientIpOf(req));
  }

  @Put('ip-policy')
  @ApiOperation({ summary: 'The IP allow-list' })
  async saveIpPolicy(
    @CurrentUser() user: RequestUser,
    @Req() req: Request,
    @Body(zodBody(securityIpPolicySchema)) body: SecurityIpPolicyInput,
  ) {
    return this.settings.saveIpPolicy(user, body, clientIpOf(req));
  }

  @Get('sessions')
  @ApiOperation({ summary: 'Who is signed in across the company' })
  async sessions(@CurrentUser() user: RequestUser) {
    return this.settings.companySessions(user);
  }

  @Post('members/:userId/sign-out')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'End every session a team member has' })
  async signOutMember(@CurrentUser() user: RequestUser, @Param('userId', ParseUUIDPipe) userId: string) {
    return this.settings.signOutMember(user, userId);
  }
}
