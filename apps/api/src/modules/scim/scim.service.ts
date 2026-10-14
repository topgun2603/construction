import { Injectable } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import type { UserRole } from '@prisma/client';
import {
  SCIM_MAX_PAGE_SIZE,
  SCIM_SCHEMA_GROUP,
  SCIM_SCHEMA_LIST,
  SCIM_SCHEMA_USER,
  SSO_PLACEHOLDER_PHONE_PREFIX,
  scimBoolean,
  scimParseFilter,
  ssoDomainOf,
} from '@sitebook/shared';
import { RoleCache } from '../../common/auth/role-cache.service';
import { TenantDb, type TenantTx } from '../../common/prisma/tenant-db.service';
import { SsoConfigService } from '../sso/sso-config.service';
import { ScimError } from './scim-error';

/**
 * SCIM 2.0 provisioning (RFC 7643/7644), the subset Microsoft Entra ID and Okta use: Users with
 * create, read, filter by `userName`/`externalId`, PUT, PATCH (add/replace/remove on active, name,
 * emails, userName, externalId) and DELETE; Groups with members, used only to map people to roles.
 *
 * Rules that make it safe to hand to an outside system:
 *   * Nothing is ever hard-deleted. `active: false` and DELETE both switch the person off
 *     (`status = disabled`, sessions revoked); their history stays.
 *   * Owners are not the provider's to manage. It cannot switch one off, rename one into another
 *     address, or change their role — a provisioning mistake must not lock the company out.
 *   * No role it hands out is ever an owner role (enforced in settings and again here).
 *   * Addresses must be on one of the company's verified domains, the same rule single sign-on
 *     applies, so provisioning cannot create a person sign-in could not vouch for.
 *
 * Every change is in the company's audit log twice over: the row trigger on `users`/`scim_*`, and
 * an explicit `scim.*` entry saying what the provider did.
 */
type ScimUserRow = {
  id: string;
  name: string;
  email: string | null;
  status: string;
  role: UserRole;
  lastLogin: Date | null;
  createdAt: Date;
  updatedAt: Date;
  scimUser: { externalId: string | null } | null;
  scimGroupMembers: Array<{ group: { id: string; displayName: string } }>;
};

const USER_SELECT = {
  id: true,
  name: true,
  email: true,
  status: true,
  role: true,
  lastLogin: true,
  createdAt: true,
  updatedAt: true,
  scimUser: { select: { externalId: true } },
  scimGroupMembers: { select: { group: { select: { id: true, displayName: true } } } },
} as const;

/** What a create, PUT or PATCH wants changed on a person, gathered before it is applied. */
interface UserChanges {
  email?: string;
  formatted?: string;
  givenName?: string;
  familyName?: string;
  active?: boolean;
  externalId?: string | null;
}

interface ListQuery {
  filter?: string;
  startIndex?: string;
  count?: string;
}

@Injectable()
export class ScimService {
  constructor(
    private readonly tenantDb: TenantDb,
    private readonly roleCache: RoleCache,
    private readonly ssoConfig: SsoConfigService,
  ) {}

  // --- Users -----------------------------------------------------------------------------------

  async listUsers(tenantId: string, query: ListQuery) {
    const { startIndex, count } = page(query);
    const where: Record<string, unknown> = { deletedAt: null, email: { not: null } };
    if (query.filter) {
      const filter = scimParseFilter(query.filter);
      if (!filter) throw ScimError.invalidFilter('Only "<attribute> eq \\"value\\"" filters are supported');
      const attribute = filter.attribute.toLowerCase();
      if (attribute === 'username' || attribute === 'emails.value' || attribute === 'emails') {
        where['email'] = filter.value.trim().toLowerCase();
      } else if (attribute === 'externalid') {
        where['scimUser'] = { externalId: filter.value };
      } else if (attribute === 'id') {
        where['id'] = isUuid(filter.value) ? filter.value : '00000000-0000-0000-0000-000000000000';
      } else {
        throw ScimError.invalidFilter(`Filtering on ${filter.attribute} is not supported`);
      }
    }

    return this.tenantDb.transaction(tenantId, async (tx) => {
      const [total, rows] = await Promise.all([
        tx.user.count({ where }),
        tx.user.findMany({
          where,
          select: USER_SELECT,
          orderBy: { createdAt: 'asc' },
          skip: startIndex - 1,
          take: count,
        }),
      ]);
      return listResponse(total, startIndex, rows.map((row) => this.userResource(row)));
    });
  }

  async getUser(tenantId: string, id: string) {
    return this.tenantDb.transaction(tenantId, async (tx) => this.userResource(await findUser(tx, id)));
  }

  async createUser(tenantId: string, body: Record<string, unknown>) {
    const changes = userChangesFromResource(body);
    if (!changes.email) throw ScimError.invalidValue('userName or a work email is required');
    const email = changes.email;

    return this.tenantDb.transaction(tenantId, async (tx) => {
      await assertVerifiedDomain(tx, email);
      const clash = await tx.user.findFirst({ where: { email, deletedAt: null }, select: { id: true } });
      if (clash) throw ScimError.uniqueness(`A user with userName ${email} already exists`);

      // The connection's default role, the one people created at first sign-in get too.
      const connection = await tx.ssoConnection.findFirst({ select: { jitRoleId: true } });
      const role = connection?.jitRoleId
        ? await tx.role.findFirst({ where: { id: connection.jitRoleId }, select: { id: true, baseRole: true } })
        : null;
      if (!role || role.baseRole === 'owner') {
        throw ScimError.invalidValue(
          'Choose a default role in BUILDR (Settings → Security → Single sign-on) before provisioning users',
        );
      }

      const created = await tx.user.create({
        data: {
          tenantId,
          phone: `${SSO_PLACEHOLDER_PHONE_PREFIX}${randomBytes(16).toString('hex')}`,
          email,
          name: displayName(changes, email),
          role: role.baseRole,
          roleId: role.id,
          status: changes.active === false ? 'disabled' : 'pending',
        },
        select: { id: true },
      });
      await tx.scimUser.create({
        data: { tenantId, userId: created.id, externalId: changes.externalId ?? null },
      });
      await audit(tx, tenantId, 'scim.user_created', created.id, { email, role_id: role.id });
      return this.userResource(await findUser(tx, created.id));
    });
  }

  /** PUT: the resource as sent replaces what is held, for the attributes this API stores. */
  async replaceUser(tenantId: string, id: string, body: Record<string, unknown>) {
    const changes = userChangesFromResource(body);
    return this.tenantDb.transaction(tenantId, async (tx) => {
      const user = await findUser(tx, id);
      await this.applyUserChanges(tx, tenantId, user, { ...changes, active: changes.active ?? true });
      return this.userResource(await findUser(tx, id));
    });
  }

  async patchUser(tenantId: string, id: string, body: Record<string, unknown>) {
    const changes: UserChanges = {};
    for (const operation of operationsOf(body)) {
      if (operation.path) {
        applyUserPath(changes, operation.op, operation.path, operation.value);
      } else if (operation.value && typeof operation.value === 'object' && !Array.isArray(operation.value)) {
        // Okta and Entra both send `{ op: "replace", value: { active: false } }` with no path.
        for (const [path, value] of Object.entries(operation.value as Record<string, unknown>)) {
          applyUserPath(changes, operation.op, path, value);
        }
      }
    }
    return this.tenantDb.transaction(tenantId, async (tx) => {
      const user = await findUser(tx, id);
      await this.applyUserChanges(tx, tenantId, user, changes);
      return this.userResource(await findUser(tx, id));
    });
  }

  /** DELETE switches the person off — the same as `active: false`. Never a hard delete. */
  async deleteUser(tenantId: string, id: string): Promise<void> {
    await this.tenantDb.transaction(tenantId, async (tx) => {
      const user = await findUser(tx, id);
      await this.applyUserChanges(tx, tenantId, user, { active: false });
    });
  }

  private async applyUserChanges(tx: TenantTx, tenantId: string, user: ScimUserRow, changes: UserChanges) {
    const isOwner = user.role === 'owner';
    const data: Record<string, unknown> = {};
    const after: Record<string, unknown> = {};

    if (changes.email !== undefined && changes.email !== user.email) {
      if (isOwner) throw ScimError.mutability('An owner’s address is changed in BUILDR, not by provisioning');
      await assertVerifiedDomain(tx, changes.email);
      const clash = await tx.user.findFirst({
        where: { email: changes.email, deletedAt: null, id: { not: user.id } },
        select: { id: true },
      });
      if (clash) throw ScimError.uniqueness(`A user with userName ${changes.email} already exists`);
      data['email'] = changes.email;
      after['email'] = changes.email;
    }

    if (changes.formatted !== undefined || changes.givenName !== undefined || changes.familyName !== undefined) {
      const [currentGiven = '', ...rest] = user.name.split(' ');
      const name =
        changes.formatted?.trim() ||
        [changes.givenName ?? currentGiven, changes.familyName ?? rest.join(' ')].filter(Boolean).join(' ').trim();
      if (name && name !== user.name) {
        data['name'] = name.slice(0, 120);
        after['name'] = data['name'];
      }
    }

    if (changes.active !== undefined) {
      const isActive = user.status !== 'disabled';
      if (changes.active === false && isActive) {
        // The break-glass rule again: whoever owns the company keeps their way in.
        if (isOwner) throw ScimError.mutability('Owners cannot be deactivated by provisioning');
        data['status'] = 'disabled';
        after['active'] = false;
      } else if (changes.active === true && !isActive) {
        data['status'] = user.lastLogin ? 'active' : 'pending';
        after['active'] = true;
      }
    }

    if (Object.keys(data).length > 0) {
      await tx.user.update({ where: { id: user.id }, data });
    }
    if (data['status'] === 'disabled') {
      // Off means off now, not when their refresh token runs out in a month.
      await tx.refreshToken.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: new Date() } });
    }

    if (changes.externalId !== undefined && changes.externalId !== (user.scimUser?.externalId ?? null)) {
      await tx.scimUser.upsert({
        where: { userId: user.id },
        create: { tenantId, userId: user.id, externalId: changes.externalId },
        update: { externalId: changes.externalId },
      });
      after['external_id'] = changes.externalId;
    } else if (!user.scimUser) {
      // A person who existed before provisioning, now managed by it.
      await tx.scimUser.create({ data: { tenantId, userId: user.id, externalId: null } });
    }

    if (Object.keys(after).length > 0) {
      const action = after['active'] === false ? 'scim.user_deactivated' : 'scim.user_updated';
      await audit(tx, tenantId, action, user.id, after);
    }
  }

  private userResource(row: ScimUserRow) {
    const [givenName = '', ...rest] = row.name.split(' ');
    return {
      schemas: [SCIM_SCHEMA_USER],
      id: row.id,
      ...(row.scimUser?.externalId ? { externalId: row.scimUser.externalId } : {}),
      userName: row.email,
      name: { formatted: row.name, givenName, familyName: rest.join(' ') },
      displayName: row.name,
      emails: row.email ? [{ value: row.email, type: 'work', primary: true }] : [],
      active: row.status !== 'disabled',
      groups: row.scimGroupMembers.map((member) => ({
        value: member.group.id,
        display: member.group.displayName,
      })),
      meta: {
        resourceType: 'User',
        created: row.createdAt.toISOString(),
        lastModified: row.updatedAt.toISOString(),
        location: this.location('Users', row.id),
      },
    };
  }

  // --- Groups ----------------------------------------------------------------------------------

  async listGroups(tenantId: string, query: ListQuery & { excludedAttributes?: string }) {
    const { startIndex, count } = page(query);
    const where: Record<string, unknown> = {};
    if (query.filter) {
      const filter = scimParseFilter(query.filter);
      if (!filter) throw ScimError.invalidFilter('Only "<attribute> eq \\"value\\"" filters are supported');
      const attribute = filter.attribute.toLowerCase();
      if (attribute === 'displayname') where['displayName'] = filter.value;
      else if (attribute === 'externalid') where['externalId'] = filter.value;
      else if (attribute === 'id') where['id'] = isUuid(filter.value) ? filter.value : '00000000-0000-0000-0000-000000000000';
      else throw ScimError.invalidFilter(`Filtering on ${filter.attribute} is not supported`);
    }
    const withMembers = !(query.excludedAttributes ?? '').toLowerCase().includes('members');

    return this.tenantDb.transaction(tenantId, async (tx) => {
      const [total, rows] = await Promise.all([
        tx.scimGroup.count({ where }),
        tx.scimGroup.findMany({
          where,
          include: { members: { include: { user: { select: { name: true } } } } },
          orderBy: { createdAt: 'asc' },
          skip: startIndex - 1,
          take: count,
        }),
      ]);
      return listResponse(total, startIndex, rows.map((row) => this.groupResource(row, withMembers)));
    });
  }

  async getGroup(tenantId: string, id: string) {
    return this.tenantDb.transaction(tenantId, async (tx) => this.groupResource(await findGroup(tx, id), true));
  }

  async createGroup(tenantId: string, body: Record<string, unknown>) {
    const name = typeof body['displayName'] === 'string' ? body['displayName'].trim() : '';
    if (!name) throw ScimError.invalidValue('displayName is required');
    return this.tenantDb.transaction(tenantId, async (tx) => {
      const clash = await tx.scimGroup.findFirst({ where: { displayName: name }, select: { id: true } });
      if (clash) throw ScimError.uniqueness(`A group called ${name} already exists`);
      const group = await tx.scimGroup.create({
        data: {
          tenantId,
          displayName: name,
          externalId: typeof body['externalId'] === 'string' ? body['externalId'] : null,
        },
      });
      const members = await this.addMembers(tx, tenantId, group.id, memberIds(body['members']));
      await audit(tx, tenantId, 'scim.group_created', null, { group_id: group.id, display_name: name });
      await this.applyGroupRoles(tx, members);
      return this.groupResource(await findGroup(tx, group.id), true);
    });
  }

  async replaceGroup(tenantId: string, id: string, body: Record<string, unknown>) {
    return this.tenantDb.transaction(tenantId, async (tx) => {
      const group = await findGroup(tx, id);
      const name = typeof body['displayName'] === 'string' ? body['displayName'].trim() : group.displayName;
      await this.renameGroup(tx, group.id, group.displayName, name);
      const before = group.members.map((member) => member.userId);
      await tx.scimGroupMember.deleteMany({ where: { groupId: group.id } });
      const after = await this.addMembers(tx, tenantId, group.id, memberIds(body['members']));
      await audit(tx, tenantId, 'scim.group_updated', null, { group_id: group.id, display_name: name });
      await this.applyGroupRoles(tx, [...new Set([...before, ...after])]);
      return this.groupResource(await findGroup(tx, group.id), true);
    });
  }

  async patchGroup(tenantId: string, id: string, body: Record<string, unknown>) {
    return this.tenantDb.transaction(tenantId, async (tx) => {
      const group = await findGroup(tx, id);
      const touched = new Set<string>();

      for (const operation of operationsOf(body)) {
        const path = (operation.path ?? '').trim();
        const lower = path.toLowerCase();

        if (!path && operation.value && typeof operation.value === 'object' && !Array.isArray(operation.value)) {
          const value = operation.value as Record<string, unknown>;
          if (typeof value['displayName'] === 'string') {
            await this.renameGroup(tx, group.id, group.displayName, value['displayName'].trim());
          }
          if (value['members'] !== undefined) {
            await this.membersOperation(tx, tenantId, group.id, operation.op, value['members'], null, touched);
          }
          continue;
        }
        if (lower === 'displayname') {
          if (typeof operation.value === 'string') {
            await this.renameGroup(tx, group.id, group.displayName, operation.value.trim());
          }
          continue;
        }
        if (lower === 'externalid') {
          await tx.scimGroup.update({
            where: { id: group.id },
            data: { externalId: operation.op === 'remove' ? null : String(operation.value ?? '') || null },
          });
          continue;
        }
        if (lower.startsWith('members')) {
          // `members[value eq "<id>"]` names one member to remove.
          const selected = /^members\[\s*value\s+eq\s+"([^"]+)"\s*\]$/i.exec(path)?.[1] ?? null;
          await this.membersOperation(tx, tenantId, group.id, operation.op, operation.value, selected, touched);
        }
        // Anything else (extension attributes a provider may send) is ignored rather than refused,
        // so one unknown attribute does not stop a whole provisioning cycle.
      }

      await audit(tx, tenantId, 'scim.group_updated', null, { group_id: group.id });
      await this.applyGroupRoles(tx, [...touched]);
      return this.groupResource(await findGroup(tx, group.id), true);
    });
  }

  async deleteGroup(tenantId: string, id: string): Promise<void> {
    await this.tenantDb.transaction(tenantId, async (tx) => {
      const group = await findGroup(tx, id);
      await tx.scimGroup.delete({ where: { id: group.id } });
      await audit(tx, tenantId, 'scim.group_deleted', null, { group_id: group.id, display_name: group.displayName });
      // Roles are left as they are: losing a group does not demote anybody by itself.
    });
  }

  private async membersOperation(
    tx: TenantTx,
    tenantId: string,
    groupId: string,
    op: string,
    value: unknown,
    selected: string | null,
    touched: Set<string>,
  ): Promise<void> {
    if (op === 'add') {
      for (const userId of await this.addMembers(tx, tenantId, groupId, memberIds(value))) touched.add(userId);
      return;
    }
    if (op === 'replace') {
      const current = await tx.scimGroupMember.findMany({ where: { groupId }, select: { userId: true } });
      current.forEach((member) => touched.add(member.userId));
      await tx.scimGroupMember.deleteMany({ where: { groupId } });
      for (const userId of await this.addMembers(tx, tenantId, groupId, memberIds(value))) touched.add(userId);
      return;
    }
    // remove: one named in the path, the ones listed in the value, or — with neither — all of them.
    const ids = selected ? [selected] : memberIds(value);
    const where = ids.length > 0 ? { groupId, userId: { in: ids.filter(isUuid) } } : { groupId };
    const removed = await tx.scimGroupMember.findMany({ where, select: { userId: true } });
    removed.forEach((member) => touched.add(member.userId));
    await tx.scimGroupMember.deleteMany({ where });
  }

  /** Adds members who are people in this company; ids from anywhere else silently drop out. */
  private async addMembers(tx: TenantTx, tenantId: string, groupId: string, ids: string[]): Promise<string[]> {
    const valid = ids.filter(isUuid);
    if (valid.length === 0) return [];
    const users = await tx.user.findMany({
      where: { id: { in: valid }, deletedAt: null },
      select: { id: true },
    });
    await tx.scimGroupMember.createMany({
      data: users.map((user) => ({ tenantId, groupId, userId: user.id })),
      skipDuplicates: true,
    });
    return users.map((user) => user.id);
  }

  private async renameGroup(tx: TenantTx, groupId: string, current: string, next: string): Promise<void> {
    if (!next || next === current) return;
    const clash = await tx.scimGroup.findFirst({ where: { displayName: next, id: { not: groupId } }, select: { id: true } });
    if (clash) throw ScimError.uniqueness(`A group called ${next} already exists`);
    await tx.scimGroup.update({ where: { id: groupId }, data: { displayName: next } });
  }

  /**
   * Puts each person on the role their groups map to (Settings → Security → group mappings). The
   * first matching mapping by group name wins, so the outcome does not depend on the order the
   * provider happened to send members in. No mapping means no change; owners are never touched,
   * and no mapping can make anybody an owner.
   */
  private async applyGroupRoles(tx: TenantTx, userIds: string[]): Promise<void> {
    if (userIds.length === 0) return;
    const mappings = await tx.scimRoleMapping.findMany({
      orderBy: { groupName: 'asc' },
      include: { role: { select: { id: true, baseRole: true } } },
    });
    if (mappings.length === 0) return;

    const users = await tx.user.findMany({
      where: { id: { in: userIds }, deletedAt: null },
      select: { id: true, role: true, roleId: true, scimGroupMembers: { select: { group: { select: { displayName: true } } } } },
    });
    for (const user of users) {
      if (user.role === 'owner') continue;
      const groups = new Set(user.scimGroupMembers.map((member) => member.group.displayName.toLowerCase()));
      const mapping = mappings.find((candidate) => groups.has(candidate.groupName.toLowerCase()));
      if (!mapping || mapping.role.baseRole === 'owner' || mapping.role.id === user.roleId) continue;
      await tx.user.update({
        where: { id: user.id },
        data: { roleId: mapping.role.id, role: mapping.role.baseRole },
      });
      this.roleCache.invalidateUser(user.id);
      await tx.auditLog.create({
        data: {
          tenantId: mapping.tenantId,
          action: 'scim.role_mapped',
          entity: 'users',
          entityId: user.id,
          after: { role_id: mapping.role.id, group: mapping.groupName },
        },
      });
    }
  }

  private groupResource(
    row: {
      id: string;
      displayName: string;
      externalId: string | null;
      createdAt: Date;
      updatedAt: Date;
      members: Array<{ userId: string; user: { name: string } }>;
    },
    withMembers: boolean,
  ) {
    return {
      schemas: [SCIM_SCHEMA_GROUP],
      id: row.id,
      displayName: row.displayName,
      ...(row.externalId ? { externalId: row.externalId } : {}),
      ...(withMembers
        ? { members: row.members.map((member) => ({ value: member.userId, display: member.user.name })) }
        : {}),
      meta: {
        resourceType: 'Group',
        created: row.createdAt.toISOString(),
        lastModified: row.updatedAt.toISOString(),
        location: this.location('Groups', row.id),
      },
    };
  }

  private location(resource: string, id: string): string {
    try {
      return `${this.ssoConfig.scimBaseUrl}/${resource}/${id}`;
    } catch {
      return `/v1/scim/v2/${resource}/${id}`;
    }
  }
}

// --- helpers -------------------------------------------------------------------------------------

async function findUser(tx: TenantTx, id: string): Promise<ScimUserRow> {
  if (!isUuid(id)) throw ScimError.notFound('User');
  const user = await tx.user.findFirst({ where: { id, deletedAt: null, email: { not: null } }, select: USER_SELECT });
  if (!user) throw ScimError.notFound('User');
  return user;
}

async function findGroup(tx: TenantTx, id: string) {
  if (!isUuid(id)) throw ScimError.notFound('Group');
  const group = await tx.scimGroup.findFirst({
    where: { id },
    include: { members: { include: { user: { select: { name: true } } } } },
  });
  if (!group) throw ScimError.notFound('Group');
  return group;
}

async function assertVerifiedDomain(tx: TenantTx, email: string): Promise<void> {
  const domain = ssoDomainOf(email);
  const verified = domain
    ? await tx.ssoDomain.findFirst({ where: { domain, verifiedAt: { not: null } }, select: { id: true } })
    : null;
  if (!verified) {
    throw ScimError.invalidValue(`${email} is not on a domain this company has verified in BUILDR`);
  }
}

async function audit(
  tx: TenantTx,
  tenantId: string,
  action: string,
  userId: string | null,
  after: Record<string, unknown>,
): Promise<void> {
  await tx.auditLog.create({
    data: {
      tenantId,
      action,
      entity: userId ? 'users' : 'scim_groups',
      entityId: userId ?? (typeof after['group_id'] === 'string' ? after['group_id'] : null),
      after: after as object,
    },
  });
}

function page(query: ListQuery): { startIndex: number; count: number } {
  const start = Number.parseInt(query.startIndex ?? '1', 10);
  const count = Number.parseInt(query.count ?? '100', 10);
  return {
    startIndex: Number.isFinite(start) && start >= 1 ? start : 1,
    count: Number.isFinite(count) && count >= 0 ? Math.min(count, SCIM_MAX_PAGE_SIZE) : 100,
  };
}

function listResponse(total: number, startIndex: number, resources: unknown[]) {
  return {
    schemas: [SCIM_SCHEMA_LIST],
    totalResults: total,
    startIndex,
    itemsPerPage: resources.length,
    Resources: resources,
  };
}

function operationsOf(body: Record<string, unknown>): Array<{ op: string; path?: string; value?: unknown }> {
  const operations = body['Operations'] ?? body['operations'];
  if (!Array.isArray(operations)) throw ScimError.invalidValue('Operations is required');
  return operations.map((raw) => {
    const operation = (raw ?? {}) as Record<string, unknown>;
    // Entra ID capitalises the op ("Replace"); RFC 7644 says it is case-insensitive.
    const op = String(operation['op'] ?? '').toLowerCase();
    if (op !== 'add' && op !== 'replace' && op !== 'remove') {
      throw ScimError.invalidValue(`Unsupported PATCH op: ${String(operation['op'])}`);
    }
    return {
      op,
      path: typeof operation['path'] === 'string' ? operation['path'] : undefined,
      value: operation['value'],
    };
  });
}

/** One PATCH path on a User, folded into `changes`. Unknown attributes are ignored. */
function applyUserPath(changes: UserChanges, op: string, path: string, value: unknown): void {
  const lower = path.trim().toLowerCase();
  const text = (input: unknown) => (typeof input === 'string' ? input.trim() : undefined);

  if (lower === 'active') {
    if (op === 'remove') return;
    const active = scimBoolean(value);
    if (active === null) throw ScimError.invalidValue('active must be true or false');
    changes.active = active;
  } else if (lower === 'username') {
    if (op !== 'remove' && text(value)) changes.email = normaliseAddress(text(value) as string);
  } else if (lower === 'displayname' || lower === 'name.formatted') {
    if (op !== 'remove' && text(value)) changes.formatted = text(value);
  } else if (lower === 'name.givenname') {
    if (op !== 'remove') changes.givenName = text(value) ?? '';
  } else if (lower === 'name.familyname') {
    if (op !== 'remove') changes.familyName = text(value) ?? '';
  } else if (lower === 'name') {
    if (op !== 'remove' && value && typeof value === 'object') {
      const name = value as Record<string, unknown>;
      if (text(name['formatted'])) changes.formatted = text(name['formatted']);
      if (name['givenName'] !== undefined) changes.givenName = text(name['givenName']) ?? '';
      if (name['familyName'] !== undefined) changes.familyName = text(name['familyName']) ?? '';
    }
  } else if (lower === 'externalid') {
    changes.externalId = op === 'remove' ? null : (text(value) ?? null);
  } else if (lower === 'emails' || lower.startsWith('emails[')) {
    if (op === 'remove') return;
    const address = lower === 'emails' ? workEmail(value) : text(value);
    if (address) changes.email = normaliseAddress(address);
  }
}

/** The attributes a whole User resource (POST or PUT) carries. */
function userChangesFromResource(body: Record<string, unknown>): UserChanges {
  const changes: UserChanges = {};
  const userName = typeof body['userName'] === 'string' ? body['userName'].trim() : '';
  const email = workEmail(body['emails']) ?? (userName.includes('@') ? userName : undefined);
  if (email) changes.email = normaliseAddress(email);
  const name = (body['name'] ?? {}) as Record<string, unknown>;
  if (typeof name['formatted'] === 'string' && name['formatted'].trim()) changes.formatted = name['formatted'].trim();
  else if (typeof body['displayName'] === 'string' && body['displayName'].trim()) changes.formatted = body['displayName'].trim();
  if (typeof name['givenName'] === 'string') changes.givenName = name['givenName'].trim();
  if (typeof name['familyName'] === 'string') changes.familyName = name['familyName'].trim();
  if (body['active'] !== undefined) {
    const active = scimBoolean(body['active']);
    if (active === null) throw ScimError.invalidValue('active must be true or false');
    changes.active = active;
  }
  if (typeof body['externalId'] === 'string') changes.externalId = body['externalId'];
  return changes;
}

/** The primary address, else the work one, else the first; from a SCIM `emails` array. */
function workEmail(value: unknown): string | undefined {
  if (!Array.isArray(value)) return undefined;
  const emails = value.filter(
    (entry): entry is { value: string; primary?: unknown; type?: unknown } =>
      typeof entry === 'object' && entry !== null && typeof (entry as { value?: unknown }).value === 'string',
  );
  const chosen =
    emails.find((entry) => scimBoolean(entry.primary) === true) ??
    emails.find((entry) => entry.type === 'work') ??
    emails[0];
  return chosen?.value.trim();
}

function normaliseAddress(value: string): string {
  const address = value.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) throw ScimError.invalidValue(`${value} is not an email address`);
  return address;
}

function displayName(changes: UserChanges, email: string): string {
  const name =
    changes.formatted || [changes.givenName, changes.familyName].filter(Boolean).join(' ') || email.split('@')[0] || email;
  return name.slice(0, 120);
}

function memberIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => (typeof entry === 'object' && entry !== null ? (entry as { value?: unknown }).value : entry))
    .filter((id): id is string => typeof id === 'string');
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}
