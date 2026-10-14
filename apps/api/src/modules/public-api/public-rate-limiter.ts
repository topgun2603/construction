import { Injectable } from '@nestjs/common';
import { env } from '../../config/env';

export interface RateDecision {
  allowed: boolean;
  limit: number;
  remaining: number;
  /** Seconds until the window resets — Retry-After when refused. */
  resetSeconds: number;
}

const WINDOW_MS = 60_000;

/**
 * Per-key request limit for the public API (PUBLIC_API_RATE_LIMIT_PER_MINUTE, default 600).
 *
 * A fixed one-minute window per key, in this process's memory. That is deliberate for now: the
 * limit protects the database from one runaway integration, and an in-process counter costs nothing
 * on the request path. With several API instances behind a load balancer the effective ceiling is
 * the limit times the instance count — still a ceiling, and documented in the API reference. A
 * shared Redis counter is the upgrade when exact cluster-wide limits matter.
 */
@Injectable()
export class PublicRateLimiter {
  /** Settable so the e2e suite can reach the limit in a handful of calls. */
  limit = env().PUBLIC_API_RATE_LIMIT_PER_MINUTE;
  private readonly windows = new Map<string, { window: number; count: number }>();

  take(keyId: string, now = Date.now()): RateDecision {
    const window = Math.floor(now / WINDOW_MS);
    const resetSeconds = Math.max(1, Math.ceil(((window + 1) * WINDOW_MS - now) / 1000));
    let entry = this.windows.get(keyId);
    if (!entry || entry.window !== window) {
      // Old windows are dropped as keys come back; a sweep keeps keys that never return from piling up.
      if (this.windows.size > 50_000) this.sweep(window);
      entry = { window, count: 0 };
      this.windows.set(keyId, entry);
    }
    if (entry.count >= this.limit) {
      return { allowed: false, limit: this.limit, remaining: 0, resetSeconds };
    }
    entry.count += 1;
    return { allowed: true, limit: this.limit, remaining: this.limit - entry.count, resetSeconds };
  }

  private sweep(current: number): void {
    for (const [key, entry] of this.windows) {
      if (entry.window !== current) this.windows.delete(key);
    }
  }
}
