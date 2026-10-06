-- AlterTable
ALTER TABLE "refresh_tokens" ADD COLUMN     "session_id" UUID;

-- CreateTable
CREATE TABLE "tenant_security_settings" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "mfa_policy" TEXT NOT NULL DEFAULT 'off',
    "trust_idp_mfa" BOOLEAN NOT NULL DEFAULT true,
    "idle_timeout_minutes" INTEGER,
    "absolute_lifetime_hours" INTEGER,
    "ip_mode" TEXT NOT NULL DEFAULT 'off',
    "ip_rules" JSONB NOT NULL DEFAULT '[]',
    "ip_exempt_owners" BOOLEAN NOT NULL DEFAULT true,
    "ip_exempt_roles" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "updated_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "tenant_security_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_sessions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "method" TEXT NOT NULL,
    "client" TEXT NOT NULL DEFAULT 'web',
    "device_id" TEXT,
    "user_agent" TEXT,
    "ip" TEXT,
    "last_ip" TEXT,
    "started_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_active_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "mfa_at" TIMESTAMPTZ(6),
    "mfa_method" TEXT,
    "revoked_at" TIMESTAMPTZ(6),
    "revoked_reason" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mfa_factors" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "secret_cipher" TEXT NOT NULL,
    "confirmed_at" TIMESTAMPTZ(6),
    "last_used_step" BIGINT,
    "failed_attempts" INTEGER NOT NULL DEFAULT 0,
    "locked_until" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "mfa_factors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mfa_recovery_codes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "code_hash" TEXT NOT NULL,
    "used_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mfa_recovery_codes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tenant_security_settings_tenant_id_key" ON "tenant_security_settings"("tenant_id");

-- CreateIndex
CREATE INDEX "user_sessions_tenant_id_user_id_revoked_at_idx" ON "user_sessions"("tenant_id", "user_id", "revoked_at");

-- CreateIndex
CREATE UNIQUE INDEX "mfa_factors_user_id_key" ON "mfa_factors"("user_id");

-- CreateIndex
CREATE INDEX "mfa_factors_tenant_id_idx" ON "mfa_factors"("tenant_id");

-- CreateIndex
CREATE INDEX "mfa_recovery_codes_tenant_id_idx" ON "mfa_recovery_codes"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "mfa_recovery_codes_user_id_code_hash_key" ON "mfa_recovery_codes"("user_id", "code_hash");

-- CreateIndex
CREATE INDEX "refresh_tokens_session_id_idx" ON "refresh_tokens"("session_id");

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "user_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_security_settings" ADD CONSTRAINT "tenant_security_settings_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_sessions" ADD CONSTRAINT "user_sessions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_sessions" ADD CONSTRAINT "user_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mfa_factors" ADD CONSTRAINT "mfa_factors_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mfa_factors" ADD CONSTRAINT "mfa_factors_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mfa_recovery_codes" ADD CONSTRAINT "mfa_recovery_codes_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mfa_recovery_codes" ADD CONSTRAINT "mfa_recovery_codes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- --------------------------------------------------------------------------
-- Rules the schema cannot express
-- --------------------------------------------------------------------------

ALTER TABLE "tenant_security_settings"
  ADD CONSTRAINT "tenant_security_settings_mfa_policy_known" CHECK ("mfa_policy" IN ('off', 'admins', 'everyone')),
  ADD CONSTRAINT "tenant_security_settings_ip_mode_known" CHECK ("ip_mode" IN ('off', 'web', 'everyone')),
  ADD CONSTRAINT "tenant_security_settings_idle_range"
    CHECK ("idle_timeout_minutes" IS NULL OR "idle_timeout_minutes" BETWEEN 30 AND 1440),
  ADD CONSTRAINT "tenant_security_settings_absolute_range"
    CHECK ("absolute_lifetime_hours" IS NULL OR "absolute_lifetime_hours" BETWEEN 8 AND 720);

ALTER TABLE "user_sessions"
  ADD CONSTRAINT "user_sessions_method_known" CHECK ("method" IN ('phone', 'email', 'sso')),
  ADD CONSTRAINT "user_sessions_client_known" CHECK ("client" IN ('web', 'app'));

-- --------------------------------------------------------------------------
-- Every tenant table: the same isolation policy as the rest.
-- --------------------------------------------------------------------------

ALTER TABLE "tenant_security_settings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tenant_security_settings" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "tenant_security_settings"
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

ALTER TABLE "user_sessions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "user_sessions" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "user_sessions"
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

ALTER TABLE "mfa_factors" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "mfa_factors" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "mfa_factors"
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

ALTER TABLE "mfa_recovery_codes" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "mfa_recovery_codes" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "mfa_recovery_codes"
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- The platform console's role reads and repairs tenant data across companies, as for every other
-- tenant table — and resetting somebody's two-factor is one of the repairs it makes. Skipped where
-- that role does not exist (a developer's database).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sitebook_admin') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON
      "tenant_security_settings",
      "user_sessions",
      "mfa_factors",
      "mfa_recovery_codes"
    TO sitebook_admin;
  END IF;
END $$;

-- --------------------------------------------------------------------------
-- The audit log
-- --------------------------------------------------------------------------
-- Every rule change, every enrolment and reset, every recovery code made or spent, and every
-- session begun or ended — all of it decides who can get into the company. The secret and the
-- code hashes are redacted by column name (`_cipher`, `_hash`). Bookkeeping columns are skipped:
-- a session's activity stamps move on every request, and a factor's step counter and
-- failed-attempt count on every code typed (a refused code is logged by the service instead).
SELECT audit_attach('tenant_security_settings');
SELECT audit_attach('user_sessions', 'last_active_at', 'last_ip');
SELECT audit_attach('mfa_factors', 'last_used_step', 'failed_attempts', 'locked_until');
SELECT audit_attach('mfa_recovery_codes');

