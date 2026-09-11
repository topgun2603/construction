-- The site conversation, and documents with revisions.
--
-- Two features, one migration, because they are the same promise to the same person: everything a
-- client asks and everything they are sent should live against the job rather than in a WhatsApp
-- thread on a phone that gets replaced.

CREATE TYPE "message_audience" AS ENUM ('everyone', 'team');

CREATE TYPE "document_category" AS ENUM (
  'drawing',
  'contract',
  'approval',
  'permit',
  'invoice',
  'other'
);

CREATE TABLE "site_messages" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "project_id" UUID NOT NULL,
  "author_id" UUID NOT NULL,
  "body" TEXT NOT NULL,
  "audience" "message_audience" NOT NULL DEFAULT 'everyone',
  "client_id" UUID,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deleted_at" TIMESTAMPTZ(6),

  CONSTRAINT "site_messages_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "site_messages_tenant_id_fkey" FOREIGN KEY ("tenant_id")
    REFERENCES "tenants"("id") ON DELETE CASCADE,
  CONSTRAINT "site_messages_project_id_fkey" FOREIGN KEY ("project_id")
    REFERENCES "projects"("id") ON DELETE CASCADE,
  CONSTRAINT "site_messages_author_id_fkey" FOREIGN KEY ("author_id")
    REFERENCES "users"("id") ON DELETE RESTRICT
);

CREATE UNIQUE INDEX "site_messages_tenant_id_client_id_key"
  ON "site_messages"("tenant_id", "client_id");
CREATE INDEX "site_messages_project_id_created_at_idx"
  ON "site_messages"("project_id", "created_at" DESC);

CREATE TABLE "site_message_attachments" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "message_id" UUID NOT NULL,
  "s3_key" TEXT NOT NULL,
  "thumb_s3_key" TEXT,
  "content_type" TEXT NOT NULL,
  "size_bytes" INTEGER NOT NULL,
  "caption" TEXT,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "site_message_attachments_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "site_message_attachments_tenant_id_fkey" FOREIGN KEY ("tenant_id")
    REFERENCES "tenants"("id") ON DELETE CASCADE,
  CONSTRAINT "site_message_attachments_message_id_fkey" FOREIGN KEY ("message_id")
    REFERENCES "site_messages"("id") ON DELETE CASCADE
);

CREATE INDEX "site_message_attachments_message_id_idx"
  ON "site_message_attachments"("message_id");

CREATE TABLE "documents" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "project_id" UUID,
  "family_id" UUID NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "title" TEXT NOT NULL,
  "category" "document_category" NOT NULL DEFAULT 'other',
  "s3_key" TEXT NOT NULL,
  "content_type" TEXT NOT NULL,
  "size_bytes" INTEGER NOT NULL,
  "visible_to_client" BOOLEAN NOT NULL DEFAULT false,
  "uploaded_by" UUID NOT NULL,
  "client_id" UUID,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deleted_at" TIMESTAMPTZ(6),

  CONSTRAINT "documents_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "documents_tenant_id_fkey" FOREIGN KEY ("tenant_id")
    REFERENCES "tenants"("id") ON DELETE CASCADE,
  CONSTRAINT "documents_project_id_fkey" FOREIGN KEY ("project_id")
    REFERENCES "projects"("id") ON DELETE CASCADE,
  CONSTRAINT "documents_uploaded_by_fkey" FOREIGN KEY ("uploaded_by")
    REFERENCES "users"("id") ON DELETE RESTRICT
);

CREATE UNIQUE INDEX "documents_tenant_id_client_id_key"
  ON "documents"("tenant_id", "client_id");

-- Two rows claiming to be revision 3 of the same drawing is the one thing this table must never
-- allow: "which one was current when the slab was poured" has to have an answer.
CREATE UNIQUE INDEX "documents_family_id_version_key" ON "documents"("family_id", "version");

CREATE INDEX "documents_tenant_id_project_id_created_at_idx"
  ON "documents"("tenant_id", "project_id", "created_at" DESC);

-- Tenancy, the same way as every other table here: the policy binds the owner too, so a query
-- without `app.tenant_id` set reads nothing rather than everything.
ALTER TABLE "site_messages" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "site_messages" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "site_messages" USING (tenant_id = current_tenant_id());

ALTER TABLE "site_message_attachments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "site_message_attachments" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "site_message_attachments"
  USING (tenant_id = current_tenant_id());

ALTER TABLE "documents" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "documents" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "documents" USING (tenant_id = current_tenant_id());

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sitebook_admin') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "site_messages" TO sitebook_admin;
    GRANT SELECT, INSERT, UPDATE, DELETE ON "site_message_attachments" TO sitebook_admin;
    GRANT SELECT, INSERT, UPDATE, DELETE ON "documents" TO sitebook_admin;
  END IF;
END $$;

-- The new permissions on the built-in roles.
--
-- System roles read their preset from code at request time, so this is the stored column catching
-- up rather than the source of truth — but a column that disagrees with the code is a trap for the
-- next person reading the table.
--
-- FORCE is lifted for the update: migrations run as `sitebook_app`, which owns the table and is
-- NOBYPASSRLS, and with no tenant context set the policy matches nothing, so the UPDATE would
-- silently touch zero rows.
ALTER TABLE "roles" NO FORCE ROW LEVEL SECURITY;

UPDATE "roles" SET permissions = permissions || ARRAY['messages.post', 'messages.internal', 'documents.view', 'documents.manage']
  WHERE is_system = true AND base_role = 'owner';

UPDATE "roles" SET permissions = permissions || ARRAY['messages.post', 'messages.internal', 'documents.view', 'documents.manage']
  WHERE is_system = true AND base_role = 'project_manager';

UPDATE "roles" SET permissions = permissions || ARRAY['messages.post', 'messages.internal', 'documents.view']
  WHERE is_system = true AND base_role IN ('site_supervisor', 'accounts');

-- The client writes and reads what was shared. Deliberately not `messages.internal`.
UPDATE "roles" SET permissions = permissions || ARRAY['messages.post', 'documents.view']
  WHERE is_system = true AND base_role = 'client';

ALTER TABLE "roles" FORCE ROW LEVEL SECURITY;
