import { Injectable, Logger } from '@nestjs/common';
import { securitySessionVerdict } from '@sitebook/shared';
import type { RequestUser } from '../../common/auth/request-user';
import type { TenantSecurityGate } from '../../common/auth/tenant-cache.service';
import { ApiError } from '../../common/errors/api-error';
import { TenantDb, type TenantTx } from '../../common/prisma/tenant-db.service';

/** How the first factor was proved. */
export type SessionMethod = 'phone' | 'email' | 'sso';

/** How the second factor was shown, when it was. */
export type MfaMethod = 'totp' | 'recovery_code' | 'firebase' | 'identity_provider';

/** Why a session ended. Stored on the row and shown nowhere but the audit log. */
export type SessionEndReason =
  | 'sign_out'
  | 'sign_out_everywhere'
  | 'revoked'
  | 'revoked_by_admin'
  | 'idle_timeout'
  | 'absolute_timeout'
  | 'mfa_reset'
  | 'replayed';

/**
 * Activity is written at most this often per session. Idle timeouts are thirty minutes at the
 * least, so a minute of slack costs nothing, and it keeps the busiest dashboard to one small write a
 * minute instead of one per request.
 */
const TOUCH_INTERVAL_MS = 60_000;
/** Forget old entries past this many, so a long-running process does not grow without bound. */
const TOUCH_MEMORY = 20_000;

export interface SessionTimes {
  startedAt: Date;
  lastActiveAt: Date;
}

/**
 * Sessions (roadmap Phase 3, item 2): one row per sign-in, `user_sessions`, which every refresh
 * token rotated from it points at.
 *
 * WHY A TABLE BESIDE `refresh_tokens` RATHER THAN COLUMNS ON IT. A refresh token is replaced on
 * every refresh, so "when did this sign-in start" and "was a second factor shown" would have to be
 * copied from row to row forever, and "sign out of that laptop" would mean finding a chain. A
 * session row is the thing a person recognises — one device, one sign-in — and the tokens stay
 * what they were: short-lived proof of possession, rotated and replay-checked as before.
 *
 * Idle and absolute timeouts are measured on it and enforced at refresh. Access tokens stay short
 * (fifteen minutes) and are cut to the absolute deadline, so a timed-out session can never be used
 * past its limit for longer than an idle minute's slack.
 */
@Injectable()
export class SessionService {
  private readonly logger = new Logger(SessionService.name);
  private readonly touched = new Map<string, number>();

  constructor(private readonly tenantDb: TenantDb) {}

  /** Starts a session, in the transaction that issues its first token pair. */
  async open(
    tx: TenantTx,
    input: {
      tenantId: string;
      userId: string;
      method: SessionMethod;
      deviceId?: string | null;
      userAgent?: string | null;
      ip: string;
      app: boolean;
      mfaMethod: MfaMethod | null;
      /** For a session made up for a token that predates sessions: when that token was issued. */
      startedAt?: Date;
    },
  ) {
    const now = new Date();
    return tx.userSession.create({
      data: {
        tenantId: input.tenantId,
        userId: input.userId,
        method: input.method,
        client: input.app ? 'app' : 'web',
        deviceId: input.deviceId ?? null,
        userAgent: input.userAgent?.slice(0, 300) ?? null,
        ip: input.ip || null,
        lastIp: input.ip || null,
        startedAt: input.startedAt ?? now,
        lastActiveAt: now,
        mfaAt: input.mfaMethod ? now : null,
        mfaMethod: input.mfaMethod,
      },
      select: { id: true, startedAt: true, lastActiveAt: true, mfaAt: true, client: true },
    });
  }

  /** Has this session outlived the company's timeouts? No rules, no limit. */
  verdict(session: SessionTimes, gate: TenantSecurityGate | null): 'active' | 'idle' | 'expired' {
    if (!gate) return 'active';
    return securitySessionVerdict({
      startedAt: session.startedAt,
      lastActiveAt: session.lastActiveAt,
      now: new Date(),
      idleMinutes: gate.idleTimeoutMinutes,
      absoluteHours: gate.absoluteLifetimeHours,
    });
  }

  /**
   * Records that a session did something, at most once a minute. Awaited by the guard rather than
   * fired and forgotten, so a request never finishes with a write still in flight; a failure is
   * logged and swallowed, because a missed activity stamp must not fail the request it rode on.
   */
  async touch(tenantId: string, sessionId: string, ip: string): Promise<void> {
    const now = Date.now();
    const last = this.touched.get(sessionId);
    if (last !== undefined && now - last < TOUCH_INTERVAL_MS) return;
    if (this.touched.size >= TOUCH_MEMORY) this.touched.clear();
    this.touched.set(sessionId, now);
    try {
      await this.tenantDb.clientFor(tenantId).userSession.updateMany({
        where: { id: sessionId, revokedAt: null },
        data: { lastActiveAt: new Date(now), ...(ip ? { lastIp: ip } : {}) },
      });
    } catch (error) {
      this.logger.warn({ err: error }, 'Could not record session activity');
    }
  }

  /** Ends one session and every refresh token in it. In the caller's transaction. */
  async end(tx: TenantTx, sessionId: string, reason: SessionEndReason): Promise<boolean> {
    const now = new Date();
    const ended = await tx.userSession.updateMany({
      where: { id: sessionId, revokedAt: null },
      data: { revokedAt: now, revokedReason: reason },
    });
    await tx.refreshToken.updateMany({
      where: { sessionId, revokedAt: null },
      data: { revokedAt: now },
    });
    // Forget the activity stamp so a revived id could never ride on it.
    this.touched.delete(sessionId);
    return ended.count === 1;
  }

  /**
   * Ends every session a person has in this company, optionally keeping one (the session asking —
   * "sign out everywhere else"). Refresh tokens from before sessions existed go too.
   */
  async endAllFor(
    tx: TenantTx,
    userId: string,
    reason: SessionEndReason,
    keepSessionId: string | null = null,
  ): Promise<number> {
    const now = new Date();
    const ended = await tx.userSession.updateMany({
      where: { userId, revokedAt: null, ...(keepSessionId ? { id: { not: keepSessionId } } : {}) },
      data: { revokedAt: now, revokedReason: reason },
    });
    await tx.refreshToken.updateMany({
      where: {
        userId,
        revokedAt: null,
        ...(keepSessionId ? { OR: [{ sessionId: null }, { sessionId: { not: keepSessionId } }] } : {}),
      },
      data: { revokedAt: now },
    });
    return ended.count;
  }

  /**
   * The sessions a person can still use: not ended, with a refresh token that has not run out, and
   * within the company's timeouts. Newest activity first.
   */
  async listLive(tx: TenantTx, userId: string, gate: TenantSecurityGate | null) {
    const rows = await tx.userSession.findMany({
      where: {
        userId,
        revokedAt: null,
        refreshTokens: { some: { revokedAt: null, expiresAt: { gt: new Date() } } },
      },
      orderBy: { lastActiveAt: 'desc' },
      take: 100,
      select: {
        id: true,
        method: true,
        client: true,
        userAgent: true,
        ip: true,
        lastIp: true,
        startedAt: true,
        lastActiveAt: true,
        mfaAt: true,
      },
    });
    return rows.filter((row) => this.verdict(row, gate) === 'active');
  }

  /** `GET /auth/sessions` — where I am signed in. */
  async mine(actor: RequestUser, gate: TenantSecurityGate | null) {
    const rows = await this.tenantDb.transaction(actor.tenantId, (tx) =>
      this.listLive(tx, actor.userId, gate),
    );
    return rows.map((row) => presentSession(row, actor.sessionId ?? null));
  }

  /** `DELETE /auth/sessions/:id` — sign out of one of my sessions. */
  async endMine(actor: RequestUser, sessionId: string): Promise<void> {
    await this.tenantDb.transaction(actor.tenantId, async (tx) => {
      const row = await tx.userSession.findFirst({
        where: { id: sessionId, userId: actor.userId },
        select: { id: true },
      });
      // Somebody else's session reads as missing, the same as one that never existed.
      if (!row) throw ApiError.notFound('Session');
      await this.end(tx, sessionId, sessionId === actor.sessionId ? 'sign_out' : 'revoked');
    });
  }
}

export function presentSession(
  row: {
    id: string;
    method: string;
    client: string;
    userAgent: string | null;
    ip: string | null;
    lastIp: string | null;
    startedAt: Date;
    lastActiveAt: Date;
    mfaAt: Date | null;
  },
  currentSessionId: string | null,
) {
  return {
    id: row.id,
    method: row.method,
    client: row.client,
    user_agent: row.userAgent,
    ip: row.lastIp ?? row.ip,
    started_at: row.startedAt.toISOString(),
    last_active_at: row.lastActiveAt.toISOString(),
    two_factor: row.mfaAt !== null,
    current: row.id === currentSessionId,
  };
}
