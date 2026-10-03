import { Injectable } from '@nestjs/common';
import { toE164Indian } from '@sitebook/shared';
import { ApiError } from '../../common/errors/api-error';
import { normaliseEmail } from '../auth/phone-auth.service';
import { PlatformAdmins } from './platform-admins.service';
import { PlatformDb } from './platform-db.service';

export interface OperatorView {
  phone: string;
  name: string | null;
  /** A Google address this operator may also sign in with, or null if they have not linked one. */
  email: string | null;
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

  /**
   * The phone behind a Google address, or null if nobody has linked it.
   *
   * Deliberately resolves to a *phone*. The console's identity is the number — the token carries
   * it, every audit row is keyed by it — so signing in with an address has to arrive at the same
   * place as signing in with an SMS, or the trail would record two people where there is one.
   *
   * A revoked operator resolves to nothing. The row survives revocation so the record of who had
   * access when is kept, and the linked address has to stop working with it.
   */
  async phoneForEmail(email: string): Promise<string | null> {
    const row = await this.db.client.platformOperator.findFirst({
      where: { email, revokedAt: null },
      select: { phone: true },
    });
    return row?.phone ?? null;
  }

  async list(): Promise<OperatorView[]> {
    const granted = await this.db.client.platformOperator.findMany({
      where: { revokedAt: null },
      orderBy: { grantedAt: 'asc' },
    });

    /*
     * Root numbers are not in the table, so they are folded in here — an operator list that
     * omitted the people who own the deployment would be a misleading answer to "who has access".
     *
     * A root operator *can* have a row, though, since linking a Google address needs somewhere to
     * put it. So the merge is by phone: the row supplies the address and the name, the env supplies
     * `root`, and the number appears once. Listing it twice would read as two operators sharing a
     * number, which is the one thing this table is meant to make visible.
     */
    const byPhone = new Map(granted.map((row) => [row.phone, row] as const));

    return [
      ...this.admins.phones.map((phone) => ({
        phone,
        name: byPhone.get(phone)?.name ?? null,
        email: byPhone.get(phone)?.email ?? null,
        root: true,
        granted_by: null,
        granted_at: null,
      })),
      ...granted
        .filter((row) => !this.isRoot(row.phone))
        .map((row) => ({
          phone: row.phone,
          name: row.name,
          email: row.email,
          root: false,
          granted_by: row.grantedBy,
          granted_at: row.grantedAt.toISOString(),
        })),
    ];
  }

  /**
   * Links a Google address to an operator, or clears one.
   *
   * Root-only, like granting: an address is a way in, so handing one out is the same act as
   * handing out console access and belongs to the same small circle.
   *
   * A root operator has no row until this creates one. That row is not a grant — `allows()` lets
   * them in from the env regardless, and `list()` folds it back into the env entry — it is just
   * where the address lives.
   */
  async linkEmail(
    actorPhone: string,
    rawPhone: string,
    rawEmail: string | null,
  ): Promise<OperatorView> {
    this.assertRoot(actorPhone);

    const phone = toE164Indian(rawPhone);
    if (!phone) throw ApiError.validationFailed(undefined, 'That is not an Indian mobile number');

    // Normalised to the same form sign-in arrives in — trimmed and lower-cased, and nothing
    // cleverer: Gmail ignores dots and `+` suffixes, other providers do not, and normalising on
    // Google's rules would merge two addresses a different mail server treats as two people. The
    // shape is checked by the schema at the controller; this is the storage form.
    const email = rawEmail === null ? null : normaliseEmail(rawEmail);

    if (email) {
      // Checked before writing so the refusal names the problem. The unique index would catch it
      // either way, as a constraint violation that says nothing useful to whoever is reading it.
      const taken = await this.db.client.platformOperator.findFirst({
        where: { email, phone: { not: phone } },
        select: { phone: true },
      });
      if (taken) {
        throw ApiError.conflict('Another operator has already linked that address');
      }
    }

    const root = this.isRoot(phone);
    const existing = await this.db.client.platformOperator.findUnique({ where: { phone } });
    if (!existing && !root) {
      throw ApiError.notFound('That number does not have console access');
    }
    if (existing?.revokedAt && !root) {
      throw ApiError.notFound('That number does not have console access');
    }

    const row = await this.db.client.platformOperator.upsert({
      where: { phone },
      create: { phone, email, grantedBy: actorPhone },
      update: { email },
    });

    await this.audit(actorPhone, email ? 'operator.email_linked' : 'operator.email_cleared', {
      phone,
      email,
    });

    return {
      phone: row.phone,
      name: row.name,
      email: row.email,
      root,
      granted_by: root ? null : row.grantedBy,
      granted_at: root ? null : row.grantedAt.toISOString(),
    };
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
      // Carried through rather than nulled: granting access back to somebody previously revoked
      // restores their row, and the address they had linked is part of it.
      email: row.email,
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
