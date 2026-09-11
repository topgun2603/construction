-- Site expenses and petty cash (spec §3 item 9, §7).
--
-- The RLS policy is created here, in the same migration as the table, so the
-- window where the table exists unprotected is zero (spec §17).

-- CreateEnum
CREATE TYPE "expense_status" AS ENUM ('pending', 'approved', 'rejected');

-- CreateTable
CREATE TABLE "expenses" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "amount" BIGINT NOT NULL,
    "category" TEXT NOT NULL,
    "spent_on" DATE NOT NULL,
    "bill_s3_key" TEXT,
    "note" TEXT,
    "status" "expense_status" NOT NULL DEFAULT 'pending',
    "submitted_by" UUID NOT NULL,
    "approved_by" UUID,
    "approved_at" TIMESTAMPTZ(6),
    "client_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "expenses_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "expenses_tenant_id_client_id_key" ON "expenses"("tenant_id", "client_id");
CREATE INDEX "expenses_tenant_id_status_idx" ON "expenses"("tenant_id", "status");
CREATE INDEX "expenses_tenant_id_spent_on_idx" ON "expenses"("tenant_id", "spent_on");
CREATE INDEX "expenses_project_id_spent_on_idx" ON "expenses"("project_id", "spent_on");
CREATE INDEX "expenses_tenant_id_updated_at_idx" ON "expenses"("tenant_id", "updated_at");

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_submitted_by_fkey" FOREIGN KEY ("submitted_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_approved_by_fkey" FOREIGN KEY ("approved_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Row-level security, same shape as every other tenant table (ADR 0001).
-- FORCE so the policy binds even for the role that owns the table.
ALTER TABLE "expenses" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "expenses" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "expenses"
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());
