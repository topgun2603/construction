import { ipCidrParse, ipFormat, ipInCidr, ipParse, type IpCidr } from './security';

/**
 * The public REST API and webhooks (roadmap Phase 3).
 *
 * A company's own systems — an accounting package, a BI tool, a client's portal — read and write
 * through `/public/v1` with an API key, and hear about changes through signed webhooks. Everything
 * here is the part both the API and the settings screen need: the scopes a key can hold, the events
 * an endpoint can ask for, the retry schedule, and the rules for which URLs may receive company data.
 */

// ---------------------------------------------------------------------------------------------
// API keys
// ---------------------------------------------------------------------------------------------

/**
 * Every key starts with this, so a key pasted into a chat or committed to a repository is
 * recognisable — to a person, and to a secret scanner — for what it is.
 */
export const PUBLIC_API_KEY_PREFIX = 'bk_live_';

/** `bk_live_` and 32 random bytes in base64url. */
export const PUBLIC_API_KEY_PATTERN = /^bk_live_[A-Za-z0-9_-]{43}$/;

/** Does this bearer token look like an API key at all? (It may still be wrong, revoked or expired.) */
export function publicApiLooksLikeKey(token: string): boolean {
  return token.startsWith(PUBLIC_API_KEY_PREFIX);
}

/**
 * What a key may do, by resource and direction. A key holds exactly the scopes it was made with;
 * a route needing one it lacks answers 403. Read and write are separate so the common case — a
 * reporting tool — can be given read access and nothing that changes anything.
 */
export const PUBLIC_API_SCOPES = [
  'projects:read',
  'workers:read',
  'attendance:read',
  'expenses:read',
  'expenses:write',
  'purchase_orders:read',
  'cost_report:read',
  'daily_reports:read',
  'change_orders:read',
  'rfis:read',
] as const;
export type PublicApiScope = (typeof PUBLIC_API_SCOPES)[number];

export function publicApiIsScope(value: string): value is PublicApiScope {
  return (PUBLIC_API_SCOPES as readonly string[]).includes(value);
}

/** What each scope lets a key do, in the words the settings screen shows (wrapped in `t()` there). */
export const PUBLIC_API_SCOPE_COPY: Record<PublicApiScope, string> = {
  'projects:read': 'Read sites',
  'workers:read': 'Read workers',
  'attendance:read': 'Read attendance',
  'expenses:read': 'Read expenses',
  'expenses:write': 'Record expenses',
  'purchase_orders:read': 'Read purchase orders',
  'cost_report:read': 'Read cost reports',
  'daily_reports:read': 'Read daily reports',
  'change_orders:read': 'Read change orders',
  'rfis:read': 'Read RFIs',
};

/** Requests per key per minute. Above it: 429 with Retry-After. */
export const PUBLIC_API_RATE_LIMIT_PER_MINUTE = 600;
/** List pages: what you get without asking, and the most you can ask for. */
export const PUBLIC_API_PAGE_SIZE = { default: 50, max: 200 } as const;
/** Live keys per company — far more than any company integrates, few enough to keep the list readable. */
export const PUBLIC_API_MAX_KEYS = 50;
/** Addresses or blocks one key may be limited to. */
export const PUBLIC_API_MAX_KEY_CIDRS = 20;
/** How long an `Idempotency-Key` answer is kept and replayed. */
export const PUBLIC_API_IDEMPOTENCY_HOURS = 24;
/** Attendance is read by date range; a range is at most this many days, so one call is one page of work. */
export const PUBLIC_API_MAX_ATTENDANCE_DAYS = 93;

/**
 * A key's state as the settings screen shows it. Expiry is a moment, so the same row reads
 * `active` today and `expired` tomorrow without anything being written.
 */
export function publicApiKeyState(
  key: { revokedAt: Date | null; expiresAt: Date | null },
  now: Date,
): 'active' | 'expired' | 'revoked' {
  if (key.revokedAt) return 'revoked';
  if (key.expiresAt && key.expiresAt.getTime() <= now.getTime()) return 'expired';
  return 'active';
}

// ---------------------------------------------------------------------------------------------
// Webhooks
// ---------------------------------------------------------------------------------------------

/** The events an endpoint can subscribe to. Names are `resource.past_tense`, as Stripe's are. */
export const WEBHOOK_EVENT_TYPES = [
  'expense.created',
  'expense.approved',
  'attendance.recorded',
  'dpr.submitted',
  'purchase_order.approved',
  'change_order.approved',
  'rfi.answered',
  'safety.incident_reported',
] as const;
export type WebhookEventType = (typeof WEBHOOK_EVENT_TYPES)[number];

/** Sent only by the "Send test event" button, to one endpoint, whatever it subscribed to. */
export const WEBHOOK_PING_EVENT = 'webhook.ping';

export function webhookIsEventType(value: string): value is WebhookEventType {
  return (WEBHOOK_EVENT_TYPES as readonly string[]).includes(value);
}

export const WEBHOOK_EVENT_COPY: Record<WebhookEventType, string> = {
  'expense.created': 'An expense is recorded',
  'expense.approved': 'An expense is approved',
  'attendance.recorded': 'Attendance is marked for a site and day',
  'dpr.submitted': 'A daily report is submitted',
  'purchase_order.approved': 'A purchase order is approved',
  'change_order.approved': 'A change order is approved',
  'rfi.answered': 'An RFI gets its answer',
  'safety.incident_reported': 'A safety incident is reported',
};

/** `t=<unix seconds>,v1=<hex HMAC-SHA256(secret, "<t>.<body>")>` — the Stripe scheme. */
export const WEBHOOK_SIGNATURE_HEADER = 'X-Buildr-Signature';
/** Receivers should refuse a signature older than this, so a captured request cannot be replayed later. */
export const WEBHOOK_SIGNATURE_TOLERANCE_SECONDS = 300;
/** A signing secret starts with this, like a key starts with `bk_live_`. */
export const WEBHOOK_SECRET_PREFIX = 'whsec_';

/**
 * Waits between tries: 1 minute, 5 minutes, 30 minutes, 2, 5, 8 and 8 hours. Eight tries in all,
 * the last about 24 hours after the first — long enough to ride out a receiver's bad night, short
 * enough that a day-old event is the oldest anybody receives.
 */
export const WEBHOOK_RETRY_DELAYS_SECONDS = [60, 300, 1_800, 7_200, 18_000, 28_800, 28_800] as const;
export const WEBHOOK_MAX_ATTEMPTS = WEBHOOK_RETRY_DELAYS_SECONDS.length + 1;

/**
 * How long to wait after the `attemptsMade`-th failed try, or null when that was the last.
 * `jitter` (0..1, default none) spreads retries by up to ±10% so a receiver coming back up is not
 * hit by every waiting delivery in the same second.
 */
export function webhookRetryDelaySeconds(attemptsMade: number, jitter = 0.5): number | null {
  if (attemptsMade < 1 || attemptsMade >= WEBHOOK_MAX_ATTEMPTS) return null;
  const base = WEBHOOK_RETRY_DELAYS_SECONDS[attemptsMade - 1]!;
  const spread = 1 + (Math.min(Math.max(jitter, 0), 1) - 0.5) * 0.2;
  return Math.round(base * spread);
}

/** A receiver gets this long to answer, and this much of its answer is read. */
export const WEBHOOK_TIMEOUT_MS = 10_000;
export const WEBHOOK_MAX_RESPONSE_BYTES = 64 * 1024;
/** Endpoints per company. */
export const WEBHOOK_MAX_ENDPOINTS = 20;

/**
 * Addresses a webhook must never be sent to: this host, the private networks behind it, link-local
 * (where cloud metadata services answer), and every block reserved for something other than the
 * public internet. Without this, "register a webhook" is "make our server fetch any address inside
 * its own network" — server-side request forgery.
 */
const BLOCKED_BLOCKS: readonly string[] = [
  '0.0.0.0/8', // "this network"
  '10.0.0.0/8', // private
  '100.64.0.0/10', // carrier-grade NAT
  '127.0.0.0/8', // loopback
  '169.254.0.0/16', // link-local, incl. 169.254.169.254 cloud metadata
  '172.16.0.0/12', // private
  '192.0.0.0/24', // IETF protocol assignments
  '192.0.2.0/24', // documentation
  '192.88.99.0/24', // 6to4 relay
  '192.168.0.0/16', // private
  '198.18.0.0/15', // benchmarking
  '198.51.100.0/24', // documentation
  '203.0.113.0/24', // documentation
  '224.0.0.0/4', // multicast
  '240.0.0.0/4', // reserved, incl. broadcast
  '::/128', // unspecified
  '::1/128', // loopback
  '64:ff9b::/96', // NAT64 — would reach an IPv4 address of the operator's choosing
  '64:ff9b:1::/48', // local NAT64
  '100::/64', // discard
  '2001::/32', // Teredo
  '2001:db8::/32', // documentation
  '2002::/16', // 6to4 — embeds an IPv4 address
  'fc00::/7', // unique local (private)
  'fe80::/10', // link-local
  'ff00::/8', // multicast
];
const BLOCKED: readonly IpCidr[] = BLOCKED_BLOCKS.map((block) => ipCidrParse(block)!);
const LOOPBACK: readonly IpCidr[] = ['127.0.0.0/8', '::1/128'].map((block) => ipCidrParse(block)!);

/**
 * May a webhook be delivered to this resolved address? False for anything that is not a plain
 * public unicast address, and for anything that does not parse. An IPv4-mapped IPv6 address is
 * judged as the IPv4 address it is (`ipParse` unwraps it).
 */
export function webhookAddressAllowed(address: string, options: { allowLoopback?: boolean } = {}): boolean {
  const parsed = ipParse(address);
  if (!parsed) return false;
  if (options.allowLoopback && LOOPBACK.some((cidr) => ipInCidr(parsed, cidr))) return true;
  return !BLOCKED.some((cidr) => ipInCidr(parsed, cidr));
}

/** Names that only ever mean something inside a network. Refused before any DNS lookup. */
function internalHostname(host: string): boolean {
  return (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host.endsWith('.internal') ||
    host.endsWith('.localdomain') ||
    host.endsWith('.home.arpa') ||
    // A bare name ("intranet") resolves through the server's search domains, i.e. inside.
    !host.includes('.')
  );
}

export type WebhookUrlProblem =
  | 'invalid'
  | 'not_https'
  | 'credentials'
  | 'internal_host'
  | 'blocked_address'
  | 'too_long';

export const WEBHOOK_URL_MAX_LENGTH = 2048;

/**
 * Why a URL may not receive webhooks, or null when it may (as far as can be told without DNS — the
 * API resolves the name and checks every address too, at registration and again at every send).
 *
 * `allowLoopback` is for a developer's own machine and the test suite (WEBHOOK_ALLOW_LOOPBACK, never
 * on in production): plain http to 127.0.0.1 / ::1 / localhost, and nothing else private.
 */
export function webhookUrlProblem(
  input: string,
  options: { allowLoopback?: boolean } = {},
): WebhookUrlProblem | null {
  if (input.length > WEBHOOK_URL_MAX_LENGTH) return 'too_long';
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return 'invalid';
  }
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (!host) return 'invalid';
  // Credentials in a URL end up in logs and in the settings screen.
  if (url.username || url.password) return 'credentials';

  const literal = ipParse(host);
  const loopbackTarget =
    options.allowLoopback === true &&
    (host === 'localhost' ||
      (literal !== null && LOOPBACK.some((cidr) => ipInCidr(literal, cidr))));
  if (loopbackTarget) {
    return url.protocol === 'https:' || url.protocol === 'http:' ? null : 'not_https';
  }

  if (url.protocol !== 'https:') return 'not_https';
  if (literal) return webhookAddressAllowed(ipFormat(literal)) ? null : 'blocked_address';
  if (internalHostname(host)) return 'internal_host';
  return null;
}

/** What each refusal means, for the API's error message and the settings form. */
export const WEBHOOK_URL_PROBLEM_COPY: Record<WebhookUrlProblem, string> = {
  invalid: 'That is not a web address.',
  not_https: 'Webhooks are only sent over https.',
  credentials: 'Take the user name and password out of the address.',
  internal_host: 'That address is inside a private network. Use a public https address.',
  blocked_address: 'That address is private, local or reserved. Use a public https address.',
  too_long: 'That address is too long.',
};
