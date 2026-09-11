-- Which tenant a Razorpay subscription belongs to.
--
-- WHY THIS EXISTS
--
-- A webhook is authenticated by signature and carries no session, so the tenant must be worked out
-- before any tenant-scoped query can run. `subscriptions` is FORCE ROW LEVEL SECURITY, so reading it
-- without `app.tenant_id` returns zero rows — correct, and useless for this purpose. The first version
-- of the billing service tried exactly that and silently resolved no tenant, so a paid subscription
-- never upgraded the plan.
--
-- This directory holds a Razorpay id and a tenant id and nothing else, the same shape and for the same
-- reason as `auth_identities`. A trigger keeps it in step with `subscriptions` so application code
-- never writes it and cannot let the two disagree.

CREATE TABLE "billing_identities" (
    "razorpay_subscription_id" TEXT NOT NULL,
    "tenant_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "billing_identities_pkey" PRIMARY KEY ("razorpay_subscription_id")
);

CREATE INDEX "billing_identities_tenant_id_idx" ON "billing_identities"("tenant_id");

ALTER TABLE "billing_identities" ADD CONSTRAINT "billing_identities_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- No RLS, deliberately. See above.

CREATE OR REPLACE FUNCTION sync_billing_identity() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF (TG_OP = 'DELETE') THEN
    DELETE FROM billing_identities WHERE tenant_id = OLD.tenant_id;
    RETURN OLD;
  END IF;

  -- A subscription with no Razorpay id yet (seeded as 'none') maps to nothing.
  IF (NEW.razorpay_subscription_id IS NULL) THEN
    DELETE FROM billing_identities WHERE tenant_id = NEW.tenant_id;
    RETURN NEW;
  END IF;

  -- Resubscribing gives a tenant a new Razorpay id; drop the stale mapping so a replayed webhook for
  -- the old subscription cannot keep acting on the account.
  DELETE FROM billing_identities
    WHERE tenant_id = NEW.tenant_id
      AND razorpay_subscription_id <> NEW.razorpay_subscription_id;

  INSERT INTO billing_identities (razorpay_subscription_id, tenant_id)
  VALUES (NEW.razorpay_subscription_id, NEW.tenant_id)
  ON CONFLICT (razorpay_subscription_id) DO UPDATE SET tenant_id = EXCLUDED.tenant_id;

  RETURN NEW;
END $$;

CREATE TRIGGER subscriptions_sync_billing_identity
AFTER INSERT OR UPDATE OF razorpay_subscription_id, tenant_id OR DELETE ON "subscriptions"
FOR EACH ROW EXECUTE FUNCTION sync_billing_identity();

-- Backfill anything that already has a Razorpay id.
ALTER TABLE "subscriptions" NO FORCE ROW LEVEL SECURITY;
INSERT INTO "billing_identities" (razorpay_subscription_id, tenant_id)
SELECT s.razorpay_subscription_id, s.tenant_id
FROM "subscriptions" s
WHERE s.razorpay_subscription_id IS NOT NULL
ON CONFLICT (razorpay_subscription_id) DO NOTHING;
ALTER TABLE "subscriptions" FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sitebook_admin') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "billing_identities" TO sitebook_admin;
  END IF;
END $$;
