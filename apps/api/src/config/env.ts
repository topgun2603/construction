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
    // Cost forecasts per site, on each company's clock: after the night's rollup and drafts.
    SITE_FORECAST_CRON: z.string().default('0 3 * * *'),
    // Leak and fraud checks, on each company's clock, after the forecasts.
    LEAK_CHECK_CRON: z.string().default('30 3 * * *'),
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
     * Stripe, for every currency other than rupees (roadmap Phase 0, item 7). Unset, checkout runs
     * dry the way Razorpay's does. The webhook secret is the endpoint's signing secret (whsec_…)
     * from the Stripe dashboard, not the API key.
     */
    STRIPE_SECRET_KEY: z.string().optional(),
    STRIPE_WEBHOOK_SECRET: z.string().optional(),

    /**
     * Contact address sent to the geocoder in the User-Agent, as its usage policy requires. Without
     * one the traffic is anonymous and they are entitled to block it.
     */
    GEOCODER_CONTACT: z.string().optional(),

    /*
     * Google Maps, server side: address search.
     *
     * A different key from the browser's. This one carries no referrer restriction — a server has
     * no referrer — so it must never reach a bundle; restrict it by IP instead. With no key set the
     * search falls back to MapTiler and then to Nominatim, and everything keeps working.
     */
    GOOGLE_MAPS_API_KEY: z.string().optional(),

    /*
     * Reading photographed bills into expense drafts.
     *
     * Optional: with no key the scan endpoint answers "not configured" and the rest of the product
     * is unaffected. The key is server-side only and must never reach a browser bundle or an APK —
     * it is a spending credential, not a public identifier like the Firebase web config.
     */
    OPENAI_API_KEY: z.string().optional(),
    /*
     * Default to the better reader, not the cheaper one.
     *
     * `gpt-4o-mini` read an invoice printed 25/09/2026 as 25/08/2026 — the rasterised page was
     * crisp, so the digit was not the problem. A date a month out files an expense against the
     * wrong month's spend, and nothing downstream can tell. A deployment that scans mostly
     * photographs with large print can set the cheaper model here.
     */
    OPENAI_VISION_MODEL: z.string().default('gpt-4o'),
    /*
     * Reading a question into a lookup. A smaller model than the one that reads bills: this one
     * classifies a sentence into six metrics and a period keyword, which is the easy half of what
     * a vision model is asked to do.
     */
    OPENAI_ASK_MODEL: z.string().default('gpt-4o-mini'),
    /*
     * Listening to a spoken site note.
     *
     * `whisper-1` rather than a newer transcriber because it is the one that reports which language
     * it heard. The interface says "heard as Tamil" above the draft, and a supervisor whose note
     * was transcribed as Malayalam can see why the report reads like nonsense — which is worth more
     * than a point of word accuracy.
     */
    OPENAI_TRANSCRIBE_MODEL: z.string().default('whisper-1'),
    /*
     * Answering a question from pages of a drawing or a contract.
     *
     * The better model, like the bill reader, and for the same reason: the input is construction
     * prose full of codes and dimensions — "M25", "Cl. 7.3.2", "150mm c/c" — and a figure read back
     * one digit out is a figure somebody pours concrete to. The cheap model also gives up on the
     * instruction that matters most here, which is to answer "the documents do not say" instead of
     * producing something plausible.
     */
    OPENAI_DOCUMENT_MODEL: z.string().default('gpt-4o'),
    /*
     * Where model calls go, per company region (Settings → Security → AI and data).
     *
     * Unset means the provider's own default endpoint. A regional URL is only offered to companies
     * when it is configured here — the product never guesses one — and a company that chose a
     * region whose URL is later removed has its AI refused (`region_unavailable`) rather than
     * quietly sent to the default endpoint it asked to avoid.
     */
    OPENAI_BASE_URL: z.string().url().optional().or(z.literal('').transform(() => undefined)),
    OPENAI_BASE_URL_EU: z.string().url().optional().or(z.literal('').transform(() => undefined)),
    OPENAI_BASE_URL_US: z.string().url().optional().or(z.literal('').transform(() => undefined)),
    /*
     * The operator's kill switch: `all`, or a comma list of AI_FEATURES (`voice,translation`).
     * Applies to every company, whatever their own settings, and the settings screen says the
     * feature is off "on this server" rather than "for your company". Read at start-up like every
     * other setting here, so changing it takes a restart and no code.
     */
    AI_DISABLED_FEATURES: z.string().default(''),

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

    /**
     * Key for workers' identity-document numbers (passport, Emirates ID, Iqama): 32 random bytes,
     * base64. Generate with: node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
     * Unset, the documents feature answers "not configured" rather than store a number in the clear.
     * Changing it makes every stored number unreadable, so it is rotated by re-encrypting, never
     * by replacing.
     */
    DOCUMENT_ENCRYPTION_KEY: z
      .string()
      .optional()
      .refine((value) => !value || Buffer.from(value, 'base64').length === 32, {
        message: 'DOCUMENT_ENCRYPTION_KEY must be 32 bytes, base64-encoded',
      }),
    /**
     * Ask the bucket to encrypt document scans at rest (SSE-S3, AES256). On for AWS S3 and
     * Tigris; off for local MinIO, which needs a key server configured before it will accept it.
     */
    S3_SERVER_SIDE_ENCRYPTION: z
      .enum(['true', 'false'])
      .default('false')
      .transform((value) => value === 'true'),
    /**
     * Where this API is reachable from the internet, without `/v1` — e.g. https://api.buildr.app.
     * Single sign-on needs it: the OIDC redirect URI, the SAML ACS URL and entity id are all built
     * from it, and an identity provider will only send people back to the exact URL it was given.
     * Unset, SSO answers "not configured"; nothing else uses it.
     */
    API_PUBLIC_URL: z.string().url().optional(),
    /**
     * Key for SSO client secrets at rest: 32 random bytes, base64, generated like
     * DOCUMENT_ENCRYPTION_KEY and deliberately a different key — losing one must not expose the
     * other's data. Unset, an OIDC connection cannot store a client secret (SAML needs none).
     */
    SSO_ENCRYPTION_KEY: z
      .string()
      .optional()
      .refine((value) => !value || Buffer.from(value, 'base64').length === 32, {
        message: 'SSO_ENCRYPTION_KEY must be 32 bytes, base64-encoded',
      }),
    /**
     * Key for authenticator-app (TOTP) secrets at rest: 32 random bytes, base64, generated like
     * DOCUMENT_ENCRYPTION_KEY and deliberately its own key. Unset, nobody can enrol an authenticator
     * and a company cannot switch on required two-factor — refused rather than stored in the clear.
     */
    MFA_ENCRYPTION_KEY: z
      .string()
      .optional()
      .refine((value) => !value || Buffer.from(value, 'base64').length === 32, {
        message: 'MFA_ENCRYPTION_KEY must be 32 bytes, base64-encoded',
      }),
    /**
     * Which proxies Express may believe about the client's address — the value of its `trust proxy`
     * setting. The IP allow-list and the audit log read `req.ip`, which is the socket's address
     * unless this says otherwise.
     *
     *   false (default)  nothing in front: the socket address is the client. Right for local runs.
     *   1                one proxy in front (Caddy in infra/, or Fly's edge): believe the address it
     *                    appends to X-Forwarded-For, nothing further left.
     *   a list           specific proxies: `loopback, 10.0.0.0/8`.
     *
     * `true` is refused: it believes the leftmost X-Forwarded-For entry, which the client writes,
     * so anybody could claim to be inside the office and walk past the allow-list.
     */
    TRUST_PROXY: z
      .string()
      .default('false')
      .refine((value) => value.trim().toLowerCase() !== 'true', {
        message: 'TRUST_PROXY=true would trust a client-written header; give a hop count such as 1',
      })
      .transform((value): boolean | number | string => {
        const trimmed = value.trim();
        if (trimmed === '' || trimmed.toLowerCase() === 'false') return false;
        if (/^\d+$/.test(trimmed)) return Number(trimmed);
        return trimmed;
      }),
    /**
     * Shared with the web app's server, which calls this API on the browser's behalf: with it, the
     * web server passes the browser's address in `X-Buildr-Client-Ip` beside this secret in
     * `X-Buildr-Proxy-Secret`, and the API believes it. Without it every dashboard request appears
     * to come from the web server, and an IP allow-list in web mode would be checking the server.
     * At least 32 characters. Never sent to a browser.
     */
    WEB_CLIENT_IP_SECRET: z
      .string()
      .optional()
      .transform((value) => value || undefined)
      .refine((value) => !value || value.length >= 32, {
        message: 'WEB_CLIENT_IP_SECRET must be at least 32 characters',
      }),
    // Workers' documents nearing expiry, on each company's clock: first thing in the morning.
    DOCUMENT_EXPIRY_CRON: z.string().default('0 8 * * *'),
    // Cube and lab tests due today, on each company's clock: early enough to get them to the lab.
    QUALITY_TEST_DUE_CRON: z.string().default('0 7 * * *'),
    // Permits to work whose time ran out while still open. Every quarter-hour, so the alert lands
    // within fifteen minutes of the permit lapsing on any company's clock.
    SAFETY_PERMIT_EXPIRY_CRON: z.string().default('*/15 * * * *'),
    // RFIs and submittals due soon or overdue, on each company's clock: first thing, before the
    // morning's calls to the consultants.
    RFI_REMINDER_CRON: z.string().default('0 8 * * *'),
    // Machines due for a service and machine papers about to lapse, on each company's clock: early,
    // so the fitter is booked before the machine starts work.
    EQUIPMENT_REMINDER_CRON: z.string().default('30 7 * * *'),
    // Data export and deletion (roadmap Phase 3, compliance). The version string of the data
    // processing agreement companies are asked to accept, and where its text is published. Legal
    // text is not shipped in the app: change the version here when the document changes, and every
    // company is asked to accept the new one.
    DPA_VERSION: z.string().trim().min(1).default('2026-10'),
    DPA_URL: z.string().url().optional().or(z.literal('').transform(() => undefined)),
    // How often the worker looks for companies past their deletion grace period and for expired
    // exports to remove. Hourly: a deletion is due on a day, not a minute.
    DELETION_SWEEP_CRON: z.string().default('15 * * * *'),
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
    if (value.STRIPE_SECRET_KEY && !value.STRIPE_WEBHOOK_SECRET) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['STRIPE_WEBHOOK_SECRET'],
        message: 'STRIPE_SECRET_KEY is set, so STRIPE_WEBHOOK_SECRET must be too',
      });
    }
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
