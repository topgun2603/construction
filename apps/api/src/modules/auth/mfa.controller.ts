import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  mfaConfirmSchema,
  mfaVerifySchema,
  type MfaConfirmInput,
  type MfaVerifyInput,
} from '@sitebook/shared';
import type { RequestUser } from '../../common/auth/request-user';
import { AllowWithoutMfa, CurrentUser, SessionOnly } from '../../common/decorators';
import { zodBody } from '../../common/pipes/zod-validation.pipe';
import { MfaService } from '../security/mfa.service';
import { AuthService } from './auth.service';

/**
 * The person's own authenticator app, and the two-factor step after sign-in.
 *
 * Every route is `@AllowWithoutMfa()`: these are how a session that owes a second factor pays it.
 * They are still behind the IP allow-list. `@SessionOnly()` on the writes because they change the
 * caller's own sign-in, not the company's data — an expired plan must not stop somebody signing in.
 *
 * Verifying (or confirming a new authenticator) answers with a fresh token pair for the same
 * session, now carrying `mfa`, so the client swaps its tokens and carries on.
 */
@ApiTags('auth')
@AllowWithoutMfa()
@Controller('auth/mfa')
export class MfaController {
  constructor(
    private readonly mfa: MfaService,
    private readonly auth: AuthService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Two-factor status for you and this session' })
  async status(@CurrentUser() user: RequestUser) {
    return this.mfa.status(user);
  }

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @SessionOnly()
  @Post('enrol')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Start setting up an authenticator app (returns the QR code URI)' })
  async enrol(@CurrentUser() user: RequestUser) {
    return this.mfa.beginEnrol(user);
  }

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @SessionOnly()
  @Post('enrol/confirm')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Confirm the authenticator with its first code; returns recovery codes' })
  async confirm(@CurrentUser() user: RequestUser, @Body(zodBody(mfaConfirmSchema)) body: MfaConfirmInput) {
    const { recovery_codes } = await this.mfa.confirmEnrol(user, body.code);
    const tokens = user.sessionId ? await this.auth.reissueForSession(user) : null;
    return { recovery_codes, tokens };
  }

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @SessionOnly()
  @Post('verify')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Show the second factor for this session (authenticator or recovery code)' })
  async verify(@CurrentUser() user: RequestUser, @Body(zodBody(mfaVerifySchema)) body: MfaVerifyInput) {
    const result = await this.mfa.verify(user, body.code);
    const tokens = await this.auth.reissueForSession(user);
    return { ...result, tokens };
  }

  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @SessionOnly()
  @Post('recovery-codes')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Replace your recovery codes' })
  async regenerate(@CurrentUser() user: RequestUser) {
    return this.mfa.regenerateRecoveryCodes(user);
  }

  @SessionOnly()
  @Delete()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Remove your authenticator app' })
  async remove(@CurrentUser() user: RequestUser): Promise<void> {
    await this.mfa.remove(user);
  }
}
