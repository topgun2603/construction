-- AlterEnum
ALTER TYPE "tenant_status" ADD VALUE 'pending_deletion';

-- CreateTable
CREATE TABLE "data_exports" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "requested_by_user_id" UUID NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "s3_key" TEXT,
    "size_bytes" BIGINT,
    "manifest" JSONB,
    "error" TEXT,
    "started_at" TIMESTAMPTZ(6),
    "finished_at" TIMESTAMPTZ(6),
    "expires_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "data_exports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "company_deletion_requests" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "requested_by_user_id" UUID NOT NULL,
    "requested_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "purge_after" TIMESTAMPTZ(6) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "cancelled_at" TIMESTAMPTZ(6),
    "cancelled_by_user_id" UUID,
    "platform_action" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "company_deletion_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "company_deletion_schedule" (
    "tenant_id" UUID NOT NULL,
    "purge_after" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "company_deletion_schedule_pkey" PRIMARY KEY ("tenant_id")
);

-- CreateTable
CREATE TABLE "deletion_certificates" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "company_id" UUID NOT NULL,
    "name_hash" TEXT NOT NULL,
    "requested_by_user_id" UUID,
    "requested_at" TIMESTAMPTZ(6),
    "trigger" TEXT NOT NULL DEFAULT 'grace_period',
    "deleted_at" TIMESTAMPTZ(6) NOT NULL,
    "table_counts" JSONB NOT NULL,
    "object_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "deletion_certificates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "legal_acceptances" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "document" TEXT NOT NULL DEFAULT 'dpa',
    "version" TEXT NOT NULL,
    "accepted_by_user_id" UUID NOT NULL,
    "accepted_by_name" TEXT NOT NULL,
    "accepted_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "legal_acceptances_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "data_exports_tenant_id_created_at_idx" ON "data_exports"("tenant_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "company_deletion_requests_tenant_id_status_idx" ON "company_deletion_requests"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "company_deletion_schedule_purge_after_idx" ON "company_deletion_schedule"("purge_after");

-- CreateIndex
CREATE INDEX "deletion_certificates_company_id_idx" ON "deletion_certificates"("company_id");

-- CreateIndex
CREATE UNIQUE INDEX "legal_acceptances_tenant_id_document_version_key" ON "legal_acceptances"("tenant_id", "document", "version");

-- AddForeignKey
ALTER TABLE "data_exports" ADD CONSTRAINT "data_exports_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company_deletion_requests" ADD CONSTRAINT "company_deletion_requests_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company_deletion_schedule" ADD CONSTRAINT "company_deletion_schedule_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "legal_acceptances" ADD CONSTRAINT "legal_acceptances_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- --------------------------------------------------------------------------
-- Rules the schema cannot express
-- --------------------------------------------------------------------------

ALTER TABLE "data_exports"
  ADD CONSTRAINT "data_exports_status_known"
  CHECK ("status" IN ('queued', 'running', 'ready', 'failed', 'expired'));

ALTER TABLE "company_deletion_requests"
  ADD CONSTRAINT "company_deletion_requests_status_known" CHECK ("status" IN ('pending', 'cancelled'));

ALTER TABLE "company_deletion_requests"
  ADD CONSTRAINT "company_deletion_requests_platform_action_known"
  CHECK ("platform_action" IS NULL OR "platform_action" IN ('cancelled', 'expedited'));

ALTER TABLE "deletion_certificates"
  ADD CONSTRAINT "deletion_certificates_trigger_known" CHECK ("trigger" IN ('grace_period', 'platform'));

ALTER TABLE "legal_acceptances"
  ADD CONSTRAINT "legal_acceptances_document_known" CHECK ("document" IN ('dpa'));

-- One deletion waiting per company: asking twice must not start a second clock. Partial, because a
-- company may cancel and ask again, and the cancelled rows are its history.
CREATE UNIQUE INDEX "company_deletion_requests_one_pending"
  ON "company_deletion_requests" ("tenant_id") WHERE "status" = 'pending';

-- And only one export under way per company, enforced where two racing requests cannot both win.
CREATE UNIQUE INDEX "data_exports_one_active"
  ON "data_exports" ("tenant_id") WHERE "status" IN ('queued', 'running');

-- --------------------------------------------------------------------------
-- The deletion schedule, kept by a trigger
-- --------------------------------------------------------------------------
--
-- The background sweep has no tenant context and no BYPASSRLS connection (the worker never gets
-- one — see TenantRoster), so it cannot read `company_deletion_requests`. It reads this narrow
-- mirror instead: a tenant id and a time, nothing else, no RLS — the `sso_domain_directory` pattern.
-- SECURITY DEFINER so a write to the request table from any role keeps it in step without that
-- role being granted the mirror; the search path is pinned for the usual reason.

CREATE OR REPLACE FUNCTION sync_company_deletion_schedule() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF (TG_OP = 'DELETE' OR TG_OP = 'UPDATE') THEN
    DELETE FROM company_deletion_schedule WHERE tenant_id = OLD.tenant_id;
  END IF;
  IF (TG_OP = 'DELETE') THEN
    RETURN OLD;
  END IF;
  IF (NEW.status = 'pending') THEN
    INSERT INTO company_deletion_schedule (tenant_id, purge_after) VALUES (NEW.tenant_id, NEW.purge_after)
    ON CONFLICT (tenant_id) DO UPDATE SET purge_after = EXCLUDED.purge_after;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER company_deletion_requests_sync_schedule
AFTER INSERT OR UPDATE OF status, purge_after, tenant_id OR DELETE ON "company_deletion_requests"
FOR EACH ROW EXECUTE FUNCTION sync_company_deletion_schedule();

-- --------------------------------------------------------------------------
-- Deletion certificates are append-only
-- --------------------------------------------------------------------------
-- The one record that a company existed and was deleted. Nothing in the app edits or removes it;
-- refused outright, like `audit_logs`, so a buggy "delete everything for this id" cannot either.

CREATE OR REPLACE FUNCTION deletion_certificates_append_only() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'deletion_certificates is append-only' USING ERRCODE = 'insufficient_privilege';
END $$;

CREATE TRIGGER deletion_certificates_append_only BEFORE UPDATE OR DELETE ON "deletion_certificates"
FOR EACH ROW EXECUTE FUNCTION deletion_certificates_append_only();

-- --------------------------------------------------------------------------
-- Every tenant table: the same isolation policy as the rest.
-- --------------------------------------------------------------------------
-- `company_deletion_schedule` (a directory, see above) and `deletion_certificates` (platform-level,
-- no tenant column, outlives the tenant) are deliberately outside RLS.

ALTER TABLE "data_exports" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "data_exports" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "data_exports"
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

ALTER TABLE "company_deletion_requests" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "company_deletion_requests" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "company_deletion_requests"
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

ALTER TABLE "legal_acceptances" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "legal_acceptances" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "legal_acceptances"
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- The platform console lists pending deletions and certificates across companies, as for every other
-- tenant table. The schedule and the certificates are read-only to it: the schedule is written by
-- its trigger alone, and a certificate once, by the deletion itself. Skipped where the role does not
-- exist (a developer's database).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sitebook_admin') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON
      "data_exports",
      "company_deletion_requests",
      "legal_acceptances"
    TO sitebook_admin;
    GRANT SELECT ON
      "company_deletion_schedule",
      "deletion_certificates"
    TO sitebook_admin;
  END IF;
END $$;

-- --------------------------------------------------------------------------
-- The audit log
-- --------------------------------------------------------------------------
-- Asking for an export, asking for (or calling off) a deletion and accepting a DPA version are all
-- recorded with who did it. The export's `manifest` is skipped — a table-by-table row count is the
-- ZIP's business, not something anybody reads in a diff. The schedule mirror is trigger-maintained
-- and the certificates outlive the log, so neither is attached.
SELECT audit_attach('data_exports', 'manifest');
SELECT audit_attach('company_deletion_requests');
SELECT audit_attach('legal_acceptances');

