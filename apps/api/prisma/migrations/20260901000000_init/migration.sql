-- SiteBook Phase 1 schema.
--
-- Tables, indexes and foreign keys below are Prisma-shaped (keep them in step with
-- schema.prisma; `pnpm db:drift` checks this). Everything from "Row-level security"
-- onward is hand-written and invisible to Prisma's differ.

-- `gen_random_uuid()` is in core since PostgreSQL 13, so no extension is needed —
-- which also means this migration does not require superuser.

-- CreateEnum
CREATE TYPE "plan" AS ENUM ('starter', 'pro');
CREATE TYPE "tenant_status" AS ENUM ('active', 'suspended', 'cancelled');
CREATE TYPE "user_role" AS ENUM ('owner', 'project_manager', 'site_supervisor', 'accounts', 'client');
CREATE TYPE "user_status" AS ENUM ('pending', 'active', 'disabled');
CREATE TYPE "project_status" AS ENUM ('planning', 'active', 'on_hold', 'completed');
CREATE TYPE "payment_terms" AS ENUM ('weekly', 'fortnightly', 'monthly');
CREATE TYPE "skill_level" AS ENUM ('unskilled', 'semi', 'skilled');
CREATE TYPE "worker_status" AS ENUM ('active', 'inactive');
CREATE TYPE "dpr_status" AS ENUM ('draft', 'submitted');
CREATE TYPE "attendance_status" AS ENUM ('present', 'half_day', 'absent');
CREATE TYPE "wage_period_status" AS ENUM ('open', 'finalised', 'paid');
CREATE TYPE "labour_payment_type" AS ENUM ('advance', 'wage', 'bonus', 'deduction');
CREATE TYPE "payment_mode" AS ENUM ('cash', 'upi', 'bank');
CREATE TYPE "indent_status" AS ENUM ('requested', 'approved', 'rejected', 'ordered', 'received');
CREATE TYPE "urgency" AS ENUM ('low', 'normal', 'high');
CREATE TYPE "sync_op" AS ENUM ('create', 'update');

-- CreateTable
CREATE TABLE "tenants" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL,
    "logo_url" TEXT,
    "plan" "plan" NOT NULL DEFAULT 'starter',
    "enabled_modules" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "razorpay_customer_id" TEXT,
    "status" "tenant_status" NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "tenants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "phone" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" "user_role" NOT NULL,
    "status" "user_status" NOT NULL DEFAULT 'pending',
    "fcm_tokens" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "last_login" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refresh_tokens" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "device_id" TEXT,
    "user_agent" TEXT,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "revoked_at" TIMESTAMPTZ(6),
    "replaced_by_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "projects" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "client_name" TEXT,
    "address" TEXT,
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,
    "start_date" DATE,
    "target_end_date" DATE,
    "budget_amount" BIGINT,
    "status" "project_status" NOT NULL DEFAULT 'planning',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "projects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_members" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role_on_project" "user_role" NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "project_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "milestones" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "planned_date" DATE,
    "actual_date" DATE,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "milestones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contractors" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "trade" TEXT,
    "phone" TEXT,
    "payment_terms" "payment_terms" NOT NULL DEFAULT 'weekly',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "contractors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workers" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "contractor_id" UUID,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "trade" TEXT,
    "skill_level" "skill_level" NOT NULL DEFAULT 'unskilled',
    "daily_wage" BIGINT NOT NULL,
    "overtime_rate_per_hour" BIGINT NOT NULL DEFAULT 0,
    "id_proof_s3_key" TEXT,
    "photo_s3_key" TEXT,
    "status" "worker_status" NOT NULL DEFAULT 'active',
    "client_id" UUID,
    "portal_user_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "workers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "worker_projects" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "worker_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "from_date" DATE NOT NULL,
    "to_date" DATE,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "worker_projects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "daily_reports" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "report_date" DATE NOT NULL,
    "submitted_by" UUID NOT NULL,
    "weather" TEXT,
    "work_done" TEXT,
    "issues" TEXT,
    "status" "dpr_status" NOT NULL DEFAULT 'draft',
    "submitted_at" TIMESTAMPTZ(6),
    "client_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "daily_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dpr_activities" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "daily_report_id" UUID NOT NULL,
    "activity" TEXT NOT NULL,
    "quantity" DECIMAL(14,3),
    "unit" TEXT,

    CONSTRAINT "dpr_activities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dpr_photos" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "daily_report_id" UUID NOT NULL,
    "s3_key" TEXT NOT NULL,
    "thumb_s3_key" TEXT,
    "caption" TEXT,
    "taken_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dpr_photos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dpr_manpower" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "daily_report_id" UUID NOT NULL,
    "trade" TEXT NOT NULL,
    "count" INTEGER NOT NULL,

    CONSTRAINT "dpr_manpower_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attendance" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "attendance_date" DATE NOT NULL,
    "worker_id" UUID NOT NULL,
    "status" "attendance_status" NOT NULL,
    "overtime_hours" DECIMAL(4,1) NOT NULL DEFAULT 0,
    "wage_snapshot" BIGINT NOT NULL,
    "overtime_rate_snapshot" BIGINT NOT NULL DEFAULT 0,
    "recorded_by" UUID NOT NULL,
    "recorded_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,
    "client_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "attendance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wage_periods" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "contractor_id" UUID,
    "period_start" DATE NOT NULL,
    "period_end" DATE NOT NULL,
    "status" "wage_period_status" NOT NULL DEFAULT 'open',
    "total_earned" BIGINT NOT NULL DEFAULT 0,
    "total_advances" BIGINT NOT NULL DEFAULT 0,
    "total_paid" BIGINT NOT NULL DEFAULT 0,
    "finalised_by" UUID,
    "finalised_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "wage_periods_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wage_lines" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "wage_period_id" UUID NOT NULL,
    "worker_id" UUID NOT NULL,
    "days_present" DECIMAL(4,1) NOT NULL DEFAULT 0,
    "overtime_hours" DECIMAL(4,1) NOT NULL DEFAULT 0,
    "gross_amount" BIGINT NOT NULL DEFAULT 0,
    "advances_deducted" BIGINT NOT NULL DEFAULT 0,
    "net_payable" BIGINT NOT NULL DEFAULT 0,
    "paid_amount" BIGINT NOT NULL DEFAULT 0,
    "note" TEXT,

    CONSTRAINT "wage_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "labour_payments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "project_id" UUID,
    "worker_id" UUID,
    "contractor_id" UUID,
    "wage_period_id" UUID,
    "type" "labour_payment_type" NOT NULL,
    "amount" BIGINT NOT NULL,
    "paid_on" DATE NOT NULL,
    "mode" "payment_mode" NOT NULL DEFAULT 'cash',
    "reference" TEXT,
    "note" TEXT,
    "recorded_by" UUID NOT NULL,
    "client_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "labour_payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "materials" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "category" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "materials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "material_indents" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "requested_by" UUID NOT NULL,
    "status" "indent_status" NOT NULL DEFAULT 'requested',
    "urgency" "urgency" NOT NULL DEFAULT 'normal',
    "notes" TEXT,
    "required_by" DATE,
    "approved_by" UUID,
    "approved_at" TIMESTAMPTZ(6),
    "client_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "material_indents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "indent_items" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "indent_id" UUID NOT NULL,
    "material_id" UUID NOT NULL,
    "quantity" DECIMAL(14,3) NOT NULL,
    "received_quantity" DECIMAL(14,3) NOT NULL DEFAULT 0,

    CONSTRAINT "indent_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "read_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sync_log" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "device_id" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entity_id" UUID,
    "client_id" UUID,
    "op" "sync_op" NOT NULL,
    "status" TEXT NOT NULL,
    "detail" JSONB,
    "server_ts" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sync_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auth_identities" (
    "user_id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "phone" TEXT NOT NULL,

    CONSTRAINT "auth_identities_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "actor_id" UUID,
    "action" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entity_id" UUID,
    "before" JSONB,
    "after" JSONB,
    "request_id" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_tenant_id_phone_key" ON "users"("tenant_id", "phone");
CREATE INDEX "users_tenant_id_role_idx" ON "users"("tenant_id", "role");
CREATE INDEX "users_tenant_id_updated_at_idx" ON "users"("tenant_id", "updated_at");

CREATE UNIQUE INDEX "refresh_tokens_token_hash_key" ON "refresh_tokens"("token_hash");
CREATE INDEX "refresh_tokens_user_id_expires_at_idx" ON "refresh_tokens"("user_id", "expires_at");

CREATE INDEX "projects_tenant_id_status_idx" ON "projects"("tenant_id", "status");
CREATE INDEX "projects_tenant_id_updated_at_idx" ON "projects"("tenant_id", "updated_at");

CREATE UNIQUE INDEX "project_members_project_id_user_id_key" ON "project_members"("project_id", "user_id");
CREATE INDEX "project_members_tenant_id_user_id_idx" ON "project_members"("tenant_id", "user_id");

CREATE INDEX "milestones_project_id_sort_order_idx" ON "milestones"("project_id", "sort_order");

CREATE INDEX "contractors_tenant_id_updated_at_idx" ON "contractors"("tenant_id", "updated_at");

CREATE UNIQUE INDEX "workers_tenant_id_client_id_key" ON "workers"("tenant_id", "client_id");
CREATE INDEX "workers_tenant_id_contractor_id_idx" ON "workers"("tenant_id", "contractor_id");
CREATE INDEX "workers_tenant_id_status_idx" ON "workers"("tenant_id", "status");
CREATE INDEX "workers_tenant_id_updated_at_idx" ON "workers"("tenant_id", "updated_at");

CREATE UNIQUE INDEX "worker_projects_worker_project_from_key" ON "worker_projects"("worker_id", "project_id", "from_date");
CREATE INDEX "worker_projects_project_id_from_date_to_date_idx" ON "worker_projects"("project_id", "from_date", "to_date");
CREATE INDEX "worker_projects_tenant_id_updated_at_idx" ON "worker_projects"("tenant_id", "updated_at");

CREATE UNIQUE INDEX "daily_reports_project_id_report_date_key" ON "daily_reports"("project_id", "report_date");
CREATE UNIQUE INDEX "daily_reports_tenant_id_client_id_key" ON "daily_reports"("tenant_id", "client_id");
CREATE INDEX "daily_reports_tenant_id_report_date_idx" ON "daily_reports"("tenant_id", "report_date");
CREATE INDEX "daily_reports_tenant_id_updated_at_idx" ON "daily_reports"("tenant_id", "updated_at");

CREATE INDEX "dpr_activities_daily_report_id_idx" ON "dpr_activities"("daily_report_id");
CREATE INDEX "dpr_photos_daily_report_id_idx" ON "dpr_photos"("daily_report_id");
CREATE UNIQUE INDEX "dpr_manpower_daily_report_id_trade_key" ON "dpr_manpower"("daily_report_id", "trade");

CREATE UNIQUE INDEX "attendance_project_date_worker_key" ON "attendance"("project_id", "attendance_date", "worker_id");
CREATE UNIQUE INDEX "attendance_tenant_id_client_id_key" ON "attendance"("tenant_id", "client_id");
CREATE INDEX "attendance_tenant_id_attendance_date_idx" ON "attendance"("tenant_id", "attendance_date");
CREATE INDEX "attendance_worker_id_attendance_date_idx" ON "attendance"("worker_id", "attendance_date");
CREATE INDEX "attendance_tenant_id_updated_at_idx" ON "attendance"("tenant_id", "updated_at");

CREATE INDEX "wage_periods_tenant_id_period_start_period_end_idx" ON "wage_periods"("tenant_id", "period_start", "period_end");
CREATE INDEX "wage_periods_tenant_id_status_idx" ON "wage_periods"("tenant_id", "status");

CREATE UNIQUE INDEX "wage_lines_wage_period_id_worker_id_key" ON "wage_lines"("wage_period_id", "worker_id");
CREATE INDEX "wage_lines_tenant_id_worker_id_idx" ON "wage_lines"("tenant_id", "worker_id");

CREATE UNIQUE INDEX "labour_payments_tenant_id_client_id_key" ON "labour_payments"("tenant_id", "client_id");
CREATE INDEX "labour_payments_tenant_id_worker_id_paid_on_idx" ON "labour_payments"("tenant_id", "worker_id", "paid_on");
CREATE INDEX "labour_payments_tenant_id_contractor_id_paid_on_idx" ON "labour_payments"("tenant_id", "contractor_id", "paid_on");
CREATE INDEX "labour_payments_tenant_id_updated_at_idx" ON "labour_payments"("tenant_id", "updated_at");

CREATE UNIQUE INDEX "materials_tenant_id_name_key" ON "materials"("tenant_id", "name");
CREATE INDEX "materials_tenant_id_updated_at_idx" ON "materials"("tenant_id", "updated_at");

CREATE UNIQUE INDEX "material_indents_tenant_id_client_id_key" ON "material_indents"("tenant_id", "client_id");
CREATE INDEX "material_indents_tenant_id_status_idx" ON "material_indents"("tenant_id", "status");
CREATE INDEX "material_indents_project_id_created_at_idx" ON "material_indents"("project_id", "created_at");
CREATE INDEX "material_indents_tenant_id_updated_at_idx" ON "material_indents"("tenant_id", "updated_at");

CREATE UNIQUE INDEX "indent_items_indent_id_material_id_key" ON "indent_items"("indent_id", "material_id");

CREATE INDEX "notifications_user_id_read_at_created_at_idx" ON "notifications"("user_id", "read_at", "created_at");

CREATE INDEX "sync_log_tenant_id_device_id_server_ts_idx" ON "sync_log"("tenant_id", "device_id", "server_ts");
CREATE INDEX "sync_log_tenant_id_entity_server_ts_idx" ON "sync_log"("tenant_id", "entity", "server_ts");

CREATE UNIQUE INDEX "auth_identities_phone_tenant_id_key" ON "auth_identities"("phone", "tenant_id");
CREATE INDEX "auth_identities_phone_idx" ON "auth_identities"("phone");

CREATE INDEX "audit_logs_tenant_id_entity_entity_id_idx" ON "audit_logs"("tenant_id", "entity", "entity_id");
CREATE INDEX "audit_logs_tenant_id_created_at_idx" ON "audit_logs"("tenant_id", "created_at");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "projects" ADD CONSTRAINT "projects_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "project_members" ADD CONSTRAINT "project_members_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "project_members" ADD CONSTRAINT "project_members_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "project_members" ADD CONSTRAINT "project_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "milestones" ADD CONSTRAINT "milestones_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "milestones" ADD CONSTRAINT "milestones_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "contractors" ADD CONSTRAINT "contractors_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "workers" ADD CONSTRAINT "workers_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "workers" ADD CONSTRAINT "workers_contractor_id_fkey" FOREIGN KEY ("contractor_id") REFERENCES "contractors"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "workers" ADD CONSTRAINT "workers_portal_user_id_fkey" FOREIGN KEY ("portal_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "worker_projects" ADD CONSTRAINT "worker_projects_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "worker_projects" ADD CONSTRAINT "worker_projects_worker_id_fkey" FOREIGN KEY ("worker_id") REFERENCES "workers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "worker_projects" ADD CONSTRAINT "worker_projects_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "daily_reports" ADD CONSTRAINT "daily_reports_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "daily_reports" ADD CONSTRAINT "daily_reports_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "daily_reports" ADD CONSTRAINT "daily_reports_submitted_by_fkey" FOREIGN KEY ("submitted_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "dpr_activities" ADD CONSTRAINT "dpr_activities_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "dpr_activities" ADD CONSTRAINT "dpr_activities_daily_report_id_fkey" FOREIGN KEY ("daily_report_id") REFERENCES "daily_reports"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "dpr_photos" ADD CONSTRAINT "dpr_photos_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "dpr_photos" ADD CONSTRAINT "dpr_photos_daily_report_id_fkey" FOREIGN KEY ("daily_report_id") REFERENCES "daily_reports"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "dpr_manpower" ADD CONSTRAINT "dpr_manpower_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "dpr_manpower" ADD CONSTRAINT "dpr_manpower_daily_report_id_fkey" FOREIGN KEY ("daily_report_id") REFERENCES "daily_reports"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "attendance" ADD CONSTRAINT "attendance_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "attendance" ADD CONSTRAINT "attendance_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "attendance" ADD CONSTRAINT "attendance_worker_id_fkey" FOREIGN KEY ("worker_id") REFERENCES "workers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "attendance" ADD CONSTRAINT "attendance_recorded_by_fkey" FOREIGN KEY ("recorded_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "wage_periods" ADD CONSTRAINT "wage_periods_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "wage_periods" ADD CONSTRAINT "wage_periods_contractor_id_fkey" FOREIGN KEY ("contractor_id") REFERENCES "contractors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "wage_periods" ADD CONSTRAINT "wage_periods_finalised_by_fkey" FOREIGN KEY ("finalised_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "wage_lines" ADD CONSTRAINT "wage_lines_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "wage_lines" ADD CONSTRAINT "wage_lines_wage_period_id_fkey" FOREIGN KEY ("wage_period_id") REFERENCES "wage_periods"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "wage_lines" ADD CONSTRAINT "wage_lines_worker_id_fkey" FOREIGN KEY ("worker_id") REFERENCES "workers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "labour_payments" ADD CONSTRAINT "labour_payments_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "labour_payments" ADD CONSTRAINT "labour_payments_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "labour_payments" ADD CONSTRAINT "labour_payments_worker_id_fkey" FOREIGN KEY ("worker_id") REFERENCES "workers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "labour_payments" ADD CONSTRAINT "labour_payments_contractor_id_fkey" FOREIGN KEY ("contractor_id") REFERENCES "contractors"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "labour_payments" ADD CONSTRAINT "labour_payments_wage_period_id_fkey" FOREIGN KEY ("wage_period_id") REFERENCES "wage_periods"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "labour_payments" ADD CONSTRAINT "labour_payments_recorded_by_fkey" FOREIGN KEY ("recorded_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "materials" ADD CONSTRAINT "materials_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "material_indents" ADD CONSTRAINT "material_indents_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "material_indents" ADD CONSTRAINT "material_indents_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "material_indents" ADD CONSTRAINT "material_indents_requested_by_fkey" FOREIGN KEY ("requested_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "material_indents" ADD CONSTRAINT "material_indents_approved_by_fkey" FOREIGN KEY ("approved_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "indent_items" ADD CONSTRAINT "indent_items_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "indent_items" ADD CONSTRAINT "indent_items_indent_id_fkey" FOREIGN KEY ("indent_id") REFERENCES "material_indents"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "indent_items" ADD CONSTRAINT "indent_items_material_id_fkey" FOREIGN KEY ("material_id") REFERENCES "materials"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "notifications" ADD CONSTRAINT "notifications_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "sync_log" ADD CONSTRAINT "sync_log_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ===========================================================================
-- Row-level security (spec §6.1)
--
-- Every tenant-scoped table is filtered on `app.tenant_id`, which
-- TenantMiddleware sets with SET LOCAL inside the request transaction.
--
-- FORCE ROW LEVEL SECURITY is deliberate: without it the table owner — which is
-- whoever runs the migrations, and in local dev is also the app's login role —
-- silently bypasses every policy, and the tenancy isolation test would pass
-- while proving nothing. The consequence is that *all* row access needs
-- `app.tenant_id` set, including the seed script; superadmin work uses a
-- separate BYPASSRLS role (see infra/sql/superadmin-role.sql).
--
-- `current_setting(..., true)` returns NULL when unset, so an untenanted query
-- matches no rows rather than erroring: fail closed.
-- ===========================================================================

CREATE OR REPLACE FUNCTION current_tenant_id() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.tenant_id', true), '')::uuid
$$;

-- `tenants` has no tenant_id column; it is scoped by its own primary key.
ALTER TABLE "tenants" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tenants" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "tenants"
  USING ("id" = current_tenant_id())
  WITH CHECK ("id" = current_tenant_id());

DO $$
DECLARE
  t text;
  tenant_tables text[] := ARRAY[
    'users', 'refresh_tokens', 'projects', 'project_members', 'milestones',
    'contractors', 'workers', 'worker_projects', 'daily_reports',
    'dpr_activities', 'dpr_photos', 'dpr_manpower', 'attendance',
    'wage_periods', 'wage_lines', 'labour_payments', 'materials',
    'material_indents', 'indent_items', 'notifications', 'sync_log',
    'audit_logs'
  ];
BEGIN
  FOREACH t IN ARRAY tenant_tables LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id())',
      t
    );
  END LOOP;
END $$;

-- ===========================================================================
-- auth_identities: the one table with no RLS.
--
-- /auth/exchange receives a phone number and must find which tenant it belongs
-- to before any tenant context can exist. Rather than give the auth module an
-- RLS-bypassing connection, that single lookup reads this directory, which holds
-- nothing but a phone and two ids. A trigger keeps it in step with `users` so
-- application code never writes it and cannot let it drift.
-- ===========================================================================

CREATE OR REPLACE FUNCTION sync_auth_identity() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF (TG_OP = 'DELETE') THEN
    DELETE FROM auth_identities WHERE user_id = OLD.id;
    RETURN OLD;
  END IF;

  -- A soft-deleted or disabled user must not resolve to a tenant at login.
  IF (NEW.deleted_at IS NOT NULL) THEN
    DELETE FROM auth_identities WHERE user_id = NEW.id;
    RETURN NEW;
  END IF;

  INSERT INTO auth_identities (user_id, tenant_id, phone)
  VALUES (NEW.id, NEW.tenant_id, NEW.phone)
  ON CONFLICT (user_id) DO UPDATE
    SET tenant_id = EXCLUDED.tenant_id, phone = EXCLUDED.phone;

  RETURN NEW;
END $$;

CREATE TRIGGER users_sync_auth_identity
AFTER INSERT OR UPDATE OF phone, tenant_id, deleted_at OR DELETE ON "users"
FOR EACH ROW EXECUTE FUNCTION sync_auth_identity();
