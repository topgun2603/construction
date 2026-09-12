-- What the client owes, what they have paid, and what they have signed off.
--
-- Two features, one migration, because they are the same half of the relationship: the part of a
-- job the client is answerable for rather than the part the builder is.
--
-- The money here is money coming *in*, and it is deliberately not the same table as `expenses` or
-- `labour_payments`, which are money going out. The difference between the two is the margin on the
-- job. Keeping them apart is what lets a client be shown one and never the other — a single
-- "payments" table with a direction column would put the builder's cost one forgotten `WHERE`
-- clause away from the person paying the bill.

CREATE TYPE "approval_status" AS ENUM ('pending', 'approved', 'rejected');

-- --------------------------------------------------------------------------
-- The schedule: what is owed, and when
-- --------------------------------------------------------------------------

CREATE TABLE "payment_stages" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "project_id" UUID NOT NULL,
  -- Optional, because a schedule is usually tied to the build but does not have to be. "On
  -- completion of the slab" is a milestone; "On signing" is not.
  "milestone_id" UUID,
  "label" TEXT NOT NULL,
  -- Paise. Never a float, never a numeric — see ADR 0003.
  "amount" BIGINT NOT NULL,
  "due_date" DATE,
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  /*
   * When the builder actually asked the client for this instalment.
   *
   * Deliberately an instant rather than a status column. "Upcoming", "due" and "paid" are then
   * derived — from this and from the receipts below — and cannot drift out of step with the money
   * the way a status somebody forgot to update always does.
   */
  "raised_at" TIMESTAMPTZ(6),
  "client_id" UUID,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deleted_at" TIMESTAMPTZ(6),

  CONSTRAINT "payment_stages_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "payment_stages_tenant_id_fkey" FOREIGN KEY ("tenant_id")
    REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "payment_stages_project_id_fkey" FOREIGN KEY ("project_id")
    REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "payment_stages_milestone_id_fkey" FOREIGN KEY ("milestone_id")
    REFERENCES "milestones"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  -- A negative instalment is a credit note, which this product does not have a concept of yet.
  -- Better to refuse it than to quietly produce a schedule that sums to less than its parts.
  CONSTRAINT "payment_stages_amount_positive" CHECK ("amount" > 0)
);

CREATE UNIQUE INDEX "payment_stages_tenant_id_client_id_key"
  ON "payment_stages"("tenant_id", "client_id");
CREATE INDEX "payment_stages_project_id_sort_order_idx"
  ON "payment_stages"("project_id", "sort_order");

-- --------------------------------------------------------------------------
-- The receipts: what actually arrived
-- --------------------------------------------------------------------------

CREATE TABLE "client_payments" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "project_id" UUID NOT NULL,
  -- Unallocated money is real: a client transfers a round sum against no particular stage, and
  -- somebody reconciles it later. It still has to be counted against the total.
  "stage_id" UUID,
  "amount" BIGINT NOT NULL,
  "received_on" DATE NOT NULL,
  "mode" "payment_mode" NOT NULL DEFAULT 'bank',
  "reference" TEXT,
  "note" TEXT,
  "recorded_by" UUID NOT NULL,
  "client_id" UUID,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deleted_at" TIMESTAMPTZ(6),

  CONSTRAINT "client_payments_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "client_payments_tenant_id_fkey" FOREIGN KEY ("tenant_id")
    REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "client_payments_project_id_fkey" FOREIGN KEY ("project_id")
    REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "client_payments_stage_id_fkey" FOREIGN KEY ("stage_id")
    REFERENCES "payment_stages"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "client_payments_recorded_by_fkey" FOREIGN KEY ("recorded_by")
    REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "client_payments_amount_positive" CHECK ("amount" > 0)
);

CREATE UNIQUE INDEX "client_payments_tenant_id_client_id_key"
  ON "client_payments"("tenant_id", "client_id");
CREATE INDEX "client_payments_project_id_received_on_idx"
  ON "client_payments"("project_id", "received_on" DESC);
CREATE INDEX "client_payments_stage_id_idx" ON "client_payments"("stage_id");

-- --------------------------------------------------------------------------
-- Approvals
-- --------------------------------------------------------------------------

CREATE TABLE "approvals" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "project_id" UUID NOT NULL,
  -- Usually the drawing or the quote being approved. Kept as a reference rather than a copy, so
  -- the approval always points at the revision that was current when it was asked for.
  "document_id" UUID,
  "title" TEXT NOT NULL,
  "body" TEXT NOT NULL DEFAULT '',
  "status" "approval_status" NOT NULL DEFAULT 'pending',
  "requested_by" UUID NOT NULL,
  /*
   * Who actually decided, and when.
   *
   * This is the entire point of the table. An approval that does not name its decider settles
   * nothing six months later, when the argument is whether the client ever agreed to the granite.
   */
  "decided_by" UUID,
  "decided_at" TIMESTAMPTZ(6),
  "decision_note" TEXT,
  "client_id" UUID,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deleted_at" TIMESTAMPTZ(6),

  CONSTRAINT "approvals_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "approvals_tenant_id_fkey" FOREIGN KEY ("tenant_id")
    REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "approvals_project_id_fkey" FOREIGN KEY ("project_id")
    REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "approvals_document_id_fkey" FOREIGN KEY ("document_id")
    REFERENCES "documents"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "approvals_requested_by_fkey" FOREIGN KEY ("requested_by")
    REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "approvals_decided_by_fkey" FOREIGN KEY ("decided_by")
    REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  -- Decided means all three, or none of them. A row claiming to be approved with nobody's name on
  -- it is exactly the row somebody would forge by hand.
  CONSTRAINT "approvals_decision_is_whole" CHECK (
    ("status"::text = 'pending') = ("decided_by" IS NULL AND "decided_at" IS NULL)
  )
);

CREATE UNIQUE INDEX "approvals_tenant_id_client_id_key" ON "approvals"("tenant_id", "client_id");
CREATE INDEX "approvals_project_id_status_created_at_idx"
  ON "approvals"("project_id", "status", "created_at" DESC);

-- --------------------------------------------------------------------------
-- Tenancy
-- --------------------------------------------------------------------------

ALTER TABLE "payment_stages" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "payment_stages" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "payment_stages" USING (tenant_id = current_tenant_id());

ALTER TABLE "client_payments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "client_payments" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "client_payments" USING (tenant_id = current_tenant_id());

ALTER TABLE "approvals" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "approvals" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "approvals" USING (tenant_id = current_tenant_id());

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sitebook_admin') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "payment_stages" TO sitebook_admin;
    GRANT SELECT, INSERT, UPDATE, DELETE ON "client_payments" TO sitebook_admin;
    GRANT SELECT, INSERT, UPDATE, DELETE ON "approvals" TO sitebook_admin;
  END IF;
END $$;

-- --------------------------------------------------------------------------
-- The new permissions on the built-in roles
-- --------------------------------------------------------------------------
--
-- System roles read their preset from code at request time, so this is the stored column catching
-- up rather than the source of truth — but a column that disagrees with the code is a trap for the
-- next person reading the table.
--
-- FORCE is lifted for the updates: migrations run as `sitebook_app`, which owns the table and is
-- NOBYPASSRLS, and with no tenant context set the policy matches nothing.
ALTER TABLE "roles" NO FORCE ROW LEVEL SECURITY;

UPDATE "roles" SET permissions = permissions
  || ARRAY['client_payments.view', 'client_payments.manage', 'approvals.request', 'approvals.decide']
  WHERE is_system = true AND base_role = 'owner';

UPDATE "roles" SET permissions = permissions || ARRAY['client_payments.view', 'approvals.request']
  WHERE is_system = true AND base_role = 'project_manager';

UPDATE "roles" SET permissions = permissions || ARRAY['approvals.request']
  WHERE is_system = true AND base_role = 'site_supervisor';

UPDATE "roles" SET permissions = permissions || ARRAY['client_payments.view', 'client_payments.manage']
  WHERE is_system = true AND base_role = 'accounts';

UPDATE "roles" SET permissions = permissions || ARRAY['client_payments.view', 'approvals.decide']
  WHERE is_system = true AND base_role = 'client';

ALTER TABLE "roles" FORCE ROW LEVEL SECURITY;
