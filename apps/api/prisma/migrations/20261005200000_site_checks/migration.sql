-- Leakage and fraud findings for a person to confirm or dismiss (roadmap, AI agent 3).
--
-- RLS in the same migration as the table, so it never exists unprotected (spec §17).
CREATE TABLE "site_checks" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "project_id" UUID,
    "kind" TEXT NOT NULL,
    "subject_key" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "details" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "decided_by" UUID,
    "decided_at" TIMESTAMPTZ(6),
    "note" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "site_checks_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "site_checks_kind_known" CHECK ("kind" IN ('double_booked', 'never_off', 'headcount_gap', 'duplicate_expense', 'unusual_expense', 'unidentified_paid')),
    CONSTRAINT "site_checks_severity_known" CHECK ("severity" IN ('high', 'medium')),
    CONSTRAINT "site_checks_status_known" CHECK ("status" IN ('open', 'confirmed', 'dismissed'))
);

CREATE UNIQUE INDEX "site_checks_tenant_id_kind_subject_key_key" ON "site_checks"("tenant_id", "kind", "subject_key");
CREATE INDEX "site_checks_tenant_id_status_idx" ON "site_checks"("tenant_id", "status");

ALTER TABLE "site_checks" ADD CONSTRAINT "site_checks_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "site_checks" ADD CONSTRAINT "site_checks_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "site_checks" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "site_checks" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "site_checks"
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());
