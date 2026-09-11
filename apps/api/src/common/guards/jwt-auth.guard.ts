import { Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import type { AuthenticatedRequest } from '../auth/request-user';
import { RoleCache } from '../auth/role-cache.service';
import { TenantCache } from '../auth/tenant-cache.service';
import { TokenService } from '../auth/token.service';
import { IS_PUBLIC_KEY } from '../decorators';
import { ApiError } from '../errors/api-error';

/**
 * Verifies the app JWT and assembles `request.user`.
 *
 * The tenant id is taken from the signed token and nowhere else — never from a
 * header, query string or body (spec §6.1). This is the single place that decides
 * which tenant a request belongs to.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: TokenService,
    private readonly tenantCache: TenantCache,
    private readonly roleCache: RoleCache,
  ) {}

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
