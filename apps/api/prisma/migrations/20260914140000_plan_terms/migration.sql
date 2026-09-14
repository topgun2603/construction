-- Plans become lengths of time rather than feature tiers.
--
-- Every account now gets every module; what a builder buys is how long they keep it. The tiered
-- model hid the product's best half from the customers most likely to need it, and made every
-- support call a conversation about which tier somebody was on.
--
-- Postgres cannot remove a value from an enum, so the type is rebuilt and the columns moved across.
-- Both existing tiers map to `three_months`: nothing is in production, and a short term that has
-- to be extended is a better default than a long one somebody did not pay for.

ALTER TYPE "plan" RENAME TO "plan_old";

CREATE TYPE "plan" AS ENUM ('three_months', 'six_months', 'one_year', 'lifetime');

ALTER TABLE "tenants" ALTER COLUMN "plan" DROP DEFAULT;
ALTER TABLE "tenants"
  ALTER COLUMN "plan" TYPE "plan"
  USING (CASE WHEN "plan"::text = 'pro' THEN 'three_months' ELSE 'three_months' END)::"plan";
ALTER TABLE "tenants" ALTER COLUMN "plan" SET DEFAULT 'three_months';

ALTER TABLE "subscriptions"
  ALTER COLUMN "plan" TYPE "plan"
  USING (CASE WHEN "plan"::text = 'pro' THEN 'three_months' ELSE 'three_months' END)::"plan";

DROP TYPE "plan_old";

-- When the current term runs, so the API can tell an active account from one that has lapsed.
-- `plan_expires_on` NULL means lifetime. It deliberately does not mean "expired at the epoch":
-- reading it that way would lock out the customers who paid the most.
ALTER TABLE "tenants" ADD COLUMN "plan_started_on" TIMESTAMPTZ(6);
ALTER TABLE "tenants" ADD COLUMN "plan_expires_on" TIMESTAMPTZ(6);

-- Every module, for everybody. `enabled_modules` stays: an operator can still turn one off for an
-- account that is misbehaving, and the guard honours it. What no longer happens is a module being
-- off because of what somebody paid.
UPDATE "tenants" SET "enabled_modules" = ARRAY[
  'projects','dpr','attendance','labour','indents','materials','notifications','dashboard',
  'expenses','stock','reports','billing','client_portal','documents'
];

-- Existing accounts are given a year from today rather than being expired the moment this runs.
UPDATE "tenants"
   SET "plan_started_on" = now(),
       "plan_expires_on" = now() + INTERVAL '1 year',
       "plan" = 'one_year';
