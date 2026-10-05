-- Cost codes and budgets (roadmap Phase 2, module 1): a work breakdown per site with a budget per
-- line, the company's own template library, and expenses booked to a line.
-- RLS in the same migration as the tables (spec §17).

-- AlterTable
ALTER TABLE "expenses" ADD COLUMN     "cost_code_id" UUID;

-- CreateTable
CREATE TABLE "cost_codes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "parent_id" UUID,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "unit" TEXT,
    "budget" BIGINT NOT NULL DEFAULT 0,
    "labour_default" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "cost_codes_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "cost_codes_budget_not_negative" CHECK ("budget" >= 0),
    CONSTRAINT "cost_codes_not_own_parent" CHECK ("parent_id" IS NULL OR "parent_id" <> "id")
);

-- CreateTable
CREATE TABLE "cost_code_templates" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "cost_code_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cost_code_template_items" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "template_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "parent_code" TEXT,
    "unit" TEXT,

    CONSTRAINT "cost_code_template_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "cost_codes_tenant_id_idx" ON "cost_codes"("tenant_id");

-- CreateIndex
CREATE INDEX "cost_codes_parent_id_idx" ON "cost_codes"("parent_id");

-- CreateIndex
CREATE UNIQUE INDEX "cost_codes_project_id_code_key" ON "cost_codes"("project_id", "code");

-- CreateIndex
CREATE INDEX "cost_code_templates_tenant_id_idx" ON "cost_code_templates"("tenant_id");

-- CreateIndex
CREATE INDEX "cost_code_template_items_tenant_id_idx" ON "cost_code_template_items"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "cost_code_template_items_template_id_code_key" ON "cost_code_template_items"("template_id", "code");

-- CreateIndex
CREATE INDEX "expenses_cost_code_id_idx" ON "expenses"("cost_code_id");

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_cost_code_id_fkey" FOREIGN KEY ("cost_code_id") REFERENCES "cost_codes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cost_codes" ADD CONSTRAINT "cost_codes_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cost_codes" ADD CONSTRAINT "cost_codes_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cost_codes" ADD CONSTRAINT "cost_codes_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "cost_codes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cost_code_templates" ADD CONSTRAINT "cost_code_templates_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cost_code_template_items" ADD CONSTRAINT "cost_code_template_items_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cost_code_template_items" ADD CONSTRAINT "cost_code_template_items_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "cost_code_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Every new table is tenant data: the same isolation policy as the rest.
ALTER TABLE "cost_codes" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "cost_codes" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "cost_codes"
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

ALTER TABLE "cost_code_templates" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "cost_code_templates" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "cost_code_templates"
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

ALTER TABLE "cost_code_template_items" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "cost_code_template_items" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "cost_code_template_items"
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- --------------------------------------------------------------------------
-- The new permissions on the built-in roles
-- --------------------------------------------------------------------------
--
-- System roles read their preset from code at request time, so this is the stored column catching
-- up rather than the source of truth — but a column that disagrees with the code is a trap for the
-- next person reading the table. FORCE is lifted for the updates: migrations run as `sitebook_app`,
-- which is NOBYPASSRLS, and with no tenant context set the policy matches nothing.
ALTER TABLE "roles" NO FORCE ROW LEVEL SECURITY;

UPDATE "roles" SET permissions = permissions || ARRAY['cost_codes.view', 'cost_codes.manage']
  WHERE is_system = true AND base_role IN ('owner', 'project_manager');

UPDATE "roles" SET permissions = permissions || ARRAY['cost_codes.view']
  WHERE is_system = true AND base_role = 'accounts';

ALTER TABLE "roles" FORCE ROW LEVEL SECURITY;
