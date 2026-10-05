-- Stripe beside Razorpay (roadmap Phase 0, item 7).
--
-- Rupees keep going through Razorpay; every other currency goes through Stripe. Each plan carries
-- its price in other currencies, in their own minor units. Existing rows are all Razorpay and INR.

ALTER TABLE "plans" ADD COLUMN "prices" JSONB NOT NULL DEFAULT '{}';

ALTER TABLE "subscriptions"
  ADD COLUMN "provider" TEXT NOT NULL DEFAULT 'razorpay',
  ADD COLUMN "currency" TEXT NOT NULL DEFAULT 'INR',
  ADD COLUMN "stripe_session_id" TEXT,
  ADD COLUMN "stripe_subscription_id" TEXT,
  ADD CONSTRAINT "subscriptions_provider_known" CHECK ("provider" IN ('razorpay', 'stripe'));
CREATE UNIQUE INDEX "subscriptions_stripe_session_id_key" ON "subscriptions"("stripe_session_id");
CREATE UNIQUE INDEX "subscriptions_stripe_subscription_id_key" ON "subscriptions"("stripe_subscription_id");

-- An invoice is either provider's; exactly one id is set.
ALTER TABLE "invoices" ALTER COLUMN "razorpay_invoice_id" DROP NOT NULL;
ALTER TABLE "invoices" ADD COLUMN "stripe_invoice_id" TEXT;
CREATE UNIQUE INDEX "invoices_stripe_invoice_id_key" ON "invoices"("stripe_invoice_id");
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_one_provider_id"
  CHECK (("razorpay_invoice_id" IS NULL) <> ("stripe_invoice_id" IS NULL));

-- The Stripe twin of billing_identities. No RLS, deliberately, for the same reason: webhooks and the
-- nightly lapse sweep arrive with no tenant context.
CREATE TABLE "stripe_identities" (
    "stripe_subscription_id" TEXT NOT NULL,
    "tenant_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "stripe_identities_pkey" PRIMARY KEY ("stripe_subscription_id")
);
CREATE INDEX "stripe_identities_tenant_id_idx" ON "stripe_identities"("tenant_id");
ALTER TABLE "stripe_identities" ADD CONSTRAINT "stripe_identities_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
