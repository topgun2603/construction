-- CreateEnum
CREATE TYPE "schedule_task_kind" AS ENUM ('task', 'milestone');

-- CreateEnum
CREATE TYPE "schedule_constraint_type" AS ENUM ('asap', 'snet', 'fnlt');

-- CreateEnum
CREATE TYPE "schedule_link_type" AS ENUM ('FS', 'SS', 'FF', 'SF');

-- CreateTable
CREATE TABLE "schedule_calendars" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "project_id" UUID,
    "name" TEXT NOT NULL,
    "working_days" INTEGER[],
    "holidays" DATE[],
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "schedule_calendars_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "schedule_tasks" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "parent_id" UUID,
    "milestone_id" UUID,
    "cost_code_id" UUID,
    "responsible_user_id" UUID,
    "contractor_id" UUID,
    "wbs_code" TEXT,
    "name" TEXT NOT NULL,
    "kind" "schedule_task_kind" NOT NULL DEFAULT 'task',
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "duration_days" INTEGER NOT NULL DEFAULT 1,
    "constraint_type" "schedule_constraint_type" NOT NULL DEFAULT 'asap',
    "constraint_date" DATE,
    "percent_complete" INTEGER NOT NULL DEFAULT 0,
    "actual_start" DATE,
    "actual_finish" DATE,
    "notes" TEXT,
    "external_id" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "schedule_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "schedule_dependencies" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "predecessor_id" UUID NOT NULL,
    "successor_id" UUID NOT NULL,
    "type" "schedule_link_type" NOT NULL DEFAULT 'FS',
    "lag_days" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "schedule_dependencies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "schedule_baselines" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "finish_date" DATE NOT NULL,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "schedule_baselines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "schedule_baseline_tasks" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "baseline_id" UUID NOT NULL,
    "task_id" UUID,
    "name" TEXT NOT NULL,
    "start_date" DATE NOT NULL,
    "finish_date" DATE NOT NULL,
    "duration_days" INTEGER NOT NULL,

    CONSTRAINT "schedule_baseline_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "schedule_calendars_project_id_key" ON "schedule_calendars"("project_id");

-- CreateIndex
CREATE INDEX "schedule_calendars_tenant_id_idx" ON "schedule_calendars"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "schedule_tasks_milestone_id_key" ON "schedule_tasks"("milestone_id");

-- CreateIndex
CREATE INDEX "schedule_tasks_project_id_sort_order_idx" ON "schedule_tasks"("project_id", "sort_order");

-- CreateIndex
CREATE INDEX "schedule_tasks_parent_id_idx" ON "schedule_tasks"("parent_id");

-- CreateIndex
CREATE INDEX "schedule_tasks_tenant_id_idx" ON "schedule_tasks"("tenant_id");

-- CreateIndex
CREATE INDEX "schedule_dependencies_project_id_idx" ON "schedule_dependencies"("project_id");

-- CreateIndex
CREATE INDEX "schedule_dependencies_successor_id_idx" ON "schedule_dependencies"("successor_id");

-- CreateIndex
CREATE INDEX "schedule_dependencies_tenant_id_idx" ON "schedule_dependencies"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "schedule_dependencies_predecessor_id_successor_id_key" ON "schedule_dependencies"("predecessor_id", "successor_id");

-- CreateIndex
CREATE INDEX "schedule_baselines_project_id_created_at_idx" ON "schedule_baselines"("project_id", "created_at");

-- CreateIndex
CREATE INDEX "schedule_baselines_tenant_id_idx" ON "schedule_baselines"("tenant_id");

-- CreateIndex
CREATE INDEX "schedule_baseline_tasks_task_id_idx" ON "schedule_baseline_tasks"("task_id");

-- CreateIndex
CREATE INDEX "schedule_baseline_tasks_tenant_id_idx" ON "schedule_baseline_tasks"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "schedule_baseline_tasks_baseline_id_task_id_key" ON "schedule_baseline_tasks"("baseline_id", "task_id");

-- AddForeignKey
ALTER TABLE "schedule_calendars" ADD CONSTRAINT "schedule_calendars_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "schedule_calendars" ADD CONSTRAINT "schedule_calendars_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "schedule_tasks" ADD CONSTRAINT "schedule_tasks_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "schedule_tasks" ADD CONSTRAINT "schedule_tasks_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "schedule_tasks" ADD CONSTRAINT "schedule_tasks_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "schedule_tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "schedule_tasks" ADD CONSTRAINT "schedule_tasks_milestone_id_fkey" FOREIGN KEY ("milestone_id") REFERENCES "milestones"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "schedule_tasks" ADD CONSTRAINT "schedule_tasks_cost_code_id_fkey" FOREIGN KEY ("cost_code_id") REFERENCES "cost_codes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "schedule_tasks" ADD CONSTRAINT "schedule_tasks_responsible_user_id_fkey" FOREIGN KEY ("responsible_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "schedule_tasks" ADD CONSTRAINT "schedule_tasks_contractor_id_fkey" FOREIGN KEY ("contractor_id") REFERENCES "contractors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "schedule_dependencies" ADD CONSTRAINT "schedule_dependencies_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "schedule_dependencies" ADD CONSTRAINT "schedule_dependencies_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "schedule_dependencies" ADD CONSTRAINT "schedule_dependencies_predecessor_id_fkey" FOREIGN KEY ("predecessor_id") REFERENCES "schedule_tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "schedule_dependencies" ADD CONSTRAINT "schedule_dependencies_successor_id_fkey" FOREIGN KEY ("successor_id") REFERENCES "schedule_tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "schedule_baselines" ADD CONSTRAINT "schedule_baselines_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "schedule_baselines" ADD CONSTRAINT "schedule_baselines_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "schedule_baselines" ADD CONSTRAINT "schedule_baselines_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "schedule_baseline_tasks" ADD CONSTRAINT "schedule_baseline_tasks_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "schedule_baseline_tasks" ADD CONSTRAINT "schedule_baseline_tasks_baseline_id_fkey" FOREIGN KEY ("baseline_id") REFERENCES "schedule_baselines"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "schedule_baseline_tasks" ADD CONSTRAINT "schedule_baseline_tasks_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "schedule_tasks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- --------------------------------------------------------------------------
-- What the database holds to, whatever the service forgets
-- --------------------------------------------------------------------------
-- Prisma cannot express CHECK constraints; drift ignores them, so they live here only.

ALTER TABLE "schedule_tasks"
  ADD CONSTRAINT "schedule_tasks_percent_range" CHECK ("percent_complete" BETWEEN 0 AND 100),
  ADD CONSTRAINT "schedule_tasks_duration_not_negative" CHECK ("duration_days" >= 0),
  ADD CONSTRAINT "schedule_tasks_not_own_parent" CHECK ("parent_id" IS NULL OR "parent_id" <> "id"),
  -- A dated constraint carries its date; "as soon as possible" has none to carry.
  ADD CONSTRAINT "schedule_tasks_constraint_dated" CHECK (("constraint_type" = 'asap') = ("constraint_date" IS NULL)),
  ADD CONSTRAINT "schedule_tasks_actuals_in_order" CHECK (
    "actual_start" IS NULL OR "actual_finish" IS NULL OR "actual_finish" >= "actual_start"
  );

ALTER TABLE "schedule_dependencies"
  ADD CONSTRAINT "schedule_dependencies_not_self" CHECK ("predecessor_id" <> "successor_id");

ALTER TABLE "schedule_calendars"
  ADD CONSTRAINT "schedule_calendars_has_working_day" CHECK (cardinality("working_days") >= 1);

-- --------------------------------------------------------------------------
-- Tenant isolation: every new table is tenant data, under the same policy as the rest.
-- --------------------------------------------------------------------------

ALTER TABLE "schedule_calendars" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "schedule_calendars" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "schedule_calendars"
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

ALTER TABLE "schedule_tasks" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "schedule_tasks" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "schedule_tasks"
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

ALTER TABLE "schedule_dependencies" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "schedule_dependencies" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "schedule_dependencies"
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

ALTER TABLE "schedule_baselines" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "schedule_baselines" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "schedule_baselines"
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

ALTER TABLE "schedule_baseline_tasks" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "schedule_baseline_tasks" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "schedule_baseline_tasks"
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- The support console's role, where it exists (the same guarded grant as procurement's tables).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sitebook_admin') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "schedule_calendars" TO sitebook_admin;
    GRANT SELECT, INSERT, UPDATE, DELETE ON "schedule_tasks" TO sitebook_admin;
    GRANT SELECT, INSERT, UPDATE, DELETE ON "schedule_dependencies" TO sitebook_admin;
    GRANT SELECT, INSERT, UPDATE, DELETE ON "schedule_baselines" TO sitebook_admin;
    GRANT SELECT, INSERT, UPDATE, DELETE ON "schedule_baseline_tasks" TO sitebook_admin;
  END IF;
END $$;

-- --------------------------------------------------------------------------
-- The audit trail. "Who moved the slab pour, and from when" is the question a programme gets asked
-- most; links and calendars change dates as surely as the tasks do, so they are attached too.
-- Baseline rows are written once and never edited, but deleting one is worth seeing.
-- --------------------------------------------------------------------------
SELECT audit_attach('schedule_calendars');
SELECT audit_attach('schedule_tasks');
SELECT audit_attach('schedule_dependencies');
SELECT audit_attach('schedule_baselines');
SELECT audit_attach('schedule_baseline_tasks');

-- --------------------------------------------------------------------------
-- The new permissions on the built-in roles
-- --------------------------------------------------------------------------
--
-- System roles read their preset from code at request time; this keeps the stored column in step
-- so it does not mislead anyone reading the table (see 20261007000100_cost_codes). FORCE is lifted
-- for the updates because migrations run NOBYPASSRLS with no tenant context.
ALTER TABLE "roles" NO FORCE ROW LEVEL SECURITY;

UPDATE "roles" SET permissions = permissions || ARRAY['schedule.view', 'schedule.manage', 'schedule.progress']
  WHERE is_system = true AND base_role = 'owner';

UPDATE "roles" SET permissions = permissions || ARRAY['schedule.view', 'schedule.manage', 'schedule.progress']
  WHERE is_system = true AND base_role = 'project_manager';

UPDATE "roles" SET permissions = permissions || ARRAY['schedule.view', 'schedule.progress']
  WHERE is_system = true AND base_role = 'site_supervisor';

UPDATE "roles" SET permissions = permissions || ARRAY['schedule.view']
  WHERE is_system = true AND base_role = 'accounts';

ALTER TABLE "roles" FORCE ROW LEVEL SECURITY;

