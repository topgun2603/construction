import { Injectable } from '@nestjs/common';
import { ssoDomainOf } from '@sitebook/shared';
import type { TenantTx } from '../../common/prisma/tenant-db.service';

/**
 * How a session was, or is about to be, proved: a phone OTP, a Firebase email (Google, password,
 * email link), or the company's own identity provider.
 */
export type SignInMethod = 'phone' | 'email' | 'sso';

/**
 * "Enforce single sign-on" (Settings → Security).
 *
 * When a company turns it on, anybody whose email is on one of its *verified* domains must sign in
 * through its identity provider. Every other way in — phone OTP, Google, email and password — is
 * refused for them, at sign-in, at refresh and at company switch, so switching it on also ends the
 * sessions those people already had (at their next refresh, within 15 minutes).
 *
 * THE BREAK-GLASS PATH. An owner keeps phone OTP. A misconfigured identity provider — an expired
 * certificate, a deleted app registration, a typo in the issuer — would otherwise lock the whole
 * company out with nobody left who could sign in to fix it. Phone, not Google or password, because
 * the phone is the identity the account was created around and is not on the company's domain to
 * begin with. People with no email on a verified domain (site staff known only by their phone) are
 * not affected at all.
 *
 * Runs inside the caller's tenant transaction: the decision is about one company's settings and
 * one of its people, and RLS keeps it to that company.
 */
@Injectable()
export class SsoPolicyService {
  /** True when this user may use `method` in this company; false when the company demands SSO. */
  async permits(tx: TenantTx, userId: string, method: SignInMethod): Promise<boolean> {
    if (method === 'sso') return true;

    const enforcing = await tx.ssoConnection.findFirst({
      where: { enabled: true, enforceSso: true },
      select: { id: true },
    });
    if (!enforcing) return true;

    const user = await tx.user.findFirst({
      where: { id: userId, deletedAt: null },
      select: { email: true, role: true },
    });
    const domain = user?.email ? ssoDomainOf(user.email) : null;
    if (!user || !domain) return true;

    const verified = await tx.ssoDomain.findFirst({
      where: { domain, verifiedAt: { not: null } },
      select: { id: true },
    });
    if (!verified) return true;

    return method === 'phone' && user.role === 'owner';
  }
}
