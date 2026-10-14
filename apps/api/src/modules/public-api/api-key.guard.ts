import {
  HttpStatus,
  Injectable,
  Logger,
  SetMetadata,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request, Response } from 'express';
import {
  ERROR_CODES,
  PUBLIC_API_KEY_PATTERN,
  hasModule,
  ipAllowed,
  planStanding,
  type ModuleName,
  type PublicApiScope,
} from '@sitebook/shared';
import { TenantCache, type TenantGateInfo } from '../../common/auth/tenant-cache.service';
import { ApiError } from '../../common/errors/api-error';
import { clientIpOf } from '../../common/net/client-ip';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TenantDb } from '../../common/prisma/tenant-db.service';
import { env } from '../../config/env';
import { ApiKeyHasher } from './api-key-hasher';
import { PublicRateLimiter } from './public-rate-limiter';

/** The company's service principal a public API request runs as. Never a person. */
export interface ApiKeyPrincipal {
  id: string;
  tenantId: string;
  name: string;
  scopes: readonly string[];
  /** The owner who made the key: whom a write is filed under when a table insists on a person. */
  createdByUserId: string;
  tenant: TenantGateInfo;
}

export interface PublicApiRequest extends Request {
  apiKey?: ApiKeyPrincipal;
}

export const PUBLIC_SCOPE_KEY = 'sitebook:public-scope';

/**
 * The scope a public route needs, and the module it reads (honouring a module the operator has
 * switched off for the company, as `@RequiresModule` does on the internal API).
 */
export const PublicScope = (scope: PublicApiScope, module?: ModuleName): MethodDecorator =>
  SetMetadata(PUBLIC_SCOPE_KEY, { scope, module });

/** `last_used_at` is written at most this often per key, so a busy integration is not a write per call. */
const TOUCH_INTERVAL_MS = 60_000;
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Authenticates a `/public/v1` request by its API key, and is the only way in there.
 *
 * In order — each step refuses before the next costs anything:
 *
 * 1. The bearer token must look like a key. A session JWT is refused here, as a key is refused by
 *    JwtAuthGuard on `/v1`: the two credentials never cross.
 * 2. HMAC of the key → `api_key_directory` (no RLS, answers "which company?" and nothing else) →
 *    the key row inside that company's RLS scope, compared in constant time. Unknown, revoked and
 *    malformed are one answer (401) so the endpoint is no oracle; expired says so, since the owner
 *    set that date and the integrator needs to know to ask for a new key.
 * 3. The company: gone → 401, suspended → 403, plan run out → writes refused (reads keep working,
 *    as for people).
 * 4. Addresses. The company's IP allow-list applies to every key whenever it is on (`web` or
 *    `everyone` mode alike): a key is server-to-server, so the mobile-data reason for the `web`
 *    exemption does not apply, and the owner exemption does not either — a key is not the owner.
 *    Then the key's own `allowed_cidrs`, if it has any. Both must pass.
 * 5. Rate limit, per key (429 with Retry-After).
 * 6. The route's scope and module.
 */
@Injectable()
export class ApiKeyGuard implements CanActivate {
  private readonly logger = new Logger(ApiKeyGuard.name);
  private readonly hasher = ApiKeyHasher.fromEnv(env());
  private readonly touched = new Map<string, number>();

  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
    private readonly tenantDb: TenantDb,
    private readonly tenantCache: TenantCache,
    private readonly limiter: PublicRateLimiter,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<PublicApiRequest>();
    const response = context.switchToHttp().getResponse<Response>();

    // 1. A key, not a session.
    const [scheme, token] = (request.headers.authorization ?? '').split(' ');
    if (scheme?.toLowerCase() !== 'bearer' || !token) {
      throw ApiError.unauthenticated('Send your API key as "Authorization: Bearer bk_live_…".');
    }
    const key = token.trim();
    if (!PUBLIC_API_KEY_PATTERN.test(key)) throw invalidKey();
    if (!this.hasher) {
      throw new ApiError(HttpStatus.SERVICE_UNAVAILABLE, ERROR_CODES.INTERNAL, 'The public API is not set up on this server.');
    }

    // 2. Which company, then the key itself under that company's RLS.
    const hash = this.hasher.hash(key);
    const entry = await this.prisma.apiKeyDirectory.findUnique({ where: { keyHash: hash }, select: { tenantId: true } });
    if (!entry) throw invalidKey();
    const stored = await this.tenantDb.transaction(entry.tenantId, (tx) =>
      tx.apiKey.findFirst({
        where: { keyHash: hash, revokedAt: null },
        select: {
          id: true,
          name: true,
          keyHash: true,
          scopes: true,
          allowedCidrs: true,
          expiresAt: true,
          createdByUserId: true,
          lastUsedAt: true,
        },
      }),
    );
    if (!stored || !this.hasher.matches(stored.keyHash, hash)) throw invalidKey();
    if (stored.expiresAt && stored.expiresAt.getTime() <= Date.now()) {
      throw new ApiError(
        HttpStatus.UNAUTHORIZED,
        ERROR_CODES.TOKEN_EXPIRED,
        `This API key expired on ${stored.expiresAt.toISOString()}. Ask an owner for a new one.`,
        { expired_at: stored.expiresAt.toISOString() },
      );
    }

    // 3. The company.
    const tenant = await this.tenantCache.get(entry.tenantId);
    if (!tenant) throw invalidKey();
    if (tenant.status !== 'active') throw ApiError.tenantSuspended();
    if (
      !SAFE_METHODS.has(request.method) &&
      planStanding(tenant.planExpiresOn, new Date(), env().BILLING_GRACE_DAYS) === 'expired'
    ) {
      throw ApiError.planExpired();
    }

    // 4. Where the call comes from.
    const ip = clientIpOf(request);
    const gate = tenant.security;
    if (gate && gate.ipMode !== 'off' && !ipAllowed(ip, gate.ipCidrs)) throw ApiError.ipNotAllowed(ip);
    if (stored.allowedCidrs.length > 0 && !ipAllowed(ip, stored.allowedCidrs)) {
      throw new ApiError(
        HttpStatus.FORBIDDEN,
        ERROR_CODES.IP_NOT_ALLOWED,
        `This API key may only be used from its approved addresses, and ${ip || 'this address'} is not one of them.`,
        { ip },
      );
    }

    // 5. How often.
    const rate = this.limiter.take(stored.id);
    response.setHeader('X-RateLimit-Limit', String(rate.limit));
    response.setHeader('X-RateLimit-Remaining', String(rate.remaining));
    response.setHeader('X-RateLimit-Reset', String(rate.resetSeconds));
    if (!rate.allowed) {
      response.setHeader('Retry-After', String(rate.resetSeconds));
      throw ApiError.rateLimited(`Too many requests for this API key. Try again in ${rate.resetSeconds} seconds.`, {
        limit: rate.limit,
        retry_after: rate.resetSeconds,
      });
    }

    // 6. What this route needs.
    const meta = this.reflector.getAllAndOverride<{ scope: PublicApiScope; module?: ModuleName } | undefined>(
      PUBLIC_SCOPE_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (meta) {
      if (!stored.scopes.includes(meta.scope)) {
        throw new ApiError(
          HttpStatus.FORBIDDEN,
          ERROR_CODES.FORBIDDEN,
          `This API key does not have the ${meta.scope} scope. An owner can make a key that does in Settings → Developers.`,
          { required_scope: meta.scope },
        );
      }
      if (meta.module && !hasModule(tenant.enabledModules, meta.module)) throw ApiError.moduleNotEnabled(meta.module);
    }

    request.apiKey = {
      id: stored.id,
      tenantId: entry.tenantId,
      name: stored.name,
      scopes: stored.scopes,
      createdByUserId: stored.createdByUserId,
      tenant,
    };
    await this.touch(entry.tenantId, stored.id, stored.lastUsedAt, ip);
    return true;
  }

  private async touch(tenantId: string, keyId: string, lastUsedAt: Date | null, ip: string): Promise<void> {
    const now = Date.now();
    const recent = Math.max(lastUsedAt?.getTime() ?? 0, this.touched.get(keyId) ?? 0);
    if (now - recent < TOUCH_INTERVAL_MS) return;
    this.touched.set(keyId, now);
    if (this.touched.size > 10_000) this.touched.clear();
    try {
      await this.tenantDb.transaction(tenantId, (tx) =>
        tx.apiKey.update({ where: { id: keyId }, data: { lastUsedAt: new Date(now), lastUsedIp: ip || null } }),
      );
    } catch (error) {
      // Bookkeeping: never worth failing the call it describes.
      this.logger.warn({ err: error, keyId }, 'Could not record API key use');
    }
  }
}

function invalidKey(): ApiError {
  return ApiError.invalidToken('The API key is not valid. Check it was copied whole, and has not been revoked.');
}
