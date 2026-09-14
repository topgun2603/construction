// Loads apps/api/.env before anything reads process.env. The Prisma CLI does this
// for itself, but `nest start` and ts-node do not â€” without it the app starts with
// an empty environment and fails validation for the wrong reason.
// Values already in the environment win, so a container's real config is never
// overwritten by a stray .env.
import 'dotenv/config';
import { z } from 'zod';

/**
 * Environment is validated once at boot and the process refuses to start if it is
 * wrong. A misconfigured JWT secret or a missing database URL should be a crash on
 * line one, not a 500 three hours into production.
 */
const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),

    DATABASE_URL: z.string().min(1),

    /**
     * Connection for the platform console only, as a role with BYPASSRLS
     * (infra/postgres/init/02-admin-role.sql). Optional: leave it unset and the
     * console is simply off, which is the right default for any deployment that is
     * not the one the platform team operates.
     */
    ADMIN_DATABASE_URL: z.string().optional(),

    /**
     * Phones allowed into the platform console, comma separated, stored form
     * (`91XXXXXXXXXX`). Empty means nobody, and the console refuses every login.
     *
     * Deliberately env rather than a table: the console can change a tenant's plan and
     * suspend accounts, so the list of people who may do that should not itself be
     * editable from inside the console. Granting access is a deploy, which leaves a
     * trail outside the database.
     */
    PLATFORM_ADMIN_PHONES: z.string().default(''),

    /**
     * Eight hours. Longer than a tenant access token because there is no refresh flow
     * here â€” re-authenticating means another SMS â€” and short enough that a forgotten
     * open tab is not a standing credential. Revocation does not wait for expiry: the
     * guard re-reads the allowlist on every request.
     */
    PLATFORM_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(8 * 60 * 60),

    REDIS_URL: z.string().default('redis://localhost:6379'),

    /**
     * Which half of the system this process is. The API registers queues as a
     * producer; only the worker attaches processors, so a job is never handled by
     * the process that is also serving requests.
     */
    SITEBOOK_ROLE: z.enum(['api', 'worker']).default('api'),
    /** Turn the queues off entirely â€” useful in tests and when Redis is absent. */
    JOBS_ENABLED: z
      .enum(['true', 'false'])
      .default('true')
      .transform((value) => value === 'true'),

    S3_ENDPOINT: z.string().optional(),
    S3_REGION: z.string().default('ap-south-1'),
    S3_BUCKET: z.string().default('sitebook-media'),
    S3_ACCESS_KEY_ID: z.string().optional(),
    S3_SECRET_ACCESS_KEY: z.string().optional(),
    S3_FORCE_PATH_STYLE: z
      .enum(['true', 'false'])
      .default('true')
      .transform((value) => value === 'true'),

    JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
    JWT_REFRESH_SECRET: z.string().min(32, 'JWT_REFRESH_SECRET must be at least 32 characters'),
    ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(15 * 60),
    REFRESH_TOKEN_TTL_SECONDS: z.coerce
      .number()
      .int()
      .positive()
      .default(30 * 24 * 60 * 60),

    /** Firebase project id â€” must match the web client's `projectId`. */
    FIREBASE_PROJECT_ID: z.string().optional(),
    /** Admin SDK credential as inline JSON. */
    FIREBASE_SERVICE_ACCOUNT: z.string().optional(),
    /**
     * Path to the Admin SDK credential file â€” preferred over inline JSON, because a
     * multi-line private key survives a file far better than a shell variable.
     */
    FIREBASE_SERVICE_ACCOUNT_FILE: z.string().optional(),
    DEV_AUTH_BYPASS: z
      .enum(['true', 'false'])
      .default('false')
      .transform((value) => value === 'true'),

    /** Seconds a tenant's plan/module list is cached in process. */
    TENANT_CACHE_TTL_SECONDS: z.coerce.number().int().min(0).default(30),

    WHATSAPP_TOKEN: z.string().optional(),
    WHATSAPP_PHONE_ID: z.string().optional(),
    WHATSAPP_API_VERSION: z.string().default('v21.0'),
    /** Owner daily summary, IST. */
    WHATSAPP_SUMMARY_CRON: z.string().default('0 19 * * *'),
    /** Missing-DPR nudge to supervisors, IST. */
    WHATSAPP_DPR_REMINDER_CRON: z.string().default('30 17 * * *'),
    /** Nightly labour-cost rollup. */
    REPORTS_ROLLUP_CRON: z.string().default('0 1 * * *'),
    /** Auto-draft wage periods for contractors whose period just ended. */
    WAGE_PERIOD_DRAFT_CRON: z.string().default('0 2 * * *'),
    /**
     * Drops the plan for subscriptions whose paid period and grace window have both passed. Runs after
     * the wage drafts so a tenant losing Pro does so on a quiet database rather than mid-rollup.
     */
    BILLING_SWEEP_CRON: z.string().default('30 2 * * *'),
    RAZORPAY_KEY_ID: z.string().optional(),
    RAZORPAY_SECRET: z.string().optional(),
    /**
     * Separate from RAZORPAY_SECRET. Razorpay signs webhooks with a secret you choose when adding
     * the endpoint, not with your API secret â€” using the wrong one means every webhook is rejected
     * as forged, which looks exactly like an attack.
     */
    RAZORPAY_WEBHOOK_SECRET: z.string().optional(),
    /** The Razorpay plan each of our plans maps to. Razorpay holds the authoritative price. */
    RAZORPAY_PLAN_ID_STARTER: z.string().optional(),
    RAZORPAY_PLAN_ID_PRO: z.string().optional(),
    /**
     * How long a tenant keeps working after a charge fails. Access ends when the period they already
     * paid for runs out plus this â€” dropping someone's site staff mid-shift over a failed card is
     * not a collections strategy.
     */
    BILLING_GRACE_DAYS: z.coerce.number().int().min(0).max(60).default(7),

    /**
     * Contact address sent to the geocoder in the User-Agent, as its usage policy requires. Without
     * one the traffic is anonymous and they are entitled to block it.
     */
    GEOCODER_CONTACT: z.string().optional(),

    /**
     * Map tiles and geocoding. Without it the geocoder falls back to Nominatim's volunteer
     * service, which is fine for a checkout and not fine for a deployment - their usage policy is
     * enforced by blocking, and being blocked takes site search down for every tenant at once.
     */
    MAPTILER_KEY: z.string().optional(),

    CORS_ORIGINS: z.string().default('http://localhost:3001'),

    /**
     * Where the web app lives, for links the API mints but does not serve — a worker's
     * self-service page, for one. Optional: left unset the API returns the path alone, which a
     * half-configured deployment shows up as a visibly wrong link rather than a silently dead one.
     */
    WEB_BASE_URL: z.string().url().optional(),
  })
  .superRefine((value, ctx) => {
    if (value.NODE_ENV !== 'production') return;

    if (value.DEV_AUTH_BYPASS) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['DEV_AUTH_BYPASS'],
        message: 'DEV_AUTH_BYPASS must be false in production',
      });
    }
    // A console wired to the app's own connection would find every RLS policy
    // matching zero rows, so it must not be half-configured: either both or neither.
    if (value.PLATFORM_ADMIN_PHONES.trim() !== '' && !value.ADMIN_DATABASE_URL) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['ADMIN_DATABASE_URL'],
        message: 'PLATFORM_ADMIN_PHONES is set, so ADMIN_DATABASE_URL must be too',
      });
    }
    // Half-configured billing is worse than none: checkout would create subscriptions that no
    // webhook could ever confirm, leaving tenants charged and still on the old plan.
    if (value.RAZORPAY_KEY_ID && !value.RAZORPAY_WEBHOOK_SECRET) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['RAZORPAY_WEBHOOK_SECRET'],
        message: 'RAZORPAY_KEY_ID is set, so RAZORPAY_WEBHOOK_SECRET must be too',
      });
    }
    if (!value.FIREBASE_SERVICE_ACCOUNT && !value.FIREBASE_SERVICE_ACCOUNT_FILE) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['FIREBASE_SERVICE_ACCOUNT'],
        message:
          'Set FIREBASE_SERVICE_ACCOUNT or FIREBASE_SERVICE_ACCOUNT_FILE in production',
      });
    }
  });

export type Env = z.infer<typeof envSchema>;

let cached: Env | undefined;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  ${i.path.join('.') || '(root)'}: ${i.message}`);
    throw new Error(`Invalid environment:\n${lines.join('\n')}`);
  }
  return parsed.data;
}

export function env(): Env {
  cached ??= loadEnv();
  return cached;
}

/** Test helper: forget the memoised env so a test can load a different one. */
export function resetEnvCache(): void {
  cached = undefined;
}

export function corsOrigins(value: Env): string[] {
  return value.CORS_ORIGINS.split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
}
