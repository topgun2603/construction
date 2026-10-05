-- Change orders (roadmap Phase 2, module 4): variations to the client's contract with their cost,
-- price and time impact; the client's answer through the existing portal approvals; and, on a yes,
-- the cost codes' budgets, the site's handover date and its contract value moved — each recorded as
-- a revision row so the original figures can always be read back. Plus the scope-creep catcher's
-- suggestions, raised from daily reports and site messages that read like extra work.
-- RLS in the same migration as the tables (spec §17).
--
-- Cost codes are referenced NO ACTION rather than RESTRICT, for the reason given in
-- 20261007000500_subcontracts: deleting a whole company cascades to its cost codes and to these
-- lines in one statement, and RESTRICT would trip over a line that is itself about to go.

-- CreateEnum
CREATE TYPE "change_order_status" AS ENUM ('draft', 'submitted', 'sent', 'approved', 'rejected', 'implemented', 'cancelled');

-- CreateEnum
CREATE TYPE "change_order_reason" AS ENUM ('client_request', 'design_change', 'site_condition', 'error_omission');

-- CreateEnum
CREATE TYPE "change_order_suggestion_status" AS ENUM ('open', 'dismissed', 'converted');

-- CreateEnum
CREATE TYPE "change_order_source_kind" AS ENUM ('daily_report', 'site_message');

-- AlterTable
ALTER TABLE "projects" ADD COLUMN     "contract_value" BIGINT;

-- CreateTable
CREATE TABLE "change_orders" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "number" INTEGER NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "reason" "change_order_reason" NOT NULL,
    "status" "change_order_status" NOT NULL DEFAULT 'draft',
    "raised_by" UUID NOT NULL,
    "raised_on" DATE NOT NULL,
    "markup_bp" INTEGER NOT NULL DEFAULT 0,
    "entered_price" BIGINT,
    "tax_rate_bp" INTEGER NOT NULL DEFAULT 0,
    "cost_impact" BIGINT NOT NULL DEFAULT 0,
    "client_price" BIGINT NOT NULL DEFAULT 0,
    "tax_amount" BIGINT NOT NULL DEFAULT 0,
    "client_total" BIGINT NOT NULL DEFAULT 0,
    "time_impact_days" INTEGER NOT NULL DEFAULT 0,
    "submitted_by" UUID,
    "submitted_at" TIMESTAMPTZ(6),
    "approved_by" UUID,
    "approved_at" TIMESTAMPTZ(6),
    "review_note" TEXT,
    "sent_at" TIMESTAMPTZ(6),
    "approval_id" UUID,
    "client_decided_by" UUID,
    "client_decided_at" TIMESTAMPTZ(6),
    "client_note" TEXT,
    "applied_at" TIMESTAMPTZ(6),
    "implemented_by" UUID,
    "implemented_at" TIMESTAMPTZ(6),
    "cancelled_by" UUID,
    "cancelled_at" TIMESTAMPTZ(6),
    "cancel_reason" TEXT,
    "client_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "change_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "change_order_lines" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "change_order_id" UUID NOT NULL,
    "cost_code_id" UUID,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "description" TEXT NOT NULL,
    "unit" TEXT,
    "quantity" DECIMAL(14,3),
    "rate" BIGINT,
    "amount" BIGINT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "change_order_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "change_order_attachments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "change_order_id" UUID NOT NULL,
    "document_id" UUID,
    "s3_key" TEXT,
    "content_type" TEXT,
    "caption" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "change_order_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "change_order_budget_revisions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "change_order_id" UUID NOT NULL,
    "cost_code_id" UUID NOT NULL,
    "requested" BIGINT NOT NULL,
    "amount" BIGINT NOT NULL,
    "budget_before" BIGINT NOT NULL,
    "budget_after" BIGINT NOT NULL,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "change_order_budget_revisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "change_order_site_revisions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "change_order_id" UUID NOT NULL,
    "time_impact_days" INTEGER NOT NULL,
    "handover_before" DATE,
    "handover_after" DATE,
    "contract_before" BIGINT,
    "contract_after" BIGINT,
    "site_budget_before" BIGINT,
    "site_budget_after" BIGINT,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "change_order_site_revisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "change_order_suggestions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "source_kind" "change_order_source_kind" NOT NULL,
    "source_id" UUID NOT NULL,
    "excerpt" TEXT NOT NULL,
    "matched" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "detected_by" TEXT NOT NULL DEFAULT 'rules',
    "summary" TEXT,
    "status" "change_order_suggestion_status" NOT NULL DEFAULT 'open',
    "change_order_id" UUID,
    "decided_by" UUID,
    "decided_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "change_order_suggestions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "change_orders_approval_id_key" ON "change_orders"("approval_id");

-- CreateIndex
CREATE INDEX "change_orders_tenant_id_status_idx" ON "change_orders"("tenant_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "change_orders_project_id_number_key" ON "change_orders"("project_id", "number");

-- CreateIndex
CREATE UNIQUE INDEX "change_orders_tenant_id_client_id_key" ON "change_orders"("tenant_id", "client_id");

-- CreateIndex
CREATE INDEX "change_order_lines_tenant_id_idx" ON "change_order_lines"("tenant_id");

-- CreateIndex
CREATE INDEX "change_order_lines_change_order_id_sort_order_idx" ON "change_order_lines"("change_order_id", "sort_order");

-- CreateIndex
CREATE INDEX "change_order_lines_cost_code_id_idx" ON "change_order_lines"("cost_code_id");

-- CreateIndex
CREATE INDEX "change_order_attachments_tenant_id_idx" ON "change_order_attachments"("tenant_id");

-- CreateIndex
CREATE INDEX "change_order_attachments_change_order_id_idx" ON "change_order_attachments"("change_order_id");

-- CreateIndex
CREATE INDEX "change_order_attachments_document_id_idx" ON "change_order_attachments"("document_id");

-- CreateIndex
CREATE INDEX "change_order_budget_revisions_tenant_id_idx" ON "change_order_budget_revisions"("tenant_id");

-- CreateIndex
CREATE INDEX "change_order_budget_revisions_project_id_cost_code_id_idx" ON "change_order_budget_revisions"("project_id", "cost_code_id");

-- CreateIndex
CREATE INDEX "change_order_budget_revisions_change_order_id_idx" ON "change_order_budget_revisions"("change_order_id");

-- CreateIndex
CREATE INDEX "change_order_budget_revisions_cost_code_id_idx" ON "change_order_budget_revisions"("cost_code_id");

-- CreateIndex
CREATE UNIQUE INDEX "change_order_site_revisions_change_order_id_key" ON "change_order_site_revisions"("change_order_id");

-- CreateIndex
CREATE INDEX "change_order_site_revisions_tenant_id_idx" ON "change_order_site_revisions"("tenant_id");

-- CreateIndex
CREATE INDEX "change_order_site_revisions_project_id_created_at_idx" ON "change_order_site_revisions"("project_id", "created_at");

-- CreateIndex
CREATE INDEX "change_order_suggestions_tenant_id_status_idx" ON "change_order_suggestions"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "change_order_suggestions_project_id_status_idx" ON "change_order_suggestions"("project_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "change_order_suggestions_source_kind_source_id_key" ON "change_order_suggestions"("source_kind", "source_id");

-- AddForeignKey
ALTER TABLE "change_orders" ADD CONSTRAINT "change_orders_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "change_orders" ADD CONSTRAINT "change_orders_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "change_orders" ADD CONSTRAINT "change_orders_approval_id_fkey" FOREIGN KEY ("approval_id") REFERENCES "approvals"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "change_order_lines" ADD CONSTRAINT "change_order_lines_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "change_order_lines" ADD CONSTRAINT "change_order_lines_change_order_id_fkey" FOREIGN KEY ("change_order_id") REFERENCES "change_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "change_order_lines" ADD CONSTRAINT "change_order_lines_cost_code_id_fkey" FOREIGN KEY ("cost_code_id") REFERENCES "cost_codes"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "change_order_attachments" ADD CONSTRAINT "change_order_attachments_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "change_order_attachments" ADD CONSTRAINT "change_order_attachments_change_order_id_fkey" FOREIGN KEY ("change_order_id") REFERENCES "change_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "change_order_attachments" ADD CONSTRAINT "change_order_attachments_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "change_order_budget_revisions" ADD CONSTRAINT "change_order_budget_revisions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "change_order_budget_revisions" ADD CONSTRAINT "change_order_budget_revisions_change_order_id_fkey" FOREIGN KEY ("change_order_id") REFERENCES "change_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "change_order_budget_revisions" ADD CONSTRAINT "change_order_budget_revisions_cost_code_id_fkey" FOREIGN KEY ("cost_code_id") REFERENCES "cost_codes"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "change_order_site_revisions" ADD CONSTRAINT "change_order_site_revisions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "change_order_site_revisions" ADD CONSTRAINT "change_order_site_revisions_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "change_order_site_revisions" ADD CONSTRAINT "change_order_site_revisions_change_order_id_fkey" FOREIGN KEY ("change_order_id") REFERENCES "change_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "change_order_suggestions" ADD CONSTRAINT "change_order_suggestions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "change_order_suggestions" ADD CONSTRAINT "change_order_suggestions_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "change_order_suggestions" ADD CONSTRAINT "change_order_suggestions_change_order_id_fkey" FOREIGN KEY ("change_order_id") REFERENCES "change_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- --------------------------------------------------------------------------
-- Figures that must make sense
-- --------------------------------------------------------------------------
-- The service checks all of these first and says why; the database is the backstop for a bug.
ALTER TABLE "change_orders"
  ADD CONSTRAINT "change_orders_number_positive" CHECK ("number" > 0),
  ADD CONSTRAINT "change_orders_revision_not_negative" CHECK ("revision" >= 0),
  ADD CONSTRAINT "change_orders_markup_bp_range" CHECK ("markup_bp" BETWEEN 0 AND 100000),
  ADD CONSTRAINT "change_orders_tax_bp_range" CHECK ("tax_rate_bp" BETWEEN 0 AND 10000),
  ADD CONSTRAINT "change_orders_total_adds_up" CHECK ("client_total" = "client_price" + "tax_amount"),
  -- Applied exactly when the client said yes: an approved change order that moved nothing, or a
  -- pending one that already moved budgets, is a register that cannot be trusted.
  ADD CONSTRAINT "change_orders_applied_when_agreed" CHECK (
    ("applied_at" IS NOT NULL) = ("status" IN ('approved', 'implemented'))
  );

ALTER TABLE "change_order_lines"
  ADD CONSTRAINT "change_order_lines_rate_not_negative" CHECK ("rate" IS NULL OR "rate" >= 0),
  -- Measured (quantity and rate) or a lump sum (neither).
  ADD CONSTRAINT "change_order_lines_measured_or_lump" CHECK (("quantity" IS NULL) = ("rate" IS NULL));

ALTER TABLE "change_order_attachments"
  ADD CONSTRAINT "change_order_attachments_one_source" CHECK (("document_id" IS NULL) <> ("s3_key" IS NULL));

ALTER TABLE "change_order_budget_revisions"
  ADD CONSTRAINT "change_order_budget_revisions_adds_up" CHECK ("budget_after" = "budget_before" + "amount"),
  ADD CONSTRAINT "change_order_budget_revisions_not_negative" CHECK ("budget_after" >= 0);

ALTER TABLE "projects"
  ADD CONSTRAINT "projects_contract_value_not_negative" CHECK ("contract_value" IS NULL OR "contract_value" >= 0);

-- --------------------------------------------------------------------------
-- Every new table is tenant data: the same isolation policy as the rest.
-- --------------------------------------------------------------------------
ALTER TABLE "change_orders" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "change_orders" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "change_orders"
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

ALTER TABLE "change_order_lines" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "change_order_lines" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "change_order_lines"
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

ALTER TABLE "change_order_attachments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "change_order_attachments" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "change_order_attachments"
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

ALTER TABLE "change_order_budget_revisions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "change_order_budget_revisions" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "change_order_budget_revisions"
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

ALTER TABLE "change_order_site_revisions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "change_order_site_revisions" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "change_order_site_revisions"
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

ALTER TABLE "change_order_suggestions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "change_order_suggestions" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "change_order_suggestions"
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- The platform console's role reads and repairs tenant data across companies, as for every other
-- tenant table; skipped where that role does not exist (a developer's database).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sitebook_admin') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON
      "change_orders",
      "change_order_lines",
      "change_order_attachments",
      "change_order_budget_revisions",
      "change_order_site_revisions",
      "change_order_suggestions"
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
    'change_orders.view', 'change_orders.manage', 'change_orders.approve'
  ]
  WHERE is_system = true AND base_role IN ('owner', 'project_manager');

UPDATE "roles" SET permissions = permissions || ARRAY['change_orders.view']
  WHERE is_system = true AND base_role = 'accounts';

ALTER TABLE "roles" FORCE ROW LEVEL SECURITY;

-- --------------------------------------------------------------------------
-- The audit log
-- --------------------------------------------------------------------------
-- A change order is the argument about money a builder most often has with a client; who priced
-- it, who approved it, and which budget it moved by how much is exactly what gets asked later.
SELECT audit_attach('change_orders');
SELECT audit_attach('change_order_lines');
SELECT audit_attach('change_order_attachments');
SELECT audit_attach('change_order_budget_revisions');
SELECT audit_attach('change_order_site_revisions');
SELECT audit_attach('change_order_suggestions');
