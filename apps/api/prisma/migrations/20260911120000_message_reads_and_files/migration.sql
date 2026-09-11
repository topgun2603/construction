-- Read receipts on the site conversation, and attachments that are not photographs.
--
-- Reads are stored as a watermark per person per site, not a row per person per message. A busy job
-- with eight people on it and two thousand messages would otherwise carry sixteen thousand rows
-- saying nothing more than "everyone has caught up", and every new message would write eight more.
-- One row per reader answers the same question — a message is read by somebody whose watermark is
-- at or past it — and the table never grows with the length of the thread.

CREATE TABLE "site_message_reads" (
  "tenant_id" UUID NOT NULL,
  "project_id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  -- Everything posted at or before this instant has been seen by this person on this site.
  "last_read_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "site_message_reads_pkey" PRIMARY KEY ("project_id", "user_id"),
  CONSTRAINT "site_message_reads_tenant_id_fkey" FOREIGN KEY ("tenant_id")
    REFERENCES "tenants"("id") ON DELETE CASCADE,
  CONSTRAINT "site_message_reads_project_id_fkey" FOREIGN KEY ("project_id")
    REFERENCES "projects"("id") ON DELETE CASCADE,
  CONSTRAINT "site_message_reads_user_id_fkey" FOREIGN KEY ("user_id")
    REFERENCES "users"("id") ON DELETE CASCADE
);

CREATE INDEX "site_message_reads_tenant_id_user_id_idx"
  ON "site_message_reads"("tenant_id", "user_id");

-- The original name of a file somebody attached.
--
-- A photograph needs none — it is shown, and "IMG_20260911_094312.jpg" is noise beside the picture
-- itself. A PDF is the opposite: all anybody has to go on is the name, and a row reading
-- "application/pdf, 240 KB" is not something you can pick out of five of them.
ALTER TABLE "site_message_attachments" ADD COLUMN "filename" TEXT;

ALTER TABLE "site_message_reads" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "site_message_reads" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "site_message_reads" USING (tenant_id = current_tenant_id());

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sitebook_admin') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "site_message_reads" TO sitebook_admin;
  END IF;
END $$;
