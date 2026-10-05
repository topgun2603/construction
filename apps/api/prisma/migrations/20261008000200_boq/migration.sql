-- Bill of quantities (roadmap Phase 2, module 5): the client-side BOQ per site — sections and
-- priced items linked to cost codes, the measurement book, and running-account bills to the client
-- that become instalments in the existing payment schedule once invoiced.
-- RLS in the same migration as the tables (spec §17).
--
-- As with subcontracts, the foreign keys that must refuse a delete (an item with bills against it,
-- a cost code an item is priced against) are NO ACTION rather than RESTRICT, so deleting a whole
-- company — which cascades through all of them in one statement — is not tripped by a row that is
-- itself about to go.

-- CreateEnum
CREATE TYPE "boq_item_kind" AS ENUM ('section', 'item');

-- CreateEnum
CREATE TYPE "boq_bill_status" AS ENUM ('draft', 'submitted', 'certified', 'invoiced');

-- CreateTable
CREATE TABLE "boqs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "title" TEXT NOT NULL DEFAULT 'Bill of quantities',
    "retention_bp" INTEGER NOT NULL DEFAULT 0,
    "advance_amount" BIGINT NOT NULL DEFAULT 0,
    "advance_recovery_bp" INTEGER NOT NULL DEFAULT 0,
    "tax_rate_bp" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "boqs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "boq_items" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "boq_id" UUID NOT NULL,
    "parent_id" UUID,
    "cost_code_id" UUID,
    "kind" "boq_item_kind" NOT NULL DEFAULT 'item',
    "item_no" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "unit" TEXT,
    "quantity" DECIMAL(14,3),
    "rate" BIGINT,
    "amount" BIGINT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "boq_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "boq_measurements" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "item_id" UUID NOT NULL,
    "measured_on" DATE NOT NULL,
    "location" TEXT,
    "count" DECIMAL(14,3),
    "length" DECIMAL(14,3),
    "breadth" DECIMAL(14,3),
    "height" DECIMAL(14,3),
    "quantity" DECIMAL(14,3) NOT NULL,
    "note" TEXT,
    "photo_keys" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "measured_by" UUID NOT NULL,
    "client_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "boq_measurements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "boq_bills" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "boq_id" UUID NOT NULL,
    "number" INTEGER NOT NULL,
    "period_from" DATE,
    "period_to" DATE NOT NULL,
    "bill_date" DATE NOT NULL,
    "status" "boq_bill_status" NOT NULL DEFAULT 'draft',
    "claimed_gross" BIGINT NOT NULL DEFAULT 0,
    "gross_to_date" BIGINT NOT NULL DEFAULT 0,
    "previous_gross" BIGINT NOT NULL DEFAULT 0,
    "gross" BIGINT NOT NULL DEFAULT 0,
    "retention_to_date" BIGINT NOT NULL DEFAULT 0,
    "retention" BIGINT NOT NULL DEFAULT 0,
    "advance_recovered_to_date" BIGINT NOT NULL DEFAULT 0,
    "advance_recovery" BIGINT NOT NULL DEFAULT 0,
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
    "invoiced_by" UUID,
    "invoiced_at" TIMESTAMPTZ(6),
    "payment_stage_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "boq_bills_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "boq_bill_lines" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "bill_id" UUID NOT NULL,
    "item_id" UUID NOT NULL,
    "claimed_quantity" DECIMAL(14,3) NOT NULL,
    "certified_quantity" DECIMAL(14,3),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "boq_bill_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "boqs_project_id_key" ON "boqs"("project_id");

-- CreateIndex
CREATE INDEX "boqs_tenant_id_idx" ON "boqs"("tenant_id");

-- CreateIndex
CREATE INDEX "boq_items_tenant_id_idx" ON "boq_items"("tenant_id");

-- CreateIndex
CREATE INDEX "boq_items_boq_id_sort_order_idx" ON "boq_items"("boq_id", "sort_order");

-- CreateIndex
CREATE INDEX "boq_items_parent_id_idx" ON "boq_items"("parent_id");

-- CreateIndex
CREATE INDEX "boq_items_cost_code_id_idx" ON "boq_items"("cost_code_id");

-- CreateIndex
CREATE UNIQUE INDEX "boq_items_boq_id_item_no_key" ON "boq_items"("boq_id", "item_no");

-- CreateIndex
CREATE INDEX "boq_measurements_tenant_id_idx" ON "boq_measurements"("tenant_id");

-- CreateIndex
CREATE INDEX "boq_measurements_item_id_measured_on_idx" ON "boq_measurements"("item_id", "measured_on");

-- CreateIndex
CREATE UNIQUE INDEX "boq_measurements_tenant_id_client_id_key" ON "boq_measurements"("tenant_id", "client_id");

-- CreateIndex
CREATE UNIQUE INDEX "boq_bills_payment_stage_id_key" ON "boq_bills"("payment_stage_id");

-- CreateIndex
CREATE INDEX "boq_bills_tenant_id_status_idx" ON "boq_bills"("tenant_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "boq_bills_boq_id_number_key" ON "boq_bills"("boq_id", "number");

-- CreateIndex
CREATE INDEX "boq_bill_lines_tenant_id_idx" ON "boq_bill_lines"("tenant_id");

-- CreateIndex
CREATE INDEX "boq_bill_lines_item_id_idx" ON "boq_bill_lines"("item_id");

-- CreateIndex
CREATE UNIQUE INDEX "boq_bill_lines_bill_id_item_id_key" ON "boq_bill_lines"("bill_id", "item_id");

-- AddForeignKey
ALTER TABLE "boqs" ADD CONSTRAINT "boqs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "boqs" ADD CONSTRAINT "boqs_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "boq_items" ADD CONSTRAINT "boq_items_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "boq_items" ADD CONSTRAINT "boq_items_boq_id_fkey" FOREIGN KEY ("boq_id") REFERENCES "boqs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "boq_items" ADD CONSTRAINT "boq_items_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "boq_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "boq_items" ADD CONSTRAINT "boq_items_cost_code_id_fkey" FOREIGN KEY ("cost_code_id") REFERENCES "cost_codes"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "boq_measurements" ADD CONSTRAINT "boq_measurements_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "boq_measurements" ADD CONSTRAINT "boq_measurements_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "boq_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "boq_bills" ADD CONSTRAINT "boq_bills_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "boq_bills" ADD CONSTRAINT "boq_bills_boq_id_fkey" FOREIGN KEY ("boq_id") REFERENCES "boqs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "boq_bills" ADD CONSTRAINT "boq_bills_payment_stage_id_fkey" FOREIGN KEY ("payment_stage_id") REFERENCES "payment_stages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "boq_bill_lines" ADD CONSTRAINT "boq_bill_lines_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "boq_bill_lines" ADD CONSTRAINT "boq_bill_lines_bill_id_fkey" FOREIGN KEY ("bill_id") REFERENCES "boq_bills"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "boq_bill_lines" ADD CONSTRAINT "boq_bill_lines_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "boq_items"("id") ON DELETE NO ACTION ON UPDATE CASCADE;


-- --------------------------------------------------------------------------
-- Figures that cannot go negative, and percentages that stay percentages
-- --------------------------------------------------------------------------
-- The service checks all of these first and says why; the database is the backstop for a bug.
ALTER TABLE "boqs"
  ADD CONSTRAINT "boqs_retention_bp_range" CHECK ("retention_bp" BETWEEN 0 AND 10000),
  ADD CONSTRAINT "boqs_recovery_bp_range" CHECK ("advance_recovery_bp" BETWEEN 0 AND 10000),
  ADD CONSTRAINT "boqs_tax_bp_range" CHECK ("tax_rate_bp" BETWEEN 0 AND 10000),
  ADD CONSTRAINT "boqs_advance_not_negative" CHECK ("advance_amount" >= 0);

-- A section carries no figures; an item carries all of them.
ALTER TABLE "boq_items"
  ADD CONSTRAINT "boq_items_kind_figures" CHECK (
    ("kind" = 'section' AND "quantity" IS NULL AND "rate" IS NULL AND "amount" IS NULL)
    OR ("kind" = 'item' AND "unit" IS NOT NULL AND "quantity" > 0 AND "rate" >= 0 AND "amount" >= 0)
  ),
  ADD CONSTRAINT "boq_items_not_own_parent" CHECK ("parent_id" IS NULL OR "parent_id" <> "id");

ALTER TABLE "boq_measurements"
  ADD CONSTRAINT "boq_measurements_quantity_not_zero" CHECK ("quantity" <> 0);

ALTER TABLE "boq_bill_lines"
  ADD CONSTRAINT "boq_bill_lines_claimed_not_negative" CHECK ("claimed_quantity" >= 0),
  ADD CONSTRAINT "boq_bill_lines_certified_within_claim"
    CHECK ("certified_quantity" IS NULL OR ("certified_quantity" >= 0 AND "certified_quantity" <= "claimed_quantity"));

-- Invoiced means it was raised as an instalment, and only then; the period runs forwards.
ALTER TABLE "boq_bills"
  ADD CONSTRAINT "boq_bills_invoiced_stamped" CHECK (("status" = 'invoiced') = ("invoiced_at" IS NOT NULL)),
  ADD CONSTRAINT "boq_bills_period_in_order" CHECK ("period_from" IS NULL OR "period_from" <= "period_to");

-- --------------------------------------------------------------------------
-- Every new table is tenant data: the same isolation policy as the rest.
-- --------------------------------------------------------------------------
ALTER TABLE "boqs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "boqs" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "boqs"
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

ALTER TABLE "boq_items" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "boq_items" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "boq_items"
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

ALTER TABLE "boq_measurements" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "boq_measurements" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "boq_measurements"
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

ALTER TABLE "boq_bills" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "boq_bills" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "boq_bills"
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

ALTER TABLE "boq_bill_lines" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "boq_bill_lines" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "boq_bill_lines"
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- The platform console's role reads and repairs tenant data across companies, as for every other
-- tenant table; skipped where that role does not exist (a developer's database).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sitebook_admin') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON
      "boqs",
      "boq_items",
      "boq_measurements",
      "boq_bills",
      "boq_bill_lines"
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

UPDATE "roles" SET permissions = permissions || ARRAY['boq.view', 'boq.manage', 'boq.measure', 'boq.bill']
  WHERE is_system = true AND base_role IN ('owner', 'project_manager');

UPDATE "roles" SET permissions = permissions || ARRAY['boq.measure']
  WHERE is_system = true AND base_role = 'site_supervisor';

UPDATE "roles" SET permissions = permissions || ARRAY['boq.view', 'boq.bill']
  WHERE is_system = true AND base_role = 'accounts';

ALTER TABLE "roles" FORCE ROW LEVEL SECURITY;

-- --------------------------------------------------------------------------
-- The audit log
-- --------------------------------------------------------------------------
-- Rates, measured quantities and what the client certified are exactly what gets argued over at
-- final account; every change to them is recorded with who made it.
SELECT audit_attach('boqs');
SELECT audit_attach('boq_items');
SELECT audit_attach('boq_measurements');
SELECT audit_attach('boq_bills');
SELECT audit_attach('boq_bill_lines');
