-- Public REST API with scoped keys, and signed webhooks (roadmap Phase 3).
--
-- KEYS
--
-- A company's integration calls `/public/v1/...` with `Authorization: Bearer bk_live_…`. The key is
-- a service principal of the company holding exactly the scopes it was made with; it is never a
-- person and never reaches the internal `/v1` routes. Only an HMAC-SHA256 of the key under a server
-- pepper is stored (`key_hash`), plus its last four characters for telling keys apart.
--
-- A request arrives with no company known, so — exactly as SCIM does — the key's hash is looked up
-- in a narrow, RLS-free directory kept by a trigger, and everything after that runs tenant-scoped:
--
--   api_key_directory   key HMAC → tenant id   (mirrors api_keys WHERE NOT revoked)
--
-- See 20261010000100_sso for why a directory rather than a SECURITY DEFINER function or the admin
-- connection. An expired key stays in the directory until revoked; expiry is checked against the
-- tenant row, so the directory never has to be swept on a clock.
--
-- WEBHOOKS
--
-- A change that should be announced writes an `outbox_events` row, and a `webhook_deliveries` row per
-- subscribed endpoint, in the same transaction as the change: nothing is announced that rolled back,
-- and nothing that committed is lost if the process dies before sending. A worker sends them, signed,
-- with retries; each try is logged in `webhook_delivery_attempts`.
--
-- AUDIT
--
-- Keys and endpoints are audited (who made, changed, revoked or switched off what). Writes made with
-- a key are audited as the key: `TenantDb` sets `app.actor_type = 'api_key'` and the key's id as the
-- actor, and `audit_fill_context` (replaced below) records `actor_type = 'api_key'`; the log shows
-- the key's name. Not audited, each for volume:
--   outbox_events, webhook_deliveries, webhook_delivery_attempts
--                          written for every announced change and every try; the delivery log
--                          in Settings → Developers is their history. Endpoint switch-offs and
--                          resends are written to the audit log by hand.
--   api_idempotency_keys   one per retried POST, kept a day; the write it guards is audited itself.
--   api_key_directory      a trigger-maintained mirror with no tenant RLS, like scim_token_directory.
-- `last_used_at`/`last_used_ip` on keys and the failure counters on endpoints are bookkeeping, skipped.

-- CreateTable
CREATE TABLE "api_keys" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "key_hash" TEXT NOT NULL,
    "key_last4" TEXT NOT NULL,
    "scopes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "allowed_cidrs" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "expires_at" TIMESTAMPTZ(6),
    "created_by_user_id" UUID NOT NULL,
    "last_used_at" TIMESTAMPTZ(6),
    "last_used_ip" TEXT,
    "revoked_at" TIMESTAMPTZ(6),
    "revoked_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "api_keys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "api_key_directory" (
    "key_hash" TEXT NOT NULL,
    "tenant_id" UUID NOT NULL,

    CONSTRAINT "api_key_directory_pkey" PRIMARY KEY ("key_hash")
);

-- CreateTable
CREATE TABLE "api_idempotency_keys" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "api_key_id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "request_hash" TEXT NOT NULL,
    "response_status" INTEGER,
    "response_body" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "api_idempotency_keys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhook_endpoints" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "url" TEXT NOT NULL,
    "description" TEXT,
    "events" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "secret_cipher" TEXT NOT NULL,
    "secret_last4" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "disabled_reason" TEXT,
    "disabled_at" TIMESTAMPTZ(6),
    "consecutive_failures" INTEGER NOT NULL DEFAULT 0,
    "last_success_at" TIMESTAMPTZ(6),
    "last_failure_at" TIMESTAMPTZ(6),
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "webhook_endpoints_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "outbox_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "outbox_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhook_deliveries" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "endpoint_id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "max_attempts" INTEGER NOT NULL DEFAULT 8,
    "next_attempt_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "locked_until" TIMESTAMPTZ(6),
    "last_status_code" INTEGER,
    "last_error" TEXT,
    "last_latency_ms" INTEGER,
    "delivered_at" TIMESTAMPTZ(6),
    "resend_of_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "webhook_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhook_delivery_attempts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "delivery_id" UUID NOT NULL,
    "attempt" INTEGER NOT NULL,
    "status_code" INTEGER,
    "ok" BOOLEAN NOT NULL,
    "latency_ms" INTEGER NOT NULL,
    "error" TEXT,
    "response_snippet" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "webhook_delivery_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "api_keys_key_hash_key" ON "api_keys"("key_hash");

-- CreateIndex
CREATE INDEX "api_keys_tenant_id_created_at_idx" ON "api_keys"("tenant_id", "created_at");

-- CreateIndex
CREATE INDEX "api_key_directory_tenant_id_idx" ON "api_key_directory"("tenant_id");

-- CreateIndex
CREATE INDEX "api_idempotency_keys_tenant_id_created_at_idx" ON "api_idempotency_keys"("tenant_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "api_idempotency_keys_api_key_id_key_key" ON "api_idempotency_keys"("api_key_id", "key");

-- CreateIndex
CREATE INDEX "webhook_endpoints_tenant_id_status_idx" ON "webhook_endpoints"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "outbox_events_tenant_id_created_at_idx" ON "outbox_events"("tenant_id", "created_at");

-- CreateIndex
CREATE INDEX "webhook_deliveries_tenant_id_status_next_attempt_at_idx" ON "webhook_deliveries"("tenant_id", "status", "next_attempt_at");

-- CreateIndex
CREATE INDEX "webhook_deliveries_endpoint_id_created_at_idx" ON "webhook_deliveries"("endpoint_id", "created_at");

-- CreateIndex
CREATE INDEX "webhook_deliveries_event_id_idx" ON "webhook_deliveries"("event_id");

-- CreateIndex
CREATE INDEX "webhook_delivery_attempts_delivery_id_attempt_idx" ON "webhook_delivery_attempts"("delivery_id", "attempt");

-- CreateIndex
CREATE INDEX "webhook_delivery_attempts_tenant_id_created_at_idx" ON "webhook_delivery_attempts"("tenant_id", "created_at");

-- AddForeignKey
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "api_key_directory" ADD CONSTRAINT "api_key_directory_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "api_idempotency_keys" ADD CONSTRAINT "api_idempotency_keys_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "api_idempotency_keys" ADD CONSTRAINT "api_idempotency_keys_api_key_id_fkey" FOREIGN KEY ("api_key_id") REFERENCES "api_keys"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "webhook_endpoints" ADD CONSTRAINT "webhook_endpoints_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outbox_events" ADD CONSTRAINT "outbox_events_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_endpoint_id_fkey" FOREIGN KEY ("endpoint_id") REFERENCES "webhook_endpoints"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "outbox_events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "webhook_delivery_attempts" ADD CONSTRAINT "webhook_delivery_attempts_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "webhook_delivery_attempts" ADD CONSTRAINT "webhook_delivery_attempts_delivery_id_fkey" FOREIGN KEY ("delivery_id") REFERENCES "webhook_deliveries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- --------------------------------------------------------------------------
-- Rules the schema cannot express
-- --------------------------------------------------------------------------

ALTER TABLE "webhook_endpoints"
  ADD CONSTRAINT "webhook_endpoints_status_known" CHECK ("status" IN ('active', 'disabled')),
  -- The API refuses anything else long before this; a row that somehow held `http://` would be a
  -- channel for sending company data in the clear. Plain http is let through for the loopback
  -- address only, which the API accepts solely when WEBHOOK_ALLOW_LOOPBACK is on (never in
  -- production): a developer's local receiver, and the e2e suite's.
  ADD CONSTRAINT "webhook_endpoints_url_https" CHECK ("url" LIKE 'https://%' OR "url" LIKE 'http://127.0.0.1%' OR "url" LIKE 'http://localhost%');

ALTER TABLE "webhook_deliveries"
  ADD CONSTRAINT "webhook_deliveries_status_known"
    CHECK ("status" IN ('pending', 'sending', 'succeeded', 'failed')),
  ADD CONSTRAINT "webhook_deliveries_attempts_bounded" CHECK ("attempt_count" >= 0 AND "attempt_count" <= "max_attempts");

-- --------------------------------------------------------------------------
-- The key directory, kept by a trigger (see the header)
-- --------------------------------------------------------------------------
--
-- SECURITY DEFINER with a pinned search path, as `sync_scim_token_directory`: a write to `api_keys`
-- from any role maintains the mirror without that role being granted it.

CREATE OR REPLACE FUNCTION sync_api_key_directory() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF (TG_OP = 'DELETE' OR TG_OP = 'UPDATE') THEN
    DELETE FROM api_key_directory WHERE key_hash = OLD.key_hash;
  END IF;
  IF (TG_OP = 'DELETE') THEN
    RETURN OLD;
  END IF;
  -- A revoked key must stop resolving to a company the moment it is revoked.
  IF (NEW.revoked_at IS NULL) THEN
    INSERT INTO api_key_directory (key_hash, tenant_id) VALUES (NEW.key_hash, NEW.tenant_id);
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER api_keys_sync_directory
AFTER INSERT OR UPDATE OF key_hash, tenant_id, revoked_at OR DELETE ON "api_keys"
FOR EACH ROW EXECUTE FUNCTION sync_api_key_directory();

-- --------------------------------------------------------------------------
-- Audit: writes made with an API key are recorded as the key
-- --------------------------------------------------------------------------
--
-- The same function as 20261007000200_full_audit_log, with one branch added first: a transaction
-- whose context says `app.actor_type = 'api_key'` was opened for a public API request, and its
-- `app.actor_id` is the key's id, not a person's. A service's hand-written entry inside that
-- transaction may name a user (the person an expense is filed under); the key is still who acted,
-- so the key wins. Outside a key's request the setting is empty and nothing changes.
CREATE OR REPLACE FUNCTION audit_fill_context() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.created_at := clock_timestamp();
  NEW.request_id := coalesce(NEW.request_id, nullif(current_setting('app.request_id', true), ''));
  NEW.ip         := coalesce(NEW.ip, nullif(current_setting('app.client_ip', true), ''));
  NEW.user_agent := coalesce(NEW.user_agent, nullif(current_setting('app.user_agent', true), ''));
  IF coalesce(current_setting('app.actor_type', true), '') = 'api_key' THEN
    NEW.actor_id   := nullif(current_setting('app.actor_id', true), '')::uuid;
    NEW.actor_type := 'api_key';
    RETURN NEW;
  END IF;
  NEW.actor_id   := coalesce(NEW.actor_id, nullif(current_setting('app.actor_id', true), '')::uuid);
  IF NEW.actor_id IS NOT NULL THEN
    NEW.actor_type := 'user';
  ELSIF current_tenant_id() IS NULL THEN
    NEW.actor_type := 'platform';
  END IF;
  RETURN NEW;
END $$;

-- --------------------------------------------------------------------------
-- Every tenant table: the same isolation policy as the rest.
-- --------------------------------------------------------------------------

ALTER TABLE "api_keys" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "api_keys" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "api_keys"
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

ALTER TABLE "api_idempotency_keys" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "api_idempotency_keys" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "api_idempotency_keys"
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

ALTER TABLE "webhook_endpoints" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "webhook_endpoints" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "webhook_endpoints"
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

ALTER TABLE "outbox_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "outbox_events" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "outbox_events"
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

ALTER TABLE "webhook_deliveries" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "webhook_deliveries" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "webhook_deliveries"
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

ALTER TABLE "webhook_delivery_attempts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "webhook_delivery_attempts" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "webhook_delivery_attempts"
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- The platform console reads and repairs tenant data across companies, as for every other tenant
-- table; skipped where that role does not exist (a developer's database). The directory is not
-- granted: nothing but its trigger should ever write it.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sitebook_admin') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON
      "api_keys",
      "api_idempotency_keys",
      "webhook_endpoints",
      "outbox_events",
      "webhook_deliveries",
      "webhook_delivery_attempts"
    TO sitebook_admin;
  END IF;
END $$;

-- --------------------------------------------------------------------------
-- The audit log
-- --------------------------------------------------------------------------
-- Who made a key, with which scopes and restrictions, and who revoked it; who pointed company data
-- at which URL, for which events, and when it was switched off. The secret columns are redacted by
-- name (`key_hash`, `secret_cipher`, `secret_last4`). See the header for the tables left out.
SELECT audit_attach('api_keys', 'last_used_at', 'last_used_ip');
SELECT audit_attach('webhook_endpoints', 'consecutive_failures', 'last_success_at', 'last_failure_at');
