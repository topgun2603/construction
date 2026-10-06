/**
 * The deployment settings single sign-on needs, for the SSO and SCIM suites only.
 *
 * Imported *first* by those suites, before the app: `env()` parses once per test file when the app
 * module loads, so these must be in `process.env` by then. Not set in global-setup, because
 * `WEB_BASE_URL` changes the links other suites assert on (a worker link becomes absolute). The
 * previous values are restored after the suite so the next file, which loads its own copy of the
 * app, sees the environment it always did.
 */
const KEYS = ['API_PUBLIC_URL', 'WEB_BASE_URL', 'SSO_ENCRYPTION_KEY'] as const;
const previous = new Map<string, string | undefined>(KEYS.map((key) => [key, process.env[key]]));

process.env['API_PUBLIC_URL'] = 'https://api.buildr.test';
process.env['WEB_BASE_URL'] = 'https://app.buildr.test';
process.env['SSO_ENCRYPTION_KEY'] = Buffer.alloc(32, 9).toString('base64');

export const SSO_TEST_API = 'https://api.buildr.test/v1';
export const SSO_TEST_WEB_CALLBACK = 'https://app.buildr.test/sso/callback';

export function restoreSsoEnv(): void {
  for (const [key, value] of previous) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}
