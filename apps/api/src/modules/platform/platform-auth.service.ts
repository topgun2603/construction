import { Injectable, Logger } from '@nestjs/common';
import type { PlatformLoginInput } from '@sitebook/shared';
import { TokenService } from '../../common/auth/token.service';
import { ApiError } from '../../common/errors/api-error';
import { PhoneAuthService } from '../auth/phone-auth.service';
import { PlatformAdmins } from './platform-admins.service';
import { PlatformOperators } from './platform-operators.service';
import { PlatformService } from './platform.service';

/**
 * Signing in to the platform console.
 *
 * Same OTP vendor as the tenant app — the operator gets an SMS like anyone else — but
 * the resulting session is a different kind of token entirely, and no part of it is
 * shared with a tenant session.
 *
 * A phone that is not on the allowlist gets the same refusal as a phone that failed
 * OTP, and nothing in the response distinguishes "wrong number" from "not an
 * administrator". The console's URL is not a secret; the list of people who can open it
 * should not be enumerable through it.
 */
@Injectable()
export class PlatformAuthService {
  private readonly logger = new Logger(PlatformAuthService.name);

  constructor(
    private readonly phoneAuth: PhoneAuthService,
    private readonly tokens: TokenService,
    private readonly admins: PlatformAdmins,
    private readonly operators: PlatformOperators,
    private readonly platform: PlatformService,
  ) {}

  async login(input: PlatformLoginInput): Promise<{ access_token: string; expires_in: number; phone: string }> {
    if (!this.admins.configured) {
      throw ApiError.forbidden('The platform console is not enabled on this deployment');
    }

    const phone = await this.phoneAuth.verify(input.firebase_token);

    if (!(await this.operators.allows(phone))) {
      // Logged, because a stranger reaching a verified OTP at the console door is worth
      // knowing about. The caller is told nothing beyond "no".
      this.logger.warn('Platform console login refused for a number not on the allowlist');
      throw ApiError.unauthenticated('That number cannot sign in here');
    }

    await this.platform.recordLogin(phone);

    return {
      access_token: this.tokens.signPlatformToken(phone),
      expires_in: this.tokens.platformTokenTtlSeconds,
      phone,
    };
  }
}
