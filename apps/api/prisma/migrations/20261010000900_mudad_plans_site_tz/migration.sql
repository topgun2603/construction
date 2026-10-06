-- Three smaller roadmap items in one migration:
--
--   1. Saudi Arabia's Wage Protection payroll file (Mudad): the establishment number on the
--      company, and a Saudi national ID as a worker paper beside the Iqama.
--   2. Plans paid by bank transfer, for markets where paying abroad by card is hard.
--   3. A separate time zone per site.

-- AlterTable
ALTER TABLE "projects" ADD COLUMN     "time_zone" TEXT;

-- AlterTable
ALTER TABLE "tenants" ADD COLUMN     "mudad_establishment_id" TEXT;

-- CreateTable
CREATE TABLE "plan_bank_transfer_invoices" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "plan" TEXT NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "amount" BIGINT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "requested_by" UUID,
    "note" TEXT,
    "payment_reference" TEXT,
    "settled_by" TEXT,
    "paid_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "plan_bank_transfer_invoices_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "plan_bank_transfer_invoices_number_key" ON "plan_bank_transfer_invoices"("number");

-- CreateIndex
CREATE INDEX "plan_bank_transfer_invoices_tenant_id_created_at_idx" ON "plan_bank_transfer_invoices"("tenant_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "plan_bank_transfer_invoices_status_created_at_idx" ON "plan_bank_transfer_invoices"("status", "created_at");

-- AddForeignKey
ALTER TABLE "plan_bank_transfer_invoices" ADD CONSTRAINT "plan_bank_transfer_invoices_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- --------------------------------------------------------------------------
-- Rules the schema cannot express
-- --------------------------------------------------------------------------

-- "1-123456": labour office id, a dash, the establishment's sequence. The API validates the same
-- shape; this only stops a write that skipped it.
ALTER TABLE "tenants"
  ADD CONSTRAINT "tenants_mudad_establishment_format"
    CHECK ("mudad_establishment_id" IS NULL OR "mudad_establishment_id" ~ '^[0-9]{1,3}-[0-9]{1,10}$');

-- An IANA name is checked against Intl in the API; Postgres has no tz parser to repeat that, so
-- this is the cheap shape check only ("Asia/Dubai", "America/Argentina/Buenos_Aires", "UTC").
ALTER TABLE "projects"
  ADD CONSTRAINT "projects_time_zone_format"
    CHECK ("time_zone" IS NULL OR "time_zone" ~ '^[A-Za-z0-9_+/-]{1,64}$');

-- A Saudi citizen has no Iqama; the payroll file takes the national ID instead.
ALTER TABLE "worker_documents" DROP CONSTRAINT "worker_documents_kind_known";
ALTER TABLE "worker_documents"
  ADD CONSTRAINT "worker_documents_kind_known"
    CHECK ("kind" IN ('passport', 'residence_visa', 'emirates_id', 'labour_card', 'iqama', 'national_id', 'work_permit', 'other'));

ALTER TABLE "plan_bank_transfer_invoices"
  ADD CONSTRAINT "plan_bank_transfer_invoices_status_known"
    CHECK ("status" IN ('pending', 'paid', 'cancelled')),
  ADD CONSTRAINT "plan_bank_transfer_invoices_amount_positive" CHECK ("amount" > 0),
  ADD CONSTRAINT "plan_bank_transfer_invoices_currency_format" CHECK ("currency" ~ '^[A-Z]{3}$'),
  -- Paid means somebody saw the money arrive: the time and who said so travel together.
  ADD CONSTRAINT "plan_bank_transfer_invoices_paid_complete"
    CHECK ("status" <> 'paid' OR ("paid_at" IS NOT NULL AND "settled_by" IS NOT NULL));

-- --------------------------------------------------------------------------
-- Every tenant table: the same isolation policy as the rest.
-- --------------------------------------------------------------------------

ALTER TABLE "plan_bank_transfer_invoices" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "plan_bank_transfer_invoices" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "plan_bank_transfer_invoices"
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- The platform console lists pending requests across companies and marks them paid, as for every
-- other tenant table. Skipped where that role does not exist (a developer's database).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sitebook_admin') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON
      "plan_bank_transfer_invoices"
    TO sitebook_admin;
  END IF;
END $$;

-- --------------------------------------------------------------------------
-- The audit log
-- --------------------------------------------------------------------------
-- A request, and the console marking it paid or cancelled, land in the company's own trail. The
-- two new columns ride on tables already attached (`projects`, `tenants`).
SELECT audit_attach('plan_bank_transfer_invoices');
