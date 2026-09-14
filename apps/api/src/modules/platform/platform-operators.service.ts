import { Injectable } from '@nestjs/common';
import { toE164Indian } from '@sitebook/shared';
import { ApiError } from '../../common/errors/api-error';
import { PlatformAdmins } from './platform-admins.service';
import { PlatformDb } from './platform-db.service';

export interface OperatorView {
  phone: string;
  name: string | null;
  /** Root operators come from `PLATFORM_ADMIN_PHONES` and cannot be revoked from here. */
  root: boolean;
  granted_by: string | null;
  granted_at: string | null;
}

/**
 * Who may use the console, beyond the env allowlist.
 *
 * `PlatformAdmins` explains why the allowlist is an environment variable: the console can change
 * plans and suspend accounts, so the set of people who may do that must not be editable from
 * inside the console. That reasoning is kept, not overturned — what changes is only that adding a
 * second support person no longer requires a deploy.
 *
 * The arrangement:
 *
 *   * **Env phones are root.** Always allowed, never listed as revocable, and the only ones who
 *     may grant or revoke anybody.
 *   * **Granted operators are additive.** They can use the console, and they cannot hand access to
 *     anyone else — so a compromised support account cannot widen itself, and cannot lock out the
 *     people who own the deployment.
 *   * **Every change is audited**, with the granting phone recorded on the row itself as well.
 *
 * The residual trade-off, stated plainly because it is real: somebody who takes over a root
 * account can grant themselves a second way in that survives the env entry being removed. That is
 * strictly worse than env-only, and strictly better than the alternative everybody actually does —
 * sharing one root number around the support team. Revoking a root account should therefore be
 * followed by reading this list.
 */
@Injectable()
export class PlatformOperators {
  constructor(
    private readonly db: PlatformDb,
    private readonly admins: PlatformAdmins,
  ) {}

  /** Root operators are the env allowlist, which this service never writes to. */
  isRoot(phone: string): boolean {
    return this.admins.allows(phone);
  }

  /**
   * Whether this phone may use the console at all.
   *
   * Checked on every request rather than trusted from the token, so a revoked operator loses
   * access on their next request instead of when their eight-hour token expires.
   */
  async allows(phone: string): Promise<boolean> {
    if (this.isRoot(phone)) return true;
    const row = await this.db.client.platformOperator.findFirst({
      where: { phone, revokedAt: null },
      select: { id: true },
    });
    return row !== null;
  }

  async list(): Promise<OperatorView[]> {
    const granted = await this.db.client.platformOperator.findMany({
      where: { revokedAt: null },
      orderBy: { grantedAt: 'asc' },
    });

    // Root numbers are not in the table, so they are folded in here — an operator list that
    // omitted the people who own the deployment would be a misleading answer to "who has access".
    return [
      ...this.admins.phones.map((phone) => ({
        phone,
        name: null,
        root: true,
        granted_by: null,
        granted_at: null,
      })),
      ...granted.map((row) => ({
        phone: row.phone,
        name: row.name,
        root: false,
        granted_by: row.grantedBy,
        granted_at: row.grantedAt.toISOString(),
      })),
    ];
  }

  async grant(actorPhone: string, input: { phone: string; name?: string }): Promise<OperatorView> {
    this.assertRoot(actorPhone);

    const phone = toE164Indian(input.phone);
    if (!phone) throw ApiError.validationFailed(undefined, 'That is not an Indian mobile number');
    if (this.isRoot(phone)) {
      throw ApiError.conflict('That number already has access from the deployment config');
    }

    // Upsert rather than insert: granting access back to somebody previously revoked should
    // restore the one row, not leave two contradicting each other.
    const row = await this.db.client.platformOperator.upsert({
      where: { phone },
      create: { phone, name: input.name ?? null, grantedBy: actorPhone },
      update: {
        name: input.name ?? null,
        grantedBy: actorPhone,
        grantedAt: new Date(),
        revokedAt: null,
        revokedBy: null,
      },
    });

    await this.audit(actorPhone, 'operator.granted', { phone, name: row.name });
    return {
      phone: row.phone,
      name: row.name,
      root: false,
      granted_by: row.grantedBy,
      granted_at: row.grantedAt.toISOString(),
    };
  }

  async revoke(actorPhone: string, rawPhone: string): Promise<void> {
    this.assertRoot(actorPhone);

    const phone = toE164Indian(rawPhone);
    if (!phone) throw ApiError.validationFailed(undefined, 'That is not an Indian mobile number');
    if (this.isRoot(phone)) {
      // The console must not be able to lock out the deployment's owners. Removing a root
      // operator is an environment change, which leaves a record the application cannot rewrite.
      throw ApiError.conflict(
        'That number comes from the deployment config and can only be removed there',
      );
    }

    const existing = await this.db.client.platformOperator.findFirst({
      where: { phone, revokedAt: null },
    });
    if (!existing) throw ApiError.notFound('That number does not have console access');

    await this.db.client.platformOperator.update({
      where: { phone },
      data: { revokedAt: new Date(), revokedBy: actorPhone },
    });
    await this.audit(actorPhone, 'operator.revoked', { phone });
  }

  private assertRoot(actorPhone: string): void {
    if (!this.isRoot(actorPhone)) {
      throw ApiError.forbidden('Only an operator named in the deployment config can do that');
    }
  }

  private async audit(actorPhone: string, action: string, after: Record<string, unknown>) {
    await this.db.client.platformAuditLog.create({
      data: { actorPhone, action, tenantId: null, after: after as never },
    });
  }
}
