import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ipAllowed, securityAbsoluteDeadline, securityIpApplies, type UserRole } from '@sitebook/shared';
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
  type SessionVia,
} from '../../common/auth/token.service';
import type { RequestUser } from '../../common/auth/request-user';
import { TenantCache, type TenantSecurityGate } from '../../common/auth/tenant-cache.service';
import { currentAuditActor } from '../../common/audit/audit-context';
import { SecurityAuditService } from '../security/security-audit.service';
import { SessionService, type MfaMethod, type SessionEndReason } from '../security/session.service';
import { PhoneAuthService, type VerifiedIdentity } from './phone-auth.service';
import { SsoPolicyService, type SignInMethod } from './sso-policy.service';

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
    private readonly ssoPolicy: SsoPolicyService,
    private readonly tenantCache: TenantCache,
    private readonly sessions: SessionService,
    private readonly securityAudit: SecurityAuditService,
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

    const active = await this.liveIdentities(identities);
    const live = await this.permittedIdentities(active, proof.kind);

    let identity: IdentityRow | null;
    if (input.tenant_id) {
      identity = live.find((row) => row.tenantId === input.tenant_id) ?? null;
      if (!identity) {
        // Theirs and active, but that company makes them use its identity provider.
        if (active.some((row) => row.tenantId === input.tenant_id)) throw ApiError.ssoRequired();
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
      // Only Firebase's own record of a second factor counts, never anything the client says.
      ...(proof.secondFactor ? { mfaMethod: 'firebase' as const } : {}),
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

    // A company that enforces single sign-on applies it here too: a session proved by phone or
    // Google elsewhere must not become a way into it. One proved by an identity provider may —
    // that provider owns the verified domain the email is on (see SsoLoginService).
    const method: SignInMethod = actor.via === 'sso' ? 'sso' : proof.kind;
    const permitted = await this.tenantDb.transaction(live.tenantId, (tx) =>
      this.ssoPolicy.permits(tx, live.userId, method),
    );
    if (!permitted) throw ApiError.ssoRequired();

    const tokens = await this.issueSession({
      tenantId: live.tenantId,
      userId: live.userId,
      deviceId: input.device_id,
      userAgent,
      // The identity was proved at sign-in; a first visit to a company they were invited to is
      // that membership's first sign-in, exactly as if they had picked it on the login screen.
      activatePending: true,
      identity: actor.identity ?? null,
      via: actor.via ?? null,
      // A second factor is never carried into another company: each company's rule is met by an
      // authenticator enrolled there (a person is a separate user in each). Not even a single
      // sign-on session's — that provider is the *other* company's, and this company's "trust our
      // identity provider" setting is about its own.
      mfaMethod: null,
      app: actor.app === true,
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
      claims.via === 'sso' ? 'sso' : null,
    );

    if (outcome.kind === 'replayed') {
      // Revoking has to happen in its own committed transaction: doing it inside the
      // one that then throws would roll the revocation straight back, leaving the
      // attacker's freshly issued token alive. Revoke first, then reject.
      await this.revokeAllSessions(tenantId, outcome.userId, 'replayed');
      this.logger.warn(
        { userId: outcome.userId, tenantId },
        'Revoked refresh token replayed — all sessions revoked',
      );
      throw ApiError.invalidToken('Refresh token has been used already');
    }

    if (outcome.kind === 'timed_out') {
      // Ended and recorded in their own transactions, for the same reason as above: the refusal
      // must not roll back the record of why.
      const reason: SessionEndReason = outcome.verdict === 'idle' ? 'idle_timeout' : 'absolute_timeout';
      await this.tenantDb.transaction(tenantId, (tx) => this.sessions.end(tx, outcome.sessionId, reason));
      await this.securityAudit.record(tenantId, {
        actorId: outcome.userId,
        action: 'security.session_timed_out',
        entity: 'user_sessions',
        entityId: outcome.sessionId,
        after: { reason },
      });
      throw ApiError.sessionExpired(outcome.verdict);
    }

    if (outcome.kind === 'refused') {
      await this.recordSignInRefusal(tenantId, outcome.userId, 'refresh', outcome.ip);
      throw ApiError.ipNotAllowed(outcome.ip);
    }

    return outcome.tokens;
  }

  private async rotate(
    tokenHash: string,
    tenantId: string,
    deviceId: string | undefined,
    userAgent: string | undefined,
    identity: string | null,
    via: SessionVia | null,
  ): Promise<
    | { kind: 'rotated'; tokens: TokenPair }
    | { kind: 'replayed'; userId: string }
    | { kind: 'timed_out'; userId: string; sessionId: string; verdict: 'idle' | 'expired' }
    | { kind: 'refused'; userId: string; ip: string }
  > {
    const gate = await this.securityGate(tenantId);
    const ip = currentAuditActor().ip;

    return this.tenantDb.transaction(tenantId, async (tx) => {
      const stored = await tx.refreshToken.findUnique({
        where: { tokenHash },
        select: {
          id: true,
          userId: true,
          revokedAt: true,
          expiresAt: true,
          deviceId: true,
          createdAt: true,
          session: {
            select: { id: true, revokedAt: true, startedAt: true, lastActiveAt: true, mfaAt: true, client: true },
          },
        },
      });
      if (!stored) throw ApiError.invalidToken('Refresh token is not recognised');

      // A session somebody signed out — this device, "everywhere", or an owner's "sign out" — is
      // simply over. Checked before the replay rule: its tokens were revoked on purpose, and
      // presenting one is a stale device, not a thief, so it must not end the person's other sessions.
      if (stored.session?.revokedAt) throw ApiError.invalidToken('This session was signed out');

      if (stored.revokedAt) return { kind: 'replayed' as const, userId: stored.userId };
      if (stored.expiresAt.getTime() <= Date.now()) throw ApiError.tokenExpired();

      const user = await tx.user.findFirst({
        where: { id: stored.userId, deletedAt: null },
        select: { id: true, role: true, roleId: true, status: true },
      });
      if (!user) throw ApiError.invalidToken('User no longer exists');
      if (user.status !== 'active') throw ApiError.userPending();

      /*
       * Enforcement switched on after this session began ends it here, at the next refresh. The
       * session is left unrevoked — refusing is enough, and it is still the person's to sign out
       * of — and a session without an identity claim predates switching and is read as a phone
       * sign-in, the most it could have been.
       */
      const method: SignInMethod =
        via === 'sso' ? 'sso' : (parseIdentityClaim(identity)?.kind ?? 'phone');
      if (!(await this.ssoPolicy.permits(tx, user.id, method))) {
        throw ApiError.ssoRequired(HttpStatus.UNAUTHORIZED);
      }

      // A token from before sessions existed is given one now, dated from when that token was
      // issued — the earliest this sign-in could have been, so an absolute limit errs early.
      const session =
        stored.session ??
        (await this.sessions.open(tx, {
          tenantId,
          userId: user.id,
          method,
          deviceId: deviceId ?? stored.deviceId,
          userAgent,
          ip,
          app: Boolean(deviceId ?? stored.deviceId),
          mfaMethod: null,
          startedAt: stored.createdAt,
        }));
      const app = session.client === 'app';

      // The company's timeouts, measured on the session rather than this token.
      const verdict = this.sessions.verdict(session, gate);
      if (verdict !== 'active') {
        return { kind: 'timed_out' as const, userId: user.id, sessionId: session.id, verdict };
      }
      if (gate && ipRefused(gate, user.role, app, ip)) {
        return { kind: 'refused' as const, userId: user.id, ip };
      }

      const projectIds = await this.loadProjectIds(tx, user.id);
      // The verified identity rides along unchanged: rotation proves possession of the session,
      // not of the phone, so it can carry the claim forward but never mint a new one.
      const issued = this.tokens.signRefreshToken({
        userId: user.id,
        tenantId,
        identity,
        via,
        sessionId: session.id,
      });

      const created = await tx.refreshToken.create({
        data: {
          tenantId,
          userId: user.id,
          tokenHash: issued.tokenHash,
          expiresAt: issued.expiresAt,
          deviceId: deviceId ?? stored.deviceId,
          userAgent,
          sessionId: session.id,
        },
        select: { id: true },
      });
      await tx.refreshToken.update({
        where: { id: stored.id },
        data: { revokedAt: new Date(), replacedById: created.id },
      });
      // A refresh is activity: somebody opened the app or the page.
      await tx.userSession.update({
        where: { id: session.id },
        data: { lastActiveAt: new Date(), ...(ip ? { lastIp: ip } : {}) },
      });

      const ttl = this.tokens.accessTtlUntil(securityAbsoluteDeadline(session.startedAt, gate?.absoluteLifetimeHours ?? null));
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
            via,
            sessionId: session.id,
            // From the session row, never from the old token: removing an authenticator or a
            // console reset takes the second factor away at the very next refresh.
            mfa: session.mfaAt !== null,
            app,
            ttlSeconds: ttl,
          }),
          refresh_token: issued.token,
          expires_in: ttl,
        },
      };
    });
  }

  /**
   * Ends every session a person has in this company — "sign out everywhere", a replayed refresh
   * token, removal from the company.
   */
  async revokeAllSessions(
    tenantId: string,
    userId: string,
    reason: SessionEndReason = 'sign_out_everywhere',
  ): Promise<void> {
    await this.tenantDb.transaction(tenantId, (tx) => this.sessions.endAllFor(tx, userId, reason));
  }

  /** "Sign out everywhere else": every session but the one asking. */
  async revokeOtherSessions(actor: RequestUser): Promise<{ ended: number }> {
    const ended = await this.tenantDb.transaction(actor.tenantId, (tx) =>
      this.sessions.endAllFor(tx, actor.userId, 'sign_out_everywhere', actor.sessionId ?? null),
    );
    return { ended };
  }

  /**
   * A fresh token pair for the session the caller is already in — after its second factor has just
   * been shown, so the new access token carries `mfa`. The session's other live refresh tokens are
   * retired into the new one, exactly as a rotation would, so the session still has one chain.
   */
  async reissueForSession(actor: RequestUser): Promise<TokenPair> {
    if (!actor.sessionId) throw ApiError.forbidden('Sign out and sign in again to continue.');
    const sessionId = actor.sessionId;
    const gate = await this.securityGate(actor.tenantId);

    return this.tenantDb.transaction(actor.tenantId, async (tx) => {
      const session = await tx.userSession.findFirst({
        where: { id: sessionId, userId: actor.userId, revokedAt: null },
        select: { id: true, startedAt: true, lastActiveAt: true, mfaAt: true, client: true },
      });
      if (!session) throw ApiError.invalidToken('This session was signed out');
      const verdict = this.sessions.verdict(session, gate);
      if (verdict !== 'active') throw ApiError.sessionExpired(verdict);

      const user = await tx.user.findFirst({
        where: { id: actor.userId, deletedAt: null },
        select: { id: true, role: true, roleId: true, status: true },
      });
      if (!user || user.status !== 'active') throw ApiError.invalidToken('User is not active');

      const projectIds = await this.loadProjectIds(tx, user.id);
      const via: SessionVia | null = actor.via === 'sso' ? 'sso' : null;
      const issued = this.tokens.signRefreshToken({
        userId: user.id,
        tenantId: actor.tenantId,
        identity: actor.identity ?? null,
        via,
        sessionId,
      });
      const created = await tx.refreshToken.create({
        data: {
          tenantId: actor.tenantId,
          userId: user.id,
          tokenHash: issued.tokenHash,
          expiresAt: issued.expiresAt,
          sessionId,
        },
        select: { id: true },
      });
      await tx.refreshToken.updateMany({
        where: { sessionId, revokedAt: null, id: { not: created.id } },
        data: { revokedAt: new Date(), replacedById: created.id },
      });

      const ttl = this.tokens.accessTtlUntil(
        securityAbsoluteDeadline(session.startedAt, gate?.absoluteLifetimeHours ?? null),
      );
      return {
        access_token: this.tokens.signAccessToken({
          userId: user.id,
          tenantId: actor.tenantId,
          role: user.role,
          roleId: user.roleId,
          projectIds,
          identity: actor.identity ?? null,
          via,
          sessionId,
          mfa: session.mfaAt !== null,
          app: session.client === 'app',
          ttlSeconds: ttl,
        }),
        refresh_token: issued.token,
        expires_in: ttl,
      };
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
    /** `sso` for a session that began at the company's identity provider. */
    via?: SessionVia | null;
    /**
     * A second factor already proved at sign-in (Firebase's own record of one), or `null` for
     * "none, whatever the method". Left out, a sign-in through the company's identity provider is
     * judged here by its "trust the provider" setting.
     */
    mfaMethod?: MfaMethod | null;
    /** The session began in the mobile app. Defaults to "sent a device id", which the app does. */
    app?: boolean;
  }): Promise<TokenPair> {
    const gate = await this.securityGate(input.tenantId);
    // The address this sign-in came from, as the audit log records it (`clientIpOf`).
    const ip = currentAuditActor().ip;
    const app = input.app ?? Boolean(input.deviceId);
    const method: SignInMethod =
      input.via === 'sso' ? 'sso' : (parseIdentityClaim(input.identity ?? null)?.kind ?? 'phone');
    /*
     * HOW A SIGN-IN PROVES A SECOND FACTOR, BY METHOD:
     *   phone OTP        never on its own — possession of the SIM is one factor. The person shows
     *                    an authenticator code after signing in.
     *   Firebase email   only when Firebase checked an authenticator itself (`mfaMethod: firebase`).
     *   single sign-on   when the company trusts its identity provider for two-factor (the default):
     *                    the provider enforces its own MFA, and the company chose to rely on it.
     */
    const mfaMethod: MfaMethod | null =
      input.mfaMethod !== undefined
        ? input.mfaMethod
        : input.via === 'sso' && (gate?.trustIdpMfa ?? true)
          ? 'identity_provider'
          : null;

    const outcome = await this.tenantDb.transaction(input.tenantId, async (tx) => {
      const user = await tx.user.findFirst({
        where: { id: input.userId, deletedAt: null },
        select: { id: true, role: true, roleId: true, status: true },
      });
      if (!user) throw ApiError.invalidToken('User no longer exists');

      if (user.status === 'disabled') throw ApiError.forbidden('This user has been disabled');

      // The allow-list is checked before anything is written: a refused sign-in must not activate
      // an invitation or move "last signed in".
      if (gate && ipRefused(gate, user.role, app, ip)) return { kind: 'refused' as const };

      if (user.status === 'pending') {
        if (!input.activatePending) throw ApiError.userPending();
        await tx.user.update({ where: { id: user.id }, data: { status: 'active' } });
      }

      await tx.user.update({ where: { id: user.id }, data: { lastLogin: new Date() } });

      const session = await this.sessions.open(tx, {
        tenantId: input.tenantId,
        userId: user.id,
        method,
        deviceId: input.deviceId,
        userAgent: input.userAgent,
        ip,
        app,
        mfaMethod,
      });

      const projectIds = await this.loadProjectIds(tx, user.id);
      const issued = this.tokens.signRefreshToken({
        userId: user.id,
        tenantId: input.tenantId,
        identity: input.identity ?? null,
        via: input.via ?? null,
        sessionId: session.id,
      });
      await tx.refreshToken.create({
        data: {
          tenantId: input.tenantId,
          userId: user.id,
          tokenHash: issued.tokenHash,
          expiresAt: issued.expiresAt,
          deviceId: input.deviceId,
          userAgent: input.userAgent,
          sessionId: session.id,
        },
      });

      const ttl = this.tokens.accessTtlUntil(
        securityAbsoluteDeadline(session.startedAt, gate?.absoluteLifetimeHours ?? null),
      );
      return {
        kind: 'session' as const,
        tokens: {
          access_token: this.tokens.signAccessToken({
            userId: user.id,
            tenantId: input.tenantId,
            role: user.role,
            roleId: user.roleId,
            projectIds,
            identity: input.identity ?? null,
            via: input.via ?? null,
            sessionId: session.id,
            mfa: mfaMethod !== null,
            app,
            ttlSeconds: ttl,
          }),
          refresh_token: issued.token,
          expires_in: ttl,
        },
      };
    });

    if (outcome.kind === 'refused') {
      await this.recordSignInRefusal(input.tenantId, input.userId, method, ip);
      throw ApiError.ipNotAllowed(ip);
    }
    return outcome.tokens;
  }

  /** The company's sign-in rules, from the same cache the guards read; null when it has none. */
  private async securityGate(tenantId: string): Promise<TenantSecurityGate | null> {
    return (await this.tenantCache.get(tenantId))?.security ?? null;
  }

  private async recordSignInRefusal(tenantId: string, userId: string, method: string, ip: string): Promise<void> {
    await this.securityAudit.record(tenantId, {
      actorId: userId,
      action: 'security.sign_in_refused',
      entity: 'users',
      entityId: userId,
      after: { reason: 'ip_not_allowed', method, ip },
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

  /**
   * Drops the companies that make this person use single sign-on (`SsoPolicyService`). With
   * nothing left, the refusal says so — they belong somewhere, just not by this way in.
   */
  private async permittedIdentities(
    identities: IdentityRow[],
    method: SignInMethod,
  ): Promise<IdentityRow[]> {
    const permitted: IdentityRow[] = [];
    for (const identity of identities) {
      const allowed = await this.tenantDb.transaction(identity.tenantId, (tx) =>
        this.ssoPolicy.permits(tx, identity.userId, method),
      );
      if (allowed) permitted.push(identity);
    }
    if (permitted.length === 0) throw ApiError.ssoRequired();
    return permitted;
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

/** Does the company's IP allow-list keep this person out from this address? */
function ipRefused(gate: TenantSecurityGate, role: UserRole, app: boolean, ip: string): boolean {
  return (
    securityIpApplies(
      { mode: gate.ipMode, exemptOwners: gate.ipExemptOwners, exemptRoles: gate.ipExemptRoles },
      { role, app },
    ) && !ipAllowed(ip, gate.ipCidrs)
  );
}
