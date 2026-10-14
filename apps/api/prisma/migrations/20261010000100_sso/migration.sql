-- Single sign-on and SCIM provisioning (roadmap Phase 3, item 1).
--
-- A company connects its own identity provider (Microsoft Entra ID, Google Workspace, Okta, or any
-- OpenID Connect / SAML 2.0 provider), proves which email domains are its own through DNS, and
-- optionally lets that provider create and switch off its people over SCIM 2.0.
--
-- LOOKUPS BEFORE A COMPANY IS KNOWN
--
-- Two requests arrive with no tenant context: "Sign in with SSO" (a work email — which company?)
-- and a SCIM call (a bearer token — which company?). Both are answered the way `/auth/exchange`
-- answers a phone number: from a narrow directory table with no RLS, holding nothing but the key
-- and a tenant id, written only by a trigger on the tenant table it mirrors.
--
--   sso_domain_directory   verified domain → tenant id   (mirrors sso_domains WHERE verified)
--   scim_token_directory   token SHA-256   → tenant id   (mirrors scim_tokens WHERE NOT revoked)
--
-- Why not a SECURITY DEFINER function over the RLS tables: migrations run as `sitebook_app`, which
-- is NOBYPASSRLS, and the tables FORCE row-level security even on their owner — a definer function
-- owned by that role would see nothing either, so it would need a policy carve-out that any query
-- could use. Why not the admin (BYPASSRLS) connection: that connection is optional, belongs to the
-- platform console, and would put an all-tenants client one bug away from the login path. A
-- directory answers exactly one question and cannot answer any other; everything after the lookup
-- runs tenant-scoped through RLS as usual.
--
-- A verified domain belongs to one company only, enforced twice: a partial unique index on
-- `sso_domains (domain) WHERE verified_at IS NOT NULL` (a constraint sees every row, RLS or not)
-- and the directory's primary key.
--
-- AUDIT
--
-- The settings tables and everything SCIM writes are audited. Secrets are redacted by the trigger
-- on column name: `oidc_client_secret_cipher`, `verification_token`, `token_hash`, `token_hint`.
-- Not audited:
--   sso_login_requests     a sign-in in flight, written several times per sign-in and useless a few
--                          minutes later — the same reasoning as `refresh_tokens`. The sign-in itself
--                          is logged as an explicit `sso.sign_in` entry by the service.
--   sso_domain_directory, scim_token_directory
--                          trigger-maintained mirrors with no tenant RLS, like `auth_identities`.

-- CreateTable
CREATE TABLE "sso_connections" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "protocol" TEXT NOT NULL,
    "preset" TEXT NOT NULL DEFAULT 'other',
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "oidc_issuer" TEXT,
    "oidc_client_id" TEXT,
    "oidc_client_secret_cipher" TEXT,
    "oidc_scopes" TEXT NOT NULL DEFAULT 'openid email profile',
    "saml_idp_entity_id" TEXT,
    "saml_idp_sso_url" TEXT,
    "saml_idp_certificate" TEXT,
    "saml_idp_metadata_url" TEXT,
    "jit_enabled" BOOLEAN NOT NULL DEFAULT false,
    "jit_role_id" UUID,
    "enforce_sso" BOOLEAN NOT NULL DEFAULT false,
    "updated_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "sso_connections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sso_domains" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "domain" TEXT NOT NULL,
    "verification_token" TEXT NOT NULL,
    "verified_at" TIMESTAMPTZ(6),
    "last_checked_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sso_domains_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sso_domain_directory" (
    "domain" TEXT NOT NULL,
    "tenant_id" UUID NOT NULL,

    CONSTRAINT "sso_domain_directory_pkey" PRIMARY KEY ("domain")
);

-- CreateTable
CREATE TABLE "sso_login_requests" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "connection_id" UUID NOT NULL,
    "protocol" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'started',
    "nonce" TEXT,
    "pkce_verifier_secret" TEXT,
    "saml_request_id" TEXT,
    "binding_hash" TEXT NOT NULL,
    "email" TEXT,
    "user_id" UUID,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMPTZ(6),

    CONSTRAINT "sso_login_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scim_tokens" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "token_hint" TEXT NOT NULL,
    "created_by_user_id" UUID,
    "last_used_at" TIMESTAMPTZ(6),
    "revoked_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "scim_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scim_token_directory" (
    "token_hash" TEXT NOT NULL,
    "tenant_id" UUID NOT NULL,

    CONSTRAINT "scim_token_directory_pkey" PRIMARY KEY ("token_hash")
);

-- CreateTable
CREATE TABLE "scim_users" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "external_id" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "scim_users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scim_groups" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "display_name" TEXT NOT NULL,
    "external_id" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "scim_groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scim_group_members" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "group_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "scim_group_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scim_role_mappings" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "group_name" TEXT NOT NULL,
    "role_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "scim_role_mappings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "sso_connections_tenant_id_key" ON "sso_connections"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "sso_domains_tenant_id_domain_key" ON "sso_domains"("tenant_id", "domain");

-- CreateIndex
CREATE INDEX "sso_domain_directory_tenant_id_idx" ON "sso_domain_directory"("tenant_id");

-- CreateIndex
CREATE INDEX "sso_login_requests_tenant_id_created_at_idx" ON "sso_login_requests"("tenant_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "scim_tokens_token_hash_key" ON "scim_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "scim_tokens_tenant_id_idx" ON "scim_tokens"("tenant_id");

-- CreateIndex
CREATE INDEX "scim_token_directory_tenant_id_idx" ON "scim_token_directory"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "scim_users_user_id_key" ON "scim_users"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "scim_users_tenant_id_external_id_key" ON "scim_users"("tenant_id", "external_id");

-- CreateIndex
CREATE UNIQUE INDEX "scim_groups_tenant_id_display_name_key" ON "scim_groups"("tenant_id", "display_name");

-- CreateIndex
CREATE INDEX "scim_group_members_tenant_id_user_id_idx" ON "scim_group_members"("tenant_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "scim_group_members_group_id_user_id_key" ON "scim_group_members"("group_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "scim_role_mappings_tenant_id_group_name_key" ON "scim_role_mappings"("tenant_id", "group_name");

-- AddForeignKey
ALTER TABLE "sso_connections" ADD CONSTRAINT "sso_connections_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sso_connections" ADD CONSTRAINT "sso_connections_jit_role_id_fkey" FOREIGN KEY ("jit_role_id") REFERENCES "roles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sso_domains" ADD CONSTRAINT "sso_domains_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sso_domain_directory" ADD CONSTRAINT "sso_domain_directory_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sso_login_requests" ADD CONSTRAINT "sso_login_requests_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sso_login_requests" ADD CONSTRAINT "sso_login_requests_connection_id_fkey" FOREIGN KEY ("connection_id") REFERENCES "sso_connections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scim_tokens" ADD CONSTRAINT "scim_tokens_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scim_token_directory" ADD CONSTRAINT "scim_token_directory_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scim_users" ADD CONSTRAINT "scim_users_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scim_users" ADD CONSTRAINT "scim_users_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scim_groups" ADD CONSTRAINT "scim_groups_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scim_group_members" ADD CONSTRAINT "scim_group_members_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scim_group_members" ADD CONSTRAINT "scim_group_members_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "scim_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scim_group_members" ADD CONSTRAINT "scim_group_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scim_role_mappings" ADD CONSTRAINT "scim_role_mappings_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scim_role_mappings" ADD CONSTRAINT "scim_role_mappings_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- --------------------------------------------------------------------------
-- Rules the schema cannot express
-- --------------------------------------------------------------------------

-- One company per verified domain. Unverified claims may overlap — two companies can each be
-- *trying* — but only the one whose DNS carries its token gets past this.
CREATE UNIQUE INDEX "sso_domains_verified_domain_key" ON "sso_domains" ("domain")
  WHERE "verified_at" IS NOT NULL;

ALTER TABLE "sso_connections"
  ADD CONSTRAINT "sso_connections_protocol_known" CHECK ("protocol" IN ('oidc', 'saml')),
  ADD CONSTRAINT "sso_connections_preset_known" CHECK ("preset" IN ('entra', 'google', 'okta', 'other'));

ALTER TABLE "sso_login_requests"
  ADD CONSTRAINT "sso_login_requests_protocol_known" CHECK ("protocol" IN ('oidc', 'saml')),
  ADD CONSTRAINT "sso_login_requests_status_known"
    CHECK ("status" IN ('started', 'callback', 'authenticated', 'completed', 'failed'));

-- --------------------------------------------------------------------------
-- The two directories, kept by triggers (see the header)
-- --------------------------------------------------------------------------
--
-- SECURITY DEFINER, like `sync_auth_identity`, so a write to the tenant table from any role — the
-- app, or the console's — can maintain the mirror without that role being granted it. The search
-- path is pinned so a definer function cannot be pointed at somebody else's table of the same name.

CREATE OR REPLACE FUNCTION sync_sso_domain_directory() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF (TG_OP = 'DELETE' OR TG_OP = 'UPDATE') THEN
    DELETE FROM sso_domain_directory WHERE domain = OLD.domain AND tenant_id = OLD.tenant_id;
  END IF;
  IF (TG_OP = 'DELETE') THEN
    RETURN OLD;
  END IF;
  IF (NEW.verified_at IS NOT NULL) THEN
    -- A plain insert: if another company somehow holds the domain this fails loudly rather than
    -- quietly moving it. The partial unique index above normally refuses first.
    INSERT INTO sso_domain_directory (domain, tenant_id) VALUES (NEW.domain, NEW.tenant_id);
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER sso_domains_sync_directory
AFTER INSERT OR UPDATE OF domain, tenant_id, verified_at OR DELETE ON "sso_domains"
FOR EACH ROW EXECUTE FUNCTION sync_sso_domain_directory();

CREATE OR REPLACE FUNCTION sync_scim_token_directory() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF (TG_OP = 'DELETE' OR TG_OP = 'UPDATE') THEN
    DELETE FROM scim_token_directory WHERE token_hash = OLD.token_hash;
  END IF;
  IF (TG_OP = 'DELETE') THEN
    RETURN OLD;
  END IF;
  -- A revoked token must stop resolving to a company the moment it is revoked.
  IF (NEW.revoked_at IS NULL) THEN
    INSERT INTO scim_token_directory (token_hash, tenant_id) VALUES (NEW.token_hash, NEW.tenant_id);
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER scim_tokens_sync_directory
AFTER INSERT OR UPDATE OF token_hash, tenant_id, revoked_at OR DELETE ON "scim_tokens"
FOR EACH ROW EXECUTE FUNCTION sync_scim_token_directory();

-- --------------------------------------------------------------------------
-- Every tenant table: the same isolation policy as the rest.
-- --------------------------------------------------------------------------
ALTER TABLE "sso_connections" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "sso_connections" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "sso_connections"
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

ALTER TABLE "sso_domains" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "sso_domains" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "sso_domains"
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

ALTER TABLE "sso_login_requests" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "sso_login_requests" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "sso_login_requests"
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

ALTER TABLE "scim_tokens" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "scim_tokens" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "scim_tokens"
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

ALTER TABLE "scim_users" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "scim_users" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "scim_users"
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

ALTER TABLE "scim_groups" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "scim_groups" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "scim_groups"
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

ALTER TABLE "scim_group_members" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "scim_group_members" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "scim_group_members"
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

ALTER TABLE "scim_role_mappings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "scim_role_mappings" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "scim_role_mappings"
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- The platform console's role reads and repairs tenant data across companies, as for every other
-- tenant table; skipped where that role does not exist (a developer's database). The directories
-- are not granted: nothing but their triggers should ever write them.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sitebook_admin') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON
      "sso_connections",
      "sso_domains",
      "sso_login_requests",
      "scim_tokens",
      "scim_users",
      "scim_groups",
      "scim_group_members",
      "scim_role_mappings"
    TO sitebook_admin;
  END IF;
END $$;

-- --------------------------------------------------------------------------
-- The audit log
-- --------------------------------------------------------------------------
-- Who connected an identity provider, who claimed and proved a domain, who switched enforcement on,
-- and every account the provider created, changed or switched off — all of it decides who can get
-- into the company. `last_checked_at` and `last_used_at` are bookkeeping, not changes.
SELECT audit_attach('sso_connections');
SELECT audit_attach('sso_domains', 'last_checked_at');
SELECT audit_attach('scim_tokens', 'last_used_at');
SELECT audit_attach('scim_users');
SELECT audit_attach('scim_groups');
SELECT audit_attach('scim_group_members');
SELECT audit_attach('scim_role_mappings');
