-- Materials stock (spec §3 item 10, §7 Phase 2).
--
-- Two tables. `material_estimates` is what a site is expected to consume; `stock_movements` is
-- an append-only ledger of what actually arrived and what was used.
--
-- A ledger rather than a `stock_on_hand` balance column: stock is the sum of its movements, so
-- "why do we have 12 bags" stays answerable. A balance column would hold the number and lose
-- the reason, and the first time the site disagreed there would be nothing to check against.

CREATE TYPE "stock_movement_type" AS ENUM ('in', 'out');

CREATE TABLE "material_estimates" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "material_id" UUID NOT NULL,
    "estimated_quantity" DECIMAL(14,3) NOT NULL,
    "note" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "material_estimates_pkey" PRIMARY KEY ("id")
);

-- One estimate per material per site: two rows for the same cement would make "expected" a
-- question rather than a figure.
CREATE UNIQUE INDEX "material_estimates_project_id_material_id_key"
  ON "material_estimates"("project_id", "material_id");
CREATE INDEX "material_estimates_tenant_id_project_id_idx"
  ON "material_estimates"("tenant_id", "project_id");

CREATE TABLE "stock_movements" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "material_id" UUID NOT NULL,
    "type" "stock_movement_type" NOT NULL,
    "quantity" DECIMAL(14,3) NOT NULL,
    "moved_on" DATE NOT NULL,
    "indent_id" UUID,
    "ref" TEXT,
    "note" TEXT,
    "recorded_by" UUID NOT NULL,
    "client_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "stock_movements_pkey" PRIMARY KEY ("id")
);

-- Offline-created rows carry a client id so a retried sync cannot double-count stock (spec §7).
CREATE UNIQUE INDEX "stock_movements_tenant_id_client_id_key"
  ON "stock_movements"("tenant_id", "client_id");
CREATE INDEX "stock_movements_tenant_id_project_id_material_id_idx"
  ON "stock_movements"("tenant_id", "project_id", "material_id");
CREATE INDEX "stock_movements_project_id_moved_on_idx"
  ON "stock_movements"("project_id", "moved_on");

ALTER TABLE "material_estimates" ADD CONSTRAINT "material_estimates_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "material_estimates" ADD CONSTRAINT "material_estimates_project_id_fkey"
  FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- RESTRICT on material: deleting a material that a site has estimated or consumed would leave
-- the overrun report unable to say what the numbers were about.
ALTER TABLE "material_estimates" ADD CONSTRAINT "material_estimates_material_id_fkey"
  FOREIGN KEY ("material_id") REFERENCES "materials"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_project_id_fkey"
  FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_material_id_fkey"
  FOREIGN KEY ("material_id") REFERENCES "materials"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- SET NULL, not CASCADE: withdrawing an indent must not delete the record of material that
-- physically arrived because of it.
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_indent_id_fkey"
  FOREIGN KEY ("indent_id") REFERENCES "material_indents"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_recorded_by_fkey"
  FOREIGN KEY ("recorded_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Tenant isolation, as every tenant-scoped table (spec §6.1). FORCE so the policy binds even
-- for the table owner, which is the role migrations run as.
ALTER TABLE "material_estimates" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "material_estimates" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "material_estimates"
  USING (tenant_id = current_tenant_id());

ALTER TABLE "stock_movements" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "stock_movements" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "stock_movements"
  USING (tenant_id = current_tenant_id());

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sitebook_admin') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "material_estimates" TO sitebook_admin;
    GRANT SELECT, INSERT, UPDATE, DELETE ON "stock_movements" TO sitebook_admin;
  END IF;
END $$;
