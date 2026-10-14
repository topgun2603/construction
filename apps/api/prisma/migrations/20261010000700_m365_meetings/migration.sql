-- CreateTable
CREATE TABLE "integration_m365_connections" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'connected',
    "mailbox_email" TEXT NOT NULL,
    "mailbox_name" TEXT,
    "ms_user_id" TEXT,
    "scopes" TEXT NOT NULL,
    "refresh_token_cipher" TEXT NOT NULL,
    "refresh_token_rotated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "access_token_cipher" TEXT,
    "access_token_expires_at" TIMESTAMPTZ(6),
    "calendar_sync" BOOLEAN NOT NULL DEFAULT false,
    "calendar_synced_at" TIMESTAMPTZ(6),
    "last_error" TEXT,
    "last_used_at" TIMESTAMPTZ(6),
    "connected_by_user_id" UUID,
    "connected_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "integration_m365_connections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "integration_m365_auth_requests" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "state_hash" TEXT NOT NULL,
    "pkce_verifier_cipher" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "used_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "integration_m365_auth_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "integration_m365_calendar_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "source_type" TEXT NOT NULL,
    "source_id" UUID NOT NULL,
    "graph_event_id" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "synced_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "integration_m365_calendar_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_deliveries" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "entity_type" TEXT,
    "entity_id" UUID,
    "project_id" UUID,
    "from_email" TEXT NOT NULL,
    "to_emails" TEXT[],
    "cc_emails" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "subject" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "provider_request_id" TEXT,
    "error" TEXT,
    "sent_at" TIMESTAMPTZ(6),
    "sent_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "email_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "meetings" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "starts_at" TIMESTAMPTZ(6) NOT NULL,
    "ends_at" TIMESTAMPTZ(6) NOT NULL,
    "location" TEXT,
    "agenda" TEXT,
    "minutes" TEXT,
    "status" TEXT NOT NULL DEFAULT 'scheduled',
    "graph_event_id" TEXT,
    "invite_sent_at" TIMESTAMPTZ(6),
    "minutes_sent_at" TIMESTAMPTZ(6),
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "meetings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "meeting_attendees" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "meeting_id" UUID NOT NULL,
    "user_id" UUID,
    "email" TEXT,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "meeting_attendees_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "meeting_action_items" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "meeting_id" UUID NOT NULL,
    "description" TEXT NOT NULL,
    "owner_user_id" UUID,
    "owner_name" TEXT,
    "due_on" DATE,
    "status" TEXT NOT NULL DEFAULT 'open',
    "completed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "meeting_action_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "integration_m365_connections_tenant_id_key" ON "integration_m365_connections"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "integration_m365_auth_requests_state_hash_key" ON "integration_m365_auth_requests"("state_hash");

-- CreateIndex
CREATE INDEX "integration_m365_auth_requests_tenant_id_created_at_idx" ON "integration_m365_auth_requests"("tenant_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "integration_m365_calendar_events_tenant_id_source_type_sour_key" ON "integration_m365_calendar_events"("tenant_id", "source_type", "source_id");

-- CreateIndex
CREATE INDEX "email_deliveries_tenant_id_entity_type_entity_id_idx" ON "email_deliveries"("tenant_id", "entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "email_deliveries_tenant_id_created_at_idx" ON "email_deliveries"("tenant_id", "created_at");

-- CreateIndex
CREATE INDEX "meetings_tenant_id_project_id_starts_at_idx" ON "meetings"("tenant_id", "project_id", "starts_at");

-- CreateIndex
CREATE INDEX "meeting_attendees_meeting_id_idx" ON "meeting_attendees"("meeting_id");

-- CreateIndex
CREATE INDEX "meeting_action_items_meeting_id_idx" ON "meeting_action_items"("meeting_id");

-- CreateIndex
CREATE INDEX "meeting_action_items_tenant_id_owner_user_id_status_idx" ON "meeting_action_items"("tenant_id", "owner_user_id", "status");

-- AddForeignKey
ALTER TABLE "integration_m365_connections" ADD CONSTRAINT "integration_m365_connections_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "integration_m365_auth_requests" ADD CONSTRAINT "integration_m365_auth_requests_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "integration_m365_calendar_events" ADD CONSTRAINT "integration_m365_calendar_events_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_deliveries" ADD CONSTRAINT "email_deliveries_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meeting_attendees" ADD CONSTRAINT "meeting_attendees_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meeting_attendees" ADD CONSTRAINT "meeting_attendees_meeting_id_fkey" FOREIGN KEY ("meeting_id") REFERENCES "meetings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meeting_action_items" ADD CONSTRAINT "meeting_action_items_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meeting_action_items" ADD CONSTRAINT "meeting_action_items_meeting_id_fkey" FOREIGN KEY ("meeting_id") REFERENCES "meetings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- --------------------------------------------------------------------------
-- Rules the schema cannot express
-- --------------------------------------------------------------------------

ALTER TABLE "integration_m365_connections"
  ADD CONSTRAINT "integration_m365_connections_status_known" CHECK ("status" IN ('connected', 'needs_reconnect')),
  -- Ciphertext only, never a token in the clear (FieldCipher's `v1:` prefix).
  ADD CONSTRAINT "integration_m365_connections_cipher_only" CHECK (
    "refresh_token_cipher" LIKE 'v1:%' AND ("access_token_cipher" IS NULL OR "access_token_cipher" LIKE 'v1:%')
  );

ALTER TABLE "integration_m365_auth_requests"
  ADD CONSTRAINT "integration_m365_auth_requests_cipher_only" CHECK ("pkce_verifier_cipher" LIKE 'v1:%');

ALTER TABLE "integration_m365_calendar_events"
  ADD CONSTRAINT "integration_m365_calendar_events_source_known" CHECK ("source_type" IN ('milestone', 'rfi_due'));

ALTER TABLE "email_deliveries"
  ADD CONSTRAINT "email_deliveries_status_known" CHECK ("status" IN ('sent', 'failed')),
  ADD CONSTRAINT "email_deliveries_has_recipient" CHECK (cardinality("to_emails") > 0);

ALTER TABLE "meetings"
  ADD CONSTRAINT "meetings_status_known" CHECK ("status" IN ('scheduled', 'held', 'cancelled')),
  ADD CONSTRAINT "meetings_ends_after_start" CHECK ("ends_at" > "starts_at");

ALTER TABLE "meeting_attendees"
  ADD CONSTRAINT "meeting_attendees_somebody" CHECK ("user_id" IS NOT NULL OR "email" IS NOT NULL);

ALTER TABLE "meeting_action_items"
  ADD CONSTRAINT "meeting_action_items_status_known" CHECK ("status" IN ('open', 'done'));

-- --------------------------------------------------------------------------
-- Every tenant table: the same isolation policy as the rest. A company's connection — and so its
-- mailbox's tokens — is invisible to every other company's requests, whatever the code asks for.
-- --------------------------------------------------------------------------

ALTER TABLE "integration_m365_connections" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "integration_m365_connections" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "integration_m365_connections"
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

ALTER TABLE "integration_m365_auth_requests" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "integration_m365_auth_requests" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "integration_m365_auth_requests"
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

ALTER TABLE "integration_m365_calendar_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "integration_m365_calendar_events" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "integration_m365_calendar_events"
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

ALTER TABLE "email_deliveries" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "email_deliveries" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "email_deliveries"
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

ALTER TABLE "meetings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "meetings" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "meetings"
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

ALTER TABLE "meeting_attendees" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "meeting_attendees" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "meeting_attendees"
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

ALTER TABLE "meeting_action_items" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "meeting_action_items" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "meeting_action_items"
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- The platform console reads and repairs tenant data across companies, as for every other tenant
-- table. Skipped where that role does not exist (a developer's database).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sitebook_admin') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON
      "integration_m365_connections",
      "integration_m365_auth_requests",
      "integration_m365_calendar_events",
      "email_deliveries",
      "meetings",
      "meeting_attendees",
      "meeting_action_items"
    TO sitebook_admin;
  END IF;
END $$;

-- --------------------------------------------------------------------------
-- The new permissions on the built-in roles
-- --------------------------------------------------------------------------
--
-- System roles read their preset from code at request time, so this is the stored column catching
-- up rather than the source of truth. FORCE is lifted for the updates: migrations run as
-- `sitebook_app`, which is NOBYPASSRLS, and with no tenant context set the policy matches nothing.
ALTER TABLE "roles" NO FORCE ROW LEVEL SECURITY;

UPDATE "roles" SET permissions = permissions || ARRAY['meetings.view', 'meetings.manage', 'integrations.manage']
  WHERE is_system = true AND base_role = 'owner';

UPDATE "roles" SET permissions = permissions || ARRAY['meetings.view', 'meetings.manage']
  WHERE is_system = true AND base_role = 'project_manager';

UPDATE "roles" SET permissions = permissions || ARRAY['meetings.view']
  WHERE is_system = true AND base_role = 'site_supervisor';

ALTER TABLE "roles" FORCE ROW LEVEL SECURITY;

-- --------------------------------------------------------------------------
-- The audit log
-- --------------------------------------------------------------------------
-- Connecting and disconnecting the mailbox, switching the calendar on, every email sent and every
-- meeting, attendee and action item are recorded with who did it. The tokens are redacted by column
-- name (`refresh_token_cipher`); the hourly access token and its bookkeeping are skipped, or the log
-- would be a list of token refreshes. Not attached: `integration_m365_auth_requests` (a ten-minute
-- handshake; the connection it produces is what matters) and `integration_m365_calendar_events`
-- (the sync's own bookkeeping, rewritten whenever a milestone moves).
SELECT audit_attach('integration_m365_connections',
  'access_token_cipher', 'access_token_expires_at', 'last_used_at', 'refresh_token_rotated_at', 'calendar_synced_at');
SELECT audit_attach('email_deliveries');
SELECT audit_attach('meetings');
SELECT audit_attach('meeting_attendees');
SELECT audit_attach('meeting_action_items');
