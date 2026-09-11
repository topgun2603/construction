import { Injectable, Logger } from '@nestjs/common';
import type { UserRole } from '@sitebook/shared';
import type { AuthExchangeInput, AuthRefreshInput, TokenPair } from '@sitebook/shared';
import { ApiError } from '../../common/errors/api-error';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TenantDb, type TenantTx } from '../../common/prisma/tenant-db.service';
import { TokenService } from '../../common/auth/token.service';
import { PhoneAuthService } from './phone-auth.service';

export interface TenantChoice {
  tenant_id: string;
  tenant_name: string;
  role: UserRole;
}

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
   */
  async exchange(input: AuthExchangeInput, userAgent?: string): Promise<ExchangeResult> {
    const phone = await this.phoneAuth.verify(input.firebase_token);

    const identities = await this.prisma.authIdentity.findMany({
      where: { phone },
      select: { userId: true, tenantId: true },
    });

    if (identities.length === 0) {
      // Unknown phone: not an error. It is a builder about to onboard.
      return { kind: 'onboarding', onboarding_token: this.tokens.signOnboardingToken(phone), phone };
    }

    const identity = await this.pickIdentity(identities);
    if (!identity) {
      return { kind: 'choose_tenant', tenants: await this.describeTenants(identities) };
    }

    const tokens = await this.issueSession({
      tenantId: identity.tenantId,
      userId: identity.userId,
      deviceId: input.device_id,
      userAgent,
      activatePending: true,
    });
    return { kind: 'session', tokens };
  }

  /**
   * Rotates a refresh token. Reuse of an already-rotated token is treated as theft:
   * the whole family is revoked so both the attacker and the victim are logged out
   * rather than the attacker silently keeping a valid session.
   */
  async refresh(input: AuthRefreshInput, userAgent?: string): Promise<TokenPair> {
    const claims = this.tokens.verifyRefreshToken(input.refresh_token);
    const tenantId = claims.tenant_id;

    const outcome = await this.rotate(claims.tokenHash, tenantId, input.device_id, userAgent);

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
      const issued = this.tokens.signRefreshToken({ userId: user.id, tenantId });

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
        }),
        refresh_token: issued.token,
        expires_in: this.tokens.accessTokenTtlSeconds,
      };
    });
  }

  /**
   * One phone can belong to more than one builder, because `users.phone` is unique
   * per tenant rather than globally. With exactly one live identity we log straight
   * in; with several the client has to choose.
   */
  private async pickIdentity(
    identities: Array<{ userId: string; tenantId: string }>,
  ): Promise<{ userId: string; tenantId: string } | null> {
    const live: Array<{ userId: string; tenantId: string }> = [];
    for (const identity of identities) {
      const tenant = await this.tenantDb.clientFor(identity.tenantId).tenant.findUnique({
        where: { id: identity.tenantId },
        select: { status: true },
      });
      if (tenant?.status === 'active') live.push(identity);
    }

    if (live.length === 0) throw ApiError.tenantSuspended();
    return live.length === 1 ? (live[0] ?? null) : null;
  }

  private async describeTenants(
    identities: Array<{ userId: string; tenantId: string }>,
  ): Promise<TenantChoice[]> {
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
