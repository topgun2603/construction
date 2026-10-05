-- Labour camps and the transport from them (roadmap Phase 1, item 4).
-- RLS in the same migration as the table (spec §17).
CREATE TABLE "camps" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT,
    "capacity" INTEGER,
    "transport_note" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "camps_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "camps_capacity_positive" CHECK ("capacity" IS NULL OR "capacity" > 0)
);

CREATE INDEX "camps_tenant_id_idx" ON "camps"("tenant_id");
ALTER TABLE "camps" ADD CONSTRAINT "camps_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "camps" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "camps" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "camps"
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- Which camp a worker lives in. A camp that is deleted leaves its residents unassigned.
ALTER TABLE "workers" ADD COLUMN "camp_id" UUID;
CREATE INDEX "workers_camp_id_idx" ON "workers"("camp_id");
ALTER TABLE "workers" ADD CONSTRAINT "workers_camp_id_fkey" FOREIGN KEY ("camp_id") REFERENCES "camps"("id") ON DELETE SET NULL ON UPDATE CASCADE;
