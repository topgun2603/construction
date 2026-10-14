import { createHash } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import {
  DELETION_GRACE_DAYS,
  DELETION_REAUTH_MINUTES,
  deletionPurgeAfter,
  deletionReauthFresh,
  securityMfaRequired,
  type DeletionRequestInput,
} from '@sitebook/shared';
import type { RequestUser } from '../../common/auth/request-user';
import { TenantCache } from '../../common/auth/tenant-cache.service';
import { ApiError } from '../../common/errors/api-error';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TenantDb, type TenantTx } from '../../common/prisma/tenant-db.service';
import { RazorpayService } from '../../integrations/razorpay.service';
import { StripeService } from '../../integrations/stripe.service';
import { CompanyGroupsService } from '../company-groups/company-groups.service';
import { DataExportService } from './data-export.service';
import { assertOwner } from './owner';
import { PortabilityStorage } from './portability-storage.service';
import { countTenantRows, tenantTables } from './tenant-tables';

/** The hard delete runs in one transaction; a large company has many rows to cascade through. */
const PURGE_TX = { timeout: 30 * 60_000, maxWait: 60_000 };

/** What a finished deletion leaves behind (the certificate), as the console and tests read it. */
export interface DeletionOutcome {
  company_id: string;
  certificate_id: string;
  deleted_at: string;
  tables: number;
  rows: number;
  objects: number;
}

/**
 * Deleting a company (roadmap Phase 3, "deletion per company").
 *
 * 1. The owner asks — typing the company's name, from a sign-in less than ten minutes old, with the
 *    second factor the company requires. The company goes to `pending_deletion`: everybody is signed
 *    out, sign-in tells them the date, and only the owner may still come in, to cancel.
 * 2. Thirty days pass. The owner (or an operator) can cancel at any point and the company is back
 *    exactly as it was — nothing has been removed yet.
 * 3. The worker's hourly sweep finds the company in `company_deletion_schedule` and deletes it for
 *    good: the subscription is cancelled with the payment provider, the company leaves its group,
 *    every file under its storage prefix is removed, and the `tenants` row is deleted — every company
 *    table hangs off it with ON DELETE CASCADE (verified by the data-portability e2e suite), and
 *    `auth_identities` follows by its trigger on `users`. A deletion certificate, with no personal
 *    data in it, is written in the same transaction.
 *
 * WHY NO ADMIN CONNECTION. The hard delete runs in the company's own RLS context on the ordinary
 * application role: deleting the `tenants` row is allowed to the company itself, and Postgres runs
 * the cascades below it as referential actions, which row-level security does not filter. So the
 * worker never needs the BYPASSRLS connection, and the delete cannot reach a row of any other
 * company however it is called — the property the platform console's own delete gives up.
 */
@Injectable()
export class CompanyDeletionService {
  private readonly logger = new Logger(CompanyDeletionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantDb: TenantDb,
    private readonly tenantCache: TenantCache,
    private readonly storage: PortabilityStorage,
    private readonly exports: DataExportService,
    private readonly companyGroups: CompanyGroupsService,
    private readonly razorpay: RazorpayService,
    private readonly stripe: StripeService,
  ) {}

  /**
   * `GET /company-deletion`: where the company stands, and what the owner needs to have done before
   * the button will work. Reachable while the deletion is pending (the cancel screen reads it).
   */
  async status(actor: RequestUser, now = new Date()) {
    assertOwner(actor, 'delete the company');
    const gate = (await this.tenantCache.get(actor.tenantId))?.security ?? null;
    return this.tenantDb.transaction(actor.tenantId, async (tx) => {
      const [tenant, requests, session] = await Promise.all([
        tx.tenant.findUniqueOrThrow({ where: { id: actor.tenantId }, select: { name: true, status: true } }),
        tx.companyDeletionRequest.findMany({ orderBy: { requestedAt: 'desc' }, take: 10 }),
        actor.sessionId
          ? tx.userSession.findFirst({ where: { id: actor.sessionId }, select: { startedAt: true } })
          : null,
      ]);
      const names = await namesOf(tx, requests.flatMap((r) => [r.requestedByUserId, r.cancelledByUserId]));
      const pending = requests.find((request) => request.status === 'pending') ?? null;
      const mfaRequired = gate ? securityMfaRequired(gate.mfaPolicy, actor) : false;
      return {
        company_name: tenant.name,
        status: tenant.status,
        grace_days: DELETION_GRACE_DAYS,
        pending: pending ? presentRequest(pending, names) : null,
        history: requests.map((request) => presentRequest(request, names)),
        reauth: {
          within_minutes: DELETION_REAUTH_MINUTES,
          signed_in_at: session?.startedAt.toISOString() ?? null,
          fresh: session ? deletionReauthFresh(session.startedAt, now) : false,
        },
        mfa: { required: mfaRequired, shown: actor.mfa === true },
      };
    });
  }

  /** `POST /company-deletion`. See the class comment for the order of checks. */
  async request(actor: RequestUser, input: DeletionRequestInput, now = new Date()) {
    assertOwner(actor, 'delete the company');

    // A second factor first, when the company requires one. SecurityPolicyGuard already refuses a
    // session without it, but this is the one action where "the guard should have caught it" is not
    // good enough.
    const gate = (await this.tenantCache.get(actor.tenantId))?.security ?? null;
    if (gate && securityMfaRequired(gate.mfaPolicy, actor) && actor.mfa !== true) {
      throw ApiError.mfaRequired();
    }

    const result = await this.tenantDb.transaction(actor.tenantId, async (tx) => {
      const tenant = await tx.tenant.findUniqueOrThrow({
        where: { id: actor.tenantId },
        select: { name: true, status: true },
      });
      if (input.confirm_name.trim() !== tenant.name.trim()) {
        throw ApiError.conflict('The name typed does not match this company.');
      }

      // A fresh sign-in, judged by when this session began — refreshing tokens does not reset it.
      const session = actor.sessionId
        ? await tx.userSession.findFirst({
            where: { id: actor.sessionId, revokedAt: null },
            select: { startedAt: true },
          })
        : null;
      if (!session || !deletionReauthFresh(session.startedAt, now)) {
        throw ApiError.reauthRequired(DELETION_REAUTH_MINUTES);
      }

      if (tenant.status === 'pending_deletion') {
        throw ApiError.conflict('This company is already scheduled for deletion.');
      }
      if (tenant.status !== 'active') {
        throw ApiError.conflict('Only an active company can be scheduled for deletion.');
      }

      const purgeAfter = deletionPurgeAfter(now);
      const request = await tx.companyDeletionRequest.create({
        data: {
          tenantId: actor.tenantId,
          requestedByUserId: actor.userId,
          requestedAt: now,
          purgeAfter,
          status: 'pending',
        },
      });
      await tx.tenant.update({ where: { id: actor.tenantId }, data: { status: 'pending_deletion' } });

      // Everybody out, the owner included — the owner signs back in to a screen that only shows the
      // date and the cancel button.
      const sessions = await tx.userSession.updateMany({
        where: { revokedAt: null },
        data: { revokedAt: now, revokedReason: 'company_deletion' },
      });
      await tx.refreshToken.updateMany({ where: { revokedAt: null }, data: { revokedAt: now } });

      await tx.auditLog.create({
        data: {
          tenantId: actor.tenantId,
          actorId: actor.userId,
          action: 'company.deletion_requested',
          entity: 'company_deletion_requests',
          entityId: request.id,
          after: { purge_after: purgeAfter.toISOString(), sessions_ended: sessions.count },
        },
      });
      return { request, sessions: sessions.count };
    });

    // The guard reads the tenant through a cache; without this the old status would keep letting
    // people in on this instance for up to its lifetime.
    this.tenantCache.invalidate(actor.tenantId);
    return {
      purge_after: result.request.purgeAfter.toISOString(),
      sessions_ended: result.sessions,
    };
  }

  /** `POST /company-deletion/cancel`, by the owner during the grace period. */
  async cancel(actor: RequestUser, now = new Date()) {
    assertOwner(actor, 'cancel the deletion');
    const outcome = await this.restore(actor.tenantId, now, { userId: actor.userId });
    if (!outcome) throw ApiError.conflict('This company is not scheduled for deletion.');
    return { cancelled: true, request_id: outcome.requestId };
  }

  /** The console's cancel. Returns null when there was nothing pending. */
  async cancelByPlatform(tenantId: string, now = new Date()) {
    return this.restore(tenantId, now, { platform: true });
  }

  /**
   * The console's "delete now": the grace period is cut short and the deletion runs at once. Only for
   * a company already pending — an operator cannot start a deletion the owner never asked for.
   */
  async expedite(tenantId: string, now = new Date()): Promise<DeletionOutcome | null> {
    const pending = await this.tenantDb.transaction(tenantId, async (tx) => {
      const request = await tx.companyDeletionRequest.findFirst({ where: { status: 'pending' } });
      if (!request) return null;
      await tx.companyDeletionRequest.update({
        where: { id: request.id },
        data: { purgeAfter: now, platformAction: 'expedited' },
      });
      return request;
    });
    if (!pending) return null;
    return this.purge(tenantId, now, 'platform');
  }

  /**
   * The worker's hourly job: every company past its grace period is deleted, and every export past
   * its week is removed. One company failing (storage down, a payment provider refusing) is logged
   * and retried next hour; it does not stop the others.
   */
  async sweep(now = new Date()): Promise<{ deleted: string[]; failed: string[]; exports_expired: number }> {
    // The schedule has no RLS (see the migration): the sweep reads it with no company context.
    const due = await this.prisma.companyDeletionSchedule.findMany({
      where: { purgeAfter: { lte: now } },
      select: { tenantId: true },
      orderBy: { purgeAfter: 'asc' },
    });
    const deleted: string[] = [];
    const failed: string[] = [];
    for (const { tenantId } of due) {
      try {
        if (await this.purge(tenantId, now)) deleted.push(tenantId);
      } catch (error) {
        failed.push(tenantId);
        this.logger.error({ err: error, tenantId }, 'Company deletion failed; will retry');
      }
    }

    let expired = 0;
    const tenants = await this.prisma.authIdentity.findMany({ distinct: ['tenantId'], select: { tenantId: true } });
    for (const { tenantId } of tenants) {
      try {
        expired += await this.exports.expire(tenantId, now);
      } catch (error) {
        this.logger.warn({ err: error, tenantId }, 'Could not expire exports');
      }
    }
    return { deleted, failed, exports_expired: expired };
  }

  /**
   * Deletes one company for good, if — read again here, not trusted from the schedule — it is still
   * pending and its time has come. Returns null when there is nothing to do (cancelled meanwhile, or
   * already gone).
   */
  async purge(tenantId: string, now = new Date(), trigger: 'grace_period' | 'platform' = 'grace_period'): Promise<DeletionOutcome | null> {
    const state = await this.tenantDb.transaction(tenantId, async (tx) => {
      const tenant = await tx.tenant.findUnique({ where: { id: tenantId } });
      const request = await tx.companyDeletionRequest.findFirst({ where: { status: 'pending' } });
      const owner = await tx.user.findFirst({
        where: { role: 'owner', status: 'active', deletedAt: null },
        orderBy: { createdAt: 'asc' },
        select: { id: true, name: true },
      });
      const group = await tx.companyGroupMember.findFirst({ where: { tenantId }, select: { groupId: true } });
      const subscription = await tx.subscription.findUnique({ where: { tenantId } });
      return { tenant, request, owner, group, subscription };
    });
    const { tenant, request } = state;
    if (!tenant || !request || tenant.status !== 'pending_deletion') return null;
    if (request.purgeAfter > now) return null;

    // 1. Stop the payments. Refused rather than skipped on failure: a company deleted while its
    //    card is still being charged is worse than one deleted an hour late. Without provider keys
    //    the services run dry, which is what tests and development want.
    const subscription = state.subscription;
    if (subscription && subscription.status !== 'cancelled') {
      const providerId =
        subscription.provider === 'stripe' ? subscription.stripeSubscriptionId : subscription.razorpaySubscriptionId;
      if (providerId) {
        if (subscription.provider === 'stripe') await this.stripe.cancelSubscription(providerId, false);
        else await this.razorpay.cancelSubscription(providerId, false);
      }
    }

    // 2. Leave the group the way an owner would, so a group left empty is removed and one left with
    //    nobody to manage it hands that to another company's owner. The cascade below would drop the
    //    membership anyway, but not do either of those.
    if (state.group && state.owner) {
      try {
        await this.companyGroups.leave(ownerActor(tenant, state.owner.id));
      } catch (error) {
        this.logger.warn({ err: error, tenantId }, 'Could not leave the company group first; the cascade will');
      }
    }

    // 3. Every file under the company's prefix: photographs, bills, documents, ID scans, exports.
    const objects = await this.storage.removePrefix(tenantId);

    // 4. The rows, and the certificate, together: a certificate for a deletion that rolled back
    //    would be a lie, and a deletion with no certificate is one nobody can prove happened.
    const outcome = await this.tenantDb.transaction(
      tenantId,
      async (tx) => {
        const tables = await tenantTables(tx);
        const counts = await countTenantRows(tx, tenantId, tables);
        const certificate = await tx.deletionCertificate.create({
          data: {
            companyId: tenantId,
            nameHash: createHash('sha256').update(tenant.name.trim().toLowerCase()).digest('hex'),
            requestedByUserId: request.requestedByUserId,
            requestedAt: request.requestedAt,
            trigger,
            deletedAt: now,
            tableCounts: counts as Prisma.InputJsonValue,
            objectCount: objects,
          },
        });
        await tx.tenant.delete({ where: { id: tenantId } });
        return {
          company_id: tenantId,
          certificate_id: certificate.id,
          deleted_at: now.toISOString(),
          tables: Object.keys(counts).length,
          rows: Object.values(counts).reduce((sum, n) => sum + n, 0),
          objects,
        };
      },
      PURGE_TX,
    );

    this.tenantCache.invalidate(tenantId);
    this.logger.log({ tenantId, rows: outcome.rows, objects }, 'Company deleted');
    return outcome;
  }

  /** Takes a pending deletion back: the request is marked cancelled and the company is active again. */
  private async restore(
    tenantId: string,
    now: Date,
    by: { userId?: string; platform?: boolean },
  ): Promise<{ requestId: string } | null> {
    const outcome = await this.tenantDb.transaction(tenantId, async (tx) => {
      const request = await tx.companyDeletionRequest.findFirst({ where: { status: 'pending' } });
      if (!request) return null;
      await tx.companyDeletionRequest.update({
        where: { id: request.id },
        data: {
          status: 'cancelled',
          cancelledAt: now,
          cancelledByUserId: by.userId ?? null,
          ...(by.platform ? { platformAction: 'cancelled' } : {}),
        },
      });
      await tx.tenant.update({ where: { id: tenantId }, data: { status: 'active' } });
      await tx.auditLog.create({
        data: {
          tenantId,
          actorId: by.userId ?? null,
          action: 'company.deletion_cancelled',
          entity: 'company_deletion_requests',
          entityId: request.id,
          after: { by: by.platform ? 'platform' : 'owner' },
        },
      });
      return { requestId: request.id };
    });
    this.tenantCache.invalidate(tenantId);
    return outcome;
  }
}

/** Who asked and who cancelled, by name, for the screen. */
async function namesOf(tx: TenantTx, ids: Array<string | null>): Promise<Map<string, string>> {
  const wanted = [...new Set(ids.filter((id): id is string => Boolean(id)))];
  if (wanted.length === 0) return new Map();
  const users = await tx.user.findMany({ where: { id: { in: wanted } }, select: { id: true, name: true } });
  return new Map(users.map((user) => [user.id, user.name]));
}

function presentRequest(
  request: {
    id: string;
    status: string;
    requestedByUserId: string;
    requestedAt: Date;
    purgeAfter: Date;
    cancelledAt: Date | null;
    cancelledByUserId: string | null;
    platformAction: string | null;
  },
  names: Map<string, string>,
) {
  return {
    id: request.id,
    status: request.status,
    requested_at: request.requestedAt.toISOString(),
    requested_by_name: names.get(request.requestedByUserId) ?? null,
    purge_after: request.purgeAfter.toISOString(),
    cancelled_at: request.cancelledAt?.toISOString() ?? null,
    cancelled_by_name: request.cancelledByUserId ? (names.get(request.cancelledByUserId) ?? null) : null,
    platform_action: request.platformAction,
  };
}

/**
 * The company's owner as an actor, for the one step of a deletion that reuses a service written for
 * requests (leaving the company group). Holds no permissions: `leave` checks the owner against the
 * database, not against this object.
 */
function ownerActor(
  tenant: {
    id: string;
    plan: string;
    enabledModules: string[];
    timezone: string;
    currency: string;
    locale: string;
    taxRegime: string;
    country: string;
  },
  userId: string,
): RequestUser {
  return {
    userId,
    tenantId: tenant.id,
    role: 'owner',
    roleName: 'Owner',
    permissions: [],
    projectIds: [],
    seesAllProjects: true,
    plan: tenant.plan,
    enabledModules: tenant.enabledModules,
    timezone: tenant.timezone,
    currency: tenant.currency,
    locale: tenant.locale,
    taxRegime: tenant.taxRegime,
    country: tenant.country,
  };
}
