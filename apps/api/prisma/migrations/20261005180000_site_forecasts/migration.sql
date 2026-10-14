-- Overrun early warning: one forecast per site per day (roadmap, AI agent 2).
--
-- The RLS policy is created in the same migration as the table, so the window where the table
-- exists unprotected is zero (spec §17).
CREATE TABLE "site_forecasts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "as_of" DATE NOT NULL,
    "method" TEXT NOT NULL,
    "spent" BIGINT NOT NULL,
    "budget" BIGINT,
    "forecast" BIGINT,
    "overrun_pct" INTEGER,
    "progress_pct" INTEGER,
    "elapsed_pct" INTEGER,
    "severity" TEXT NOT NULL,
    "drivers" JSONB NOT NULL,
    "explanation" TEXT NOT NULL,
    "explained_by" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "site_forecasts_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "site_forecasts_method_known" CHECK ("method" IN ('progress', 'burn_rate', 'spend_only')),
    CONSTRAINT "site_forecasts_severity_known" CHECK ("severity" IN ('ok', 'watch', 'warning', 'critical')),
    CONSTRAINT "site_forecasts_explained_by_known" CHECK ("explained_by" IN ('template', 'ai'))
);

CREATE UNIQUE INDEX "site_forecasts_project_id_as_of_key" ON "site_forecasts"("project_id", "as_of");
CREATE INDEX "site_forecasts_tenant_id_as_of_idx" ON "site_forecasts"("tenant_id", "as_of");

ALTER TABLE "site_forecasts" ADD CONSTRAINT "site_forecasts_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "site_forecasts" ADD CONSTRAINT "site_forecasts_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Row-level security, same shape as every other tenant table (ADR 0001).
ALTER TABLE "site_forecasts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "site_forecasts" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "site_forecasts"
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());
