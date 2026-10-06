-- Equipment and plant, roadmap Phase 2, module 10: the register of owned and hired machines with
-- their hire terms; which site each was on, when; the daily logs of meter, hours and operator; fuel
-- issued; service plans, maintenance and breakdowns; documents with an expiry; and the vendor's hire
-- invoices once checked and booked. RLS in the same migration as the tables (spec §17).
--
-- Every name is prefixed `equipment`. The one change outside them is the fuel leakage check's kind on
-- `site_checks`, at the end.

-- CreateTable
CREATE TABLE "equipment" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "make" TEXT,
    "model" TEXT,
    "registration_no" TEXT,
    "serial_no" TEXT,
    "year" INTEGER,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "ownership" TEXT NOT NULL,
    "vendor_id" UUID,
    "hire_basis" TEXT,
    "hire_rate" BIGINT NOT NULL DEFAULT 0,
    "min_hours" DECIMAL(7,1),
    "operator_included" BOOLEAN NOT NULL DEFAULT true,
    "operator_rate" BIGINT NOT NULL DEFAULT 0,
    "fuel_included" BOOLEAN NOT NULL DEFAULT false,
    "mobilisation_charge" BIGINT NOT NULL DEFAULT 0,
    "charge_out_basis" TEXT,
    "charge_out_rate" BIGINT NOT NULL DEFAULT 0,
    "meter_type" TEXT NOT NULL DEFAULT 'hours',
    "meter_reading" DECIMAL(10,1),
    "status" TEXT NOT NULL DEFAULT 'available',
    "notes" TEXT,
    "archived_at" TIMESTAMPTZ(6),
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "equipment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "equipment_allocations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "equipment_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "cost_code_id" UUID,
    "from_date" DATE NOT NULL,
    "to_date" DATE,
    "note" TEXT,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "equipment_allocations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "equipment_logs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "equipment_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "cost_code_id" UUID,
    "log_date" DATE NOT NULL,
    "opening_meter" DECIMAL(10,1),
    "closing_meter" DECIMAL(10,1),
    "hours_worked" DECIMAL(4,1) NOT NULL DEFAULT 0,
    "idle_hours" DECIMAL(4,1) NOT NULL DEFAULT 0,
    "breakdown_hours" DECIMAL(4,1) NOT NULL DEFAULT 0,
    "operator_worker_id" UUID,
    "operator_name" TEXT,
    "work_done" TEXT,
    "meter_photo_key" TEXT,
    "recorded_by" UUID NOT NULL,
    "client_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "equipment_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "equipment_fuel" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "equipment_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "log_id" UUID,
    "cost_code_id" UUID,
    "issued_on" DATE NOT NULL,
    "litres" DECIMAL(9,2) NOT NULL,
    "amount" BIGINT NOT NULL DEFAULT 0,
    "source" TEXT NOT NULL DEFAULT 'direct',
    "material_id" UUID,
    "stock_movement_id" UUID,
    "expense_id" UUID,
    "bill_s3_key" TEXT,
    "meter_reading" DECIMAL(10,1),
    "note" TEXT,
    "recorded_by" UUID NOT NULL,
    "client_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "equipment_fuel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "equipment_service_plans" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "equipment_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "interval_meter" DECIMAL(10,1),
    "interval_days" INTEGER,
    "last_done_meter" DECIMAL(10,1),
    "last_done_on" DATE,
    "reminded_at" TIMESTAMPTZ(6),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "equipment_service_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "equipment_maintenance" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "equipment_id" UUID NOT NULL,
    "project_id" UUID,
    "plan_id" UUID,
    "cost_code_id" UUID,
    "done_on" DATE NOT NULL,
    "kind" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "parts" TEXT,
    "cost" BIGINT NOT NULL DEFAULT 0,
    "meter_reading" DECIMAL(10,1),
    "downtime_hours" DECIMAL(7,1),
    "vendor_name" TEXT,
    "expense_id" UUID,
    "bill_s3_key" TEXT,
    "recorded_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "equipment_maintenance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "equipment_documents" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "equipment_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "number" TEXT,
    "issued_on" DATE,
    "expires_on" DATE,
    "s3_key" TEXT,
    "note" TEXT,
    "reminded_at" TIMESTAMPTZ(6),
    "deleted_at" TIMESTAMPTZ(6),
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "equipment_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "equipment_hire_bookings" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "vendor_id" UUID NOT NULL,
    "equipment_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "month" TEXT NOT NULL,
    "amount" BIGINT NOT NULL,
    "expense_id" UUID NOT NULL,
    "invoice_ref" TEXT,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "equipment_hire_bookings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "equipment_tenant_id_status_idx" ON "equipment"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "equipment_vendor_id_idx" ON "equipment"("vendor_id");

-- CreateIndex
CREATE UNIQUE INDEX "equipment_tenant_id_code_key" ON "equipment"("tenant_id", "code");

-- CreateIndex
CREATE INDEX "equipment_allocations_equipment_id_from_date_idx" ON "equipment_allocations"("equipment_id", "from_date");

-- CreateIndex
CREATE INDEX "equipment_allocations_tenant_id_project_id_idx" ON "equipment_allocations"("tenant_id", "project_id");

-- CreateIndex
CREATE INDEX "equipment_logs_tenant_id_project_id_log_date_idx" ON "equipment_logs"("tenant_id", "project_id", "log_date");

-- CreateIndex
CREATE UNIQUE INDEX "equipment_logs_equipment_id_log_date_key" ON "equipment_logs"("equipment_id", "log_date");

-- CreateIndex
CREATE UNIQUE INDEX "equipment_logs_tenant_id_client_id_key" ON "equipment_logs"("tenant_id", "client_id");

-- CreateIndex
CREATE UNIQUE INDEX "equipment_fuel_stock_movement_id_key" ON "equipment_fuel"("stock_movement_id");

-- CreateIndex
CREATE INDEX "equipment_fuel_equipment_id_issued_on_idx" ON "equipment_fuel"("equipment_id", "issued_on");

-- CreateIndex
CREATE INDEX "equipment_fuel_tenant_id_project_id_issued_on_idx" ON "equipment_fuel"("tenant_id", "project_id", "issued_on");

-- CreateIndex
CREATE UNIQUE INDEX "equipment_fuel_tenant_id_client_id_key" ON "equipment_fuel"("tenant_id", "client_id");

-- CreateIndex
CREATE INDEX "equipment_service_plans_tenant_id_active_idx" ON "equipment_service_plans"("tenant_id", "active");

-- CreateIndex
CREATE INDEX "equipment_service_plans_equipment_id_idx" ON "equipment_service_plans"("equipment_id");

-- CreateIndex
CREATE INDEX "equipment_maintenance_equipment_id_done_on_idx" ON "equipment_maintenance"("equipment_id", "done_on");

-- CreateIndex
CREATE INDEX "equipment_maintenance_tenant_id_project_id_idx" ON "equipment_maintenance"("tenant_id", "project_id");

-- CreateIndex
CREATE INDEX "equipment_documents_tenant_id_expires_on_idx" ON "equipment_documents"("tenant_id", "expires_on");

-- CreateIndex
CREATE INDEX "equipment_documents_equipment_id_idx" ON "equipment_documents"("equipment_id");

-- CreateIndex
CREATE INDEX "equipment_hire_bookings_tenant_id_vendor_id_month_idx" ON "equipment_hire_bookings"("tenant_id", "vendor_id", "month");

-- CreateIndex
CREATE UNIQUE INDEX "equipment_hire_bookings_equipment_id_project_id_month_key" ON "equipment_hire_bookings"("equipment_id", "project_id", "month");

-- AddForeignKey
ALTER TABLE "equipment" ADD CONSTRAINT "equipment_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "equipment" ADD CONSTRAINT "equipment_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "vendors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "equipment_allocations" ADD CONSTRAINT "equipment_allocations_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "equipment_allocations" ADD CONSTRAINT "equipment_allocations_equipment_id_fkey" FOREIGN KEY ("equipment_id") REFERENCES "equipment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "equipment_allocations" ADD CONSTRAINT "equipment_allocations_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "equipment_allocations" ADD CONSTRAINT "equipment_allocations_cost_code_id_fkey" FOREIGN KEY ("cost_code_id") REFERENCES "cost_codes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "equipment_logs" ADD CONSTRAINT "equipment_logs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "equipment_logs" ADD CONSTRAINT "equipment_logs_equipment_id_fkey" FOREIGN KEY ("equipment_id") REFERENCES "equipment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "equipment_logs" ADD CONSTRAINT "equipment_logs_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "equipment_logs" ADD CONSTRAINT "equipment_logs_cost_code_id_fkey" FOREIGN KEY ("cost_code_id") REFERENCES "cost_codes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "equipment_logs" ADD CONSTRAINT "equipment_logs_operator_worker_id_fkey" FOREIGN KEY ("operator_worker_id") REFERENCES "workers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "equipment_fuel" ADD CONSTRAINT "equipment_fuel_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "equipment_fuel" ADD CONSTRAINT "equipment_fuel_equipment_id_fkey" FOREIGN KEY ("equipment_id") REFERENCES "equipment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "equipment_fuel" ADD CONSTRAINT "equipment_fuel_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "equipment_fuel" ADD CONSTRAINT "equipment_fuel_log_id_fkey" FOREIGN KEY ("log_id") REFERENCES "equipment_logs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "equipment_fuel" ADD CONSTRAINT "equipment_fuel_cost_code_id_fkey" FOREIGN KEY ("cost_code_id") REFERENCES "cost_codes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "equipment_fuel" ADD CONSTRAINT "equipment_fuel_material_id_fkey" FOREIGN KEY ("material_id") REFERENCES "materials"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "equipment_fuel" ADD CONSTRAINT "equipment_fuel_stock_movement_id_fkey" FOREIGN KEY ("stock_movement_id") REFERENCES "stock_movements"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "equipment_fuel" ADD CONSTRAINT "equipment_fuel_expense_id_fkey" FOREIGN KEY ("expense_id") REFERENCES "expenses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "equipment_service_plans" ADD CONSTRAINT "equipment_service_plans_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "equipment_service_plans" ADD CONSTRAINT "equipment_service_plans_equipment_id_fkey" FOREIGN KEY ("equipment_id") REFERENCES "equipment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "equipment_maintenance" ADD CONSTRAINT "equipment_maintenance_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "equipment_maintenance" ADD CONSTRAINT "equipment_maintenance_equipment_id_fkey" FOREIGN KEY ("equipment_id") REFERENCES "equipment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "equipment_maintenance" ADD CONSTRAINT "equipment_maintenance_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "equipment_maintenance" ADD CONSTRAINT "equipment_maintenance_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "equipment_service_plans"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "equipment_maintenance" ADD CONSTRAINT "equipment_maintenance_cost_code_id_fkey" FOREIGN KEY ("cost_code_id") REFERENCES "cost_codes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "equipment_maintenance" ADD CONSTRAINT "equipment_maintenance_expense_id_fkey" FOREIGN KEY ("expense_id") REFERENCES "expenses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "equipment_documents" ADD CONSTRAINT "equipment_documents_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "equipment_documents" ADD CONSTRAINT "equipment_documents_equipment_id_fkey" FOREIGN KEY ("equipment_id") REFERENCES "equipment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "equipment_hire_bookings" ADD CONSTRAINT "equipment_hire_bookings_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "equipment_hire_bookings" ADD CONSTRAINT "equipment_hire_bookings_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "vendors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "equipment_hire_bookings" ADD CONSTRAINT "equipment_hire_bookings_equipment_id_fkey" FOREIGN KEY ("equipment_id") REFERENCES "equipment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "equipment_hire_bookings" ADD CONSTRAINT "equipment_hire_bookings_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "equipment_hire_bookings" ADD CONSTRAINT "equipment_hire_bookings_expense_id_fkey" FOREIGN KEY ("expense_id") REFERENCES "expenses"("id") ON DELETE CASCADE ON UPDATE CASCADE;



-- --------------------------------------------------------------------------
-- What the service checks first, with the database as the backstop for a bug
-- --------------------------------------------------------------------------
-- The vocabularies are EQUIPMENT_* in @sitebook/shared; text with a CHECK rather than an enum so a
-- new kind of machine is a code change and one constraint, not an ALTER TYPE.
ALTER TABLE "equipment"
  ADD CONSTRAINT "equipment_category_known" CHECK ("category" IN (
    'excavator', 'backhoe', 'crane', 'concrete_mixer', 'compactor', 'generator', 'pump',
    'scaffolding', 'vehicle', 'small_tools', 'other'
  )),
  ADD CONSTRAINT "equipment_ownership_known" CHECK ("ownership" IN ('owned', 'hired')),
  ADD CONSTRAINT "equipment_hire_basis_known" CHECK ("hire_basis" IS NULL OR "hire_basis" IN ('hour', 'day', 'month')),
  ADD CONSTRAINT "equipment_charge_out_basis_known" CHECK ("charge_out_basis" IS NULL OR "charge_out_basis" IN ('hour', 'day')),
  ADD CONSTRAINT "equipment_meter_type_known" CHECK ("meter_type" IN ('hours', 'km', 'none')),
  ADD CONSTRAINT "equipment_status_known" CHECK ("status" IN ('available', 'on_site', 'under_maintenance', 'off_hire')),
  -- A hired machine is hired from somebody, on some basis.
  ADD CONSTRAINT "equipment_hired_has_terms" CHECK (
    "ownership" <> 'hired' OR ("vendor_id" IS NOT NULL AND "hire_basis" IS NOT NULL)
  ),
  ADD CONSTRAINT "equipment_money_not_negative" CHECK (
    "hire_rate" >= 0 AND "operator_rate" >= 0 AND "mobilisation_charge" >= 0 AND "charge_out_rate" >= 0
  ),
  ADD CONSTRAINT "equipment_quantity_positive" CHECK ("quantity" > 0),
  ADD CONSTRAINT "equipment_min_hours_not_negative" CHECK ("min_hours" IS NULL OR "min_hours" >= 0);

-- An allocation runs forwards. Overlaps between a machine's allocations are refused by the service
-- (a machine is on one site at a time).
ALTER TABLE "equipment_allocations"
  ADD CONSTRAINT "equipment_allocations_window" CHECK ("to_date" IS NULL OR "to_date" >= "from_date");

-- A meter only runs forwards, and a day has 24 hours.
ALTER TABLE "equipment_logs"
  ADD CONSTRAINT "equipment_logs_meter_forwards" CHECK (
    "opening_meter" IS NULL OR "closing_meter" IS NULL OR "closing_meter" >= "opening_meter"
  ),
  ADD CONSTRAINT "equipment_logs_hours_in_a_day" CHECK (
    "hours_worked" >= 0 AND "idle_hours" >= 0 AND "breakdown_hours" >= 0
    AND "hours_worked" + "idle_hours" + "breakdown_hours" <= 24
  );

ALTER TABLE "equipment_fuel"
  ADD CONSTRAINT "equipment_fuel_source_known" CHECK ("source" IN ('direct', 'expense', 'stock', 'vendor')),
  ADD CONSTRAINT "equipment_fuel_litres_positive" CHECK ("litres" > 0),
  ADD CONSTRAINT "equipment_fuel_amount_not_negative" CHECK ("amount" >= 0),
  -- Stock fuel is a stock movement; expense fuel is an expense. Either one or neither, never both.
  ADD CONSTRAINT "equipment_fuel_one_record" CHECK (num_nonnulls("stock_movement_id", "expense_id") <= 1);

ALTER TABLE "equipment_service_plans"
  ADD CONSTRAINT "equipment_service_plans_has_interval" CHECK (
    ("interval_meter" IS NOT NULL AND "interval_meter" > 0) OR ("interval_days" IS NOT NULL AND "interval_days" > 0)
  );

ALTER TABLE "equipment_maintenance"
  ADD CONSTRAINT "equipment_maintenance_kind_known" CHECK ("kind" IN ('preventive', 'breakdown')),
  ADD CONSTRAINT "equipment_maintenance_cost_not_negative" CHECK ("cost" >= 0),
  ADD CONSTRAINT "equipment_maintenance_downtime_not_negative" CHECK ("downtime_hours" IS NULL OR "downtime_hours" >= 0);

ALTER TABLE "equipment_documents"
  ADD CONSTRAINT "equipment_documents_kind_known" CHECK ("kind" IN (
    'insurance', 'fitness', 'registration', 'operator_licence', 'pollution', 'other'
  )),
  ADD CONSTRAINT "equipment_documents_dates" CHECK (
    "issued_on" IS NULL OR "expires_on" IS NULL OR "expires_on" >= "issued_on"
  );

ALTER TABLE "equipment_hire_bookings"
  ADD CONSTRAINT "equipment_hire_bookings_month_shape" CHECK ("month" ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  ADD CONSTRAINT "equipment_hire_bookings_amount_not_negative" CHECK ("amount" >= 0);

-- --------------------------------------------------------------------------
-- The fuel leakage check joins the nightly checks (apps/api/src/modules/checks)
-- --------------------------------------------------------------------------
ALTER TABLE "site_checks" DROP CONSTRAINT "site_checks_kind_known";
ALTER TABLE "site_checks" ADD CONSTRAINT "site_checks_kind_known" CHECK ("kind" IN (
  'double_booked', 'never_off', 'headcount_gap', 'duplicate_expense', 'unusual_expense', 'unidentified_paid',
  'fuel_outlier'
));

-- --------------------------------------------------------------------------
-- Every new table is tenant data: the same isolation policy as the rest.
-- --------------------------------------------------------------------------
ALTER TABLE "equipment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "equipment" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "equipment"
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

ALTER TABLE "equipment_allocations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "equipment_allocations" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "equipment_allocations"
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

ALTER TABLE "equipment_logs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "equipment_logs" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "equipment_logs"
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

ALTER TABLE "equipment_fuel" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "equipment_fuel" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "equipment_fuel"
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

ALTER TABLE "equipment_service_plans" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "equipment_service_plans" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "equipment_service_plans"
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

ALTER TABLE "equipment_maintenance" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "equipment_maintenance" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "equipment_maintenance"
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

ALTER TABLE "equipment_documents" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "equipment_documents" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "equipment_documents"
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

ALTER TABLE "equipment_hire_bookings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "equipment_hire_bookings" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "equipment_hire_bookings"
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- The platform console's role reads and repairs tenant data across companies, as for every other
-- tenant table; skipped where that role does not exist (a developer's database).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sitebook_admin') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON
      "equipment",
      "equipment_allocations",
      "equipment_logs",
      "equipment_fuel",
      "equipment_service_plans",
      "equipment_maintenance",
      "equipment_documents",
      "equipment_hire_bookings"
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

UPDATE "roles" SET permissions = permissions || ARRAY['equipment.view', 'equipment.manage', 'equipment.log']
  WHERE is_system = true AND base_role IN ('owner', 'project_manager');

UPDATE "roles" SET permissions = permissions || ARRAY['equipment.log']
  WHERE is_system = true AND base_role = 'site_supervisor';

UPDATE "roles" SET permissions = permissions || ARRAY['equipment.view']
  WHERE is_system = true AND base_role = 'accounts';

ALTER TABLE "roles" FORCE ROW LEVEL SECURITY;

-- --------------------------------------------------------------------------
-- The audit log
-- --------------------------------------------------------------------------
-- Hours and fuel are what a hire vendor is paid on and what a leak hides in: who changed a meter
-- reading, who moved a machine and who booked an invoice all have to be on the record.
SELECT audit_attach('equipment');
SELECT audit_attach('equipment_allocations');
SELECT audit_attach('equipment_logs');
SELECT audit_attach('equipment_fuel');
SELECT audit_attach('equipment_service_plans');
SELECT audit_attach('equipment_maintenance');
SELECT audit_attach('equipment_documents');
SELECT audit_attach('equipment_hire_bookings');
