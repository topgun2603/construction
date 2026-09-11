-- Subscription billing (spec §3 item 12, §16 step 12).
--
-- Three tables. `subscriptions` and `invoices` are tenant-scoped with RLS like everything else.
-- `webhook_events` is not: a webhook is authenticated by signature before any tenant is known, so
-- there is no tenant context in which to read or write it — the same reasoning as `auth_identities`.

CREATE TYPE "billing_status" AS ENUM ('none', 'trialing', 'active', 'past_due', 'cancelled');

CREATE TABLE "subscriptions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "plan" "plan" NOT NULL,
    "status" "billing_status" NOT NULL DEFAULT 'none',
    "razorpay_subscription_id" TEXT,
    "razorpay_plan_id" TEXT,
    "amount" BIGINT NOT NULL DEFAULT 0,
    "current_period_end" TIMESTAMPTZ(6),
    "cancel_at" TIMESTAMPTZ(6),
    "cancelled_at" TIMESTAMPTZ(6),
    "last_failure_reason" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "subscriptions_pkey" PRIMARY KEY ("id")
);

-- One subscription per tenant: two would make "what plan are they on" a question.
CREATE UNIQUE INDEX "subscriptions_tenant_id_key" ON "subscriptions"("tenant_id");
-- Unique on the Razorpay id so a replayed webhook cannot attach one subscription to two tenants.
CREATE UNIQUE INDEX "subscriptions_razorpay_subscription_id_key"
  ON "subscriptions"("razorpay_subscription_id");
CREATE INDEX "subscriptions_status_idx" ON "subscriptions"("status");

CREATE TABLE "invoices" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "subscription_id" UUID NOT NULL,
    "razorpay_invoice_id" TEXT NOT NULL,
    "razorpay_payment_id" TEXT,
    "amount" BIGINT NOT NULL,
    "status" TEXT NOT NULL,
    "invoice_url" TEXT,
    "issued_at" TIMESTAMPTZ(6),
    "paid_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invoices_pkey" PRIMARY KEY ("id")
);

-- Unique on Razorpay's invoice id: a retried `invoice.paid` must update the row, not add one.
CREATE UNIQUE INDEX "invoices_razorpay_invoice_id_key" ON "invoices"("razorpay_invoice_id");
CREATE INDEX "invoices_tenant_id_issued_at_idx" ON "invoices"("tenant_id", "issued_at" DESC);

CREATE TABLE "webhook_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "event_id" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "handled_at" TIMESTAMPTZ(6),
    "error" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "webhook_events_pkey" PRIMARY KEY ("id")
);

-- The whole point of this table: Razorpay retries until it gets a 2xx, so the same event arrives
-- repeatedly. Unique on its id makes a replay a no-op instead of a second invoice.
CREATE UNIQUE INDEX "webhook_events_event_id_key" ON "webhook_events"("event_id");
CREATE INDEX "webhook_events_event_type_created_at_idx"
  ON "webhook_events"("event_type", "created_at" DESC);

ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_subscription_id_fkey"
  FOREIGN KEY ("subscription_id") REFERENCES "subscriptions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Seed before the policies go on, not after.
--
-- The first version of this migration enabled FORCE RLS on `subscriptions` and then inserted into
-- it, and the insert was refused by its own policy — with no `app.tenant_id` set, the USING clause
-- is applied as the WITH CHECK and matches nothing. Postgres reports that as 42501, which reads as
-- a permissions problem rather than what it is.
--
-- Existing tenants get a row seeded as 'none' on the plan they already hold, so the billing screen
-- can say "you are on Pro, not yet subscribed" rather than crashing on a null.
ALTER TABLE "tenants" NO FORCE ROW LEVEL SECURITY;
INSERT INTO "subscriptions" (tenant_id, plan, status, amount, updated_at)
SELECT t.id, t.plan, 'none', 0, now() FROM "tenants" t
ON CONFLICT (tenant_id) DO NOTHING;
ALTER TABLE "tenants" FORCE ROW LEVEL SECURITY;

ALTER TABLE "subscriptions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "subscriptions" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "subscriptions" USING (tenant_id = current_tenant_id());

ALTER TABLE "invoices" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "invoices" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "invoices" USING (tenant_id = current_tenant_id());

-- webhook_events gets no policy on purpose. See the comment at the top of this file.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sitebook_admin') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "subscriptions" TO sitebook_admin;
    GRANT SELECT, INSERT, UPDATE, DELETE ON "invoices" TO sitebook_admin;
    GRANT SELECT, INSERT, UPDATE ON "webhook_events" TO sitebook_admin;
  END IF;
END $$;
