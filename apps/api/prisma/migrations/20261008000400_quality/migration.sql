-- CreateEnum
CREATE TYPE "quality_item_kind" AS ENUM ('pass_fail', 'number', 'text', 'photo');

-- CreateEnum
CREATE TYPE "quality_item_outcome" AS ENUM ('pass', 'fail', 'na');

-- CreateEnum
CREATE TYPE "quality_inspection_status" AS ENUM ('in_progress', 'completed');

-- CreateEnum
CREATE TYPE "quality_inspection_result" AS ENUM ('pass', 'pass_with_comments', 'fail');

-- CreateEnum
CREATE TYPE "quality_signoff_party" AS ENUM ('inspector', 'client', 'consultant');

-- CreateEnum
CREATE TYPE "quality_test_type" AS ENUM ('concrete_cube', 'concrete_slump', 'steel_tensile', 'soil_compaction', 'brick_compressive', 'water_absorption', 'other');

-- CreateEnum
CREATE TYPE "quality_test_result" AS ENUM ('pass', 'fail');

-- CreateEnum
CREATE TYPE "snag_status" AS ENUM ('draft', 'open', 'fixed', 'closed');

-- CreateEnum
CREATE TYPE "snag_priority" AS ENUM ('low', 'medium', 'high', 'critical');

-- CreateEnum
CREATE TYPE "snag_source" AS ENUM ('manual', 'inspection', 'quick_capture', 'test');

-- CreateEnum
CREATE TYPE "snag_photo_stage" AS ENUM ('before', 'after');

-- CreateTable
CREATE TABLE "quality_checklist_templates" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "trade" TEXT,
    "description" TEXT,
    "standard_key" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "quality_checklist_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quality_checklist_items" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "template_id" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "label" TEXT NOT NULL,
    "kind" "quality_item_kind" NOT NULL,
    "required" BOOLEAN NOT NULL DEFAULT true,
    "photo_required" BOOLEAN NOT NULL DEFAULT false,
    "unit" TEXT,
    "target_value" DECIMAL(12,3),
    "tolerance_minus" DECIMAL(12,3),
    "tolerance_plus" DECIMAL(12,3),
    "guidance" TEXT,

    CONSTRAINT "quality_checklist_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quality_inspections" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "template_id" UUID,
    "number" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "trade" TEXT,
    "location" TEXT NOT NULL,
    "inspection_date" DATE NOT NULL,
    "inspector_id" UUID,
    "cost_code_id" UUID,
    "milestone_id" UUID,
    "status" "quality_inspection_status" NOT NULL DEFAULT 'in_progress',
    "result" "quality_inspection_result",
    "notes" TEXT,
    "share_with_client" BOOLEAN NOT NULL DEFAULT false,
    "completed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "quality_inspections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quality_inspection_items" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "inspection_id" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "label" TEXT NOT NULL,
    "kind" "quality_item_kind" NOT NULL,
    "required" BOOLEAN NOT NULL DEFAULT true,
    "photo_required" BOOLEAN NOT NULL DEFAULT false,
    "unit" TEXT,
    "target_value" DECIMAL(12,3),
    "tolerance_minus" DECIMAL(12,3),
    "tolerance_plus" DECIMAL(12,3),
    "guidance" TEXT,
    "outcome" "quality_item_outcome",
    "number_value" DECIMAL(12,3),
    "text_value" TEXT,
    "comment" TEXT,
    "photo_keys" TEXT[] DEFAULT ARRAY[]::TEXT[],

    CONSTRAINT "quality_inspection_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quality_inspection_signoffs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "inspection_id" UUID NOT NULL,
    "party" "quality_signoff_party" NOT NULL,
    "user_id" UUID,
    "signature_name" TEXT NOT NULL,
    "accepted" BOOLEAN NOT NULL DEFAULT true,
    "note" TEXT,
    "signed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "quality_inspection_signoffs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quality_tests" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "number" INTEGER NOT NULL,
    "test_type" "quality_test_type" NOT NULL,
    "title" TEXT,
    "sample_ref" TEXT NOT NULL,
    "location" TEXT,
    "cost_code_id" UUID,
    "grade" TEXT,
    "cast_on" DATE,
    "age_days" INTEGER,
    "due_on" DATE,
    "tested_on" DATE,
    "spec_min" DECIMAL(12,3),
    "spec_max" DECIMAL(12,3),
    "unit" TEXT,
    "result_value" DECIMAL(12,3),
    "result" "quality_test_result",
    "lab_name" TEXT,
    "report_s3_key" TEXT,
    "notes" TEXT,
    "recorded_by" UUID,
    "reminded_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "quality_tests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "snags" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "number" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "location" TEXT,
    "trade" TEXT,
    "priority" "snag_priority" NOT NULL DEFAULT 'medium',
    "status" "snag_status" NOT NULL DEFAULT 'open',
    "source" "snag_source" NOT NULL DEFAULT 'manual',
    "assigned_user_id" UUID,
    "assigned_contractor_id" UUID,
    "due_on" DATE,
    "client_visible" BOOLEAN NOT NULL DEFAULT false,
    "cost_code_id" UUID,
    "inspection_id" UUID,
    "inspection_item_id" UUID,
    "test_id" UUID,
    "raised_by" UUID,
    "transcript" TEXT,
    "voice_s3_key" TEXT,
    "ai_suggested" BOOLEAN NOT NULL DEFAULT false,
    "reopen_count" INTEGER NOT NULL DEFAULT 0,
    "fixed_at" TIMESTAMPTZ(6),
    "closed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "snags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "snag_photos" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "snag_id" UUID NOT NULL,
    "stage" "snag_photo_stage" NOT NULL DEFAULT 'before',
    "s3_key" TEXT NOT NULL,
    "uploaded_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "snag_photos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "snag_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "snag_id" UUID NOT NULL,
    "actor_id" UUID,
    "action" TEXT NOT NULL,
    "note" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "snag_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "quality_checklist_templates_tenant_id_active_idx" ON "quality_checklist_templates"("tenant_id", "active");

-- CreateIndex
CREATE UNIQUE INDEX "quality_checklist_templates_tenant_id_name_key" ON "quality_checklist_templates"("tenant_id", "name");

-- CreateIndex
CREATE INDEX "quality_checklist_items_template_id_position_idx" ON "quality_checklist_items"("template_id", "position");

-- CreateIndex
CREATE INDEX "quality_checklist_items_tenant_id_idx" ON "quality_checklist_items"("tenant_id");

-- CreateIndex
CREATE INDEX "quality_inspections_tenant_id_project_id_inspection_date_idx" ON "quality_inspections"("tenant_id", "project_id", "inspection_date");

-- CreateIndex
CREATE INDEX "quality_inspections_template_id_idx" ON "quality_inspections"("template_id");

-- CreateIndex
CREATE UNIQUE INDEX "quality_inspections_tenant_id_number_key" ON "quality_inspections"("tenant_id", "number");

-- CreateIndex
CREATE INDEX "quality_inspection_items_inspection_id_position_idx" ON "quality_inspection_items"("inspection_id", "position");

-- CreateIndex
CREATE INDEX "quality_inspection_items_tenant_id_idx" ON "quality_inspection_items"("tenant_id");

-- CreateIndex
CREATE INDEX "quality_inspection_signoffs_tenant_id_idx" ON "quality_inspection_signoffs"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "quality_inspection_signoffs_inspection_id_party_key" ON "quality_inspection_signoffs"("inspection_id", "party");

-- CreateIndex
CREATE INDEX "quality_tests_tenant_id_project_id_idx" ON "quality_tests"("tenant_id", "project_id");

-- CreateIndex
CREATE INDEX "quality_tests_tenant_id_due_on_idx" ON "quality_tests"("tenant_id", "due_on");

-- CreateIndex
CREATE UNIQUE INDEX "quality_tests_tenant_id_number_key" ON "quality_tests"("tenant_id", "number");

-- CreateIndex
CREATE UNIQUE INDEX "snags_inspection_item_id_key" ON "snags"("inspection_item_id");

-- CreateIndex
CREATE INDEX "snags_tenant_id_project_id_status_idx" ON "snags"("tenant_id", "project_id", "status");

-- CreateIndex
CREATE INDEX "snags_assigned_user_id_idx" ON "snags"("assigned_user_id");

-- CreateIndex
CREATE INDEX "snags_assigned_contractor_id_idx" ON "snags"("assigned_contractor_id");

-- CreateIndex
CREATE INDEX "snags_inspection_id_idx" ON "snags"("inspection_id");

-- CreateIndex
CREATE INDEX "snags_test_id_idx" ON "snags"("test_id");

-- CreateIndex
CREATE UNIQUE INDEX "snags_tenant_id_number_key" ON "snags"("tenant_id", "number");

-- CreateIndex
CREATE INDEX "snag_photos_snag_id_idx" ON "snag_photos"("snag_id");

-- CreateIndex
CREATE INDEX "snag_photos_tenant_id_idx" ON "snag_photos"("tenant_id");

-- CreateIndex
CREATE INDEX "snag_events_snag_id_created_at_idx" ON "snag_events"("snag_id", "created_at");

-- CreateIndex
CREATE INDEX "snag_events_tenant_id_idx" ON "snag_events"("tenant_id");

-- AddForeignKey
ALTER TABLE "quality_checklist_templates" ADD CONSTRAINT "quality_checklist_templates_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quality_checklist_items" ADD CONSTRAINT "quality_checklist_items_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quality_checklist_items" ADD CONSTRAINT "quality_checklist_items_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "quality_checklist_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quality_inspections" ADD CONSTRAINT "quality_inspections_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quality_inspections" ADD CONSTRAINT "quality_inspections_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quality_inspections" ADD CONSTRAINT "quality_inspections_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "quality_checklist_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quality_inspections" ADD CONSTRAINT "quality_inspections_inspector_id_fkey" FOREIGN KEY ("inspector_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quality_inspections" ADD CONSTRAINT "quality_inspections_cost_code_id_fkey" FOREIGN KEY ("cost_code_id") REFERENCES "cost_codes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quality_inspections" ADD CONSTRAINT "quality_inspections_milestone_id_fkey" FOREIGN KEY ("milestone_id") REFERENCES "milestones"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quality_inspection_items" ADD CONSTRAINT "quality_inspection_items_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quality_inspection_items" ADD CONSTRAINT "quality_inspection_items_inspection_id_fkey" FOREIGN KEY ("inspection_id") REFERENCES "quality_inspections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quality_inspection_signoffs" ADD CONSTRAINT "quality_inspection_signoffs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quality_inspection_signoffs" ADD CONSTRAINT "quality_inspection_signoffs_inspection_id_fkey" FOREIGN KEY ("inspection_id") REFERENCES "quality_inspections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quality_inspection_signoffs" ADD CONSTRAINT "quality_inspection_signoffs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quality_tests" ADD CONSTRAINT "quality_tests_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quality_tests" ADD CONSTRAINT "quality_tests_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quality_tests" ADD CONSTRAINT "quality_tests_cost_code_id_fkey" FOREIGN KEY ("cost_code_id") REFERENCES "cost_codes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quality_tests" ADD CONSTRAINT "quality_tests_recorded_by_fkey" FOREIGN KEY ("recorded_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "snags" ADD CONSTRAINT "snags_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "snags" ADD CONSTRAINT "snags_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "snags" ADD CONSTRAINT "snags_assigned_user_id_fkey" FOREIGN KEY ("assigned_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "snags" ADD CONSTRAINT "snags_assigned_contractor_id_fkey" FOREIGN KEY ("assigned_contractor_id") REFERENCES "contractors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "snags" ADD CONSTRAINT "snags_cost_code_id_fkey" FOREIGN KEY ("cost_code_id") REFERENCES "cost_codes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "snags" ADD CONSTRAINT "snags_inspection_id_fkey" FOREIGN KEY ("inspection_id") REFERENCES "quality_inspections"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "snags" ADD CONSTRAINT "snags_inspection_item_id_fkey" FOREIGN KEY ("inspection_item_id") REFERENCES "quality_inspection_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "snags" ADD CONSTRAINT "snags_test_id_fkey" FOREIGN KEY ("test_id") REFERENCES "quality_tests"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "snags" ADD CONSTRAINT "snags_raised_by_fkey" FOREIGN KEY ("raised_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "snag_photos" ADD CONSTRAINT "snag_photos_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "snag_photos" ADD CONSTRAINT "snag_photos_snag_id_fkey" FOREIGN KEY ("snag_id") REFERENCES "snags"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "snag_photos" ADD CONSTRAINT "snag_photos_uploaded_by_fkey" FOREIGN KEY ("uploaded_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "snag_events" ADD CONSTRAINT "snag_events_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "snag_events" ADD CONSTRAINT "snag_events_snag_id_fkey" FOREIGN KEY ("snag_id") REFERENCES "snags"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "snag_events" ADD CONSTRAINT "snag_events_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- --------------------------------------------------------------------------
-- Every new table is tenant data: the same isolation policy as the rest.
-- --------------------------------------------------------------------------
ALTER TABLE "quality_checklist_templates" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "quality_checklist_templates" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "quality_checklist_templates"
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

ALTER TABLE "quality_checklist_items" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "quality_checklist_items" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "quality_checklist_items"
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

ALTER TABLE "quality_inspections" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "quality_inspections" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "quality_inspections"
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

ALTER TABLE "quality_inspection_items" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "quality_inspection_items" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "quality_inspection_items"
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

ALTER TABLE "quality_inspection_signoffs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "quality_inspection_signoffs" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "quality_inspection_signoffs"
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

ALTER TABLE "quality_tests" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "quality_tests" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "quality_tests"
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

ALTER TABLE "snags" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "snags" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "snags"
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

ALTER TABLE "snag_photos" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "snag_photos" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "snag_photos"
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

ALTER TABLE "snag_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "snag_events" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "snag_events"
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- The platform console's role reads and repairs tenant data across companies, as for every other
-- tenant table; skipped where that role does not exist (a developer's database).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sitebook_admin') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON
      "quality_checklist_templates",
      "quality_checklist_items",
      "quality_inspections",
      "quality_inspection_items",
      "quality_inspection_signoffs",
      "quality_tests",
      "snags",
      "snag_photos",
      "snag_events"
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
    'quality.view', 'quality.inspect', 'quality.manage', 'quality.verify'
  ]
  WHERE is_system = true AND base_role IN ('owner', 'project_manager');

UPDATE "roles" SET permissions = permissions || ARRAY['quality.view', 'quality.inspect']
  WHERE is_system = true AND base_role = 'site_supervisor';

ALTER TABLE "roles" FORCE ROW LEVEL SECURITY;

-- --------------------------------------------------------------------------
-- The audit log
-- --------------------------------------------------------------------------
-- A quality record is evidence: who signed a pour card, who closed a snag and whether a cube
-- result was ever changed are exactly the questions asked after a defect turns up at handover.
SELECT audit_attach('quality_checklist_templates');
SELECT audit_attach('quality_checklist_items');
SELECT audit_attach('quality_inspections');
SELECT audit_attach('quality_inspection_items');
SELECT audit_attach('quality_inspection_signoffs');
SELECT audit_attach('quality_tests');
SELECT audit_attach('snags');
SELECT audit_attach('snag_photos');
SELECT audit_attach('snag_events');
