import { Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import type { AuthenticatedRequest } from '../auth/request-user';
import { RoleCache } from '../auth/role-cache.service';
import { TenantCache } from '../auth/tenant-cache.service';
import { TokenService } from '../auth/token.service';
import { IS_PUBLIC_KEY } from '../decorators';
import { planStanding } from '@sitebook/shared';
import { env } from '../../config/env';
import { ApiError } from '../errors/api-error';

/**
 * Verifies the app JWT and assembles `request.user`.
 *
 * The tenant id is taken from the signed token and nowhere else — never from a
 * header, query string or body (spec §6.1). This is the single place that decides
 * which tenant a request belongs to.
 */
/**
 * Methods that only read. Everything else is a write and stops when a term has run out.
 *
 * `HEAD` and `OPTIONS` are here because a browser sends them without anybody asking, and a CORS
 * preflight refused with a permissions error is a bug that looks like a network fault.
 */
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: TokenService,
    private readonly tenantCache: TenantCache,
    private readonly roleCache: RoleCache,
  ) {}

  /**
   * Read once. The grace window is deployment config, not something that changes under a running
   * process, and `env()` parses and caches anyway.
   */
  private readonly config = env();

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<Request & AuthenticatedRequest>();
    const token = bearerToken(request.headers.authorization);
    if (!token) throw ApiError.unauthenticated();

    const claims = this.tokens.verifyAccessToken(token);

    const tenant = await this.tenantCache.get(claims.tenant_id);
    // A deleted tenant's tokens stay cryptographically valid until they expire, so
    // the absence of the row has to be treated as a failed login, not a 404.
    if (!tenant) throw ApiError.invalidToken('Tenant no longer exists');
    if (tenant.status !== 'active') throw ApiError.tenantSuspended();

    /*
     * An expired term makes the account read-only, not dead.
     *
     * Reads keep working for good reason: a builder whose plan lapsed can still open last month's
     * wage sheet, show a client the drawings, and see what they would be renewing. Taking that away
     * makes renewing feel like paying a ransom rather than continuing a service — and the data was
     * theirs before the term ran out.
     *
     * Writes are what stop. Checked here rather than per-route because "anything that changes
     * something" is the rule, and a rule enforced route by route is one a new route forgets.
     */
    if (!SAFE_METHODS.has(request.method)) {
      const standing = planStanding(
        tenant.planExpiresOn,
        new Date(),
        this.config.BILLING_GRACE_DAYS,
      );
      if (standing === 'expired') throw ApiError.planExpired();
    }

    // Permissions come from the role row, not the token, so an owner narrowing a role takes
    // effect on the next request rather than when the token happens to expire.
    const role = await this.roleCache.resolveForUser(
      claims.tenant_id,
      claims.sub,
      claims.role_id ?? null,
      claims.role,
    );

    request.user = {
      userId: claims.sub,
      tenantId: claims.tenant_id,
      role: claims.role,
      roleName: role.name,
      permissions: role.permissions,
      projectIds: claims.project_ids ?? [],
      seesAllProjects: role.seesAllProjects,
      plan: tenant.plan,
      enabledModules: tenant.enabledModules,
    };

    return true;
  }
}

function bearerToken(header: string | undefined): string | null {
  if (!header) return null;
  const [scheme, value] = header.split(' ');
  if (scheme?.toLowerCase() !== 'bearer' || !value) return null;
  return value.trim();
}
