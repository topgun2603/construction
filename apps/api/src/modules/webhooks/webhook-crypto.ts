import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { WEBHOOK_SECRET_PREFIX } from '@sitebook/shared';
import { FieldCipher } from '../../common/crypto/field-cipher';
import type { Env } from '../../config/env';

/**
 * The key webhook signing secrets are encrypted under: WEBHOOK_ENCRYPTION_KEY, or — outside
 * production only — one derived from JWT_SECRET, so a developer's machine and the test suite need
 * no extra setup. Null in production without the key: endpoints then cannot be registered, rather
 * than their secrets being stored under something guessable.
 */
export function webhookCipherFor(config: Env): FieldCipher | null {
  if (config.WEBHOOK_ENCRYPTION_KEY) return new FieldCipher(config.WEBHOOK_ENCRYPTION_KEY);
  if (config.NODE_ENV === 'production') return null;
  const derived = createHash('sha256').update(`buildr-webhook-secrets:${config.JWT_SECRET}`).digest();
  return new FieldCipher(derived.toString('base64'));
}

/** `whsec_` and 32 random bytes — shown to the owner once. */
export function newWebhookSecret(): string {
  return `${WEBHOOK_SECRET_PREFIX}${randomBytes(32).toString('base64url')}`;
}

/**
 * The `X-Buildr-Signature` value: `t=<unix seconds>,v1=<hex HMAC-SHA256(secret, "<t>.<body>")>`.
 *
 * The same scheme as Stripe's, so receivers can reuse what they know: the timestamp is inside the
 * signed string, so a captured request replayed later fails the receiver's age check rather than
 * verifying forever.
 */
export function webhookSignature(secret: string, body: string, timestampSeconds: number): string {
  const digest = createHmac('sha256', secret).update(`${timestampSeconds}.${body}`).digest('hex');
  return `t=${timestampSeconds},v1=${digest}`;
}

/**
 * Checks a signature header the way a receiver should — exported for the e2e suite and as the
 * reference the docs describe. Constant-time on the digest; refuses anything older than `tolerance`.
 */
export function webhookSignatureValid(
  secret: string,
  body: string,
  header: string,
  options: { toleranceSeconds: number; nowSeconds?: number },
): boolean {
  const parts = new Map(
    header.split(',').map((part) => {
      const index = part.indexOf('=');
      return [part.slice(0, index).trim(), part.slice(index + 1).trim()] as const;
    }),
  );
  const t = Number(parts.get('t'));
  const v1 = parts.get('v1') ?? '';
  if (!Number.isInteger(t) || !/^[0-9a-f]{64}$/.test(v1)) return false;
  const now = options.nowSeconds ?? Math.floor(Date.now() / 1000);
  if (Math.abs(now - t) > options.toleranceSeconds) return false;
  const expected = createHmac('sha256', secret).update(`${t}.${body}`).digest();
  return timingSafeEqual(expected, Buffer.from(v1, 'hex'));
}
