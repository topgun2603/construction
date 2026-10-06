import { Injectable } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import jwt, { type JwtPayload } from 'jsonwebtoken';
import type { UserRole } from '@sitebook/shared';
import { env } from '../../config/env';
import { ApiError } from '../errors/api-error';

export interface AccessTokenClaims extends JwtPayload {
  sub: string;
  tenant_id: string;
  role: UserRole;
  /**
   * Which role row to resolve permissions from. The *id* travels, never the permission
   * list: a token asserting its own permissions could not be narrowed until it expired, so
   * revoking access from the UI would do nothing for up to fifteen minutes.
   */
  role_id?: string | null;
  project_ids: string[];
}

export interface RefreshTokenClaims extends JwtPayload {
  sub: string;
  tenant_id: string;
  /** Identifies the stored `refresh_tokens` row. */
  jti: string;
}

/**
 * A platform console session. No tenant and no user id — a platform operator is not a
 * row in `users`, and giving this token a `tenant_id` is exactly the confusion the
 * separate audience exists to prevent.
 */
export interface PlatformTokenClaims extends JwtPayload {
  phone: string;
  purpose: 'platform';
}

/**
 * A link a worker was sent, standing in for an account they do not have.
 *
 * Carries the tenant and the worker and nothing else: it can only ever read one person's own
 * attendance and dues, so there is no permission to encode and no session to escalate. A worker on
 * a site has no email, often no smartphone of their own, and no reason to keep a password — the
 * link *is* the credential, and it expires.
 */
export interface WorkerLinkClaims extends JwtPayload {
  tenantId: string;
  workerId: string;
  purpose: 'worker_link';
}

/**
 * A link an outside designer or consultant was sent to answer one RFI, or to review one submittal
 * revision (roadmap Phase 2, module 9).
 *
 * Names the tenant, which kind of record and its id, and the record's link version when it was
 * signed. Nothing else: the reader can see that one record and write that one answer. Bumping the
 * version on the record withdraws every link sent so far without a table of issued tokens.
 */
export interface RfiLinkClaims extends JwtPayload {
  tenantId: string;
  kind: 'rfi' | 'submittal';
  /** The RFI id, or the submittal *revision* id — a new revision needs a new link. */
  recordId: string;
  version: number;
  purpose: 'rfi_link';
}

/** Short-lived ticket proving a phone passed OTP but has no tenant yet. */
export interface OnboardingTokenClaims extends JwtPayload {
  phone: string;
  purpose: 'onboarding';
}

const ISSUER = 'sitebook';
const ONBOARDING_TTL_SECONDS = 15 * 60;

@Injectable()
export class TokenService {
  private readonly config = env();

  get accessTokenTtlSeconds(): number {
    return this.config.ACCESS_TOKEN_TTL_SECONDS;
  }

  get refreshTokenTtlSeconds(): number {
    return this.config.REFRESH_TOKEN_TTL_SECONDS;
  }

  signAccessToken(input: {
    userId: string;
    tenantId: string;
    role: UserRole;
    roleId?: string | null;
    projectIds: string[];
  }): string {
    return jwt.sign(
      {
        tenant_id: input.tenantId,
        role: input.role,
        role_id: input.roleId ?? null,
        project_ids: input.projectIds,
      },
      this.config.JWT_SECRET,
      {
        subject: input.userId,
        issuer: ISSUER,
        audience: 'api',
        expiresIn: this.accessTokenTtlSeconds,
      },
    );
  }

  verifyAccessToken(token: string): AccessTokenClaims {
    return this.verify<AccessTokenClaims>(token, this.config.JWT_SECRET, 'api');
  }

  /**
   * Refresh tokens are signed JWTs rather than opaque strings for one reason: the
   * `refresh_tokens` table is behind RLS, so the tenant has to be known *before*
   * the row can be read. The signature carries it. Only the hash is stored, so a
   * leaked database still cannot mint a session.
   */
  signRefreshToken(input: { userId: string; tenantId: string }): {
    token: string;
    jti: string;
    tokenHash: string;
    expiresAt: Date;
  } {
    const jti = randomUUID();
    const token = jwt.sign({ tenant_id: input.tenantId }, this.config.JWT_REFRESH_SECRET, {
      subject: input.userId,
      jwtid: jti,
      issuer: ISSUER,
      audience: 'refresh',
      expiresIn: this.refreshTokenTtlSeconds,
    });
    return {
      token,
      jti,
      tokenHash: hashToken(token),
      expiresAt: new Date(Date.now() + this.refreshTokenTtlSeconds * 1000),
    };
  }

  verifyRefreshToken(token: string): RefreshTokenClaims & { tokenHash: string } {
    const claims = this.verify<RefreshTokenClaims>(token, this.config.JWT_REFRESH_SECRET, 'refresh');
    if (!claims.jti) throw ApiError.invalidToken('Refresh token has no id');
    return { ...claims, tokenHash: hashToken(token) };
  }

  signOnboardingToken(phone: string): string {
    return jwt.sign({ phone, purpose: 'onboarding' }, this.config.JWT_SECRET, {
      issuer: ISSUER,
      audience: 'onboarding',
      expiresIn: ONBOARDING_TTL_SECONDS,
    });
  }

  verifyOnboardingToken(token: string): OnboardingTokenClaims {
    const claims = this.verify<OnboardingTokenClaims>(token, this.config.JWT_SECRET, 'onboarding');
    if (claims.purpose !== 'onboarding') throw ApiError.invalidToken('Not an onboarding token');
    return claims;
  }

  /**
   * A platform console token.
   *
   * The audience is what keeps the two worlds apart: `verifyAccessToken` demands
   * `api` and this demands `platform`, so a tenant session can never be presented to
   * the console and a console session can never be presented to a tenant route. That
   * separation is enforced by the signature check itself rather than by a claim the
   * route has to remember to look at.
   */
  signPlatformToken(phone: string): string {
    return jwt.sign({ phone, purpose: 'platform' }, this.config.JWT_SECRET, {
      issuer: ISSUER,
      audience: 'platform',
      expiresIn: this.config.PLATFORM_TOKEN_TTL_SECONDS,
    });
  }

  verifyPlatformToken(token: string): PlatformTokenClaims {
    const claims = this.verify<PlatformTokenClaims>(token, this.config.JWT_SECRET, 'platform');
    if (claims.purpose !== 'platform') throw ApiError.invalidToken('Not a platform token');
    return claims;
  }

  /**
   * Signs a worker's self-service link.
   *
   * Thirty days, and deliberately not longer. The link travels by WhatsApp, which means it lives
   * in a chat that gets forwarded, backed up and read over somebody's shoulder — so it has to stop
   * working on its own. A worker who still needs it gets sent another, which costs the site office
   * one tap.
   *
   * No row is written for it. Revocation is by the reader instead: the endpoint refuses a worker
   * who has been removed or a tenant that is suspended, which covers every case a revocation list
   * would have, without a table that has to be cleaned up.
   */
  signWorkerLink(input: { tenantId: string; workerId: string }): string {
    return jwt.sign(
      { tenantId: input.tenantId, workerId: input.workerId, purpose: 'worker_link' },
      this.config.JWT_SECRET,
      { issuer: ISSUER, audience: 'worker_link', expiresIn: WORKER_LINK_TTL_SECONDS },
    );
  }

  verifyWorkerLink(token: string): WorkerLinkClaims {
    const claims = this.verify<WorkerLinkClaims>(token, this.config.JWT_SECRET, 'worker_link');
    if (claims.purpose !== 'worker_link') throw ApiError.invalidToken('Not a worker link');
    return claims;
  }

  /**
   * Signs an RFI or submittal responder's link. Thirty days, like the worker link and for the same
   * reason: it travels by email and WhatsApp and must stop working on its own. The endpoint also
   * refuses it once the record is closed, voided or decided, or the link was withdrawn.
   */
  signRfiLink(input: { tenantId: string; kind: 'rfi' | 'submittal'; recordId: string; version: number }): string {
    return jwt.sign(
      {
        tenantId: input.tenantId,
        kind: input.kind,
        recordId: input.recordId,
        version: input.version,
        purpose: 'rfi_link',
      },
      this.config.JWT_SECRET,
      // Its own audience, so a responder link can never be presented as a session or a worker link.
      { issuer: ISSUER, audience: 'rfi_link', expiresIn: RFI_LINK_TTL_SECONDS },
    );
  }

  verifyRfiLink(token: string): RfiLinkClaims {
    const claims = this.verify<RfiLinkClaims>(token, this.config.JWT_SECRET, 'rfi_link');
    if (claims.purpose !== 'rfi_link' || (claims.kind !== 'rfi' && claims.kind !== 'submittal')) {
      throw ApiError.invalidToken('Not an RFI link');
    }
    return claims;
  }

  get rfiLinkTtlSeconds(): number {
    return RFI_LINK_TTL_SECONDS;
  }

  get workerLinkTtlSeconds(): number {
    return WORKER_LINK_TTL_SECONDS;
  }

  get platformTokenTtlSeconds(): number {
    return this.config.PLATFORM_TOKEN_TTL_SECONDS;
  }

  private verify<T extends JwtPayload>(token: string, secret: string, audience: string): T {
    try {
      return jwt.verify(token, secret, { issuer: ISSUER, audience }) as T;
    } catch (error) {
      if (error instanceof jwt.TokenExpiredError) throw ApiError.tokenExpired();
      throw ApiError.invalidToken();
    }
  }
}

/** Thirty days. See `signWorkerLink` for why it is not indefinite. */
const WORKER_LINK_TTL_SECONDS = 30 * 24 * 60 * 60;

/** Thirty days. See `signRfiLink`. */
const RFI_LINK_TTL_SECONDS = 30 * 24 * 60 * 60;

/** Stored so a database dump cannot be replayed as a session. */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
