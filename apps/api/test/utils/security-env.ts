/**
 * The deployment settings the security-policy suite needs, imported *first* (before the app), for
 * the same reason as `sso-env`: `env()` is parsed once per test file when the app module loads.
 *
 * `TRUST_PROXY=1` makes the test app read the client address the way production does behind
 * Caddy — from the one X-Forwarded-For entry the proxy wrote — so a test can stand somewhere else
 * on the internet by sending that header. Restored afterwards so the next file sees what it always
 * did (no proxy trusted: the header ignored).
 */
const KEYS = ['TRUST_PROXY', 'WEB_CLIENT_IP_SECRET'] as const;
const previous = new Map<string, string | undefined>(KEYS.map((key) => [key, process.env[key]]));

process.env['TRUST_PROXY'] = '1';
export const TEST_WEB_CLIENT_IP_SECRET = 'web-server-vouches-for-browser-addresses-0123456789';
process.env['WEB_CLIENT_IP_SECRET'] = TEST_WEB_CLIENT_IP_SECRET;

export function restoreSecurityEnv(): void {
  for (const [key, value] of previous) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}
