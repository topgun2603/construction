import { Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import { TokenService } from '../../common/auth/token.service';
import { ApiError } from '../../common/errors/api-error';
import { PlatformAdmins } from './platform-admins.service';
import { PlatformDb } from './platform-db.service';

export interface PlatformRequest extends Request {
  platformAdmin?: { phone: string };
}

/**
 * The only thing standing in front of the platform console, so it checks three things
 * independently rather than trusting any one of them:
 *
 * 1. The token verifies with audience `platform`. A tenant access token has audience
 *    `api` and fails the signature check here — it is not a claim this code inspects
 *    and could forget.
 * 2. The phone inside it is *still* on the allowlist. Tokens last eight hours; removing
 *    an operator must not mean waiting for one to expire.
 * 3. The console is actually configured. An unconfigured deployment refuses everything,
 *    rather than falling through to a client that would read zero rows and look like an
 *    empty platform.
 *
 * The routes it guards are marked `@Public()` — that only means "skip the *tenant*
 * guard", which would otherwise reject these requests for having no tenant_id. This
 * guard is what actually authenticates them.
 */
@Injectable()
export class PlatformGuard implements CanActivate {
  constructor(
    private readonly tokens: TokenService,
    private readonly admins: PlatformAdmins,
    private readonly db: PlatformDb,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    if (!this.admins.configured || !this.db.enabled) {
      throw ApiError.forbidden('The platform console is not enabled on this deployment');
    }

    const request = context.switchToHttp().getRequest<PlatformRequest>();
    const header = request.headers.authorization;
    const [scheme, value] = (header ?? '').split(' ');
    if (scheme?.toLowerCase() !== 'bearer' || !value) throw ApiError.unauthenticated();

    const claims = this.tokens.verifyPlatformToken(value);
    if (!this.admins.allows(claims.phone)) {
      // Signed, unexpired, and no longer welcome.
      throw ApiError.forbidden('This number no longer has platform access');
    }

    request.platformAdmin = { phone: claims.phone };
    return true;
  }
}
