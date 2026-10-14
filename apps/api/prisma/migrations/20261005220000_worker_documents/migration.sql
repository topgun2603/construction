-- Workers' identity and work-permit papers, with expiry (roadmap Phase 1, item 3).
--
-- `number_cipher` holds only ciphertext (AES-256-GCM, encrypted by the API); the plain number is
-- never written to the database. RLS in the same migration as the table (spec §17).
CREATE TABLE "worker_documents" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "worker_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "number_cipher" TEXT NOT NULL,
    "number_hint" TEXT NOT NULL,
    "issued_on" DATE,
    "expires_on" DATE,
    "s3_key" TEXT,
    "reminded_at" TIMESTAMPTZ(6),
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "worker_documents_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "worker_documents_kind_known" CHECK ("kind" IN ('passport', 'residence_visa', 'emirates_id', 'labour_card', 'iqama', 'work_permit', 'other')),
    CONSTRAINT "worker_documents_cipher_only" CHECK ("number_cipher" LIKE 'v1:%')
);

CREATE INDEX "worker_documents_tenant_id_expires_on_idx" ON "worker_documents"("tenant_id", "expires_on");
CREATE INDEX "worker_documents_worker_id_idx" ON "worker_documents"("worker_id");

ALTER TABLE "worker_documents" ADD CONSTRAINT "worker_documents_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "worker_documents" ADD CONSTRAINT "worker_documents_worker_id_fkey" FOREIGN KEY ("worker_id") REFERENCES "workers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "worker_documents" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "worker_documents" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "worker_documents"
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());
