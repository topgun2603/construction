-- Platform console audit trail.
--
-- No tenant_id and, deliberately, NO ROW LEVEL SECURITY — the only table besides
-- `auth_identities` without it. Both exist outside tenancy by nature: this one records
-- what the platform operator did *to* tenants, so there is no tenant it could belong
-- to, and an owner must not be able to read the operator's trail about their account.
--
-- It is unreachable from the tenant API. Nothing in any tenant-facing module references
-- this table; it is written only through the BYPASSRLS connection used by the platform
-- console, whose routes all sit behind PlatformGuard.

CREATE TABLE "platform_audit_log" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "actor_phone" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "tenant_id" UUID,
    "before" JSONB,
    "after" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "platform_audit_log_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "platform_audit_log_created_at_idx" ON "platform_audit_log"("created_at" DESC);
CREATE INDEX "platform_audit_log_tenant_id_created_at_idx" ON "platform_audit_log"("tenant_id", "created_at" DESC);

-- No FK to tenants: the trail has to outlive the tenant it describes, and the most
-- important thing this table ever records is an account being shut down.

-- The console connects as sitebook_admin, which was granted table privileges in
-- infra/postgres/init/02-admin-role.sql before this table existed. The default
-- privileges set there cover it, but grant explicitly so a database created from
-- migrations alone is also correct.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sitebook_admin') THEN
    GRANT SELECT, INSERT ON "platform_audit_log" TO sitebook_admin;
  END IF;
END $$;
