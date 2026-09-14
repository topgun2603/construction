-- Operators the console granted, on top of the env allowlist.
--
-- Deliberately outside row-level security, like `platform_audit_log`: there is no tenant this
-- belongs to, and it is read while deciding whether a caller may act at all — before any
-- `app.tenant_id` could have been set. The console reaches it on the BYPASSRLS connection.
--
-- `PLATFORM_ADMIN_PHONES` remains the root of trust. Rows here are additive and revocable; the
-- env entries are neither listed here nor removable through the API.

CREATE TABLE "platform_operators" (
  "id"         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "phone"      TEXT        NOT NULL,
  "name"       TEXT,
  "granted_by" TEXT        NOT NULL,
  "granted_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "revoked_at" TIMESTAMPTZ(6),
  "revoked_by" TEXT
);

-- One row per number. A revoked operator who is granted access again updates this row rather
-- than adding a second, so "who has access" is always a single lookup.
CREATE UNIQUE INDEX "platform_operators_phone_key" ON "platform_operators" ("phone");

-- The allowlist check filters on this on every console request.
CREATE INDEX "platform_operators_revoked_at_idx" ON "platform_operators" ("revoked_at");
