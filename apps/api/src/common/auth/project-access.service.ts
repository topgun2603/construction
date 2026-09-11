import { Injectable } from '@nestjs/common';
import { ApiError } from '../errors/api-error';
import { TenantDb } from '../prisma/tenant-db.service';
import type { RequestUser } from './request-user';

/**
 * Project-level authorisation (spec §2: "Project-level assignment controls which
 * projects a supervisor/PM/client can see").
 *
 * RLS already guarantees a request cannot touch another *tenant's* project. This is
 * the layer above it: within the tenant, a supervisor sees only their own sites.
 * Both layers are needed — RLS cannot express membership, and a forgotten
 * membership check inside the right tenant is a real leak.
 */
@Injectable()
export class ProjectAccess {
  constructor(private readonly tenantDb: TenantDb) {}

  /** `where` fragment that narrows a project query to what this user may see. */
  scopeFilter(user: RequestUser): { id?: { in: string[] } } {
    if (user.seesAllProjects) return {};
    return { id: { in: user.projectIds } };
  }

  /** Same, for tables that reference a project by `projectId`. */
  scopeFilterByProjectId(user: RequestUser): { projectId?: { in: string[] } } {
    if (user.seesAllProjects) return {};
    return { projectId: { in: user.projectIds } };
  }

  /**
   * Throws unless the user may act on this project. Verifies the project exists in
   * the tenant too, so a caller cannot be handed a 403 that confirms an id from
   * another tenant.
   */
  async assertAccess(user: RequestUser, projectId: string): Promise<void> {
    const project = await this.tenantDb
      .clientFor(user.tenantId)
      .project.findFirst({ where: { id: projectId, deletedAt: null }, select: { id: true } });
    if (!project) throw ApiError.notFound('Project');

    if (!user.seesAllProjects && !user.projectIds.includes(projectId)) {
      throw ApiError.projectNotAssigned(projectId);
    }
  }
}
