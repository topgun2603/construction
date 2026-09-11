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

/** Stored so a database dump cannot be replayed as a session. */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
