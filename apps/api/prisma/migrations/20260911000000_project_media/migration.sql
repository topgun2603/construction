-- Photos and videos of a site (spec §3 item 2, §8).
--
-- Separate from `dpr_photos`. Those are evidence of what happened on one day and belong to that
-- report; these are the site itself — the approach road, the elevation, the handover walkthrough —
-- and they outlive any single report.

CREATE TYPE "media_kind" AS ENUM ('photo', 'video');

CREATE TABLE "project_media" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "kind" "media_kind" NOT NULL,
    "s3_key" TEXT NOT NULL,
    "thumb_s3_key" TEXT,
    "caption" TEXT,
    "content_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "taken_at" TIMESTAMPTZ(6),
    "uploaded_by" UUID NOT NULL,
    "client_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "project_media_pkey" PRIMARY KEY ("id")
);

-- Offline uploads carry a client id so a retried sync cannot attach the same file twice.
CREATE UNIQUE INDEX "project_media_tenant_id_client_id_key"
  ON "project_media"("tenant_id", "client_id");
CREATE INDEX "project_media_project_id_created_at_idx"
  ON "project_media"("project_id", "created_at" DESC);

ALTER TABLE "project_media" ADD CONSTRAINT "project_media_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "project_media" ADD CONSTRAINT "project_media_project_id_fkey"
  FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- RESTRICT on the uploader: a deleted user must not take the site's photographs with them.
ALTER TABLE "project_media" ADD CONSTRAINT "project_media_uploaded_by_fkey"
  FOREIGN KEY ("uploaded_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "project_media" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "project_media" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "project_media" USING (tenant_id = current_tenant_id());

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sitebook_admin') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "project_media" TO sitebook_admin;
  END IF;
END $$;
