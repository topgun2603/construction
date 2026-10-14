import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import {
  COMPANY_GROUP_PERMISSIONS,
  isCompanyGroupPermission,
  isoDateToUtcDate,
  utcDateToIsoDate,
  type CompanyGroupAdminInput,
  type CompanyGroupInviteInput,
  type CompanyGroupPermission,
  type CompanyGroupRateInput,
  type CreateCompanyGroupInput,
  type UpdateCompanyGroupInput,
} from '@sitebook/shared';
import type { RequestUser } from '../../common/auth/request-user';
import { parseIdentityClaim } from '../../common/auth/token.service';
import { ApiError } from '../../common/errors/api-error';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TenantDb, type TenantTx } from '../../common/prisma/tenant-db.service';
import {
  enterInvitingCompanyGroup,
  enterNewCompanyGroup,
  enterOwnCompanyGroup,
} from './company-group-context';

export interface CompanyGroupCompanyView {
  tenant_id: string;
  name: string;
  currency: string;
  country: string;
  status: string;
  joined_at: string;
  current: boolean;
}

export interface CompanyGroupAdminView {
  id: string;
  tenant_id: string;
  tenant_name: string | null;
  user_id: string;
  name: string | null;
  phone: string | null;
  permissions: CompanyGroupPermission[];
  /** False when the person has since been removed or disabled in their company; the grant is idle. */
  active: boolean;
}

export interface CompanyGroupRateView {
  id: string;
  currency: string;
  rate: string;
  effective_from: string;
  created_at: string;
}

export interface CompanyGroupInvitationView {
  id: string;
  group_id: string;
  group_name: string | null;
  tenant_id: string;
  tenant_name: string | null;
  status: string;
  created_at: string;
  responded_at: string | null;
}

export interface CompanyGroupOverview {
  company: { id: string; name: string; currency: string; is_owner: boolean };
  group: { id: string; name: string; base_currency: string; created_at: string } | null;
  /** What *this person* may do in the group — empty for everyone who is not a group admin. */
  my_permissions: CompanyGroupPermission[];
  /** The rest is shown only to a group admin or the company's owner; empty otherwise. */
  companies: CompanyGroupCompanyView[];
  admins: CompanyGroupAdminView[];
  outgoing_invitations: CompanyGroupInvitationView[];
  /** Invitations addressed to this company, for its owner to accept or decline. */
  incoming_invitations: CompanyGroupInvitationView[];
  rates: CompanyGroupRateView[];
}

interface TenantSummary {
  name: string;
  currency: string;
  country: string;
  status: string;
}

/** What a group action writes into each affected company's own audit log. */
interface GroupAuditEntry {
  action: string;
  groupId: string;
  groupName: string;
  after: Record<string, unknown>;
}

/**
 * Company groups: creating one, inviting companies, joining and leaving, group admins and the
 * group's exchange rates. The consolidated report is `CompanyGroupReportService`.
 *
 * Every method runs inside the *caller's own company's* tenant transaction, enters the group only
 * through `company-group-context.ts`, and reads another company's data — a name, an owner — only
 * in a separate transaction scoped to that company. Nothing here widens RLS.
 *
 * Who may do what:
 *   - create a group, accept or decline an invitation, leave: the company's **owner** (re-read
 *     from the database, not the token, so a demotion takes effect at once);
 *   - invite, cancel, rename, admins, rates: a group admin holding `group.manage`;
 *   - the consolidated report: `group.view_reports`.
 */
@Injectable()
export class CompanyGroupsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantDb: TenantDb,
  ) {}

  async overview(actor: RequestUser): Promise<CompanyGroupOverview> {
    const own = await this.tenantDb.transaction(actor.tenantId, async (tx) => {
      const [tenant, me] = await Promise.all([
        tx.tenant.findUniqueOrThrow({
          where: { id: actor.tenantId },
          select: { name: true, currency: true },
        }),
        tx.user.findFirst({
          where: { id: actor.userId, deletedAt: null },
          select: { role: true, status: true },
        }),
      ]);
      const isOwner = me?.role === 'owner' && me.status === 'active';
      const incoming = isOwner
        ? await tx.companyGroupInvitation.findMany({
            where: { tenantId: actor.tenantId, status: 'pending' },
            select: {
              id: true,
              groupId: true,
              tenantId: true,
              status: true,
              createdAt: true,
              respondedAt: true,
              group: { select: { name: true } },
            },
            orderBy: { createdAt: 'desc' },
          })
        : [];

      const groupId = await enterOwnCompanyGroup(tx, actor.tenantId);
      if (!groupId) return { tenant, isOwner, incoming, group: null };

      const grants = await this.grantsOf(tx, actor, groupId);
      const group = await tx.companyGroup.findUniqueOrThrow({
        where: { id: groupId },
        select: { id: true, name: true, baseCurrency: true, createdAt: true },
      });
      const seesDetail = isOwner || grants.size > 0;
      const [members, admins, outgoing, rates] = seesDetail
        ? await Promise.all([
            tx.companyGroupMember.findMany({
              where: { groupId },
              select: { tenantId: true, joinedAt: true },
              orderBy: { joinedAt: 'asc' },
            }),
            tx.companyGroupAdmin.findMany({
              where: { groupId },
              select: { id: true, tenantId: true, userId: true, permissions: true },
              orderBy: { createdAt: 'asc' },
            }),
            tx.companyGroupInvitation.findMany({
              where: { groupId, status: 'pending' },
              select: { id: true, tenantId: true, status: true, createdAt: true, respondedAt: true },
              orderBy: { createdAt: 'desc' },
            }),
            grants.size > 0
              ? tx.companyGroupExchangeRate.findMany({
                  where: { groupId },
                  orderBy: [{ currency: 'asc' }, { effectiveFrom: 'desc' }],
                })
              : Promise.resolve([]),
          ])
        : [[], [], [], []];
      return { tenant, isOwner, incoming, group, grants, members, admins, outgoing, rates };
    });

    const base: CompanyGroupOverview = {
      company: {
        id: actor.tenantId,
        name: own.tenant.name,
        currency: own.tenant.currency,
        is_owner: own.isOwner,
      },
      group: null,
      my_permissions: [],
      companies: [],
      admins: [],
      outgoing_invitations: [],
      incoming_invitations: own.incoming.map((row) => ({
        id: row.id,
        group_id: row.groupId,
        group_name: row.group.name,
        tenant_id: row.tenantId,
        tenant_name: own.tenant.name,
        status: row.status,
        created_at: row.createdAt.toISOString(),
        responded_at: row.respondedAt?.toISOString() ?? null,
      })),
      rates: [],
    };
    if (!own.group) return base;

    // Names of the other companies, each read in that company's own tenant context.
    const summaries = new Map<string, TenantSummary | null>();
    const summaryOf = async (tenantId: string) => {
      if (!summaries.has(tenantId)) summaries.set(tenantId, await this.tenantSummary(tenantId));
      return summaries.get(tenantId) ?? null;
    };

    const companies: CompanyGroupCompanyView[] = [];
    for (const member of own.members ?? []) {
      const summary = await summaryOf(member.tenantId);
      companies.push({
        tenant_id: member.tenantId,
        name: summary?.name ?? '—',
        currency: summary?.currency ?? '',
        country: summary?.country ?? '',
        status: summary?.status ?? 'unknown',
        joined_at: member.joinedAt.toISOString(),
        current: member.tenantId === actor.tenantId,
      });
    }

    const admins: CompanyGroupAdminView[] = [];
    for (const row of own.admins ?? []) {
      const person = await this.personIn(row.tenantId, row.userId);
      admins.push({
        id: row.id,
        tenant_id: row.tenantId,
        tenant_name: (await summaryOf(row.tenantId))?.name ?? null,
        user_id: row.userId,
        name: person?.name ?? null,
        phone: person?.phone ?? null,
        permissions: (row.permissions ?? []).filter(isCompanyGroupPermission),
        active: person?.live ?? false,
      });
    }

    const outgoing: CompanyGroupInvitationView[] = [];
    for (const row of own.outgoing ?? []) {
      outgoing.push({
        id: row.id,
        group_id: own.group.id,
        group_name: own.group.name,
        tenant_id: row.tenantId,
        tenant_name: (await summaryOf(row.tenantId))?.name ?? null,
        status: row.status,
        created_at: row.createdAt.toISOString(),
        responded_at: row.respondedAt?.toISOString() ?? null,
      });
    }

    return {
      ...base,
      group: {
        id: own.group.id,
        name: own.group.name,
        base_currency: own.group.baseCurrency,
        created_at: own.group.createdAt.toISOString(),
      },
      my_permissions: [...(own.grants ?? [])],
      companies,
      admins,
      outgoing_invitations: outgoing,
      rates: (own.rates ?? []).map(rateView),
    };
  }

  /** A new group with this company as its first member and the creator as its first admin. */
  async create(actor: RequestUser, input: CreateCompanyGroupInput): Promise<CompanyGroupOverview> {
    const created = await this.tenantDb.transaction(actor.tenantId, async (tx) => {
      await this.assertOwner(tx, actor, 'create a company group');
      const existing = await tx.companyGroupMember.findUnique({
        where: { tenantId: actor.tenantId },
        select: { groupId: true },
      });
      if (existing) throw ApiError.conflict('This company is already in a group. Leave it first.');

      const tenant = await tx.tenant.findUniqueOrThrow({
        where: { id: actor.tenantId },
        select: { currency: true },
      });

      // The id is ours, so the context can be set before the insert its policy checks.
      const groupId = randomUUID();
      await enterNewCompanyGroup(tx, groupId);
      const group = await tx.companyGroup.create({
        data: {
          id: groupId,
          name: input.name,
          baseCurrency: input.base_currency ?? tenant.currency,
          createdByTenantId: actor.tenantId,
          createdByUserId: actor.userId,
        },
        select: { id: true, name: true },
      });
      await tx.companyGroupMember.create({ data: { groupId, tenantId: actor.tenantId } });
      // Whoever starts a group can run it; without a first admin nobody could invite anybody.
      await tx.companyGroupAdmin.create({
        data: {
          groupId,
          tenantId: actor.tenantId,
          userId: actor.userId,
          permissions: [...COMPANY_GROUP_PERMISSIONS],
          grantedByUserId: actor.userId,
        },
      });
      return group;
    });

    await this.audit([actor.tenantId], actor, {
      action: 'company_group.created',
      groupId: created.id,
      groupName: created.name,
      after: { group: created.name },
    });
    return this.overview(actor);
  }

  async update(actor: RequestUser, input: UpdateCompanyGroupInput): Promise<CompanyGroupOverview> {
    const changed = await this.tenantDb.transaction(actor.tenantId, async (tx) => {
      const groupId = await this.requireGroup(tx, actor.tenantId);
      await this.requireGrant(tx, actor, groupId, 'group.manage');
      return tx.companyGroup.update({
        where: { id: groupId },
        data: {
          ...(input.name === undefined ? {} : { name: input.name }),
          ...(input.base_currency === undefined ? {} : { baseCurrency: input.base_currency }),
        },
        select: { id: true, name: true, baseCurrency: true },
      });
    });
    await this.audit([actor.tenantId], actor, {
      action: 'company_group.updated',
      groupId: changed.id,
      groupName: changed.name,
      after: { name: changed.name, base_currency: changed.baseCurrency },
    });
    return this.overview(actor);
  }

  /**
   * Invite a company. Nothing happens to it until its own owner accepts — an invitation is only a
   * row the invited company can see.
   */
  async invite(actor: RequestUser, input: CompanyGroupInviteInput): Promise<CompanyGroupInvitationView> {
    // Who the group is and that the caller may invite, before anything is looked up about anybody
    // else — so a caller with no right to invite learns nothing about the company they named.
    const group = await this.tenantDb.transaction(actor.tenantId, async (tx) => {
      const groupId = await this.requireGroup(tx, actor.tenantId);
      await this.requireGrant(tx, actor, groupId, 'group.manage');
      const members = await tx.companyGroupMember.findMany({
        where: { groupId },
        select: { tenantId: true },
      });
      const row = await tx.companyGroup.findUniqueOrThrow({
        where: { id: groupId },
        select: { id: true, name: true },
      });
      return { ...row, memberIds: new Set(members.map((member) => member.tenantId)) };
    });

    const targetId = input.tenant_id ?? (await this.companyOwnedBy(input.owner_phone as string, group.memberIds));
    if (group.memberIds.has(targetId)) throw ApiError.conflict('That company is already in this group.');

    // Read in the invited company's own context: does it exist, and is it free to join?
    const target = await this.tenantDb.transaction(targetId, async (tx) => {
      const tenant = await tx.tenant.findUnique({ where: { id: targetId }, select: { name: true } });
      const membership = tenant
        ? await tx.companyGroupMember.findUnique({ where: { tenantId: targetId }, select: { groupId: true } })
        : null;
      return { tenant, inAGroup: Boolean(membership) };
    });
    if (!target.tenant) throw ApiError.notFound('Company');
    if (target.inAGroup) {
      throw ApiError.conflict('That company is already in another group. It has to leave it first.');
    }

    const invitation = await this.tenantDb.transaction(actor.tenantId, async (tx) => {
      // Re-entered and re-checked inside the write's own transaction.
      const groupId = await this.requireGroup(tx, actor.tenantId);
      if (groupId !== group.id) throw ApiError.conflict('Your company’s group changed. Try again.');
      await this.requireGrant(tx, actor, groupId, 'group.manage');
      try {
        return await tx.companyGroupInvitation.create({
          data: {
            groupId,
            tenantId: targetId,
            invitedByTenantId: actor.tenantId,
            invitedByUserId: actor.userId,
          },
          select: { id: true, status: true, createdAt: true },
        });
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw ApiError.conflict('That company already has an invitation waiting.');
        }
        throw error;
      }
    });

    await this.audit([actor.tenantId, targetId], actor, {
      action: 'company_group.invited',
      groupId: group.id,
      groupName: group.name,
      after: { company_id: targetId, company: target.tenant.name },
    });

    return {
      id: invitation.id,
      group_id: group.id,
      group_name: group.name,
      tenant_id: targetId,
      tenant_name: target.tenant.name,
      status: invitation.status,
      created_at: invitation.createdAt.toISOString(),
      responded_at: null,
    };
  }

  async cancelInvitation(actor: RequestUser, invitationId: string): Promise<void> {
    const cancelled = await this.tenantDb.transaction(actor.tenantId, async (tx) => {
      const groupId = await this.requireGroup(tx, actor.tenantId);
      await this.requireGrant(tx, actor, groupId, 'group.manage');
      const invitation = await tx.companyGroupInvitation.findFirst({
        where: { id: invitationId, groupId, status: 'pending' },
        select: { id: true, tenantId: true, group: { select: { name: true } } },
      });
      if (!invitation) throw ApiError.notFound('Invitation');
      await tx.companyGroupInvitation.update({
        where: { id: invitation.id },
        data: { status: 'cancelled', respondedAt: new Date(), respondedByUserId: actor.userId },
      });
      return { groupId, ...invitation };
    });
    await this.audit([actor.tenantId, cancelled.tenantId], actor, {
      action: 'company_group.invitation_cancelled',
      groupId: cancelled.groupId,
      groupName: cancelled.group.name,
      after: { company_id: cancelled.tenantId },
    });
  }

  /** The invited company's owner says yes. Only then does the company join. */
  async accept(actor: RequestUser, invitationId: string): Promise<CompanyGroupOverview> {
    const joined = await this.tenantDb.transaction(actor.tenantId, async (tx) => {
      await this.assertOwner(tx, actor, 'accept a group invitation');
      const already = await tx.companyGroupMember.findUnique({
        where: { tenantId: actor.tenantId },
        select: { groupId: true },
      });
      if (already) throw ApiError.conflict('This company is already in a group. Leave it first.');

      const invitation = await enterInvitingCompanyGroup(tx, actor.tenantId, invitationId);
      if (!invitation) throw ApiError.notFound('Invitation');

      try {
        await tx.companyGroupMember.create({
          data: { groupId: invitation.groupId, tenantId: actor.tenantId },
        });
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw ApiError.conflict('This company is already in a group. Leave it first.');
        }
        throw error;
      }
      await tx.companyGroupInvitation.update({
        where: { id: invitationId },
        data: { status: 'accepted', respondedAt: new Date(), respondedByUserId: actor.userId },
      });
      const [group, members] = await Promise.all([
        tx.companyGroup.findUniqueOrThrow({
          where: { id: invitation.groupId },
          select: { id: true, name: true },
        }),
        tx.companyGroupMember.findMany({
          where: { groupId: invitation.groupId },
          select: { tenantId: true },
        }),
      ]);
      return { group, memberIds: members.map((member) => member.tenantId) };
    });

    await this.audit(joined.memberIds, actor, {
      action: 'company_group.joined',
      groupId: joined.group.id,
      groupName: joined.group.name,
      after: { company_id: actor.tenantId },
    });
    return this.overview(actor);
  }

  async decline(actor: RequestUser, invitationId: string): Promise<void> {
    const declined = await this.tenantDb.transaction(actor.tenantId, async (tx) => {
      await this.assertOwner(tx, actor, 'decline a group invitation');
      const invitation = await tx.companyGroupInvitation.findFirst({
        where: { id: invitationId, tenantId: actor.tenantId, status: 'pending' },
        select: {
          id: true,
          groupId: true,
          invitedByTenantId: true,
          group: { select: { name: true } },
        },
      });
      if (!invitation) throw ApiError.notFound('Invitation');
      await tx.companyGroupInvitation.update({
        where: { id: invitation.id },
        data: { status: 'declined', respondedAt: new Date(), respondedByUserId: actor.userId },
      });
      return invitation;
    });
    await this.audit(
      [actor.tenantId, ...(declined.invitedByTenantId ? [declined.invitedByTenantId] : [])],
      actor,
      {
        action: 'company_group.declined',
        groupId: declined.groupId,
        groupName: declined.group.name,
        after: { company_id: actor.tenantId },
      },
    );
  }

  /**
   * The company's owner takes it out of the group. Its people's group grants go with it (the admin
   * rows cascade from the membership). A group left with no companies is deleted; one left with no
   * one able to manage it hands `group.manage` to the owner of its longest-standing company, so a
   * group is never orphaned with nobody who can invite, remove or set rates.
   */
  async leave(actor: RequestUser): Promise<void> {
    const outcome = await this.tenantDb.transaction(actor.tenantId, async (tx) => {
      await this.assertOwner(tx, actor, 'take this company out of its group');
      const groupId = await this.requireGroup(tx, actor.tenantId);
      const group = await tx.companyGroup.findUniqueOrThrow({
        where: { id: groupId },
        select: { id: true, name: true },
      });
      await tx.companyGroupMember.delete({
        where: { groupId_tenantId: { groupId, tenantId: actor.tenantId } },
      });
      const remaining = await tx.companyGroupMember.findMany({
        where: { groupId },
        select: { tenantId: true },
        orderBy: { joinedAt: 'asc' },
      });
      if (remaining.length === 0) {
        await tx.companyGroup.delete({ where: { id: groupId } });
        return { group, remaining: [] as string[], promoted: null };
      }
      const managers = await tx.companyGroupAdmin.count({
        where: { groupId, permissions: { has: 'group.manage' } },
      });
      return {
        group,
        remaining: remaining.map((row) => row.tenantId),
        promoted: managers === 0 ? (remaining[0]?.tenantId ?? null) : null,
      };
    });

    await this.audit([actor.tenantId, ...outcome.remaining], actor, {
      action: 'company_group.left',
      groupId: outcome.group.id,
      groupName: outcome.group.name,
      after: { company_id: actor.tenantId },
    });

    if (outcome.promoted) await this.promoteOwnerOf(outcome.promoted, outcome.group, actor);
  }

  /** Makes a person in one of the group's companies a group admin, or changes what they hold. */
  async grantAdmin(actor: RequestUser, input: CompanyGroupAdminInput): Promise<CompanyGroupAdminView> {
    const group = await this.tenantDb.transaction(actor.tenantId, async (tx) => {
      const groupId = await this.requireGroup(tx, actor.tenantId);
      await this.requireGrant(tx, actor, groupId, 'group.manage');
      const member = await tx.companyGroupMember.findFirst({
        where: { groupId, tenantId: input.tenant_id },
        select: { tenantId: true },
      });
      if (!member) throw ApiError.forbidden('That company is not in your group');
      return tx.companyGroup.findUniqueOrThrow({
        where: { id: groupId },
        select: { id: true, name: true },
      });
    });

    // Named by company and number, resolved through the directory — no browsing of another
    // company's team. Then confirmed live inside that company's own context.
    const identity = await this.prisma.authIdentity.findFirst({
      where: { tenantId: input.tenant_id, phone: input.phone },
      select: { userId: true },
    });
    const person = identity ? await this.personIn(input.tenant_id, identity.userId) : null;
    if (!identity || !person?.live) {
      throw ApiError.notFound('Nobody active in that company uses that number');
    }

    const permissions = [...new Set(input.permissions)];
    const row = await this.tenantDb.transaction(actor.tenantId, async (tx) => {
      const groupId = await this.requireGroup(tx, actor.tenantId);
      if (groupId !== group.id) throw ApiError.conflict('Your company’s group changed. Try again.');
      await this.requireGrant(tx, actor, groupId, 'group.manage');
      const existing = await tx.companyGroupAdmin.findUnique({
        where: { groupId_userId: { groupId, userId: identity.userId } },
        select: { id: true, permissions: true },
      });
      if (existing && !permissions.includes('group.manage') && existing.permissions?.includes('group.manage')) {
        await this.assertAnotherManager(tx, groupId, existing.id);
      }
      return tx.companyGroupAdmin.upsert({
        where: { groupId_userId: { groupId, userId: identity.userId } },
        create: {
          groupId,
          tenantId: input.tenant_id,
          userId: identity.userId,
          permissions,
          grantedByUserId: actor.userId,
        },
        update: { permissions, grantedByUserId: actor.userId },
        select: { id: true, tenantId: true, userId: true, permissions: true },
      });
    });

    await this.audit([...new Set([actor.tenantId, input.tenant_id])], actor, {
      action: 'company_group.admin_granted',
      groupId: group.id,
      groupName: group.name,
      after: { company_id: input.tenant_id, user_id: identity.userId, name: person.name, permissions },
    });

    return {
      id: row.id,
      tenant_id: row.tenantId,
      tenant_name: (await this.tenantSummary(row.tenantId))?.name ?? null,
      user_id: row.userId,
      name: person.name,
      phone: person.phone,
      permissions: (row.permissions ?? []).filter(isCompanyGroupPermission),
      active: true,
    };
  }

  async revokeAdmin(actor: RequestUser, adminId: string): Promise<void> {
    const revoked = await this.tenantDb.transaction(actor.tenantId, async (tx) => {
      const groupId = await this.requireGroup(tx, actor.tenantId);
      await this.requireGrant(tx, actor, groupId, 'group.manage');
      const row = await tx.companyGroupAdmin.findFirst({
        where: { id: adminId, groupId },
        select: { id: true, tenantId: true, userId: true, permissions: true },
      });
      if (!row) throw ApiError.notFound('Group admin');
      if (row.permissions?.includes('group.manage')) await this.assertAnotherManager(tx, groupId, row.id);
      await tx.companyGroupAdmin.delete({ where: { id: row.id } });
      const group = await tx.companyGroup.findUniqueOrThrow({
        where: { id: groupId },
        select: { id: true, name: true },
      });
      return { group, row };
    });
    await this.audit([...new Set([actor.tenantId, revoked.row.tenantId])], actor, {
      action: 'company_group.admin_revoked',
      groupId: revoked.group.id,
      groupName: revoked.group.name,
      after: { company_id: revoked.row.tenantId, user_id: revoked.row.userId },
    });
  }

  async listRates(actor: RequestUser): Promise<CompanyGroupRateView[]> {
    return this.tenantDb.transaction(actor.tenantId, async (tx) => {
      const groupId = await this.requireGroup(tx, actor.tenantId);
      const grants = await this.grantsOf(tx, actor, groupId);
      if (grants.size === 0) throw ApiError.forbidden('Only group admins see the exchange rates');
      const rows = await tx.companyGroupExchangeRate.findMany({
        where: { groupId },
        orderBy: [{ currency: 'asc' }, { effectiveFrom: 'desc' }],
      });
      return rows.map(rateView);
    });
  }

  /** Sets the rate for a currency from a date — replacing one already set for that same date. */
  async setRate(actor: RequestUser, input: CompanyGroupRateInput): Promise<CompanyGroupRateView> {
    const saved = await this.tenantDb.transaction(actor.tenantId, async (tx) => {
      const groupId = await this.requireGroup(tx, actor.tenantId);
      await this.requireGrant(tx, actor, groupId, 'group.manage');
      const group = await tx.companyGroup.findUniqueOrThrow({
        where: { id: groupId },
        select: { id: true, name: true, baseCurrency: true },
      });
      if (input.currency === group.baseCurrency) {
        throw ApiError.validationFailed(
          { currency: input.currency },
          `${group.baseCurrency} is the group’s own currency and needs no rate`,
        );
      }
      const effectiveFrom = isoDateToUtcDate(input.effective_from);
      const row = await tx.companyGroupExchangeRate.upsert({
        where: {
          groupId_currency_effectiveFrom: { groupId, currency: input.currency, effectiveFrom },
        },
        create: {
          groupId,
          currency: input.currency,
          rate: new Prisma.Decimal(input.rate),
          effectiveFrom,
          createdByUserId: actor.userId,
        },
        update: { rate: new Prisma.Decimal(input.rate), createdByUserId: actor.userId },
      });
      return { group, row };
    });
    await this.audit([actor.tenantId], actor, {
      action: 'company_group.rate_set',
      groupId: saved.group.id,
      groupName: saved.group.name,
      after: { currency: input.currency, rate: input.rate, effective_from: input.effective_from },
    });
    return rateView(saved.row);
  }

  async removeRate(actor: RequestUser, rateId: string): Promise<void> {
    const removed = await this.tenantDb.transaction(actor.tenantId, async (tx) => {
      const groupId = await this.requireGroup(tx, actor.tenantId);
      await this.requireGrant(tx, actor, groupId, 'group.manage');
      const row = await tx.companyGroupExchangeRate.findFirst({ where: { id: rateId, groupId } });
      if (!row) throw ApiError.notFound('Exchange rate');
      await tx.companyGroupExchangeRate.delete({ where: { id: row.id } });
      const group = await tx.companyGroup.findUniqueOrThrow({
        where: { id: groupId },
        select: { id: true, name: true },
      });
      return { group, row };
    });
    await this.audit([actor.tenantId], actor, {
      action: 'company_group.rate_removed',
      groupId: removed.group.id,
      groupName: removed.group.name,
      after: { currency: removed.row.currency, effective_from: utcDateToIsoDate(removed.row.effectiveFrom) },
    });
  }

  // ---------------------------------------------------------------------------------------------
  // Shared with the report service
  // ---------------------------------------------------------------------------------------------

  /** Enters the caller's company's group, or refuses: most group routes need one. */
  async requireGroup(tx: TenantTx, tenantId: string): Promise<string> {
    const groupId = await enterOwnCompanyGroup(tx, tenantId);
    if (!groupId) throw ApiError.notFound('Company group');
    return groupId;
  }

  async requireGrant(
    tx: TenantTx,
    actor: RequestUser,
    groupId: string,
    permission: CompanyGroupPermission,
  ): Promise<void> {
    const grants = await this.grantsOf(tx, actor, groupId);
    if (!grants.has(permission)) {
      throw ApiError.forbidden(
        permission === 'group.manage'
          ? 'Only a group admin who manages the group can do this'
          : 'Only group admins can see the consolidated reports',
      );
    }
  }

  /**
   * What this person holds in the group (the group context must already be entered).
   *
   * A grant is on a person's user row in one of the group's companies. The person is recognised
   * in any of the group's companies by the identity they verified at sign-in — so a group admin
   * whose grant sits on their Indian-company account still has it while signed in to the Dubai
   * one — but a grant on an account since removed or disabled in its company counts for nothing.
   */
  async grantsOf(
    tx: TenantTx,
    actor: RequestUser,
    groupId: string,
  ): Promise<Set<CompanyGroupPermission>> {
    const pairs = [{ tenantId: actor.tenantId, userId: actor.userId }];
    const proof = parseIdentityClaim(actor.identity);
    if (proof) {
      const rows = await this.prisma.authIdentity.findMany({
        where: proof.kind === 'phone' ? { phone: proof.phone } : { email: proof.email },
        select: { tenantId: true, userId: true },
      });
      for (const row of rows) {
        if (row.tenantId !== actor.tenantId) pairs.push(row);
      }
    }

    const grants = await tx.companyGroupAdmin.findMany({
      where: { groupId, OR: pairs },
      select: { tenantId: true, userId: true, permissions: true },
    });

    const out = new Set<CompanyGroupPermission>();
    for (const grant of grants) {
      const isSelf = grant.tenantId === actor.tenantId && grant.userId === actor.userId;
      if (!isSelf && !(await this.personIn(grant.tenantId, grant.userId))?.live) continue;
      for (const permission of grant.permissions ?? []) {
        if (isCompanyGroupPermission(permission)) out.add(permission);
      }
    }
    return out;
  }

  /** A company's name and money settings, read in that company's own tenant context. */
  async tenantSummary(tenantId: string): Promise<TenantSummary | null> {
    return this.tenantDb.transaction(tenantId, (tx) =>
      tx.tenant.findUnique({
        where: { id: tenantId },
        select: { name: true, currency: true, country: true, status: true },
      }),
    );
  }

  // ---------------------------------------------------------------------------------------------

  private async assertOwner(tx: TenantTx, actor: RequestUser, doing: string): Promise<void> {
    const me = await tx.user.findFirst({
      where: { id: actor.userId, deletedAt: null },
      select: { role: true, status: true },
    });
    if (me?.role !== 'owner' || me.status !== 'active') {
      throw ApiError.forbidden(`Only the company’s owner can ${doing}`);
    }
  }

  /** Refuses to take away the group's last `group.manage` holder. */
  private async assertAnotherManager(tx: TenantTx, groupId: string, exceptId: string): Promise<void> {
    const others = await tx.companyGroupAdmin.count({
      where: { groupId, id: { not: exceptId }, permissions: { has: 'group.manage' } },
    });
    if (others === 0) {
      throw ApiError.conflict(
        'Somebody has to be able to manage the group. Give another admin “manage” first.',
      );
    }
  }

  /** Name, number and standing of one user, read in their own company's context. */
  private async personIn(
    tenantId: string,
    userId: string,
  ): Promise<{ name: string; phone: string; live: boolean } | null> {
    const user = await this.tenantDb.transaction(tenantId, (tx) =>
      tx.user.findFirst({
        where: { id: userId },
        select: { name: true, phone: true, status: true, deletedAt: true },
      }),
    );
    if (!user) return null;
    return {
      name: user.name,
      phone: user.phone,
      live: user.deletedAt === null && user.status !== 'disabled',
    };
  }

  /**
   * The company whose owner uses this number — for inviting by phone. Refuses when it is ambiguous
   * rather than guessing which of a person's companies they meant.
   */
  private async companyOwnedBy(phone: string, exclude: Set<string>): Promise<string> {
    const identities = await this.prisma.authIdentity.findMany({
      where: { phone },
      select: { tenantId: true, userId: true },
    });
    const owned: string[] = [];
    for (const identity of identities) {
      if (exclude.has(identity.tenantId)) continue;
      const user = await this.tenantDb.transaction(identity.tenantId, (tx) =>
        tx.user.findFirst({
          where: { id: identity.userId, deletedAt: null, role: 'owner', status: 'active' },
          select: { id: true },
        }),
      );
      if (user) owned.push(identity.tenantId);
    }
    if (owned.length === 0) throw ApiError.notFound('A company owned by that number');
    if (owned.length > 1) {
      throw ApiError.conflict('That number owns more than one company — invite by company id instead.');
    }
    return owned[0] as string;
  }

  /** See `leave`: the longest-standing company's owner becomes a full group admin. */
  private async promoteOwnerOf(
    tenantId: string,
    group: { id: string; name: string },
    actor: RequestUser,
  ): Promise<void> {
    const owner = await this.tenantDb.transaction(tenantId, (tx) =>
      tx.user.findFirst({
        where: { role: 'owner', status: 'active', deletedAt: null },
        select: { id: true, name: true },
        orderBy: { createdAt: 'asc' },
      }),
    );
    if (!owner) return;
    await this.tenantDb.transaction(tenantId, async (tx) => {
      const groupId = await enterOwnCompanyGroup(tx, tenantId);
      if (groupId !== group.id) return;
      await tx.companyGroupAdmin.upsert({
        where: { groupId_userId: { groupId, userId: owner.id } },
        create: {
          groupId,
          tenantId,
          userId: owner.id,
          permissions: [...COMPANY_GROUP_PERMISSIONS],
        },
        update: { permissions: [...COMPANY_GROUP_PERMISSIONS] },
      });
    });
    await this.audit([tenantId], actor, {
      action: 'company_group.admin_granted',
      groupId: group.id,
      groupName: group.name,
      after: {
        company_id: tenantId,
        user_id: owner.id,
        name: owner.name,
        permissions: [...COMPANY_GROUP_PERMISSIONS],
        reason: 'last group manager left',
      },
    });
  }

  /**
   * One entry in each affected company's own audit log, each written in that company's tenant
   * context. The actor id is the person who did it, whichever company their account is in; the
   * entry names their company so a reader elsewhere can tell who that was.
   */
  private async audit(tenantIds: string[], actor: RequestUser, entry: GroupAuditEntry): Promise<void> {
    for (const tenantId of new Set(tenantIds)) {
      await this.tenantDb.transaction(tenantId, (tx) =>
        tx.auditLog.create({
          data: {
            tenantId,
            actorId: actor.userId,
            action: entry.action,
            entity: 'company_groups',
            entityId: entry.groupId,
            entityLabel: entry.groupName.slice(0, 200),
            after: { ...entry.after, by_company_id: actor.tenantId } as Prisma.InputJsonValue,
          },
        }),
      );
    }
  }
}

function rateView(row: {
  id: string;
  currency: string;
  rate: Prisma.Decimal;
  effectiveFrom: Date;
  createdAt: Date;
}): CompanyGroupRateView {
  return {
    id: row.id,
    currency: row.currency,
    // `toFixed()` rather than `toString()`: Decimal switches to exponent notation for small
    // numbers, and "4.41e-2" is not something a person or a parser should have to read.
    rate: trimRate(row.rate.toFixed()),
    effective_from: utcDateToIsoDate(row.effectiveFrom),
    created_at: row.createdAt.toISOString(),
  };
}

/** `0.0441000000` → `0.0441`. */
function trimRate(value: string): string {
  return value.includes('.') ? value.replace(/0+$/, '').replace(/\.$/, '') : value;
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}
