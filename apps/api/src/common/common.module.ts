import { Global, Module } from '@nestjs/common';
import { ProjectAccess } from './auth/project-access.service';
import { TenantCache } from './auth/tenant-cache.service';
import { RoleCache } from './auth/role-cache.service';
import { TokenService } from './auth/token.service';

/**
 * Cross-cutting services the global guards depend on. Global because
 * JwtAuthGuard and PlanGuard are registered app-wide and cannot import from a
 * feature module without a cycle.
 */
@Global()
@Module({
  providers: [TokenService, TenantCache, RoleCache, ProjectAccess],
  exports: [TokenService, TenantCache, RoleCache, ProjectAccess],
})
export class CommonModule {}
