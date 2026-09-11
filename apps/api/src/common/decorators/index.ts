import { SetMetadata, createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { ModuleName, Permission, UserRole } from '@sitebook/shared';
import type { AuthenticatedRequest, RequestUser } from '../auth/request-user';
import { ApiError } from '../errors/api-error';

export const IS_PUBLIC_KEY = 'sitebook:public';
export const ROLES_KEY = 'sitebook:roles';
export const REQUIRES_MODULE_KEY = 'sitebook:requires-module';
export const PERMISSIONS_KEY = 'sitebook:permissions';

/** Skips JwtAuthGuard. Only for login, health and webhooks. */
export const Public = (): MethodDecorator & ClassDecorator => SetMetadata(IS_PUBLIC_KEY, true);

/** Restricts a route to specific roles (spec §2). */
export const Roles = (...roles: UserRole[]): MethodDecorator & ClassDecorator =>
  SetMetadata(ROLES_KEY, roles);

/**
 * Gates a route on what the caller may do, rather than on the name of their role.
 *
 * This is what makes owner-defined roles possible: a custom role called "Store keeper" is
 * allowed through by holding `indents.raise`, without any route needing to have heard of it.
 *
 * Several permissions means any one of them is enough. No route so far needs all of a set,
 * and "any" is the reading people expect from a list.
 */
export const RequiresPermission = (
  ...permissions: Permission[]
): MethodDecorator & ClassDecorator => SetMetadata(PERMISSIONS_KEY, permissions);

/** Gates a route on the tenant's plan (spec §6.3). */
export const RequiresModule = (moduleName: ModuleName): MethodDecorator & ClassDecorator =>
  SetMetadata(REQUIRES_MODULE_KEY, moduleName);

/** The authenticated caller. Throws rather than returning undefined. */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): RequestUser => {
    const request = ctx.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!request.user) throw ApiError.unauthenticated();
    return request.user;
  },
);
