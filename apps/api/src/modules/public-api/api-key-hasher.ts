import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { PUBLIC_API_KEY_PREFIX } from '@sitebook/shared';
import type { Env } from '../../config/env';

/**
 * How API keys are made and recognised.
 *
 * Stored as HMAC-SHA256(pepper, key), hex. A plain SHA-256 would already make a database dump
 * useless for calling the API (the key has 256 bits of entropy, so there is nothing to guess); the
 * pepper — API_KEY_PEPPER, kept outside the database — means the dump cannot even be used to check
 * whether a key found somewhere else is one of ours.
 *
 * The hash is also the directory's primary key, which is what lets a request find its company before
 * any company is known (see migration 20261010000500_public_api).
 */
export class ApiKeyHasher {
  private constructor(private readonly pepper: Buffer) {}

  /**
   * Null in production without API_KEY_PEPPER: keys then cannot be made or used. Outside production
   * the pepper is derived from JWT_SECRET, so a laptop and the test suite need nothing extra.
   */
  static fromEnv(config: Env): ApiKeyHasher | null {
    if (config.API_KEY_PEPPER) return new ApiKeyHasher(Buffer.from(config.API_KEY_PEPPER, 'utf8'));
    if (config.NODE_ENV === 'production') return null;
    return new ApiKeyHasher(createHash('sha256').update(`buildr-api-key-pepper:${config.JWT_SECRET}`).digest());
  }

  /** A new key: `bk_live_` and 32 random bytes. Returned to the owner once; never stored. */
  generate(): { key: string; hash: string; last4: string } {
    const key = `${PUBLIC_API_KEY_PREFIX}${randomBytes(32).toString('base64url')}`;
    return { key, hash: this.hash(key), last4: key.slice(-4) };
  }

  hash(key: string): string {
    return createHmac('sha256', this.pepper).update(key, 'utf8').digest('hex');
  }

  /** Constant-time: the comparison takes as long whether the first character or the last differs. */
  matches(storedHash: string, computedHash: string): boolean {
    const a = Buffer.from(storedHash, 'hex');
    const b = Buffer.from(computedHash, 'hex');
    return a.length === b.length && a.length > 0 && timingSafeEqual(a, b);
  }
}
