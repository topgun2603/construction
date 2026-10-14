-- CreateTable
CREATE TABLE "ai_settings" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "disabled_features" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "region" TEXT NOT NULL DEFAULT 'default',
    "updated_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "ai_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_usage_daily" (
    "tenant_id" UUID NOT NULL,
    "day" DATE NOT NULL,
    "feature" TEXT NOT NULL,
    "calls" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ai_usage_daily_pkey" PRIMARY KEY ("tenant_id","day","feature")
);

-- CreateIndex
CREATE UNIQUE INDEX "ai_settings_tenant_id_key" ON "ai_settings"("tenant_id");

-- AddForeignKey
ALTER TABLE "ai_settings" ADD CONSTRAINT "ai_settings_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_usage_daily" ADD CONSTRAINT "ai_usage_daily_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- --------------------------------------------------------------------------
-- Rules the schema cannot express
-- --------------------------------------------------------------------------

ALTER TABLE "ai_settings"
  ADD CONSTRAINT "ai_settings_region_known" CHECK ("region" IN ('default', 'eu', 'us'));

ALTER TABLE "ai_usage_daily"
  ADD CONSTRAINT "ai_usage_daily_calls_positive" CHECK ("calls" >= 0);

-- --------------------------------------------------------------------------
-- Every tenant table: the same isolation policy as the rest.
-- --------------------------------------------------------------------------

ALTER TABLE "ai_settings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ai_settings" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "ai_settings"
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

ALTER TABLE "ai_usage_daily" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ai_usage_daily" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "ai_usage_daily"
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- The platform console reads a company's AI settings and usage across companies, as for every
-- other tenant table. Skipped where that role does not exist (a developer's database).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sitebook_admin') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON
      "ai_settings",
      "ai_usage_daily"
    TO sitebook_admin;
  END IF;
END $$;

-- --------------------------------------------------------------------------
-- The audit log
-- --------------------------------------------------------------------------
-- Every change to what a company lets its model calls do — the master switch, a feature, the
-- region — is recorded with who made it. `ai_usage_daily` is deliberately not attached: it is a
-- counter bumped on every model call, so each row would be audited hundreds of times a day as
-- "calls 41 -> 42", drowning the entries people actually read. Deleting stored AI data is audited
-- by hand (`ai.data_deleted`), since `document_chunks`, the table it empties, is not attached either.
SELECT audit_attach('ai_settings');

