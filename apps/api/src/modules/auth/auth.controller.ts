import { Body, Controller, Headers, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  authExchangeSchema,
  authRefreshSchema,
  type AuthExchangeInput,
  type AuthRefreshInput,
} from '@sitebook/shared';
import { CurrentUser, Public } from '../../common/decorators';
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
