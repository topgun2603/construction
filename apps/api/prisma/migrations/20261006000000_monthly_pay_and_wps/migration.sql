-- Monthly salaried workers and the UAE Wage Protection System (roadmap Phase 1, items 1 and 2).

-- Pay basis and salary components. Every existing worker is daily, as before.
ALTER TABLE "workers"
  ADD COLUMN "pay_basis" TEXT NOT NULL DEFAULT 'daily',
  ADD COLUMN "basic_salary" BIGINT,
  ADD COLUMN "housing_allowance" BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN "transport_allowance" BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN "food_allowance" BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN "wps_person_id" TEXT,
  ADD COLUMN "wps_agent_code" TEXT,
  ADD COLUMN "wps_account" TEXT;

ALTER TABLE "workers"
  ADD CONSTRAINT "workers_pay_basis_known" CHECK ("pay_basis" IN ('daily', 'monthly')),
  ADD CONSTRAINT "workers_monthly_has_salary" CHECK ("pay_basis" = 'daily' OR "basic_salary" IS NOT NULL),
  ADD CONSTRAINT "workers_wps_person_id_format" CHECK ("wps_person_id" IS NULL OR "wps_person_id" ~ '^[0-9]{14}$'),
  ADD CONSTRAINT "workers_wps_agent_code_format" CHECK ("wps_agent_code" IS NULL OR "wps_agent_code" ~ '^[0-9]{9}$');

ALTER TABLE "tenants"
  ADD COLUMN "wps_employer_id" TEXT,
  ADD COLUMN "wps_bank_code" TEXT;

ALTER TABLE "tenants"
  ADD CONSTRAINT "tenants_wps_employer_id_format" CHECK ("wps_employer_id" IS NULL OR "wps_employer_id" ~ '^[0-9]{13}$'),
  ADD CONSTRAINT "tenants_wps_bank_code_format" CHECK ("wps_bank_code" IS NULL OR "wps_bank_code" ~ '^[0-9]{9}$');

-- The fixed / variable split a salary file needs. Lines generated before this split existed are
-- all fixed: their overtime was folded into the gross and cannot be separated now.
ALTER TABLE "wage_lines"
  ADD COLUMN "fixed_amount" BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN "variable_amount" BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN "leave_days" DECIMAL(4,1) NOT NULL DEFAULT 0;
UPDATE "wage_lines" SET "fixed_amount" = "gross_amount";
