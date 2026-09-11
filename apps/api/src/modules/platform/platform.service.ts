import { Injectable } from '@nestjs/common';
import { effectiveModules, monthlyRecurringPaise, type Plan } from '@sitebook/shared';
import { ApiError } from '../../common/errors/api-error';
import { PlatformDb } from './platform-db.service';

export interface TenantRow {
  id: string;
  name: string;
  plan: string;
  status: string;
  enabled_modules: string[];
  created_at: string;
  owner_name: string | null;
  owner_phone: string | null;
  user_count: number;
  project_count: number;
  worker_count: number;
  /** The most recent sign-in by anyone in the tenant, or null if nobody ever has. */
  last_activity: string | null;
}

/**
 * The platform console's read and write model.
 *
 * Every query here runs on the BYPASSRLS connection, so every one of them is
 * cross-tenant by construction. That makes this the one file in the codebase where
 * forgetting a `where tenant_id` is not caught by the database, so each query either
 * groups by tenant or is explicitly about all of them.
 */
@Injectable()
export class PlatformService {
  constructor(private readonly db: PlatformDb) {}

  /**
   * The numbers on the console's front page.
   *
   * Counted in the database rather than by loading tenants and reducing in Node: this
   * is the one part of the system with no tenant filter, so the row counts grow with
   * the whole business rather than with one builder.
   */
  async metrics() {
    const prisma = this.db.client;
    const monthStart = startOfMonthUtc();

    const [
      byStatus,
      byPlan,
      newThisMonth,
      users,
      projects,
      workers,
      activeProjects,
      subscriptions,
    ] = await Promise.all([
        prisma.tenant.groupBy({ by: ['status'], _count: { _all: true } }),
        prisma.tenant.groupBy({ by: ['plan'], _count: { _all: true } }),
        prisma.tenant.count({ where: { createdAt: { gte: monthStart } } }),
        prisma.user.count({ where: { deletedAt: null } }),
        prisma.project.count({ where: { deletedAt: null } }),
        prisma.worker.count({ where: { deletedAt: null } }),
        prisma.project.count({ where: { deletedAt: null, status: 'active' } }),
        /*
         * Joined to the tenant so a suspended account cannot count as revenue even while its
         * subscription row still says active — the money stops when the service does.
         */
        prisma.subscription.findMany({
          where: { tenant: { status: 'active' } },
          select: { plan: true, status: true },
        }),
      ]);

    const statusCount = (status: string) =>
      byStatus.find((row) => row.status === status)?._count._all ?? 0;
    const planCount = (plan: string) => byPlan.find((row) => row.plan === plan)?._count._all ?? 0;

    const billable = subscriptions.map((row) => ({
      plan: row.plan,
      billing_status: row.status,
    }));

    return {
      /*
       * Real MRR, not an estimate. Counts only subscriptions actually being charged — a trial, a
       * past-due account, a cancellation or a suspended tenant is not revenue, and an MRR that
       * included them is the number that makes a business think it is twice the size it is.
       *
       * Absent from this console until billing shipped, because a plan price existed nowhere and an
       * invented figure is the one number here somebody would act on.
       */
      revenue: {
        mrr: monthlyRecurringPaise(billable).toString(),
        paying: billable.filter((row) => row.billing_status === 'active').length,
        trialing: billable.filter((row) => row.billing_status === 'trialing').length,
        past_due: billable.filter((row) => row.billing_status === 'past_due').length,
      },
      tenants: {
        total: byStatus.reduce((sum, row) => sum + row._count._all, 0),
        active: statusCount('active'),
        suspended: statusCount('suspended'),
        cancelled: statusCount('cancelled'),
        new_this_month: newThisMonth,
      },
      plans: { starter: planCount('starter'), pro: planCount('pro') },
      usage: {
        users,
        projects,
        active_projects: activeProjects,
        workers,
      },
    };
  }

  /**
   * Every tenant, with the counts that tell you whether an account is alive.
   *
   * The counts come from one grouped query per entity rather than a per-tenant loop:
   * with a few thousand tenants the loop is a few thousand round trips, and this
   * screen is the first thing the console loads.
   */
  async listTenants(query: { search?: string; status?: string; plan?: string }) {
    const prisma = this.db.client;
    const search = query.search?.trim();

    const tenants = await prisma.tenant.findMany({
      where: {
        ...(query.status ? { status: query.status as never } : {}),
        ...(query.plan ? { plan: query.plan as never } : {}),
        ...(search
          ? {
              OR: [
                { name: { contains: search, mode: 'insensitive' as const } },
                { users: { some: { phone: { contains: search }, deletedAt: null } } },
              ],
            }
          : {}),
      },
      select: {
        id: true,
        name: true,
        plan: true,
        status: true,
        enabledModules: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
      take: 500,
    });

    if (tenants.length === 0) return { tenants: [] as TenantRow[] };

    const ids = tenants.map((tenant) => tenant.id);
    const [users, projects, workers, owners, lastLogins] = await Promise.all([
      prisma.user.groupBy({
        by: ['tenantId'],
        where: { tenantId: { in: ids }, deletedAt: null },
        _count: { _all: true },
      }),
      prisma.project.groupBy({
        by: ['tenantId'],
        where: { tenantId: { in: ids }, deletedAt: null },
        _count: { _all: true },
      }),
      prisma.worker.groupBy({
        by: ['tenantId'],
        where: { tenantId: { in: ids }, deletedAt: null },
        _count: { _all: true },
      }),
      // The first owner by creation is the person who onboarded, which is who you want
      // to ring about an account.
      prisma.user.findMany({
        where: { tenantId: { in: ids }, role: 'owner', deletedAt: null },
        select: { tenantId: true, name: true, phone: true, createdAt: true },
        orderBy: { createdAt: 'asc' },
      }),
      prisma.user.groupBy({
        by: ['tenantId'],
        where: { tenantId: { in: ids }, deletedAt: null },
        _max: { lastLogin: true },
      }),
    ]);

    const count = (rows: Array<{ tenantId: string; _count: { _all: number } }>) =>
      new Map(rows.map((row) => [row.tenantId, row._count._all]));
    const userCount = count(users);
    const projectCount = count(projects);
    const workerCount = count(workers);
    const lastByTenant = new Map(
      lastLogins.map((row) => [row.tenantId, row._max.lastLogin ?? null]),
    );
    const ownerByTenant = new Map<string, { name: string; phone: string }>();
    for (const owner of owners) {
      if (!ownerByTenant.has(owner.tenantId)) {
        ownerByTenant.set(owner.tenantId, { name: owner.name, phone: owner.phone });
      }
    }

    const rows: TenantRow[] = tenants.map((tenant) => ({
      id: tenant.id,
      name: tenant.name,
      plan: tenant.plan,
      status: tenant.status,
      enabled_modules: tenant.enabledModules,
      created_at: tenant.createdAt.toISOString(),
      owner_name: ownerByTenant.get(tenant.id)?.name ?? null,
      owner_phone: ownerByTenant.get(tenant.id)?.phone ?? null,
      user_count: userCount.get(tenant.id) ?? 0,
      project_count: projectCount.get(tenant.id) ?? 0,
      worker_count: workerCount.get(tenant.id) ?? 0,
      last_activity: lastByTenant.get(tenant.id)?.toISOString() ?? null,
    }));

    return { tenants: rows };
  }

  /** One tenant in detail: its team, its sites, and what the console has done to it. */
  async getTenant(tenantId: string) {
    const prisma = this.db.client;

    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: {
        id: true,
        name: true,
        logoUrl: true,
        plan: true,
        status: true,
        enabledModules: true,
        createdAt: true,
        razorpayCustomerId: true,
      },
    });
    if (!tenant) throw ApiError.notFound('Tenant');

    const [team, projects, counts, audit] = await Promise.all([
      prisma.user.findMany({
        where: { tenantId, deletedAt: null },
        select: { id: true, name: true, phone: true, role: true, status: true, lastLogin: true },
        orderBy: [{ role: 'asc' }, { name: 'asc' }],
      }),
      prisma.project.findMany({
        where: { tenantId, deletedAt: null },
        select: { id: true, name: true, status: true, startDate: true, budgetAmount: true },
        orderBy: { createdAt: 'desc' },
        take: 50,
      }),
      Promise.all([
        prisma.worker.count({ where: { tenantId, deletedAt: null } }),
        prisma.attendance.count({ where: { tenantId } }),
        prisma.dailyReport.count({ where: { tenantId, deletedAt: null } }),
        prisma.expense.count({ where: { tenantId, deletedAt: null } }),
      ]),
      prisma.platformAuditLog.findMany({
        where: { tenantId },
        orderBy: { createdAt: 'desc' },
        take: 25,
      }),
    ]);

    const [workers, attendanceRows, reports, expenses] = counts;

    return {
      tenant: {
        id: tenant.id,
        name: tenant.name,
        logo_url: tenant.logoUrl,
        plan: tenant.plan,
        status: tenant.status,
        enabled_modules: tenant.enabledModules,
        created_at: tenant.createdAt.toISOString(),
        razorpay_customer_id: tenant.razorpayCustomerId,
      },
      usage: { workers, attendance_rows: attendanceRows, reports, expenses },
      team: team.map((member) => ({
        id: member.id,
        name: member.name,
        phone: member.phone,
        role: member.role,
        status: member.status,
        last_login: member.lastLogin?.toISOString() ?? null,
      })),
      projects: projects.map((project) => ({
        id: project.id,
        name: project.name,
        status: project.status,
        start_date: project.startDate ? project.startDate.toISOString().slice(0, 10) : null,
        // Paise as a string, like everywhere else money crosses the wire.
        budget_amount: project.budgetAmount === null ? null : project.budgetAmount.toString(),
      })),
      audit: audit.map((entry) => ({
        id: entry.id,
        actor_phone: entry.actorPhone,
        action: entry.action,
        before: entry.before,
        after: entry.after,
        created_at: entry.createdAt.toISOString(),
      })),
    };
  }

  /**
   * Change a tenant's plan, module list or status.
   *
   * Suspension takes effect on the tenant's next request, not on their next login:
   * `JwtAuthGuard` reads `tenants.status` through `TenantCache` on every call, so an
   * account stops working within the cache TTL. That is the lever this whole console
   * exists to provide, and it is why the status change is written before anything else
   * can fail.
   *
   * Changing the plan resets `enabled_modules` to that plan's defaults unless the caller
   * passes an explicit list. Otherwise a downgrade from Pro to Starter would leave the
   * Pro modules switched on and the tenant keeping features they stopped paying for —
   * the plan field would say Starter while the gate said otherwise.
   */
  async updateTenant(
    actorPhone: string,
    tenantId: string,
    input: { plan?: string; status?: string; enabled_modules?: string[] },
  ) {
    const prisma = this.db.client;

    const before = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { id: true, name: true, plan: true, status: true, enabledModules: true },
    });
    if (!before) throw ApiError.notFound('Tenant');

    const modules =
      input.enabled_modules ??
      (input.plan && input.plan !== before.plan
        ? [...effectiveModules(input.plan as Plan, [])]
        : undefined);

    const after = await prisma.tenant.update({
      where: { id: tenantId },
      data: {
        ...(input.plan ? { plan: input.plan as never } : {}),
        ...(input.status ? { status: input.status as never } : {}),
        ...(modules ? { enabledModules: modules } : {}),
      },
      select: { id: true, name: true, plan: true, status: true, enabledModules: true },
    });

    await prisma.platformAuditLog.create({
      data: {
        actorPhone,
        action: 'tenant.updated',
        tenantId,
        before: {
          plan: before.plan,
          status: before.status,
          enabled_modules: before.enabledModules,
        },
        after: { plan: after.plan, status: after.status, enabled_modules: after.enabledModules },
      },
    });

    return {
      id: after.id,
      name: after.name,
      plan: after.plan,
      status: after.status,
      enabled_modules: after.enabledModules,
    };
  }

  /** The console's own trail, newest first, across every tenant. */
  async auditTrail(limit = 100) {
    const entries = await this.db.client.platformAuditLog.findMany({
      orderBy: { createdAt: 'desc' },
      take: limit,
    });

    // Tenant names are resolved in a second query: the trail outlives the tenants it
    // describes, so there is no join that would survive a deleted account.
    const tenantIds = [...new Set(entries.map((e) => e.tenantId).filter(Boolean))] as string[];
    const tenants = await this.db.client.tenant.findMany({
      where: { id: { in: tenantIds } },
      select: { id: true, name: true },
    });
    const nameById = new Map(tenants.map((tenant) => [tenant.id, tenant.name]));

    return {
      entries: entries.map((entry) => ({
        id: entry.id,
        actor_phone: entry.actorPhone,
        action: entry.action,
        tenant_id: entry.tenantId,
        tenant_name: entry.tenantId ? (nameById.get(entry.tenantId) ?? null) : null,
        before: entry.before,
        after: entry.after,
        created_at: entry.createdAt.toISOString(),
      })),
    };
  }

  /** Records a console sign-in, so the trail shows who was looking and when. */
  async recordLogin(actorPhone: string): Promise<void> {
    await this.db.client.platformAuditLog.create({
      data: { actorPhone, action: 'platform.login' },
    });
  }
}

/** First instant of the current month, UTC. */
function startOfMonthUtc(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}
