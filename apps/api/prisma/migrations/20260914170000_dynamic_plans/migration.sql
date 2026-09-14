-- Plans become rows an operator edits, rather than values compiled into the product.
--
-- What a term costs, what it is called and how long it runs are commercial decisions — the sort
-- made on a phone call with a customer. Held in an enum they needed a migration and a deploy;
-- adding "two years" is now an afternoon's work in the console.
--
-- `tenants.plan` and `subscriptions.plan` become text holding a plan's `code`. Deliberately not a
-- foreign key: a plan retired or deleted by mistake must not take its customers' accounts with it,
-- and an account whose plan row has gone still resolves to a readable code.

CREATE TABLE "plans" (
  "id"          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "code"        TEXT        NOT NULL,
  "name"        TEXT        NOT NULL,
  "months"      INTEGER,
  "price_paise" BIGINT      NOT NULL,
  "description" TEXT,
  "highlights"  TEXT[]      NOT NULL DEFAULT '{}',
  "is_active"   BOOLEAN     NOT NULL DEFAULT true,
  "sort_order"  INTEGER     NOT NULL DEFAULT 0,
  "created_at"  TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "updated_at"  TIMESTAMPTZ(6) NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX "plans_code_key" ON "plans" ("code");
CREATE INDEX "plans_is_active_sort_order_idx" ON "plans" ("is_active", "sort_order");

-- The four terms the product shipped with, as the starting catalogue. `months` NULL is the plan
-- that never expires.
INSERT INTO "plans" ("code", "name", "months", "price_paise", "description", "highlights", "sort_order")
VALUES
  ('three_months', '3 months',  3,    299900,  'Try it for a season.',
    ARRAY['Every feature', 'Renew whenever you like'], 1),
  ('six_months',   '6 months',  6,    549900,  'Half a year, at a better rate.',
    ARRAY['Every feature', 'Works out cheaper than two quarters'], 2),
  ('one_year',     '1 year',    12,   999900,  'The usual choice.',
    ARRAY['Every feature', 'Best value for a running site'], 3),
  ('lifetime',     'Lifetime',  NULL, 2499900, 'Pay once. Never again.',
    ARRAY['Every feature', 'No renewals, ever'], 4);

-- Enum to text. The existing values are already the codes above, so nothing has to be translated.
ALTER TABLE "tenants" ALTER COLUMN "plan" DROP DEFAULT;
ALTER TABLE "tenants" ALTER COLUMN "plan" TYPE TEXT USING "plan"::text;
ALTER TABLE "tenants" ALTER COLUMN "plan" SET DEFAULT 'three_months';

ALTER TABLE "subscriptions" ALTER COLUMN "plan" TYPE TEXT USING "plan"::text;

DROP TYPE "plan";
