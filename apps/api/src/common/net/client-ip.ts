import { timingSafeEqual } from 'node:crypto';
import type { Request } from 'express';
import { ipFormat, ipParse } from '@sitebook/shared';
import { env } from '../../config/env';

/** Set by the web app's server when it calls the API for a browser. See WEB_CLIENT_IP_SECRET. */
export const CLIENT_IP_HEADER = 'x-buildr-client-ip';
export const PROXY_SECRET_HEADER = 'x-buildr-proxy-secret';

/**
 * The address a request really came from — what the IP allow-list checks and the audit log records.
 *
 * Two sources, in order:
 *
 * 1. The web app's server, vouched for by WEB_CLIENT_IP_SECRET. Dashboard pages are rendered on
 *    that server and it calls this API itself, so the socket (and any proxy header) names the
 *    server, not the person. It passes the browser's address on, and the secret is what makes that
 *    header believable: without the secret it is just something a caller typed, and is ignored.
 * 2. `req.ip`, which honours Express's `trust proxy` (TRUST_PROXY): the socket address, or the
 *    address the configured proxy appended to X-Forwarded-For. Never a raw X-Forwarded-For.
 *
 * Returned in canonical form, so `::ffff:10.0.0.1` from a dual-stack socket reads as `10.0.0.1`
 * and matches an IPv4 rule. Empty when there is no address at all (a unit test's fake request).
 */
export function clientIpOf(req: Pick<Request, 'headers' | 'ip'> & { socket?: { remoteAddress?: string } }): string {
  const secret = env().WEB_CLIENT_IP_SECRET;
  if (secret) {
    const vouched = req.headers[PROXY_SECRET_HEADER];
    const forwarded = req.headers[CLIENT_IP_HEADER];
    if (typeof vouched === 'string' && typeof forwarded === 'string' && sameSecret(vouched, secret)) {
      const parsed = ipParse(forwarded);
      if (parsed) return ipFormat(parsed);
    }
  }
  const raw = req.ip ?? req.socket?.remoteAddress ?? '';
  const parsed = ipParse(raw);
  return parsed ? ipFormat(parsed) : raw;
}

function sameSecret(given: string, expected: string): boolean {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
