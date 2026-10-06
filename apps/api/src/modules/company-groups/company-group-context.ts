import type { TenantTx } from '../../common/prisma/tenant-db.service';

/**
 * The group half of row-level security for the `company_group*` tables
 * (migration 20261009000300_company_groups).
 *
 * Those tables are scoped by `app.group_id` as well as by the tenant. A tenant context alone sees
 * only rows about itself — its own membership, invitations addressed to it — which is how a
 * request finds its group; `app.group_id` then opens the group's own rows for the rest of the
 * transaction.
 *
 * THE RULE THIS FILE EXISTS TO KEEP: `app.group_id` is only ever set to an id that was just read
 * through the tenant-scoped view inside the same transaction (or, for a brand-new group, one this
 * process generated). It is never taken from a request, a token or a URL. The database cannot tell
 * where a setting came from, so this is the one place it is set, and every caller goes through a
 * function here that derives the id itself.
 */

/** `SET LOCAL app.group_id`, as a bound parameter. Private: callers use the derivations below. */
async function setGroupContext(tx: TenantTx, groupId: string): Promise<void> {
  await tx.$executeRaw`SELECT set_config('app.group_id', ${groupId}::text, TRUE)`;
}

/**
 * Enters the group the transaction's own company belongs to, and returns its id — or null when
 * the company is in no group. The membership row is read under the tenant clause of its policy,
 * so it can only ever be this company's.
 */
export async function enterOwnCompanyGroup(tx: TenantTx, tenantId: string): Promise<string | null> {
  const row = await tx.companyGroupMember.findUnique({
    where: { tenantId },
    select: { groupId: true },
  });
  if (!row) return null;
  await setGroupContext(tx, row.groupId);
  return row.groupId;
}

/**
 * Enters the group behind a pending invitation addressed to this company — what accepting needs,
 * since the company is not a member yet. The invitation is read under the tenant clause, so an
 * invitation to some other company is simply not found.
 */
export async function enterInvitingCompanyGroup(
  tx: TenantTx,
  tenantId: string,
  invitationId: string,
): Promise<{ groupId: string; invitedByTenantId: string | null } | null> {
  const invitation = await tx.companyGroupInvitation.findFirst({
    where: { id: invitationId, tenantId, status: 'pending' },
    select: { groupId: true, invitedByTenantId: true },
  });
  if (!invitation) return null;
  await setGroupContext(tx, invitation.groupId);
  return invitation;
}

/**
 * Enters a group this process has just created an id for, so the insert of the group row (whose
 * policy checks `id = app.group_id`) can pass. Only `CompanyGroupsService.create` calls it.
 */
export async function enterNewCompanyGroup(tx: TenantTx, freshId: string): Promise<void> {
  await setGroupContext(tx, freshId);
}
