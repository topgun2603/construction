import { Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { hasModule, type ModuleName } from '@sitebook/shared';
import type { AuthenticatedRequest } from '../auth/request-user';
import { REQUIRES_MODULE_KEY } from '../decorators';
import { ApiError } from '../errors/api-error';

/**
 * Plan gating (spec §6.3). Returns `403 MODULE_NOT_ENABLED` so clients can tell a
 * "you cannot do this" from a "your plan does not include this" and offer an
 * upgrade instead of an error.
 */
@Injectable()
export class PlanGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<ModuleName | undefined>(
      REQUIRES_MODULE_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!required) return true;

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!request.user) throw ApiError.unauthenticated();
    if (!hasModule(request.user.enabledModules, required)) {
      throw ApiError.moduleNotEnabled(required);
    }
    return true;
  }
}
