import { Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Permission } from '@sitebook/shared';
import type { AuthenticatedRequest } from '../auth/request-user';
import { PERMISSIONS_KEY } from '../decorators';
import { ApiError } from '../errors/api-error';

/**
 * Enforces `@RequiresPermission(...)`.
 *
 * Replaces role-name checking, which could not express a role the product had never heard
 * of. A route says what it needs doing; whether a given role may do it is the owner's
 * decision, recorded on the role row.
 *
 * Several permissions on one route means any of them suffices.
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<Permission[] | undefined>(PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) return true;

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    // A public route never arrives here with a user; an authenticated one without a user
    // means JwtAuthGuard did not run, which has to fail closed rather than fall through.
    if (!request.user) throw ApiError.unauthenticated();

    const held = request.user.permissions;
    if (!required.some((permission) => held.includes(permission))) {
      // The role's own name, because "limited to: owner, accounts" is meaningless to
      // somebody whose role is called "Store keeper".
      throw ApiError.forbidden(
        `Your role (${request.user.roleName}) cannot do this. An owner can change that in Settings → Roles.`,
      );
    }
    return true;
  }
}
