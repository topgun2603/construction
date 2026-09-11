/**
 * The e2e suite talks to a real Postgres, because the thing under test is
 * row-level security — an in-memory fake would prove nothing (spec §15).
 *
 * Set TEST_DATABASE_URL to point at a throwaway database; the local
 * docker-compose Postgres is fine.
 */
export default async function globalSetup(): Promise<void> {
  process.env['NODE_ENV'] = 'test';
  process.env['DATABASE_URL'] =
    process.env['TEST_DATABASE_URL'] ??
    process.env['DATABASE_URL'] ??
    // Must NOT be a superuser: superusers bypass RLS, which would make the
    // isolation suite pass while testing nothing.
    'postgresql://sitebook_app:sitebook@localhost:5432/sitebook?schema=public';

  process.env['JWT_SECRET'] ??= 'test-access-secret-that-is-definitely-long-enough';
  process.env['JWT_REFRESH_SECRET'] ??= 'test-refresh-secret-that-is-definitely-long-enough';
  // The suite signs in without Firebase; see PhoneAuthService's dev bypass.
  process.env['DEV_AUTH_BYPASS'] = 'true';
  // Make plan changes visible to the next request so gating can be asserted.
  process.env['TENANT_CACHE_TTL_SECONDS'] = '0';
  // No broker in tests. JobQueueService no-ops, so the domain code under test
  // takes the same path either way and the suite needs no Redis.
  process.env['JOBS_ENABLED'] = 'false';
  /*
   * The Razorpay webhook secret has to be set here, not in a suite's `beforeAll`.
   *
   * `env()` parses once and caches, and that happens while the modules are being imported — before
   * any `beforeAll` runs. A suite that set this itself would find the cached config had already been
   * built without it, and every correctly signed webhook would be rejected as forged.
   *
   * No API credentials: the Razorpay client runs dry without them, which is the point — the suite
   * exercises the signature check and the event handling without an account.
   */
  process.env['RAZORPAY_WEBHOOK_SECRET'] = 'test_webhook_secret_value';
}
