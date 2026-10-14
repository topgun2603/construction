-- CreateTable
CREATE TABLE "accounting_settings" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "system" TEXT NOT NULL DEFAULT 'tally',
    "gst_home_state" TEXT,
    "tally_company" TEXT,
    "qbo_site_dimension" TEXT NOT NULL DEFAULT 'class',
    "xero_tracking_name" TEXT,
    "netsuite_subsidiary" TEXT,
    "netsuite_site_dimension" TEXT NOT NULL DEFAULT 'department',
    "updated_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "accounting_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accounting_account_maps" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "system" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "code" TEXT NOT NULL DEFAULT '',
    "name" TEXT NOT NULL,
    "updated_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "accounting_account_maps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accounting_export_batches" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "number" INTEGER NOT NULL,
    "system" TEXT NOT NULL,
    "period_from" DATE NOT NULL,
    "period_to" DATE NOT NULL,
    "project_ids" UUID[] DEFAULT ARRAY[]::UUID[],
    "include" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "include_exported" BOOLEAN NOT NULL DEFAULT false,
    "voucher_count" INTEGER NOT NULL DEFAULT 0,
    "summary" JSONB NOT NULL DEFAULT '{}',
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "accounting_export_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accounting_export_items" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "batch_id" UUID NOT NULL,
    "source_type" TEXT NOT NULL,
    "source_id" UUID NOT NULL,
    "external_id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "accounting_export_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accounting_export_files" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "batch_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "content_type" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "accounting_export_files_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "accounting_settings_tenant_id_key" ON "accounting_settings"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "accounting_account_maps_tenant_id_system_key_key" ON "accounting_account_maps"("tenant_id", "system", "key");

-- CreateIndex
CREATE INDEX "accounting_export_batches_tenant_id_created_at_idx" ON "accounting_export_batches"("tenant_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "accounting_export_batches_tenant_id_number_key" ON "accounting_export_batches"("tenant_id", "number");

-- CreateIndex
CREATE INDEX "accounting_export_items_tenant_id_source_type_source_id_idx" ON "accounting_export_items"("tenant_id", "source_type", "source_id");

-- CreateIndex
CREATE UNIQUE INDEX "accounting_export_items_batch_id_source_type_source_id_key" ON "accounting_export_items"("batch_id", "source_type", "source_id");

-- CreateIndex
CREATE INDEX "accounting_export_files_batch_id_idx" ON "accounting_export_files"("batch_id");

-- CreateIndex
CREATE INDEX "accounting_export_files_tenant_id_idx" ON "accounting_export_files"("tenant_id");

-- AddForeignKey
ALTER TABLE "accounting_settings" ADD CONSTRAINT "accounting_settings_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounting_account_maps" ADD CONSTRAINT "accounting_account_maps_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounting_export_batches" ADD CONSTRAINT "accounting_export_batches_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounting_export_items" ADD CONSTRAINT "accounting_export_items_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounting_export_items" ADD CONSTRAINT "accounting_export_items_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "accounting_export_batches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounting_export_files" ADD CONSTRAINT "accounting_export_files_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounting_export_files" ADD CONSTRAINT "accounting_export_files_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "accounting_export_batches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- --------------------------------------------------------------------------
-- Rules the schema cannot express
-- --------------------------------------------------------------------------
-- The same lists as ACCOUNTING_SYSTEMS, ACCOUNTING_CATEGORIES and ACCOUNTING_SOURCE_TYPES in
-- @sitebook/shared: a value the code does not know would be a row no screen can show.

ALTER TABLE "accounting_settings"
  ADD CONSTRAINT "accounting_settings_system_known"
    CHECK ("system" IN ('tally', 'quickbooks_online', 'quickbooks_desktop', 'xero', 'sap_b1', 'netsuite')),
  ADD CONSTRAINT "accounting_settings_gst_home_state_shape"
    CHECK ("gst_home_state" IS NULL OR "gst_home_state" ~ '^[0-9]{2}$'),
  ADD CONSTRAINT "accounting_settings_qbo_site_dimension_known"
    CHECK ("qbo_site_dimension" IN ('class', 'location')),
  ADD CONSTRAINT "accounting_settings_netsuite_site_dimension_known"
    CHECK ("netsuite_site_dimension" IN ('department', 'class', 'location'));

ALTER TABLE "accounting_account_maps"
  ADD CONSTRAINT "accounting_account_maps_system_known"
    CHECK ("system" IN ('tally', 'quickbooks_online', 'quickbooks_desktop', 'xero', 'sap_b1', 'netsuite')),
  ADD CONSTRAINT "accounting_account_maps_name_present" CHECK (length(btrim("name")) > 0);

ALTER TABLE "accounting_export_batches"
  ADD CONSTRAINT "accounting_export_batches_system_known"
    CHECK ("system" IN ('tally', 'quickbooks_online', 'quickbooks_desktop', 'xero', 'sap_b1', 'netsuite')),
  ADD CONSTRAINT "accounting_export_batches_number_positive" CHECK ("number" > 0),
  ADD CONSTRAINT "accounting_export_batches_period_ordered" CHECK ("period_from" <= "period_to"),
  ADD CONSTRAINT "accounting_export_batches_voucher_count_positive" CHECK ("voucher_count" >= 0),
  ADD CONSTRAINT "accounting_export_batches_include_known"
    CHECK ("include" <@ ARRAY['purchases', 'payroll', 'subcontract_bills', 'sales', 'payments', 'masters']::TEXT[]);

ALTER TABLE "accounting_export_items"
  ADD CONSTRAINT "accounting_export_items_source_type_known"
    CHECK ("source_type" IN ('expense', 'purchase_invoice', 'wage_period', 'labour_payment', 'subcontract_bill',
                             'subcontract_payment', 'payment_stage', 'client_payment'));

ALTER TABLE "accounting_export_files"
  ADD CONSTRAINT "accounting_export_files_size_positive" CHECK ("size_bytes" >= 0);

-- --------------------------------------------------------------------------
-- Every tenant table: the same isolation policy as the rest.
-- --------------------------------------------------------------------------

ALTER TABLE "accounting_settings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "accounting_settings" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "accounting_settings"
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

ALTER TABLE "accounting_account_maps" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "accounting_account_maps" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "accounting_account_maps"
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

ALTER TABLE "accounting_export_batches" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "accounting_export_batches" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "accounting_export_batches"
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

ALTER TABLE "accounting_export_items" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "accounting_export_items" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "accounting_export_items"
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

ALTER TABLE "accounting_export_files" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "accounting_export_files" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "accounting_export_files"
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- The platform console's role reads and repairs tenant data across companies, as for every other
-- tenant table; skipped where that role does not exist (a developer's database).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sitebook_admin') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON
      "accounting_settings",
      "accounting_account_maps",
      "accounting_export_batches",
      "accounting_export_items",
      "accounting_export_files"
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

UPDATE "roles" SET permissions = permissions || ARRAY['accounting.export', 'accounting.manage']
  WHERE is_system = true AND base_role IN ('owner', 'accounts');

ALTER TABLE "roles" FORCE ROW LEVEL SECURITY;

-- --------------------------------------------------------------------------
-- The audit log
-- --------------------------------------------------------------------------
-- Which ledger each kind of money posts to decides what the books say, so every mapping change is
-- recorded with who made it; so is the system choice, and every export (who, when, which period,
-- how many vouchers). Not the items — a row per exported transaction, written in bulk with the batch
-- whose own entry already says what went — and not the files, whose content is the export itself.
SELECT audit_attach('accounting_settings');
SELECT audit_attach('accounting_account_maps');
SELECT audit_attach('accounting_export_batches');

