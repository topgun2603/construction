import { Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { UserRole } from '@sitebook/shared';
import type { AuthenticatedRequest } from '../auth/request-user';
import { ROLES_KEY } from '../decorators';
import { ApiError } from '../errors/api-error';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const allowed = this.reflector.getAllAndOverride<UserRole[] | undefined>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!allowed || allowed.length === 0) return true;

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    // Public routes never reach here with a user; an authenticated route without
    // one means JwtAuthGuard was bypassed, which must fail closed.
    if (!request.user) throw ApiError.unauthenticated();
    if (!allowed.includes(request.user.role)) {
      throw ApiError.forbidden(`This action is limited to: ${allowed.join(', ')}`);
    }
    return true;
  }
}
