-- Give accounts that predate terms a term.
--
-- `plan_started_on` and `plan_expires_on` arrived with the plan rewrite. Accounts created before
-- that have neither, and a null expiry reads as "never ends" everywhere — their plan page says the
-- term does not end, and the read-only gate never trips. So an account on a three month plan was
-- quietly sold a lifetime.
--
-- The term starts **now**, not at `created_at`. Nobody sold these accounts a length of time, so
-- dating the term from when they signed up would expire some of them on the day this ran — a
-- builder locked out of writing by a backfill, for a term they were never told about. Starting
-- today gives every one of them the full term the plan says, and an operator can shorten it in the
-- console if the real arrangement was different.
--
-- Lifetime plans are left alone: null expiry is what lifetime means, and it is the one plan where
-- the absent date is correct.
-- `tenants` has FORCE ROW LEVEL SECURITY and migrations run as `sitebook_app`, which owns the
-- table but has no BYPASSRLS — so with no `app.tenant_id` set, the isolation policy matches no rows
-- and a plain UPDATE here silently changes nothing. It is silent: Postgres reports zero rows, not
-- an error, and the migration looks like it worked. Same dance as the billing backfill.
ALTER TABLE "tenants" NO FORCE ROW LEVEL SECURITY;

UPDATE "tenants" AS t
SET "plan_started_on" = now(),
    "plan_expires_on" = now() + make_interval(months => p."months")
FROM "plans" AS p
WHERE p."code" = t."plan"
  AND p."months" IS NOT NULL
  AND t."plan_expires_on" IS NULL;

ALTER TABLE "tenants" FORCE ROW LEVEL SECURITY;
