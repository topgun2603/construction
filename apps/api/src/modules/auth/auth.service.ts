import { Injectable, Logger } from '@nestjs/common';
import type { UserRole } from '@sitebook/shared';
import type {
  AuthExchangeInput,
  AuthRefreshInput,
  CompanySwitchInput,
  TokenPair,
} from '@sitebook/shared';
import { ApiError } from '../../common/errors/api-error';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TenantDb, type TenantTx } from '../../common/prisma/tenant-db.service';
import {
  TokenService,
  identityClaim,
  parseIdentityClaim,
} from '../../common/auth/token.service';
import type { RequestUser } from '../../common/auth/request-user';
import { PhoneAuthService, type VerifiedIdentity } from './phone-auth.service';

export interface TenantChoice {
  tenant_id: string;
  tenant_name: string;
  role: UserRole;
}

/** One company this person can work in, for the company picker and the switcher. */
export interface CompanyMembership {
  tenant_id: string;
  tenant_name: string;
  logo_url: string | null;
  country: string;
  currency: string;
  /** The built-in role their role in *that* company is based on. */
  role: UserRole;
  /** That company's name for their role — a custom role reads as what its owner called it. */
  role_name: string;
  /** `pending` until they first sign in there; switching activates it, as a first sign-in would. */
  status: string;
  /** True for the company this session is in. */
  current: boolean;
}

type IdentityRow = { userId: string; tenantId: string };

export type ExchangeResult =
  | { kind: 'session'; tokens: TokenPair }
  | { kind: 'onboarding'; onboarding_token: string; phone: string }
  | { kind: 'choose_tenant'; tenants: TenantChoice[] };

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantDb: TenantDb,
    private readonly tokens: TokenService,
    private readonly phoneAuth: PhoneAuthService,
  ) {}

  /**
   * Firebase ID token → app session (spec §6.2).
   *
   * The phone is resolved to a tenant through `auth_identities`, the one table
   * without RLS, because there is no tenant context to set yet. Everything after
   * that runs tenant-scoped.
   *
   * A person in several companies gets `choose_tenant` first and then exchanges the same token
   * again with `tenant_id`. The choice is checked against the identities the *verified* token
   * resolves to, so naming a company you have no membership in is refused rather than honoured.
   */
  async exchange(input: AuthExchangeInput, userAgent?: string): Promise<ExchangeResult> {
    const proof = await this.phoneAuth.verifyIdentity(input.firebase_token);

    const identities = await this.identitiesOf(proof);

    if (identities.length === 0) {
      /*
       * An unknown *phone* is not an error — it is a builder about to onboard, and the number is
       * the account they are about to create.
       *
       * An unknown *email* is a dead end, and saying so plainly is the whole job here. An account
       * is built around a mobile number: workers are known by one, WhatsApp needs one, and a
       * Google account carries none. So there is nothing to onboard them into, and the useful
       * answer names the way in rather than reporting a failure.
       */
      if (proof.kind === 'email') {
        throw ApiError.invalidToken(
          'No BUILDR account uses that Google address. Sign in with your mobile number — ' +
            'the address can be added to your profile afterwards.',
        );
      }
      return {
        kind: 'onboarding',
        onboarding_token: this.tokens.signOnboardingToken(proof.phone),
        phone: proof.phone,
      };
    }

    const live = await this.liveIdentities(identities);

    let identity: IdentityRow | null;
    if (input.tenant_id) {
      identity = live.find((row) => row.tenantId === input.tenant_id) ?? null;
      if (!identity) {
        // A company they do belong to but which is suspended says so; one they do not belong to
        // gets the same refusal whether or not it exists, so the endpoint cannot be used to probe.
        if (identities.some((row) => row.tenantId === input.tenant_id)) {
          throw ApiError.tenantSuspended();
        }
        throw ApiError.forbidden('You do not have access to that company');
      }
    } else {
      identity = live.length === 1 ? (live[0] ?? null) : null;
    }

    if (!identity) {
      return { kind: 'choose_tenant', tenants: await this.describeTenants(live) };
    }

    const tokens = await this.issueSession({
      tenantId: identity.tenantId,
      userId: identity.userId,
      deviceId: input.device_id,
      userAgent,
      activatePending: true,
      identity: identityClaim(proof),
    });
    return { kind: 'session', tokens };
  }

  /**
   * Every company the signed-in person can work in.
   *
   * Keyed on the identity verified at sign-in (carried in the token), never on the phone stored
   * on their `users` row here — see `AccessTokenClaims.idn`. A session from before that claim
   * existed lists just the company it is in.
   */
  async memberships(actor: RequestUser): Promise<CompanyMembership[]> {
    const proof = parseIdentityClaim(actor.identity);
    const identities = proof ? await this.identitiesOf(proof) : [];
    if (!identities.some((row) => row.tenantId === actor.tenantId)) {
      identities.unshift({ tenantId: actor.tenantId, userId: actor.userId });
    }

    const out: CompanyMembership[] = [];
    for (const identity of identities) {
      const current = identity.tenantId === actor.tenantId;
      // Each read is its own tenant-scoped transaction: the person is a member of each company,
      // but the request is in one of them, and RLS stays single-tenant per transaction.
      const row = await this.tenantDb.transaction(identity.tenantId, async (tx) => {
        const [tenant, user] = await Promise.all([
          tx.tenant.findUnique({
            where: { id: identity.tenantId },
            select: { name: true, logoUrl: true, country: true, currency: true, status: true },
          }),
          tx.user.findFirst({
            where: { id: identity.userId, deletedAt: null },
            select: { role: true, status: true, roleRef: { select: { name: true } } },
          }),
        ]);
        return { tenant, user };
      });
      if (!row.tenant || !row.user) continue;
      // A suspended or disabled membership is not somewhere they can go, so it is not offered.
      if (!current && (row.tenant.status !== 'active' || row.user.status === 'disabled')) continue;
      out.push({
        tenant_id: identity.tenantId,
        tenant_name: row.tenant.name,
        logo_url: row.tenant.logoUrl,
        country: row.tenant.country,
        currency: row.tenant.currency,
        role: row.user.role,
        role_name: row.user.roleRef?.name ?? row.user.role,
        status: row.user.status,
        current,
      });
    }
    // Current first, then by name — the order a picker reads best in.
    return out.sort((a, b) =>
      a.current === b.current ? a.tenant_name.localeCompare(b.tenant_name) : a.current ? -1 : 1,
    );
  }

  /**
   * Swaps this session for one in another company the same person belongs to.
   *
   * RLS stays strictly single-tenant: a token is always for exactly one company, so switching is
   * a new token pair for the chosen one, never a token that spans two. The membership is proved
   * the same way sign-in proves it — the verified identity in the token, looked up in
   * `auth_identities` — so a company the person has no user row in is refused.
   */
  async switchCompany(
    actor: RequestUser,
    input: CompanySwitchInput,
    userAgent?: string,
  ): Promise<TokenPair> {
    const proof = parseIdentityClaim(actor.identity);
    if (!proof) {
      throw ApiError.forbidden('Sign out and sign in again to switch company.');
    }

    const target = await this.prisma.authIdentity.findFirst({
      where: {
        tenantId: input.tenant_id,
        ...(proof.kind === 'phone' ? { phone: proof.phone } : { email: proof.email }),
      },
      select: { userId: true, tenantId: true },
    });
    if (!target) throw ApiError.forbidden('You are not a member of that company');

    const [live] = await this.liveIdentities([target]);
    if (!live) throw ApiError.tenantSuspended();

    const tokens = await this.issueSession({
      tenantId: live.tenantId,
      userId: live.userId,
      deviceId: input.device_id,
      userAgent,
      // The identity was proved at sign-in; a first visit to a company they were invited to is
      // that membership's first sign-in, exactly as if they had picked it on the login screen.
      activatePending: true,
      identity: actor.identity ?? null,
    });

    if (input.refresh_token) await this.revokeLeftSession(actor, input.refresh_token);
    return tokens;
  }

  /**
   * Revokes the refresh token of the session being left — but only if it really is this caller's
   * session in this company. Anything else is ignored rather than refused: the switch has already
   * succeeded, and a stale cookie is not worth failing it over.
   */
  private async revokeLeftSession(actor: RequestUser, refreshToken: string): Promise<void> {
    try {
      const claims = this.tokens.verifyRefreshToken(refreshToken);
      if (claims.tenant_id !== actor.tenantId || claims.sub !== actor.userId) return;
      await this.tenantDb.clientFor(actor.tenantId).refreshToken.updateMany({
        where: { tokenHash: claims.tokenHash, userId: actor.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    } catch {
      // An expired or foreign token: nothing of ours to revoke.
    }
  }

  /**
   * Rotates a refresh token. Reuse of an already-rotated token is treated as theft:
   * the whole family is revoked so both the attacker and the victim are logged out
   * rather than the attacker silently keeping a valid session.
   */
  async refresh(input: AuthRefreshInput, userAgent?: string): Promise<TokenPair> {
    const claims = this.tokens.verifyRefreshToken(input.refresh_token);
    const tenantId = claims.tenant_id;

    const outcome = await this.rotate(
      claims.tokenHash,
      tenantId,
      input.device_id,
      userAgent,
      claims.idn ?? null,
    );

    if (outcome.kind === 'replayed') {
      // Revoking has to happen in its own committed transaction: doing it inside the
      // one that then throws would roll the revocation straight back, leaving the
      // attacker's freshly issued token alive. Revoke first, then reject.
      await this.revokeAllSessions(tenantId, outcome.userId);
      this.logger.warn(
        { userId: outcome.userId, tenantId },
        'Revoked refresh token replayed — all sessions revoked',
      );
      throw ApiError.invalidToken('Refresh token has been used already');
    }

    return outcome.tokens;
  }

  private async rotate(
    tokenHash: string,
    tenantId: string,
    deviceId: string | undefined,
    userAgent: string | undefined,
    identity: string | null,
  ): Promise<{ kind: 'rotated'; tokens: TokenPair } | { kind: 'replayed'; userId: string }> {
    return this.tenantDb.transaction(tenantId, async (tx) => {
      const stored = await tx.refreshToken.findUnique({
        where: { tokenHash },
        select: { id: true, userId: true, revokedAt: true, expiresAt: true, deviceId: true },
      });
      if (!stored) throw ApiError.invalidToken('Refresh token is not recognised');

      if (stored.revokedAt) return { kind: 'replayed' as const, userId: stored.userId };
      if (stored.expiresAt.getTime() <= Date.now()) throw ApiError.tokenExpired();

      const user = await tx.user.findFirst({
        where: { id: stored.userId, deletedAt: null },
        select: { id: true, role: true, roleId: true, status: true },
      });
      if (!user) throw ApiError.invalidToken('User no longer exists');
      if (user.status !== 'active') throw ApiError.userPending();

      const projectIds = await this.loadProjectIds(tx, user.id);
      // The verified identity rides along unchanged: rotation proves possession of the session,
      // not of the phone, so it can carry the claim forward but never mint a new one.
      const issued = this.tokens.signRefreshToken({ userId: user.id, tenantId, identity });

      const created = await tx.refreshToken.create({
        data: {
          tenantId,
          userId: user.id,
          tokenHash: issued.tokenHash,
          expiresAt: issued.expiresAt,
          deviceId: deviceId ?? stored.deviceId,
          userAgent,
        },
        select: { id: true },
      });
      await tx.refreshToken.update({
        where: { id: stored.id },
        data: { revokedAt: new Date(), replacedById: created.id },
      });

      return {
        kind: 'rotated' as const,
        tokens: {
          access_token: this.tokens.signAccessToken({
            userId: user.id,
            tenantId,
            role: user.role,
            roleId: user.roleId,
            projectIds,
            identity,
          }),
          refresh_token: issued.token,
          expires_in: this.tokens.accessTokenTtlSeconds,
        },
      };
    });
  }

  /** Revokes every live session for a user — used on logout and on role removal. */
  async revokeAllSessions(tenantId: string, userId: string): Promise<void> {
    await this.tenantDb.clientFor(tenantId).refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  /**
   * Mints the token pair for a known user. Shared with tenant onboarding, which
   * needs to hand back a session for the owner it just created.
   */
  async issueSession(input: {
    tenantId: string;
    userId: string;
    deviceId?: string;
    userAgent?: string;
    /** First login on an invite flips `pending` to `active` (spec §6.2 step 4). */
    activatePending?: boolean;
    /** The verified identity behind this session (`identityClaim`), for company switching. */
    identity?: string | null;
  }): Promise<TokenPair> {
    return this.tenantDb.transaction(input.tenantId, async (tx) => {
      const user = await tx.user.findFirst({
        where: { id: input.userId, deletedAt: null },
        select: { id: true, role: true, roleId: true, status: true },
      });
      if (!user) throw ApiError.invalidToken('User no longer exists');

      if (user.status === 'disabled') throw ApiError.forbidden('This user has been disabled');
      if (user.status === 'pending') {
        if (!input.activatePending) throw ApiError.userPending();
        await tx.user.update({ where: { id: user.id }, data: { status: 'active' } });
      }

      await tx.user.update({ where: { id: user.id }, data: { lastLogin: new Date() } });

      const projectIds = await this.loadProjectIds(tx, user.id);
      const issued = this.tokens.signRefreshToken({
        userId: user.id,
        tenantId: input.tenantId,
        identity: input.identity ?? null,
      });
      await tx.refreshToken.create({
        data: {
          tenantId: input.tenantId,
          userId: user.id,
          tokenHash: issued.tokenHash,
          expiresAt: issued.expiresAt,
          deviceId: input.deviceId,
          userAgent: input.userAgent,
        },
      });

      return {
        access_token: this.tokens.signAccessToken({
          userId: user.id,
          tenantId: input.tenantId,
          role: user.role,
          roleId: user.roleId,
          projectIds,
          identity: input.identity ?? null,
        }),
        refresh_token: issued.token,
        expires_in: this.tokens.accessTokenTtlSeconds,
      };
    });
  }

  /** Every (tenant, user) a verified phone or email resolves to, from the untenanted directory. */
  private async identitiesOf(proof: VerifiedIdentity): Promise<IdentityRow[]> {
    return this.prisma.authIdentity.findMany({
      where: proof.kind === 'phone' ? { phone: proof.phone } : { email: proof.email },
      select: { userId: true, tenantId: true },
    });
  }

  /**
   * One phone can belong to more than one builder, because `users.phone` is unique
   * per tenant rather than globally. Only companies that are active are somewhere a person can
   * sign in to; with none of them active the answer is "suspended", as it always was.
   */
  private async liveIdentities(identities: IdentityRow[]): Promise<IdentityRow[]> {
    const live: IdentityRow[] = [];
    for (const identity of identities) {
      const tenant = await this.tenantDb.clientFor(identity.tenantId).tenant.findUnique({
        where: { id: identity.tenantId },
        select: { status: true },
      });
      if (tenant?.status === 'active') live.push(identity);
    }

    if (live.length === 0) throw ApiError.tenantSuspended();
    return live;
  }

  private async describeTenants(identities: IdentityRow[]): Promise<TenantChoice[]> {
    const out: TenantChoice[] = [];
    for (const identity of identities) {
      const db = this.tenantDb.clientFor(identity.tenantId);
      const [tenant, user] = await Promise.all([
        db.tenant.findUnique({ where: { id: identity.tenantId }, select: { name: true } }),
        db.user.findUnique({ where: { id: identity.userId }, select: { role: true } }),
      ]);
      if (tenant && user) {
        out.push({ tenant_id: identity.tenantId, tenant_name: tenant.name, role: user.role });
      }
    }
    return out;
  }

  /**
   * Assigned projects go into the access token so authorisation needs no query
   * (spec §6.2). The trade-off is that a membership change takes effect on the next
   * token refresh — within the 15-minute access token lifetime.
   */
  private async loadProjectIds(tx: TenantTx, userId: string): Promise<string[]> {
    const rows = await tx.projectMember.findMany({
      where: { userId },
      select: { projectId: true },
    });
    return rows.map((row) => row.projectId);
  }
}
