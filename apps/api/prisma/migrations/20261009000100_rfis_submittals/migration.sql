-- RFIs and submittals, roadmap Phase 2, module 9: questions to the designers with due dates and a
-- thread of answers, and the contractor's documents sent for approval with their revisions and
-- review outcomes. Builds on Documents. RLS in the same migration as the tables (spec §17).
--
-- Every name is prefixed `rfi`/`submittal`: equipment and multi-company are being built alongside.

-- CreateEnum
CREATE TYPE "rfi_status" AS ENUM ('draft', 'open', 'answered', 'closed', 'void');

-- CreateEnum
CREATE TYPE "rfi_discipline" AS ENUM ('architectural', 'structural', 'mep', 'civil', 'other');

-- CreateEnum
CREATE TYPE "rfi_priority" AS ENUM ('low', 'normal', 'high', 'urgent');

-- CreateEnum
CREATE TYPE "submittal_status" AS ENUM ('draft', 'submitted', 'under_review', 'approved', 'approved_as_noted', 'revise_resubmit', 'rejected');

-- CreateEnum
CREATE TYPE "submittal_type" AS ENUM ('shop_drawing', 'material_sample', 'method_statement', 'data_sheet', 'other');

-- CreateEnum
CREATE TYPE "submittal_reviewer_kind" AS ENUM ('external', 'client');

-- CreateTable
CREATE TABLE "rfi_settings" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "rfi_due_days" INTEGER NOT NULL DEFAULT 7,
    "submittal_review_days" INTEGER NOT NULL DEFAULT 14,
    "reminder_days_before" INTEGER NOT NULL DEFAULT 2,
    "updated_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "rfi_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rfis" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "number" INTEGER NOT NULL,
    "subject" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "discipline" "rfi_discipline" NOT NULL DEFAULT 'other',
    "priority" "rfi_priority" NOT NULL DEFAULT 'normal',
    "location" TEXT,
    "status" "rfi_status" NOT NULL DEFAULT 'draft',
    "raised_by" UUID NOT NULL,
    "raised_on" DATE NOT NULL,
    "addressed_to_name" TEXT,
    "addressed_to_email" TEXT,
    "addressed_to_company" TEXT,
    "addressed_to_phone" TEXT,
    "assignee_id" UUID,
    "sent_at" TIMESTAMPTZ(6),
    "due_on" DATE,
    "cost_impact" BOOLEAN NOT NULL DEFAULT false,
    "schedule_impact" BOOLEAN NOT NULL DEFAULT false,
    "change_order_id" UUID,
    "schedule_task_id" UUID,
    "answered_at" TIMESTAMPTZ(6),
    "closed_by" UUID,
    "closed_at" TIMESTAMPTZ(6),
    "close_note" TEXT,
    "void_reason" TEXT,
    "link_version" INTEGER NOT NULL DEFAULT 0,
    "link_sent_at" TIMESTAMPTZ(6),
    "due_soon_reminded_at" TIMESTAMPTZ(6),
    "overdue_reminded_at" TIMESTAMPTZ(6),
    "client_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "rfis_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rfi_documents" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "rfi_id" UUID NOT NULL,
    "document_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rfi_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rfi_responses" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "rfi_id" UUID NOT NULL,
    "body" TEXT NOT NULL,
    "author_user_id" UUID,
    "author_name" TEXT NOT NULL,
    "author_email" TEXT,
    "external" BOOLEAN NOT NULL DEFAULT false,
    "is_official" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rfi_responses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rfi_attachments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "rfi_id" UUID NOT NULL,
    "response_id" UUID,
    "document_id" UUID,
    "s3_key" TEXT,
    "content_type" TEXT,
    "filename" TEXT,
    "uploaded_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rfi_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "submittals" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "number" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "type" "submittal_type" NOT NULL DEFAULT 'shop_drawing',
    "spec_section" TEXT,
    "description" TEXT,
    "cost_code_id" UUID,
    "submitted_by_user_id" UUID,
    "contractor_id" UUID,
    "vendor_id" UUID,
    "reviewer_kind" "submittal_reviewer_kind" NOT NULL DEFAULT 'external',
    "reviewer_name" TEXT,
    "reviewer_email" TEXT,
    "reviewer_company" TEXT,
    "reviewer_phone" TEXT,
    "current_revision" INTEGER NOT NULL DEFAULT 0,
    "status" "submittal_status" NOT NULL DEFAULT 'draft',
    "due_on" DATE,
    "created_by" UUID NOT NULL,
    "client_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "submittals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "submittal_revisions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "submittal_id" UUID NOT NULL,
    "revision" INTEGER NOT NULL,
    "previous_revision_id" UUID,
    "status" "submittal_status" NOT NULL DEFAULT 'draft',
    "note" TEXT,
    "submitted_by" UUID,
    "submitted_at" TIMESTAMPTZ(6),
    "due_on" DATE,
    "review_started_at" TIMESTAMPTZ(6),
    "reviewed_at" TIMESTAMPTZ(6),
    "reviewed_by" UUID,
    "reviewer_name" TEXT,
    "reviewer_email" TEXT,
    "review_comments" TEXT,
    "approval_id" UUID,
    "link_version" INTEGER NOT NULL DEFAULT 0,
    "link_sent_at" TIMESTAMPTZ(6),
    "due_soon_reminded_at" TIMESTAMPTZ(6),
    "overdue_reminded_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "submittal_revisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "submittal_files" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "revision_id" UUID NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'submission',
    "document_id" UUID,
    "s3_key" TEXT,
    "content_type" TEXT,
    "filename" TEXT,
    "uploaded_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "submittal_files_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "rfi_settings_tenant_id_key" ON "rfi_settings"("tenant_id");

-- CreateIndex
CREATE INDEX "rfis_tenant_id_status_due_on_idx" ON "rfis"("tenant_id", "status", "due_on");

-- CreateIndex
CREATE INDEX "rfis_change_order_id_idx" ON "rfis"("change_order_id");

-- CreateIndex
CREATE INDEX "rfis_schedule_task_id_idx" ON "rfis"("schedule_task_id");

-- CreateIndex
CREATE UNIQUE INDEX "rfis_project_id_number_key" ON "rfis"("project_id", "number");

-- CreateIndex
CREATE UNIQUE INDEX "rfis_tenant_id_client_id_key" ON "rfis"("tenant_id", "client_id");

-- CreateIndex
CREATE INDEX "rfi_documents_tenant_id_idx" ON "rfi_documents"("tenant_id");

-- CreateIndex
CREATE INDEX "rfi_documents_document_id_idx" ON "rfi_documents"("document_id");

-- CreateIndex
CREATE UNIQUE INDEX "rfi_documents_rfi_id_document_id_key" ON "rfi_documents"("rfi_id", "document_id");

-- CreateIndex
CREATE INDEX "rfi_responses_tenant_id_idx" ON "rfi_responses"("tenant_id");

-- CreateIndex
CREATE INDEX "rfi_responses_rfi_id_created_at_idx" ON "rfi_responses"("rfi_id", "created_at");

-- CreateIndex
CREATE INDEX "rfi_attachments_tenant_id_idx" ON "rfi_attachments"("tenant_id");

-- CreateIndex
CREATE INDEX "rfi_attachments_rfi_id_idx" ON "rfi_attachments"("rfi_id");

-- CreateIndex
CREATE INDEX "rfi_attachments_response_id_idx" ON "rfi_attachments"("response_id");

-- CreateIndex
CREATE INDEX "rfi_attachments_document_id_idx" ON "rfi_attachments"("document_id");

-- CreateIndex
CREATE INDEX "submittals_tenant_id_status_due_on_idx" ON "submittals"("tenant_id", "status", "due_on");

-- CreateIndex
CREATE INDEX "submittals_cost_code_id_idx" ON "submittals"("cost_code_id");

-- CreateIndex
CREATE INDEX "submittals_contractor_id_idx" ON "submittals"("contractor_id");

-- CreateIndex
CREATE INDEX "submittals_vendor_id_idx" ON "submittals"("vendor_id");

-- CreateIndex
CREATE UNIQUE INDEX "submittals_project_id_number_key" ON "submittals"("project_id", "number");

-- CreateIndex
CREATE UNIQUE INDEX "submittals_tenant_id_client_id_key" ON "submittals"("tenant_id", "client_id");

-- CreateIndex
CREATE UNIQUE INDEX "submittal_revisions_previous_revision_id_key" ON "submittal_revisions"("previous_revision_id");

-- CreateIndex
CREATE UNIQUE INDEX "submittal_revisions_approval_id_key" ON "submittal_revisions"("approval_id");

-- CreateIndex
CREATE INDEX "submittal_revisions_tenant_id_status_due_on_idx" ON "submittal_revisions"("tenant_id", "status", "due_on");

-- CreateIndex
CREATE UNIQUE INDEX "submittal_revisions_submittal_id_revision_key" ON "submittal_revisions"("submittal_id", "revision");

-- CreateIndex
CREATE INDEX "submittal_files_tenant_id_idx" ON "submittal_files"("tenant_id");

-- CreateIndex
CREATE INDEX "submittal_files_revision_id_idx" ON "submittal_files"("revision_id");

-- CreateIndex
CREATE INDEX "submittal_files_document_id_idx" ON "submittal_files"("document_id");

-- AddForeignKey
ALTER TABLE "rfi_settings" ADD CONSTRAINT "rfi_settings_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rfis" ADD CONSTRAINT "rfis_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rfis" ADD CONSTRAINT "rfis_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rfis" ADD CONSTRAINT "rfis_change_order_id_fkey" FOREIGN KEY ("change_order_id") REFERENCES "change_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rfis" ADD CONSTRAINT "rfis_schedule_task_id_fkey" FOREIGN KEY ("schedule_task_id") REFERENCES "schedule_tasks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rfi_documents" ADD CONSTRAINT "rfi_documents_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rfi_documents" ADD CONSTRAINT "rfi_documents_rfi_id_fkey" FOREIGN KEY ("rfi_id") REFERENCES "rfis"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rfi_documents" ADD CONSTRAINT "rfi_documents_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rfi_responses" ADD CONSTRAINT "rfi_responses_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rfi_responses" ADD CONSTRAINT "rfi_responses_rfi_id_fkey" FOREIGN KEY ("rfi_id") REFERENCES "rfis"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rfi_attachments" ADD CONSTRAINT "rfi_attachments_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rfi_attachments" ADD CONSTRAINT "rfi_attachments_rfi_id_fkey" FOREIGN KEY ("rfi_id") REFERENCES "rfis"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rfi_attachments" ADD CONSTRAINT "rfi_attachments_response_id_fkey" FOREIGN KEY ("response_id") REFERENCES "rfi_responses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rfi_attachments" ADD CONSTRAINT "rfi_attachments_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "submittals" ADD CONSTRAINT "submittals_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "submittals" ADD CONSTRAINT "submittals_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "submittals" ADD CONSTRAINT "submittals_cost_code_id_fkey" FOREIGN KEY ("cost_code_id") REFERENCES "cost_codes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "submittals" ADD CONSTRAINT "submittals_contractor_id_fkey" FOREIGN KEY ("contractor_id") REFERENCES "contractors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "submittals" ADD CONSTRAINT "submittals_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "vendors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "submittal_revisions" ADD CONSTRAINT "submittal_revisions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "submittal_revisions" ADD CONSTRAINT "submittal_revisions_submittal_id_fkey" FOREIGN KEY ("submittal_id") REFERENCES "submittals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "submittal_revisions" ADD CONSTRAINT "submittal_revisions_previous_revision_id_fkey" FOREIGN KEY ("previous_revision_id") REFERENCES "submittal_revisions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "submittal_revisions" ADD CONSTRAINT "submittal_revisions_approval_id_fkey" FOREIGN KEY ("approval_id") REFERENCES "approvals"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "submittal_files" ADD CONSTRAINT "submittal_files_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "submittal_files" ADD CONSTRAINT "submittal_files_revision_id_fkey" FOREIGN KEY ("revision_id") REFERENCES "submittal_revisions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "submittal_files" ADD CONSTRAINT "submittal_files_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;



-- --------------------------------------------------------------------------
-- What the service checks first, with the database as the backstop for a bug
-- --------------------------------------------------------------------------
ALTER TABLE "rfi_settings"
  ADD CONSTRAINT "rfi_settings_days_range" CHECK (
    "rfi_due_days" BETWEEN 1 AND 90
    AND "submittal_review_days" BETWEEN 1 AND 120
    AND "reminder_days_before" BETWEEN 0 AND 14
  );

ALTER TABLE "rfis"
  ADD CONSTRAINT "rfis_number_positive" CHECK ("number" > 0),
  -- Anything past a draft has been sent; a closed one names who closed it.
  ADD CONSTRAINT "rfis_open_was_sent" CHECK ("status" IN ('draft', 'void') OR "sent_at" IS NOT NULL),
  ADD CONSTRAINT "rfis_closed_has_closer" CHECK ("status" <> 'closed' OR ("closed_by" IS NOT NULL AND "closed_at" IS NOT NULL)),
  ADD CONSTRAINT "rfis_link_version_not_negative" CHECK ("link_version" >= 0);

-- One official answer per RFI: the one it is closed on.
CREATE UNIQUE INDEX "rfi_responses_one_official" ON "rfi_responses"("rfi_id") WHERE "is_official";

-- A file is a library document or an upload, never both and never neither.
ALTER TABLE "rfi_attachments"
  ADD CONSTRAINT "rfi_attachments_one_source" CHECK (num_nonnulls("document_id", "s3_key") = 1);

ALTER TABLE "submittals"
  ADD CONSTRAINT "submittals_number_positive" CHECK ("number" > 0),
  ADD CONSTRAINT "submittals_revision_not_negative" CHECK ("current_revision" >= 0);

ALTER TABLE "submittal_revisions"
  ADD CONSTRAINT "submittal_revisions_revision_not_negative" CHECK ("revision" >= 0),
  -- A decided revision carries when it was decided.
  ADD CONSTRAINT "submittal_revisions_decided_when" CHECK (
    "status" NOT IN ('approved', 'approved_as_noted', 'revise_resubmit', 'rejected') OR "reviewed_at" IS NOT NULL
  ),
  ADD CONSTRAINT "submittal_revisions_link_version_not_negative" CHECK ("link_version" >= 0);

ALTER TABLE "submittal_files"
  ADD CONSTRAINT "submittal_files_one_source" CHECK (num_nonnulls("document_id", "s3_key") = 1),
  ADD CONSTRAINT "submittal_files_role_known" CHECK ("role" IN ('submission', 'markup'));

-- --------------------------------------------------------------------------
-- Every new table is tenant data: the same isolation policy as the rest.
-- --------------------------------------------------------------------------
ALTER TABLE "rfi_settings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "rfi_settings" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "rfi_settings"
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

ALTER TABLE "rfis" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "rfis" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "rfis"
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

ALTER TABLE "rfi_documents" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "rfi_documents" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "rfi_documents"
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

ALTER TABLE "rfi_responses" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "rfi_responses" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "rfi_responses"
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

ALTER TABLE "rfi_attachments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "rfi_attachments" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "rfi_attachments"
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

ALTER TABLE "submittals" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "submittals" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "submittals"
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

ALTER TABLE "submittal_revisions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "submittal_revisions" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "submittal_revisions"
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

ALTER TABLE "submittal_files" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "submittal_files" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "submittal_files"
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- The platform console's role reads and repairs tenant data across companies, as for every other
-- tenant table; skipped where that role does not exist (a developer's database).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sitebook_admin') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON
      "rfi_settings",
      "rfis",
      "rfi_documents",
      "rfi_responses",
      "rfi_attachments",
      "submittals",
      "submittal_revisions",
      "submittal_files"
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

UPDATE "roles" SET permissions = permissions || ARRAY['rfis.view', 'rfis.manage', 'submittals.view', 'submittals.manage', 'submittals.review']
  WHERE is_system = true AND base_role IN ('owner', 'project_manager');

UPDATE "roles" SET permissions = permissions || ARRAY['rfis.view', 'rfis.manage', 'submittals.view']
  WHERE is_system = true AND base_role = 'site_supervisor';

ALTER TABLE "roles" FORCE ROW LEVEL SECURITY;

-- --------------------------------------------------------------------------
-- The audit log
-- --------------------------------------------------------------------------
-- An RFI log is evidence in a delay claim: when a question was asked, when it was answered, by
-- whom, and whether the answer changed. A submittal's review outcome is what the work was built to.
SELECT audit_attach('rfi_settings');
SELECT audit_attach('rfis');
SELECT audit_attach('rfi_documents');
SELECT audit_attach('rfi_responses');
SELECT audit_attach('rfi_attachments');
SELECT audit_attach('submittals');
SELECT audit_attach('submittal_revisions');
SELECT audit_attach('submittal_files');
