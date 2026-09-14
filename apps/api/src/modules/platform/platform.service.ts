import { Injectable } from '@nestjs/common';
import { effectiveModules, monthlyRecurringPaise, type Plan } from '@sitebook/shared';
import { randomUUID } from 'node:crypto';
import {
  defaultModulesForPlan,
  expiryAfterMonths,
  permissionsForSystemRole,
  planStanding,
  systemRoleSeesAllProjects,
  toE164Indian,
  type CreateTenantPlatformInput,
  type PlanStanding,
  type UserRole,
} from '@sitebook/shared';
import { ApiError } from '../../common/errors/api-error';
import { env } from '../../config/env';
import { PlansService } from '../plans/plans.service';
import { SYSTEM_ROLE_NAMES } from '../tenants/tenants.service';
import { PlatformDb } from './platform-db.service';

export interface TenantRow {
  id: string;
  name: string;
  plan: string;
  status: string;
  enabled_modules: string[];
  created_at: string;
  /** When the term runs out. Null is a plan that never does. */
  plan_expires_on: string | null;
  /** `active`, `grace` or `expired` — what the write gate is doing about that date today. */
  plan_standing: PlanStanding;
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
  private readonly config = env();

  constructor(
    private readonly db: PlatformDb,
    private readonly plans: PlansService,
  ) {}

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

    /*
     * MRR needs each subscription's price and term length, which now live in the catalogue rather
     * than in code. One query for the whole catalogue and a lookup per row — there are four plans,
     * not four thousand, and a join per subscription would be the slower answer.
     */
    const catalogue = new Map(
      (await this.plans.listAll()).map((plan) => [plan.code, plan] as const),
    );
    const billable = subscriptions.map((row) => ({
      price: BigInt(catalogue.get(row.plan)?.price ?? '0'),
      months: catalogue.get(row.plan)?.months ?? null,
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
        planExpiresOn: true,
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

    // One instant for the whole list: rows judged against different `now`s could disagree about
    // where the same boundary falls, which is a confusing thing for a table to do.
    const now = new Date();

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
      plan_expires_on: tenant.planExpiresOn?.toISOString() ?? null,
      plan_standing: planStanding(tenant.planExpiresOn, now, this.config.BILLING_GRACE_DAYS),
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
        planStartedOn: true,
        planExpiresOn: true,
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
        plan_started_on: tenant.planStartedOn?.toISOString() ?? null,
        plan_expires_on: tenant.planExpiresOn?.toISOString() ?? null,
        plan_standing: planStanding(
          tenant.planExpiresOn,
          new Date(),
          this.config.BILLING_GRACE_DAYS,
        ),
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
        /*
         * Changing the term restarts it from today.
         *
         * An operator setting a plan is recording that somebody has paid for that length of time,
         * and they have paid for it starting now — carrying the old end date forward would sell
         * six months and deliver whatever was left of the last one. `lifetime` clears the date,
         * which is what makes it never expire.
         */
        ...(input.plan
          ? {
              plan: input.plan,
              planStartedOn: new Date(),
              planExpiresOn: expiryAfterMonths(
                await this.plans.monthsFor(input.plan),
                new Date(),
              ),
            }
          : {}),
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

  /**
   * How many accounts are on a plan code.
   *
   * Here rather than in `PlansService` because the answer needs a connection that can read every
   * tenant, and the catalogue is otherwise served on the tenant-facing one. See `PlansService.remove`.
   */
  async tenantsOnPlan(code: string): Promise<number> {
    return this.db.client.tenant.count({ where: { plan: code } });
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


  /**
   * What an operator needs to answer "it is not showing on my screen", without asking the customer
   * for screenshots or opening a psql session.
   *
   * Read-only, and deliberately not impersonation. Minting a tenant token for a support person
   * would put a console operator inside a customer's account with their permissions and no
   * distinguishing mark in the tenant's own audit log — every action they took would read as the
   * customer having taken it. This returns the handful of facts that actually explain the usual
   * support call instead: who can sign in, what the plan allows, which sites are live, and whether
   * anything has been filed lately.
   *
   * Reading a customer's data is still an intrusion, so it is audited like any other console act.
   */
  async supportView(actorPhone: string, tenantId: string) {
    const prisma = this.db.client;

    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: {
        id: true,
        name: true,
        plan: true,
        status: true,
        enabledModules: true,
        createdAt: true,
      },
    });
    if (!tenant) throw ApiError.notFound('Tenant');

    const since = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);

    const [users, projects, recentReports, recentAttendance, pendingIndents, pendingExpenses] =
      await Promise.all([
        prisma.user.findMany({
          where: { tenantId, deletedAt: null },
          select: {
            id: true,
            name: true,
            phone: true,
            role: true,
            status: true,
            lastLogin: true,
            roleId: true,
          },
          orderBy: [{ role: 'asc' }, { name: 'asc' }],
        }),
        prisma.project.findMany({
          where: { tenantId, deletedAt: null },
          select: { id: true, name: true, status: true },
          orderBy: { createdAt: 'desc' },
          take: 50,
        }),
        prisma.dailyReport.count({ where: { tenantId, deletedAt: null, createdAt: { gte: since } } }),
        prisma.attendance.count({ where: { tenantId, createdAt: { gte: since } } }),
        prisma.materialIndent.count({ where: { tenantId, status: 'requested' } }),
        prisma.expense.count({ where: { tenantId, deletedAt: null, status: 'pending' } }),
      ]);

    await prisma.platformAuditLog.create({
      data: { actorPhone, action: 'tenant.support_viewed', tenantId },
    });

    return {
      tenant: {
        id: tenant.id,
        name: tenant.name,
        plan: tenant.plan,
        status: tenant.status,
        enabled_modules: tenant.enabledModules,
        created_at: tenant.createdAt.toISOString(),
      },
      // The three things that explain most "I cannot see it" calls: the account is suspended, the
      // module is off the plan, or the person asking has a role that was never given the screen.
      users: users.map((user) => ({
        id: user.id,
        name: user.name,
        phone: user.phone,
        role: user.role,
        custom_role_id: user.roleId,
        status: user.status,
        last_login: user.lastLogin?.toISOString() ?? null,
      })),
      projects,
      activity: {
        since: since.toISOString(),
        reports: recentReports,
        attendance_rows: recentAttendance,
        indents_waiting: pendingIndents,
        expenses_waiting: pendingExpenses,
      },
    };
  }

  /**
   * Everything this tenant owns, as JSON, so a customer who asks to leave can be given their data.
   *
   * Deliberately a straight dump rather than a curated report: the point is that nothing of theirs
   * is withheld, and a shape that tried to be readable would invite arguments about what was left
   * out. Money stays a string of paise here as it does everywhere else.
   *
   * Photographs are referenced by key, not embedded. The objects are in storage behind presigned
   * URLs, and a JSON file with a hundred megabytes of base64 in it is not something anybody can
   * open.
   */
  async exportTenant(actorPhone: string, tenantId: string) {
    const prisma = this.db.client;

    const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
    if (!tenant) throw ApiError.notFound('Tenant');

    const where = { tenantId };
    const [
      users,
      projects,
      workers,
      contractors,
      attendance,
      dailyReports,
      indents,
      expenses,
      labourPayments,
      wagePeriods,
      materials,
      stockMovements,
      documents,
    ] = await Promise.all([
      prisma.user.findMany({ where }),
      prisma.project.findMany({ where }),
      prisma.worker.findMany({ where }),
      prisma.contractor.findMany({ where }),
      prisma.attendance.findMany({ where }),
      prisma.dailyReport.findMany({ where }),
      prisma.materialIndent.findMany({ where, include: { items: true } }),
      prisma.expense.findMany({ where }),
      prisma.labourPayment.findMany({ where }),
      prisma.wagePeriod.findMany({ where, include: { lines: true } }),
      prisma.material.findMany({ where }),
      prisma.stockMovement.findMany({ where }),
      prisma.document.findMany({ where }),
    ]);

    await prisma.platformAuditLog.create({
      data: { actorPhone, action: 'tenant.exported', tenantId },
    });

    return {
      exported_at: new Date().toISOString(),
      exported_by: actorPhone,
      tenant,
      users,
      projects,
      workers,
      contractors,
      attendance,
      daily_reports: dailyReports,
      indents,
      expenses,
      labour_payments: labourPayments,
      wage_periods: wagePeriods,
      materials,
      stock_movements: stockMovements,
      documents,
    };
  }

  /**
   * Removes a tenant and everything under it, for good.
   *
   * Guarded by the tenant's own name rather than a checkbox. An operator working through a list of
   * accounts can click "yes" without reading; typing "Green Acres LLP" requires having looked at
   * which row they are on. The same reason `DROP DATABASE` asks in production tooling.
   *
   * Every foreign key to `tenants` is `ON DELETE CASCADE`, so this is one statement and leaves no
   * orphans. What it does *not* remove is the audit trail: `platform_audit_log` holds no foreign
   * key to the tenant precisely so the record of what was done to an account outlives the account.
   *
   * Suspension is the reversible option and stays the default; this is for a customer who has
   * asked to be forgotten, and for clearing test accounts out of a shared database.
   */
  async deleteTenant(actorPhone: string, tenantId: string, confirmName: string) {
    const prisma = this.db.client;

    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { id: true, name: true, plan: true, status: true },
    });
    if (!tenant) throw ApiError.notFound('Tenant');

    if (confirmName.trim() !== tenant.name.trim()) {
      throw ApiError.conflict('The name typed does not match this account');
    }

    // Written before the delete, not after: if the delete succeeds and the process dies before the
    // log is written, there is no tenant left to tell you what happened to it.
    await prisma.platformAuditLog.create({
      data: {
        actorPhone,
        action: 'tenant.deleted',
        tenantId,
        before: { name: tenant.name, plan: tenant.plan, status: tenant.status },
      },
    });

    await prisma.tenant.delete({ where: { id: tenantId } });
    return { deleted: tenant.name };
  }

  /**
   * Creates an account without anybody signing up for it.
   *
   * Deliberately the same shape onboarding produces — the tenant, its built-in role rows, and an
   * owner — so a console-made account is indistinguishable from a self-served one afterwards. A
   * tenant missing its role rows would work until its owner tried to build a custom role and found
   * nothing to base it on.
   *
   * The owner is `pending`: no session is issued and no OTP has been passed. They become active
   * the first time they sign in with the number given here, which is the same route a team invite
   * takes.
   */
  async createTenant(actorPhone: string, input: CreateTenantPlatformInput) {
    const phone = toE164Indian(input.owner_phone);
    if (!phone) throw ApiError.validationFailed(undefined, 'That is not an Indian mobile number');

    const prisma = this.db.client;

    // One phone, one account. `auth_identities` is what `/auth/exchange` reads to decide which
    // tenant a number belongs to, and a number in two would make that lookup a coin toss.
    const existing = await prisma.authIdentity.findFirst({ where: { phone } });
    if (existing) throw ApiError.conflict('That number already belongs to an account');

    const tenantId = randomUUID();

    const tenant = await prisma.$transaction(async (tx) => {
      const created = await tx.tenant.create({
        data: {
          id: tenantId,
          name: input.name,
          plan: input.plan,
          planStartedOn: new Date(),
          planExpiresOn: expiryAfterMonths(await this.plans.monthsFor(input.plan), new Date()),
          enabledModules: defaultModulesForPlan(input.plan),
        },
        select: { id: true, name: true, plan: true, status: true, enabledModules: true },
      });

      const roleIdByBase = new Map<UserRole, string>();
      for (const [base, name] of SYSTEM_ROLE_NAMES) {
        const role = await tx.role.create({
          data: {
            tenantId,
            name,
            baseRole: base,
            permissions: [...permissionsForSystemRole(base)],
            seesAllProjects: systemRoleSeesAllProjects(base),
            isSystem: true,
          },
          select: { id: true },
        });
        roleIdByBase.set(base, role.id);
      }

      // The row is created for its side effects: the owner exists, and a trigger on `users` writes
      // the `auth_identities` entry that lets `/auth/exchange` resolve this number to this tenant.
      await tx.user.create({
        data: {
          tenantId,
          phone,
          name: input.owner_name,
          role: 'owner',
          roleId: roleIdByBase.get('owner') ?? null,
          status: 'pending',
        },
        select: { id: true },
      });

      // `auth_identities` is not written here. A trigger on `users` keeps it in step — see the
      // init migration — precisely so application code cannot let the two drift. Inserting it by
      // hand collides with what the trigger has already done a moment earlier.

      return created;
    });

    await prisma.platformAuditLog.create({
      data: {
        actorPhone,
        action: 'tenant.created',
        tenantId,
        after: { name: tenant.name, plan: tenant.plan, owner_phone: phone },
      },
    });

    return {
      id: tenant.id,
      name: tenant.name,
      plan: tenant.plan,
      status: tenant.status,
      enabled_modules: tenant.enabledModules,
      owner_phone: phone,
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
