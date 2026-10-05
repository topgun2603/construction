-- Subcontracts and progress (RA) billing (roadmap Phase 2, module 3): a subcontract per site and
-- contractor with its schedule of rates, variations, running-account bills with retention, advance
-- recovery and back-charges, retention releases, and the payments against all of them.
-- RLS in the same migration as the tables (spec §17).
--
-- The foreign keys that must refuse a delete are NO ACTION rather than RESTRICT. RESTRICT is checked
-- row by row as the delete happens, so deleting a whole company — which cascades to its cost codes
-- and its subcontract lines in the same statement — would trip over a line that is itself about to
-- go. NO ACTION is checked once the statement is done, and still refuses a cost code or contractor
-- deleted on its own while a subcontract points at it.

-- CreateEnum
CREATE TYPE "subcontract_status" AS ENUM ('draft', 'active', 'completed', 'closed', 'terminated');

-- CreateEnum
CREATE TYPE "ra_bill_status" AS ENUM ('draft', 'submitted', 'certified', 'paid');

-- CreateEnum
CREATE TYPE "subcontract_deduction_kind" AS ENUM ('material', 'labour', 'damage', 'penalty', 'other');

-- CreateEnum
CREATE TYPE "subcontract_payment_kind" AS ENUM ('advance', 'bill', 'retention');

-- AlterTable
ALTER TABLE "contractors" ADD COLUMN     "address" TEXT,
ADD COLUMN     "tax_id" TEXT;

-- CreateTable
CREATE TABLE "subcontracts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "contractor_id" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "scope" TEXT,
    "start_date" DATE,
    "end_date" DATE,
    "retention_bp" INTEGER NOT NULL DEFAULT 0,
    "retention_release_at_completion_bp" INTEGER NOT NULL DEFAULT 5000,
    "defects_liability_months" INTEGER NOT NULL DEFAULT 12,
    "advance_amount" BIGINT NOT NULL DEFAULT 0,
    "advance_recovery_bp" INTEGER NOT NULL DEFAULT 0,
    "tax_rate_bp" INTEGER NOT NULL DEFAULT 0,
    "payment_terms" TEXT,
    "status" "subcontract_status" NOT NULL DEFAULT 'draft',
    "completed_on" DATE,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "subcontracts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subcontract_lines" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "subcontract_id" UUID NOT NULL,
    "variation_id" UUID,
    "cost_code_id" UUID,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "item_code" TEXT,
    "description" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "quantity" DECIMAL(14,3) NOT NULL,
    "rate" BIGINT NOT NULL,
    "amount" BIGINT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "subcontract_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subcontract_variations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "subcontract_id" UUID NOT NULL,
    "number" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "reason" TEXT,
    "status" "approval_status" NOT NULL DEFAULT 'pending',
    "requested_by" UUID NOT NULL,
    "decided_by" UUID,
    "decided_at" TIMESTAMPTZ(6),
    "decision_note" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "subcontract_variations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subcontract_bills" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "subcontract_id" UUID NOT NULL,
    "number" INTEGER NOT NULL,
    "period_from" DATE,
    "period_to" DATE NOT NULL,
    "bill_date" DATE NOT NULL,
    "status" "ra_bill_status" NOT NULL DEFAULT 'draft',
    "gross_to_date" BIGINT NOT NULL DEFAULT 0,
    "previous_gross" BIGINT NOT NULL DEFAULT 0,
    "gross" BIGINT NOT NULL DEFAULT 0,
    "retention_to_date" BIGINT NOT NULL DEFAULT 0,
    "retention" BIGINT NOT NULL DEFAULT 0,
    "advance_recovered_to_date" BIGINT NOT NULL DEFAULT 0,
    "advance_recovery" BIGINT NOT NULL DEFAULT 0,
    "deductions" BIGINT NOT NULL DEFAULT 0,
    "tax_rate_bp" INTEGER NOT NULL DEFAULT 0,
    "tax" BIGINT NOT NULL DEFAULT 0,
    "net_payable" BIGINT NOT NULL DEFAULT 0,
    "note" TEXT,
    "created_by" UUID NOT NULL,
    "submitted_by" UUID,
    "submitted_at" TIMESTAMPTZ(6),
    "certified_by" UUID,
    "certified_at" TIMESTAMPTZ(6),
    "certification_note" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "subcontract_bills_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subcontract_bill_lines" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "bill_id" UUID NOT NULL,
    "line_id" UUID NOT NULL,
    "claimed_quantity" DECIMAL(14,3) NOT NULL,
    "certified_quantity" DECIMAL(14,3),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "subcontract_bill_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subcontract_deductions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "bill_id" UUID NOT NULL,
    "kind" "subcontract_deduction_kind" NOT NULL,
    "description" TEXT NOT NULL,
    "amount" BIGINT NOT NULL,
    "cost_code_id" UUID,
    "expense_id" UUID,
    "stock_movement_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "subcontract_deductions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subcontract_retention_releases" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "subcontract_id" UUID NOT NULL,
    "amount" BIGINT NOT NULL,
    "released_on" DATE NOT NULL,
    "note" TEXT,
    "approved_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "subcontract_retention_releases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subcontract_payments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "subcontract_id" UUID NOT NULL,
    "kind" "subcontract_payment_kind" NOT NULL,
    "bill_id" UUID,
    "retention_release_id" UUID,
    "amount" BIGINT NOT NULL,
    "paid_on" DATE NOT NULL,
    "mode" "payment_mode" NOT NULL DEFAULT 'bank',
    "reference" TEXT,
    "note" TEXT,
    "recorded_by" UUID NOT NULL,
    "client_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "subcontract_payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subcontract_documents" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "subcontract_id" UUID NOT NULL,
    "document_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "subcontract_documents_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "subcontracts_tenant_id_project_id_idx" ON "subcontracts"("tenant_id", "project_id");

-- CreateIndex
CREATE INDEX "subcontracts_contractor_id_idx" ON "subcontracts"("contractor_id");

-- CreateIndex
CREATE UNIQUE INDEX "subcontracts_tenant_id_number_key" ON "subcontracts"("tenant_id", "number");

-- CreateIndex
CREATE INDEX "subcontract_lines_tenant_id_idx" ON "subcontract_lines"("tenant_id");

-- CreateIndex
CREATE INDEX "subcontract_lines_subcontract_id_sort_order_idx" ON "subcontract_lines"("subcontract_id", "sort_order");

-- CreateIndex
CREATE INDEX "subcontract_lines_cost_code_id_idx" ON "subcontract_lines"("cost_code_id");

-- CreateIndex
CREATE INDEX "subcontract_variations_tenant_id_idx" ON "subcontract_variations"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "subcontract_variations_subcontract_id_number_key" ON "subcontract_variations"("subcontract_id", "number");

-- CreateIndex
CREATE INDEX "subcontract_bills_tenant_id_status_idx" ON "subcontract_bills"("tenant_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "subcontract_bills_subcontract_id_number_key" ON "subcontract_bills"("subcontract_id", "number");

-- CreateIndex
CREATE INDEX "subcontract_bill_lines_tenant_id_idx" ON "subcontract_bill_lines"("tenant_id");

-- CreateIndex
CREATE INDEX "subcontract_bill_lines_line_id_idx" ON "subcontract_bill_lines"("line_id");

-- CreateIndex
CREATE UNIQUE INDEX "subcontract_bill_lines_bill_id_line_id_key" ON "subcontract_bill_lines"("bill_id", "line_id");

-- CreateIndex
CREATE INDEX "subcontract_deductions_tenant_id_idx" ON "subcontract_deductions"("tenant_id");

-- CreateIndex
CREATE INDEX "subcontract_deductions_bill_id_idx" ON "subcontract_deductions"("bill_id");

-- CreateIndex
CREATE INDEX "subcontract_deductions_cost_code_id_idx" ON "subcontract_deductions"("cost_code_id");

-- CreateIndex
CREATE INDEX "subcontract_retention_releases_tenant_id_idx" ON "subcontract_retention_releases"("tenant_id");

-- CreateIndex
CREATE INDEX "subcontract_retention_releases_subcontract_id_idx" ON "subcontract_retention_releases"("subcontract_id");

-- CreateIndex
CREATE INDEX "subcontract_payments_tenant_id_idx" ON "subcontract_payments"("tenant_id");

-- CreateIndex
CREATE INDEX "subcontract_payments_subcontract_id_paid_on_idx" ON "subcontract_payments"("subcontract_id", "paid_on");

-- CreateIndex
CREATE INDEX "subcontract_payments_bill_id_idx" ON "subcontract_payments"("bill_id");

-- CreateIndex
CREATE UNIQUE INDEX "subcontract_payments_tenant_id_client_id_key" ON "subcontract_payments"("tenant_id", "client_id");

-- CreateIndex
CREATE INDEX "subcontract_documents_tenant_id_idx" ON "subcontract_documents"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "subcontract_documents_subcontract_id_document_id_key" ON "subcontract_documents"("subcontract_id", "document_id");

-- AddForeignKey
ALTER TABLE "subcontracts" ADD CONSTRAINT "subcontracts_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subcontracts" ADD CONSTRAINT "subcontracts_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subcontracts" ADD CONSTRAINT "subcontracts_contractor_id_fkey" FOREIGN KEY ("contractor_id") REFERENCES "contractors"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subcontract_lines" ADD CONSTRAINT "subcontract_lines_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subcontract_lines" ADD CONSTRAINT "subcontract_lines_subcontract_id_fkey" FOREIGN KEY ("subcontract_id") REFERENCES "subcontracts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subcontract_lines" ADD CONSTRAINT "subcontract_lines_variation_id_fkey" FOREIGN KEY ("variation_id") REFERENCES "subcontract_variations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subcontract_lines" ADD CONSTRAINT "subcontract_lines_cost_code_id_fkey" FOREIGN KEY ("cost_code_id") REFERENCES "cost_codes"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subcontract_variations" ADD CONSTRAINT "subcontract_variations_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subcontract_variations" ADD CONSTRAINT "subcontract_variations_subcontract_id_fkey" FOREIGN KEY ("subcontract_id") REFERENCES "subcontracts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subcontract_bills" ADD CONSTRAINT "subcontract_bills_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subcontract_bills" ADD CONSTRAINT "subcontract_bills_subcontract_id_fkey" FOREIGN KEY ("subcontract_id") REFERENCES "subcontracts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subcontract_bill_lines" ADD CONSTRAINT "subcontract_bill_lines_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subcontract_bill_lines" ADD CONSTRAINT "subcontract_bill_lines_bill_id_fkey" FOREIGN KEY ("bill_id") REFERENCES "subcontract_bills"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subcontract_bill_lines" ADD CONSTRAINT "subcontract_bill_lines_line_id_fkey" FOREIGN KEY ("line_id") REFERENCES "subcontract_lines"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subcontract_deductions" ADD CONSTRAINT "subcontract_deductions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subcontract_deductions" ADD CONSTRAINT "subcontract_deductions_bill_id_fkey" FOREIGN KEY ("bill_id") REFERENCES "subcontract_bills"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subcontract_deductions" ADD CONSTRAINT "subcontract_deductions_cost_code_id_fkey" FOREIGN KEY ("cost_code_id") REFERENCES "cost_codes"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subcontract_deductions" ADD CONSTRAINT "subcontract_deductions_expense_id_fkey" FOREIGN KEY ("expense_id") REFERENCES "expenses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subcontract_deductions" ADD CONSTRAINT "subcontract_deductions_stock_movement_id_fkey" FOREIGN KEY ("stock_movement_id") REFERENCES "stock_movements"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subcontract_retention_releases" ADD CONSTRAINT "subcontract_retention_releases_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subcontract_retention_releases" ADD CONSTRAINT "subcontract_retention_releases_subcontract_id_fkey" FOREIGN KEY ("subcontract_id") REFERENCES "subcontracts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subcontract_payments" ADD CONSTRAINT "subcontract_payments_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subcontract_payments" ADD CONSTRAINT "subcontract_payments_subcontract_id_fkey" FOREIGN KEY ("subcontract_id") REFERENCES "subcontracts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subcontract_payments" ADD CONSTRAINT "subcontract_payments_bill_id_fkey" FOREIGN KEY ("bill_id") REFERENCES "subcontract_bills"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subcontract_payments" ADD CONSTRAINT "subcontract_payments_retention_release_id_fkey" FOREIGN KEY ("retention_release_id") REFERENCES "subcontract_retention_releases"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subcontract_documents" ADD CONSTRAINT "subcontract_documents_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subcontract_documents" ADD CONSTRAINT "subcontract_documents_subcontract_id_fkey" FOREIGN KEY ("subcontract_id") REFERENCES "subcontracts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subcontract_documents" ADD CONSTRAINT "subcontract_documents_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- --------------------------------------------------------------------------
-- Money that cannot go negative, and percentages that stay percentages
-- --------------------------------------------------------------------------
-- The service checks all of these first and says why; the database is the backstop for a bug.
ALTER TABLE "subcontracts"
  ADD CONSTRAINT "subcontracts_retention_bp_range" CHECK ("retention_bp" BETWEEN 0 AND 10000),
  ADD CONSTRAINT "subcontracts_release_bp_range" CHECK ("retention_release_at_completion_bp" BETWEEN 0 AND 10000),
  ADD CONSTRAINT "subcontracts_recovery_bp_range" CHECK ("advance_recovery_bp" BETWEEN 0 AND 10000),
  ADD CONSTRAINT "subcontracts_tax_bp_range" CHECK ("tax_rate_bp" BETWEEN 0 AND 10000),
  ADD CONSTRAINT "subcontracts_advance_not_negative" CHECK ("advance_amount" >= 0),
  ADD CONSTRAINT "subcontracts_dates_in_order" CHECK ("start_date" IS NULL OR "end_date" IS NULL OR "start_date" <= "end_date");

ALTER TABLE "subcontract_lines"
  ADD CONSTRAINT "subcontract_lines_quantity_positive" CHECK ("quantity" > 0),
  ADD CONSTRAINT "subcontract_lines_rate_not_negative" CHECK ("rate" >= 0),
  ADD CONSTRAINT "subcontract_lines_amount_not_negative" CHECK ("amount" >= 0);

ALTER TABLE "subcontract_bill_lines"
  ADD CONSTRAINT "subcontract_bill_lines_claimed_not_negative" CHECK ("claimed_quantity" >= 0),
  ADD CONSTRAINT "subcontract_bill_lines_certified_within_claim"
    CHECK ("certified_quantity" IS NULL OR ("certified_quantity" >= 0 AND "certified_quantity" <= "claimed_quantity"));

ALTER TABLE "subcontract_deductions"
  ADD CONSTRAINT "subcontract_deductions_amount_positive" CHECK ("amount" > 0);

ALTER TABLE "subcontract_retention_releases"
  ADD CONSTRAINT "subcontract_retention_releases_amount_positive" CHECK ("amount" > 0);

-- A payment is for exactly the thing its kind says.
ALTER TABLE "subcontract_payments"
  ADD CONSTRAINT "subcontract_payments_amount_positive" CHECK ("amount" > 0),
  ADD CONSTRAINT "subcontract_payments_kind_matches" CHECK (
    ("kind" = 'bill' AND "bill_id" IS NOT NULL AND "retention_release_id" IS NULL)
    OR ("kind" = 'retention' AND "retention_release_id" IS NOT NULL AND "bill_id" IS NULL)
    OR ("kind" = 'advance' AND "bill_id" IS NULL AND "retention_release_id" IS NULL)
  );

-- --------------------------------------------------------------------------
-- Every new table is tenant data: the same isolation policy as the rest.
-- --------------------------------------------------------------------------
ALTER TABLE "subcontracts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "subcontracts" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "subcontracts"
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

ALTER TABLE "subcontract_lines" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "subcontract_lines" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "subcontract_lines"
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

ALTER TABLE "subcontract_variations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "subcontract_variations" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "subcontract_variations"
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

ALTER TABLE "subcontract_bills" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "subcontract_bills" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "subcontract_bills"
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

ALTER TABLE "subcontract_bill_lines" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "subcontract_bill_lines" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "subcontract_bill_lines"
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

ALTER TABLE "subcontract_deductions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "subcontract_deductions" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "subcontract_deductions"
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

ALTER TABLE "subcontract_retention_releases" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "subcontract_retention_releases" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "subcontract_retention_releases"
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

ALTER TABLE "subcontract_payments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "subcontract_payments" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "subcontract_payments"
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

ALTER TABLE "subcontract_documents" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "subcontract_documents" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "subcontract_documents"
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- The platform console's role reads and repairs tenant data across companies, as for every other
-- tenant table; skipped where that role does not exist (a developer's database).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sitebook_admin') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON
      "subcontracts",
      "subcontract_lines",
      "subcontract_variations",
      "subcontract_bills",
      "subcontract_bill_lines",
      "subcontract_deductions",
      "subcontract_retention_releases",
      "subcontract_payments",
      "subcontract_documents"
    TO sitebook_admin;
  END IF;
END $$;

-- --------------------------------------------------------------------------
-- The new permissions on the built-in roles
-- --------------------------------------------------------------------------
--
-- System roles read their preset from code at request time, so this is the stored column catching
-- up rather than the source of truth. FORCE is lifted for the updates: migrations run as
-- `sitebook_app`, which is NOBYPASSRLS, and with no tenant context set the policy matches nothing.
ALTER TABLE "roles" NO FORCE ROW LEVEL SECURITY;

UPDATE "roles" SET permissions = permissions || ARRAY[
    'subcontracts.view', 'subcontracts.manage', 'subcontracts.measure', 'subcontracts.certify',
    'subcontracts.pay'
  ]
  WHERE is_system = true AND base_role = 'owner';

UPDATE "roles" SET permissions = permissions || ARRAY[
    'subcontracts.view', 'subcontracts.manage', 'subcontracts.measure', 'subcontracts.certify'
  ]
  WHERE is_system = true AND base_role = 'project_manager';

UPDATE "roles" SET permissions = permissions || ARRAY['subcontracts.measure']
  WHERE is_system = true AND base_role = 'site_supervisor';

UPDATE "roles" SET permissions = permissions || ARRAY['subcontracts.view', 'subcontracts.pay']
  WHERE is_system = true AND base_role = 'accounts';

ALTER TABLE "roles" FORCE ROW LEVEL SECURITY;

-- --------------------------------------------------------------------------
-- The audit log
-- --------------------------------------------------------------------------
-- Rates, certified quantities, retention and payments are exactly what gets disputed with a
-- subcontractor a year later; every change to them is recorded with who made it.
SELECT audit_attach('subcontracts');
SELECT audit_attach('subcontract_lines');
SELECT audit_attach('subcontract_variations');
SELECT audit_attach('subcontract_bills');
SELECT audit_attach('subcontract_bill_lines');
SELECT audit_attach('subcontract_deductions');
SELECT audit_attach('subcontract_retention_releases');
SELECT audit_attach('subcontract_payments');
SELECT audit_attach('subcontract_documents');
