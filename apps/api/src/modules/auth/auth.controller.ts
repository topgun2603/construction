import { Body, Controller, Get, Headers, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  authExchangeSchema,
  authRefreshSchema,
  companySwitchSchema,
  type AuthExchangeInput,
  type AuthRefreshInput,
  type CompanySwitchInput,
} from '@sitebook/shared';
import { CurrentUser, Public, SessionOnly } from '../../common/decorators';
import { zodBody } from '../../common/pipes/zod-validation.pipe';
import type { RequestUser } from '../../common/auth/request-user';
import { AuthService, type ExchangeResult } from './auth.service';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  /**
   * Rate limited hard: this endpoint is the one place an unauthenticated caller can
   * make us do signature verification work (spec §15).
   */
  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('exchange')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Exchange a Firebase ID token for an app session' })
  async exchange(
    @Body(zodBody(authExchangeSchema)) body: AuthExchangeInput,
    @Headers('user-agent') userAgent?: string,
  ): Promise<Record<string, unknown>> {
    return present(await this.auth.exchange(body, userAgent));
  }

  @Public()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Rotate a refresh token' })
  async refresh(
    @Body(zodBody(authRefreshSchema)) body: AuthRefreshInput,
    @Headers('user-agent') userAgent?: string,
  ) {
    return this.auth.refresh(body, userAgent);
  }

  /** The companies this person can switch to — the company switcher's list. */
  @Get('memberships')
  @ApiOperation({ summary: 'Companies the signed-in person belongs to' })
  async memberships(@CurrentUser() user: RequestUser) {
    return { items: await this.auth.memberships(user) };
  }

  /**
   * A new session in another company. Authenticated, and throttled like refresh: it mints tokens.
   * No permission gates it — belonging to the target company is the whole check, and the service
   * makes it against the verified identity.
   */
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @SessionOnly()
  @Post('switch')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Switch the session to another company this person belongs to' })
  async switchCompany(
    @CurrentUser() user: RequestUser,
    @Body(zodBody(companySwitchSchema)) body: CompanySwitchInput,
    @Headers('user-agent') userAgent?: string,
  ) {
    return this.auth.switchCompany(user, body, userAgent);
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Revoke every session for the current user' })
  async logout(@CurrentUser() user: RequestUser): Promise<void> {
    await this.auth.revokeAllSessions(user.tenantId, user.userId);
  }
}

/**
 * The three outcomes of an exchange are different shapes, not different statuses:
 * a new builder with no tenant is a successful sign-in that happens to need
 * onboarding next, so returning 200 with a discriminated body keeps the client's
 * happy path free of error handling.
 */
function present(result: ExchangeResult): Record<string, unknown> {
  switch (result.kind) {
    case 'session':
      return { ...result.tokens };
    case 'onboarding':
      return {
        onboarding_required: true,
        onboarding_token: result.onboarding_token,
        phone: result.phone,
      };
    case 'choose_tenant':
      return { tenant_choice_required: true, tenants: result.tenants };
  }
}
