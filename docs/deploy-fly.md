# Deploying BUILDR to Fly.io

Two Fly apps and three backing services, all in `bom` (Mumbai). The region is not a detail: every
person who uses this product is on Indian mobile data, and a supervisor filing a report at the end
of a shift feels every hundred milliseconds.

| App | What it is | Config |
|---|---|---|
| `buildr-api` | NestJS API, plus the BullMQ worker as a second process group | `fly.api.toml` |
| `buildr-web` | Next.js dashboard and platform console | `fly.web.toml` |

The API and the worker are **one app with two process groups**, not two apps. They share an image
and a secret set; the worker runs `dist/worker.js`, which sets `SITEBOOK_ROLE=worker` itself so the
cron jobs fire once rather than twice. Two apps would mean setting every secret twice and
remembering to deploy both.

---

## Before anything

```bash
fly auth login
fly apps create buildr-api --org personal
fly apps create buildr-web --org personal
```

Use the `topgun2603` organisation, not `srirealtime`.

---

## 1. Postgres

**Check this before you commit to a provider.** The platform console needs a second database role
with `BYPASSRLS` (`infra/postgres/init/02-admin-role.sql`, and the ADR beside it explains why the
application role must never have it). Creating such a role requires a superuser, and most managed
Postgres services do not give you one. Without it `/admin` reads an empty database for every tenant
— silently, because RLS denies rather than errors.

So, on a throwaway instance first:

```sql
CREATE ROLE probe NOSUPERUSER BYPASSRLS;  -- must succeed
DROP ROLE probe;
```

If Fly Managed Postgres refuses it, run Postgres as your own Fly app instead, where you are
superuser:

```bash
fly pg create --name buildr-db --region bom --vm-size shared-cpu-1x --volume-size 10
fly pg attach buildr-db --app buildr-api   # sets DATABASE_URL
```

Then create the admin role and capture its URL:

```bash
fly pg connect -a buildr-db
```

```sql
\i /dev/stdin
-- paste infra/postgres/init/02-admin-role.sql, then change the password:
ALTER ROLE sitebook_admin WITH PASSWORD '<a long random string>';
```

`ADMIN_DATABASE_URL` is the same host and database as `DATABASE_URL` with that role and password.

---

## 2. Redis

Fly has no managed Redis. Use Upstash, or run one as a Fly app with a volume.

**BullMQ requires `maxmemory-policy noeviction`.** A Redis that evicts under memory pressure will
drop queued jobs with no error anywhere — a WhatsApp summary that never sends, a push that never
arrives, and nothing in any log to say so. Set the policy explicitly, whichever you choose.

---

## 3. Object storage

Tigris is S3-compatible and sits on Fly:

```bash
fly storage create --name buildr-media
```

It prints the credentials once. They map to `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY_ID` and
`S3_SECRET_ACCESS_KEY`. Leave `S3_FORCE_PATH_STYLE` alone unless uploads start failing with signature
errors.

Site photos and worker ID proofs are served through presigned URLs, so the bucket stays private.

---

## 4. Secrets

Everything below is set with `fly secrets set`, never in `[env]` in the toml — that file is in git.

```bash
fly secrets set -a buildr-api \
  ADMIN_DATABASE_URL='postgres://sitebook_admin:...@.../sitebook' \
  REDIS_URL='rediss://...' \
  JWT_SECRET='<32+ random chars>' \
  JWT_REFRESH_SECRET='<a different 32+ random chars>' \
  S3_ENDPOINT='https://fly.storage.tigris.dev' \
  S3_BUCKET='buildr-media' \
  S3_ACCESS_KEY_ID='...' \
  S3_SECRET_ACCESS_KEY='...' \
  PLATFORM_ADMIN_PHONES='919876543210' \
  FIREBASE_PROJECT_ID='construction-40308' \
  FIREBASE_SERVICE_ACCOUNT="$(cat construction-service-account.json)" \
  WHATSAPP_TOKEN='...' \
  WHATSAPP_PHONE_ID='...' \
  RAZORPAY_KEY_ID='...' \
  RAZORPAY_SECRET='...' \
  RAZORPAY_WEBHOOK_SECRET='...' \
  RAZORPAY_PLAN_ID_STARTER='...' \
  RAZORPAY_PLAN_ID_PRO='...'
```

Notes on three of them:

- **`FIREBASE_SERVICE_ACCOUNT`** takes the JSON inline here rather than
  `FIREBASE_SERVICE_ACCOUNT_FILE`, because there is no file to mount into a Fly machine. The key is
  a multi-line PEM; the `$(cat ...)` form preserves the newlines, and hand-pasting it usually does
  not — "invalid PEM formatted message" at boot means exactly that.
- **`DEV_AUTH_BYPASS` must never be set.** It defaults to false and the API refuses it in
  production anyway, but a build with it on cannot sign anybody in, which wastes an afternoon.
- **`PLATFORM_ADMIN_PHONES`** is the only thing standing between a stranger and the platform
  console. It is env rather than a database row so that taking somebody out of it is a redeploy, not
  an UPDATE somebody could get wrong.

The web app needs nothing secret — its public Firebase config is compiled in at build time from
`[build.args]` in `fly.web.toml`.

---

## 5. First deploy

Order matters: the API must exist before the web app is built, because the build bakes in the API's
URL.

```bash
fly deploy -c fly.api.toml
```

Then run the migrations once, against the deployed image:

```bash
fly ssh console -a buildr-api -C "npx prisma migrate deploy"
```

Do **not** seed. `pnpm db:seed` creates the demo tenant with five fictional users and a fortnight of
invented attendance — fine locally, wrong in something a customer will sign in to.

Check it answered:

```bash
curl https://buildr-api.fly.dev/v1/health   # {"status":"ok","database":"ok"}
```

Then the web app:

```bash
fly deploy -c fly.web.toml
```

---

## 6. After the first deploy

1. **CORS.** `CORS_ORIGINS` in `fly.api.toml` lists `https://buildr-web.fly.dev`. The day the
   dashboard gets a real domain, that string changes or every browser request is refused.
2. **Razorpay webhook.** Point it at `https://buildr-api.fly.dev/v1/billing/webhook`. Subscriptions
   will look like they work without it and then never renew.
3. **Firebase authorised domains.** Add the web app's domain under Authentication → Settings, or
   phone sign-in fails in the browser while working perfectly on the phone.
4. **The mobile app** points at the local API through `adb reverse` during development. A build for
   real users needs `--dart-define=API_URL=https://buildr-api.fly.dev/v1` and no `DEV_AUTH_BYPASS`.

---

## Scaling, when it comes to that

The spec's line is no Kubernetes until fifty tenants, and nothing here contradicts it. The first
thing to feel pressure is the API, and `fly scale count app=2` is the whole answer — it holds no
local state, sessions are JWTs, and the queue is in Redis.

The worker is the exception: **keep it at one machine.** The repeatable jobs are scheduled by
BullMQ, and a second worker with its own scheduler would draft every wage period twice.
