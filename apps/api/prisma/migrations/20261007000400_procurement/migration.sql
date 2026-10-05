-- Procurement (roadmap Phase 2, module 2): suppliers, requests for quotation and the quotes that
-- answer them, purchase orders with approval limits, goods received against an order (posting to
-- the stock ledger), and supplier invoices matched three ways before they become expenses.
-- RLS and the audit trail in the same migration as the tables (spec §17).

-- CreateEnum
CREATE TYPE "purchase_order_status" AS ENUM ('draft', 'pending_approval', 'approved', 'sent', 'partially_received', 'received', 'closed', 'cancelled');

-- CreateEnum
CREATE TYPE "rfq_status" AS ENUM ('open', 'awarded', 'cancelled');

-- CreateEnum
CREATE TYPE "purchase_invoice_status" AS ENUM ('matched', 'mismatch', 'approved', 'rejected');

-- AlterTable
ALTER TABLE "tenants" ADD COLUMN     "invoice_match_tolerance_bp" INTEGER NOT NULL DEFAULT 200;

-- CreateTable
CREATE TABLE "vendors" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "contact_name" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "address" TEXT,
    "tax_id" TEXT,
    "payment_terms_days" INTEGER,
    "notes" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "vendors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_approval_limits" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "role_id" UUID,
    "user_id" UUID,
    "max_amount" BIGINT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "purchase_approval_limits_pkey" PRIMARY KEY ("id"),
    -- A limit is for a role or for a person, never both and never neither.
    CONSTRAINT "purchase_approval_limits_one_subject" CHECK (("role_id" IS NULL) <> ("user_id" IS NULL)),
    CONSTRAINT "purchase_approval_limits_not_negative" CHECK ("max_amount" IS NULL OR "max_amount" >= 0)
);

-- CreateTable
CREATE TABLE "purchase_rfqs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "notes" TEXT,
    "status" "rfq_status" NOT NULL DEFAULT 'open',
    "indent_id" UUID,
    "required_by" DATE,
    "created_by" UUID NOT NULL,
    "awarded_quote_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "purchase_rfqs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_rfq_items" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "rfq_id" UUID NOT NULL,
    "material_id" UUID,
    "description" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "quantity" DECIMAL(14,3) NOT NULL,
    "cost_code_id" UUID,
    "position" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "purchase_rfq_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_quotes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "rfq_id" UUID NOT NULL,
    "vendor_id" UUID NOT NULL,
    "delivery_days" INTEGER,
    "valid_until" DATE,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "purchase_quotes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_quote_lines" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "quote_id" UUID NOT NULL,
    "rfq_item_id" UUID NOT NULL,
    "unit_rate" BIGINT NOT NULL,
    "tax_rate_bp" INTEGER NOT NULL,

    CONSTRAINT "purchase_quote_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_orders" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "vendor_id" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "status" "purchase_order_status" NOT NULL DEFAULT 'draft',
    "rfq_id" UUID,
    "indent_id" UUID,
    "notes" TEXT,
    "delivery_address" TEXT,
    "expected_on" DATE,
    "subtotal" BIGINT NOT NULL DEFAULT 0,
    "tax_total" BIGINT NOT NULL DEFAULT 0,
    "total" BIGINT NOT NULL DEFAULT 0,
    "created_by" UUID NOT NULL,
    "submitted_at" TIMESTAMPTZ(6),
    "approved_by" UUID,
    "approved_at" TIMESTAMPTZ(6),
    "decision_note" TEXT,
    "sent_at" TIMESTAMPTZ(6),
    "closed_at" TIMESTAMPTZ(6),
    "cancelled_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "purchase_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_order_lines" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "purchase_order_id" UUID NOT NULL,
    "material_id" UUID,
    "description" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "quantity" DECIMAL(14,3) NOT NULL,
    "unit_rate" BIGINT NOT NULL,
    "tax_rate_bp" INTEGER NOT NULL,
    "amount" BIGINT NOT NULL,
    "tax_amount" BIGINT NOT NULL,
    "cost_code_id" UUID,
    "received_quantity" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "position" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "purchase_order_lines_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "purchase_order_lines_quantity_positive" CHECK ("quantity" > 0),
    CONSTRAINT "purchase_order_lines_money_not_negative" CHECK ("unit_rate" >= 0 AND "amount" >= 0 AND "tax_amount" >= 0),
    CONSTRAINT "purchase_order_lines_received_not_negative" CHECK ("received_quantity" >= 0)
);

-- CreateTable
CREATE TABLE "goods_receipts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "purchase_order_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "received_on" DATE NOT NULL,
    "ref" TEXT,
    "note" TEXT,
    "received_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "goods_receipts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "goods_receipt_lines" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "receipt_id" UUID NOT NULL,
    "purchase_order_line_id" UUID NOT NULL,
    "quantity" DECIMAL(14,3) NOT NULL,
    "stock_movement_id" UUID,

    CONSTRAINT "goods_receipt_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_invoices" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "purchase_order_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "vendor_id" UUID NOT NULL,
    "invoice_number" TEXT NOT NULL,
    "invoice_date" DATE NOT NULL,
    "due_date" DATE,
    "subtotal" BIGINT NOT NULL,
    "tax_total" BIGINT NOT NULL,
    "total" BIGINT NOT NULL,
    "attachment_s3_key" TEXT,
    "status" "purchase_invoice_status" NOT NULL,
    "flags" JSONB NOT NULL DEFAULT '[]',
    "tolerance_bp" INTEGER NOT NULL,
    "note" TEXT,
    "recorded_by" UUID NOT NULL,
    "approved_by" UUID,
    "approved_at" TIMESTAMPTZ(6),
    "decision_note" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "purchase_invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_invoice_lines" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "invoice_id" UUID NOT NULL,
    "purchase_order_line_id" UUID NOT NULL,
    "quantity" DECIMAL(14,3) NOT NULL,
    "unit_rate" BIGINT NOT NULL,
    "amount" BIGINT NOT NULL,
    "tax_amount" BIGINT NOT NULL,
    "expense_id" UUID,

    CONSTRAINT "purchase_invoice_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "vendors_tenant_id_active_idx" ON "vendors"("tenant_id", "active");

-- CreateIndex
CREATE UNIQUE INDEX "vendors_tenant_id_name_key" ON "vendors"("tenant_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_approval_limits_tenant_id_role_id_key" ON "purchase_approval_limits"("tenant_id", "role_id");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_approval_limits_tenant_id_user_id_key" ON "purchase_approval_limits"("tenant_id", "user_id");

-- CreateIndex
CREATE INDEX "purchase_rfqs_tenant_id_status_idx" ON "purchase_rfqs"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "purchase_rfqs_project_id_idx" ON "purchase_rfqs"("project_id");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_rfqs_tenant_id_number_key" ON "purchase_rfqs"("tenant_id", "number");

-- CreateIndex
CREATE INDEX "purchase_rfq_items_rfq_id_idx" ON "purchase_rfq_items"("rfq_id");

-- CreateIndex
CREATE INDEX "purchase_rfq_items_tenant_id_idx" ON "purchase_rfq_items"("tenant_id");

-- CreateIndex
CREATE INDEX "purchase_quotes_tenant_id_idx" ON "purchase_quotes"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_quotes_rfq_id_vendor_id_key" ON "purchase_quotes"("rfq_id", "vendor_id");

-- CreateIndex
CREATE INDEX "purchase_quote_lines_tenant_id_idx" ON "purchase_quote_lines"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_quote_lines_quote_id_rfq_item_id_key" ON "purchase_quote_lines"("quote_id", "rfq_item_id");

-- CreateIndex
CREATE INDEX "purchase_orders_tenant_id_status_idx" ON "purchase_orders"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "purchase_orders_project_id_status_idx" ON "purchase_orders"("project_id", "status");

-- CreateIndex
CREATE INDEX "purchase_orders_vendor_id_idx" ON "purchase_orders"("vendor_id");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_orders_tenant_id_number_key" ON "purchase_orders"("tenant_id", "number");

-- CreateIndex
CREATE INDEX "purchase_order_lines_purchase_order_id_idx" ON "purchase_order_lines"("purchase_order_id");

-- CreateIndex
CREATE INDEX "purchase_order_lines_cost_code_id_idx" ON "purchase_order_lines"("cost_code_id");

-- CreateIndex
CREATE INDEX "purchase_order_lines_tenant_id_idx" ON "purchase_order_lines"("tenant_id");

-- CreateIndex
CREATE INDEX "goods_receipts_purchase_order_id_idx" ON "goods_receipts"("purchase_order_id");

-- CreateIndex
CREATE INDEX "goods_receipts_tenant_id_received_on_idx" ON "goods_receipts"("tenant_id", "received_on");

-- CreateIndex
CREATE UNIQUE INDEX "goods_receipt_lines_stock_movement_id_key" ON "goods_receipt_lines"("stock_movement_id");

-- CreateIndex
CREATE INDEX "goods_receipt_lines_receipt_id_idx" ON "goods_receipt_lines"("receipt_id");

-- CreateIndex
CREATE INDEX "goods_receipt_lines_purchase_order_line_id_idx" ON "goods_receipt_lines"("purchase_order_line_id");

-- CreateIndex
CREATE INDEX "goods_receipt_lines_tenant_id_idx" ON "goods_receipt_lines"("tenant_id");

-- CreateIndex
CREATE INDEX "purchase_invoices_tenant_id_status_idx" ON "purchase_invoices"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "purchase_invoices_purchase_order_id_idx" ON "purchase_invoices"("purchase_order_id");

-- CreateIndex
CREATE INDEX "purchase_invoices_project_id_idx" ON "purchase_invoices"("project_id");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_invoices_vendor_id_invoice_number_key" ON "purchase_invoices"("vendor_id", "invoice_number");

-- CreateIndex
CREATE INDEX "purchase_invoice_lines_invoice_id_idx" ON "purchase_invoice_lines"("invoice_id");

-- CreateIndex
CREATE INDEX "purchase_invoice_lines_purchase_order_line_id_idx" ON "purchase_invoice_lines"("purchase_order_line_id");

-- CreateIndex
CREATE INDEX "purchase_invoice_lines_expense_id_idx" ON "purchase_invoice_lines"("expense_id");

-- CreateIndex
CREATE INDEX "purchase_invoice_lines_tenant_id_idx" ON "purchase_invoice_lines"("tenant_id");

-- AddForeignKey
ALTER TABLE "vendors" ADD CONSTRAINT "vendors_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_approval_limits" ADD CONSTRAINT "purchase_approval_limits_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_approval_limits" ADD CONSTRAINT "purchase_approval_limits_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_approval_limits" ADD CONSTRAINT "purchase_approval_limits_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_rfqs" ADD CONSTRAINT "purchase_rfqs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_rfqs" ADD CONSTRAINT "purchase_rfqs_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_rfqs" ADD CONSTRAINT "purchase_rfqs_indent_id_fkey" FOREIGN KEY ("indent_id") REFERENCES "material_indents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_rfqs" ADD CONSTRAINT "purchase_rfqs_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_rfq_items" ADD CONSTRAINT "purchase_rfq_items_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_rfq_items" ADD CONSTRAINT "purchase_rfq_items_rfq_id_fkey" FOREIGN KEY ("rfq_id") REFERENCES "purchase_rfqs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_rfq_items" ADD CONSTRAINT "purchase_rfq_items_material_id_fkey" FOREIGN KEY ("material_id") REFERENCES "materials"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_rfq_items" ADD CONSTRAINT "purchase_rfq_items_cost_code_id_fkey" FOREIGN KEY ("cost_code_id") REFERENCES "cost_codes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_quotes" ADD CONSTRAINT "purchase_quotes_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_quotes" ADD CONSTRAINT "purchase_quotes_rfq_id_fkey" FOREIGN KEY ("rfq_id") REFERENCES "purchase_rfqs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_quotes" ADD CONSTRAINT "purchase_quotes_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "vendors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_quote_lines" ADD CONSTRAINT "purchase_quote_lines_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_quote_lines" ADD CONSTRAINT "purchase_quote_lines_quote_id_fkey" FOREIGN KEY ("quote_id") REFERENCES "purchase_quotes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_quote_lines" ADD CONSTRAINT "purchase_quote_lines_rfq_item_id_fkey" FOREIGN KEY ("rfq_item_id") REFERENCES "purchase_rfq_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "vendors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_rfq_id_fkey" FOREIGN KEY ("rfq_id") REFERENCES "purchase_rfqs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_indent_id_fkey" FOREIGN KEY ("indent_id") REFERENCES "material_indents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_approved_by_fkey" FOREIGN KEY ("approved_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_purchase_order_id_fkey" FOREIGN KEY ("purchase_order_id") REFERENCES "purchase_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_material_id_fkey" FOREIGN KEY ("material_id") REFERENCES "materials"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_cost_code_id_fkey" FOREIGN KEY ("cost_code_id") REFERENCES "cost_codes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_purchase_order_id_fkey" FOREIGN KEY ("purchase_order_id") REFERENCES "purchase_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_received_by_fkey" FOREIGN KEY ("received_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_receipt_lines" ADD CONSTRAINT "goods_receipt_lines_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_receipt_lines" ADD CONSTRAINT "goods_receipt_lines_receipt_id_fkey" FOREIGN KEY ("receipt_id") REFERENCES "goods_receipts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_receipt_lines" ADD CONSTRAINT "goods_receipt_lines_purchase_order_line_id_fkey" FOREIGN KEY ("purchase_order_line_id") REFERENCES "purchase_order_lines"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_receipt_lines" ADD CONSTRAINT "goods_receipt_lines_stock_movement_id_fkey" FOREIGN KEY ("stock_movement_id") REFERENCES "stock_movements"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_invoices" ADD CONSTRAINT "purchase_invoices_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_invoices" ADD CONSTRAINT "purchase_invoices_purchase_order_id_fkey" FOREIGN KEY ("purchase_order_id") REFERENCES "purchase_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_invoices" ADD CONSTRAINT "purchase_invoices_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_invoices" ADD CONSTRAINT "purchase_invoices_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "vendors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_invoices" ADD CONSTRAINT "purchase_invoices_recorded_by_fkey" FOREIGN KEY ("recorded_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_invoices" ADD CONSTRAINT "purchase_invoices_approved_by_fkey" FOREIGN KEY ("approved_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_invoice_lines" ADD CONSTRAINT "purchase_invoice_lines_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_invoice_lines" ADD CONSTRAINT "purchase_invoice_lines_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "purchase_invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_invoice_lines" ADD CONSTRAINT "purchase_invoice_lines_purchase_order_line_id_fkey" FOREIGN KEY ("purchase_order_line_id") REFERENCES "purchase_order_lines"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_invoice_lines" ADD CONSTRAINT "purchase_invoice_lines_expense_id_fkey" FOREIGN KEY ("expense_id") REFERENCES "expenses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- --------------------------------------------------------------------------
-- Tenant isolation: every new table is tenant data, under the same policy as the rest.
-- --------------------------------------------------------------------------

ALTER TABLE "vendors" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "vendors" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "vendors"
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

ALTER TABLE "purchase_approval_limits" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "purchase_approval_limits" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "purchase_approval_limits"
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

ALTER TABLE "purchase_rfqs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "purchase_rfqs" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "purchase_rfqs"
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

ALTER TABLE "purchase_rfq_items" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "purchase_rfq_items" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "purchase_rfq_items"
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

ALTER TABLE "purchase_quotes" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "purchase_quotes" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "purchase_quotes"
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

ALTER TABLE "purchase_quote_lines" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "purchase_quote_lines" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "purchase_quote_lines"
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

ALTER TABLE "purchase_orders" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "purchase_orders" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "purchase_orders"
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

ALTER TABLE "purchase_order_lines" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "purchase_order_lines" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "purchase_order_lines"
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

ALTER TABLE "goods_receipts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "goods_receipts" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "goods_receipts"
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

ALTER TABLE "goods_receipt_lines" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "goods_receipt_lines" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "goods_receipt_lines"
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

ALTER TABLE "purchase_invoices" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "purchase_invoices" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "purchase_invoices"
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

ALTER TABLE "purchase_invoice_lines" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "purchase_invoice_lines" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "purchase_invoice_lines"
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- The support console's role, where it exists (the same guarded grant as the stock tables).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sitebook_admin') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "vendors" TO sitebook_admin;
    GRANT SELECT, INSERT, UPDATE, DELETE ON "purchase_approval_limits" TO sitebook_admin;
    GRANT SELECT, INSERT, UPDATE, DELETE ON "purchase_rfqs" TO sitebook_admin;
    GRANT SELECT, INSERT, UPDATE, DELETE ON "purchase_rfq_items" TO sitebook_admin;
    GRANT SELECT, INSERT, UPDATE, DELETE ON "purchase_quotes" TO sitebook_admin;
    GRANT SELECT, INSERT, UPDATE, DELETE ON "purchase_quote_lines" TO sitebook_admin;
    GRANT SELECT, INSERT, UPDATE, DELETE ON "purchase_orders" TO sitebook_admin;
    GRANT SELECT, INSERT, UPDATE, DELETE ON "purchase_order_lines" TO sitebook_admin;
    GRANT SELECT, INSERT, UPDATE, DELETE ON "goods_receipts" TO sitebook_admin;
    GRANT SELECT, INSERT, UPDATE, DELETE ON "goods_receipt_lines" TO sitebook_admin;
    GRANT SELECT, INSERT, UPDATE, DELETE ON "purchase_invoices" TO sitebook_admin;
    GRANT SELECT, INSERT, UPDATE, DELETE ON "purchase_invoice_lines" TO sitebook_admin;
  END IF;
END $$;

-- --------------------------------------------------------------------------
-- The audit trail. Orders, approvals and invoices are exactly what somebody asks "who changed
-- this, and from what" about. Quote lines and receipt lines are attached too: a rate edited after
-- the comparison, or a delivery count changed after the fact, is the history worth having.
-- --------------------------------------------------------------------------
SELECT audit_attach('vendors');
SELECT audit_attach('purchase_approval_limits');
SELECT audit_attach('purchase_rfqs');
SELECT audit_attach('purchase_rfq_items');
SELECT audit_attach('purchase_quotes');
SELECT audit_attach('purchase_quote_lines');
SELECT audit_attach('purchase_orders');
SELECT audit_attach('purchase_order_lines');
SELECT audit_attach('goods_receipts');
SELECT audit_attach('goods_receipt_lines');
SELECT audit_attach('purchase_invoices');
SELECT audit_attach('purchase_invoice_lines');

-- --------------------------------------------------------------------------
-- The new permissions on the built-in roles
-- --------------------------------------------------------------------------
--
-- System roles read their preset from code at request time; this keeps the stored column in step
-- so it does not mislead anyone reading the table (see 20261007000100_cost_codes). FORCE is lifted
-- for the updates because migrations run NOBYPASSRLS with no tenant context.
ALTER TABLE "roles" NO FORCE ROW LEVEL SECURITY;

UPDATE "roles" SET permissions = permissions || ARRAY['vendors.manage', 'procurement.view', 'procurement.manage', 'procurement.approve', 'procurement.receive', 'procurement.invoices']
  WHERE is_system = true AND base_role = 'owner';

UPDATE "roles" SET permissions = permissions || ARRAY['vendors.manage', 'procurement.view', 'procurement.manage', 'procurement.approve', 'procurement.receive']
  WHERE is_system = true AND base_role = 'project_manager';

UPDATE "roles" SET permissions = permissions || ARRAY['procurement.receive']
  WHERE is_system = true AND base_role = 'site_supervisor';

UPDATE "roles" SET permissions = permissions || ARRAY['vendors.manage', 'procurement.view', 'procurement.invoices']
  WHERE is_system = true AND base_role = 'accounts';

ALTER TABLE "roles" FORCE ROW LEVEL SECURITY;
