-- Company groups (roadmap Phase 2, module 11): a group owning several companies, people who work
-- in more than one of them, and a consolidated report across them.
--
-- WHAT IS *NOT* HERE: A MEMBERSHIPS TABLE
--
-- One person in several companies already works, and has since the first migration: `users` is
-- per tenant (phone unique per tenant, not globally), and `auth_identities` is the trigger-kept
-- directory from a verified phone or email to every (tenant, user) it belongs to. That directory
-- *is* the membership list — each row has the person's own role in that company on its `users`
-- row. Adding a second table would give two sources of truth for "who can sign in where", and the
-- one the login path does not read would drift. So inter-company users need no schema change and
-- no backfill: every existing user already has exactly one membership, their current one, and
-- keeps working exactly as before. What changes is the API (choose a company at sign-in; switch
-- company later, re-issuing a token for exactly one tenant) — see AuthService.
--
-- THE GROUP TABLES AND ROW-LEVEL SECURITY
--
-- A group sits above tenancy, so these tables cannot use the `tenant_isolation` policy: the
-- members of a group are several tenants by definition. Leaving them without RLS would make them
-- the one place a forgotten check reads across companies. Instead each is scoped by a second
-- setting, `app.group_id`, read through `current_company_group_id()`:
--
--   * Nothing is visible with no context at all — the same "forgetting is a visible bug" rule as
--     tenant tables.
--   * A tenant context alone sees only the rows *about itself*: its own membership row, the
--     invitations addressed to it (and the inviting group's name), and which of its own people are
--     group admins. That is how the API discovers its group.
--   * `app.group_id` is set by `CompanyGroupContext` (apps/api) only to a group id it has just read
--     *through* that tenant-scoped view — the caller's own company's membership row, or the
--     company's own pending invitation when its owner accepts. It is never taken from a request.
--     Under it the group's members, admins, invitations and rates are visible.
--   * Writes are narrower than reads: a company can only put *itself* into a group and take
--     *itself* out (both settings must match), so even a buggy service cannot enrol another
--     company without that company's own context — which only its own requests have.
--
-- The consolidated report does not read company data through any of this: it loops over the
-- group's companies and opens a separate, ordinary tenant-scoped transaction for each one, so
-- every row it reads still passes `tenant_isolation`. No policy here is ever disabled.
--
-- AUDIT
--
-- None of these tables is tenant data, so none is `audit_attach`ed (the trigger files an entry
-- under the row's tenant, and a group row has no one tenant). Instead the service writes an
-- explicit audit entry into every affected company's own log for each group action — invited,
-- joined, declined, left, admin granted or revoked — so each company's history says what was
-- done to it and by whom.

-- CreateTable
CREATE TABLE "company_groups" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL,
    "base_currency" CHAR(3) NOT NULL,
    "created_by_tenant_id" UUID,
    "created_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "company_groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "company_group_members" (
    "group_id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "joined_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "company_group_members_pkey" PRIMARY KEY ("group_id","tenant_id")
);

-- CreateTable
CREATE TABLE "company_group_invitations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "group_id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "invited_by_tenant_id" UUID,
    "invited_by_user_id" UUID,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "responded_at" TIMESTAMPTZ(6),
    "responded_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "company_group_invitations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "company_group_admins" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "group_id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "permissions" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "granted_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "company_group_admins_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "company_group_exchange_rates" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "group_id" UUID NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "rate" DECIMAL(20,10) NOT NULL,
    "effective_from" DATE NOT NULL,
    "created_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "company_group_exchange_rates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "company_group_members_tenant_id_key" ON "company_group_members"("tenant_id");

-- CreateIndex
CREATE INDEX "company_group_invitations_tenant_id_status_idx" ON "company_group_invitations"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "company_group_invitations_group_id_status_idx" ON "company_group_invitations"("group_id", "status");

-- CreateIndex
CREATE INDEX "company_group_admins_tenant_id_idx" ON "company_group_admins"("tenant_id");

-- CreateIndex
CREATE INDEX "company_group_admins_user_id_idx" ON "company_group_admins"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "company_group_admins_group_id_user_id_key" ON "company_group_admins"("group_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "company_group_exchange_rates_group_id_currency_effective_fr_key" ON "company_group_exchange_rates"("group_id", "currency", "effective_from");

-- AddForeignKey
ALTER TABLE "company_group_members" ADD CONSTRAINT "company_group_members_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "company_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company_group_members" ADD CONSTRAINT "company_group_members_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company_group_invitations" ADD CONSTRAINT "company_group_invitations_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "company_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company_group_invitations" ADD CONSTRAINT "company_group_invitations_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company_group_admins" ADD CONSTRAINT "company_group_admins_group_id_tenant_id_fkey" FOREIGN KEY ("group_id", "tenant_id") REFERENCES "company_group_members"("group_id", "tenant_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company_group_admins" ADD CONSTRAINT "company_group_admins_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company_group_exchange_rates" ADD CONSTRAINT "company_group_exchange_rates_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "company_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- --------------------------------------------------------------------------
-- What the service checks first, with the database as the backstop for a bug
-- --------------------------------------------------------------------------

-- One live invitation per company per group. Partial, so declined and cancelled ones stay as
-- history and a company can be asked again. Prisma cannot express it; absent from schema.prisma.
CREATE UNIQUE INDEX "company_group_invitations_one_pending"
  ON "company_group_invitations" ("group_id", "tenant_id") WHERE "status" = 'pending';

ALTER TABLE "company_group_invitations"
  ADD CONSTRAINT "company_group_invitations_status_known"
    CHECK ("status" IN ('pending', 'accepted', 'declined', 'cancelled'));

ALTER TABLE "company_group_admins"
  ADD CONSTRAINT "company_group_admins_permissions_known"
    CHECK ("permissions" <@ ARRAY['group.view_reports', 'group.manage']::TEXT[]
           AND cardinality("permissions") > 0);

ALTER TABLE "company_group_exchange_rates"
  ADD CONSTRAINT "company_group_exchange_rates_rate_positive" CHECK ("rate" > 0),
  ADD CONSTRAINT "company_group_exchange_rates_currency_shape" CHECK ("currency" ~ '^[A-Z]{3}$');

ALTER TABLE "company_groups"
  ADD CONSTRAINT "company_groups_base_currency_shape" CHECK ("base_currency" ~ '^[A-Z]{3}$');

-- --------------------------------------------------------------------------
-- Row-level security: scoped by group, never by nothing
-- --------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION current_company_group_id() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.group_id', true), '')::uuid
$$;

-- The group row: its own context, or a company that has been invited to it (to read its name).
ALTER TABLE "company_groups" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "company_groups" FORCE ROW LEVEL SECURITY;
CREATE POLICY company_group_scope ON "company_groups"
  USING (id = current_company_group_id())
  WITH CHECK (id = current_company_group_id());
CREATE POLICY company_group_invited ON "company_groups" FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM "company_group_invitations" i
     WHERE i.group_id = "company_groups".id AND i.tenant_id = current_tenant_id()
  ));

-- Membership: read by the group or by the company itself; joined and left only by the company
-- itself, inside the group's context. No UPDATE policy — a membership is never edited.
ALTER TABLE "company_group_members" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "company_group_members" FORCE ROW LEVEL SECURITY;
CREATE POLICY company_group_member_read ON "company_group_members" FOR SELECT
  USING (group_id = current_company_group_id() OR tenant_id = current_tenant_id());
CREATE POLICY company_group_member_join ON "company_group_members" FOR INSERT
  WITH CHECK (group_id = current_company_group_id() AND tenant_id = current_tenant_id());
CREATE POLICY company_group_member_leave ON "company_group_members" FOR DELETE
  USING (group_id = current_company_group_id() AND tenant_id = current_tenant_id());

-- Invitations: created by the group; answered by the company invited or cancelled by the group.
-- Never deleted (they are the history of who asked whom).
ALTER TABLE "company_group_invitations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "company_group_invitations" FORCE ROW LEVEL SECURITY;
CREATE POLICY company_group_invitation_read ON "company_group_invitations" FOR SELECT
  USING (group_id = current_company_group_id() OR tenant_id = current_tenant_id());
CREATE POLICY company_group_invitation_create ON "company_group_invitations" FOR INSERT
  WITH CHECK (group_id = current_company_group_id() AND status = 'pending');
CREATE POLICY company_group_invitation_answer ON "company_group_invitations" FOR UPDATE
  USING (group_id = current_company_group_id() OR tenant_id = current_tenant_id())
  WITH CHECK (group_id = current_company_group_id() OR tenant_id = current_tenant_id());

-- Admins: managed by the group; a company may see which of its own people hold a grant.
ALTER TABLE "company_group_admins" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "company_group_admins" FORCE ROW LEVEL SECURITY;
CREATE POLICY company_group_admin_scope ON "company_group_admins"
  USING (group_id = current_company_group_id())
  WITH CHECK (group_id = current_company_group_id());
CREATE POLICY company_group_admin_own_company ON "company_group_admins" FOR SELECT
  USING (tenant_id = current_tenant_id());

-- Rates: the group's alone.
ALTER TABLE "company_group_exchange_rates" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "company_group_exchange_rates" FORCE ROW LEVEL SECURITY;
CREATE POLICY company_group_rate_scope ON "company_group_exchange_rates"
  USING (group_id = current_company_group_id())
  WITH CHECK (group_id = current_company_group_id());

-- The platform console shows which group a company is in. Read-only: the console does not make
-- or break groups — joining one is the company owner's decision. Skipped where the role does not
-- exist (a developer's database).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sitebook_admin') THEN
    GRANT SELECT ON
      "company_groups",
      "company_group_members",
      "company_group_invitations",
      "company_group_admins",
      "company_group_exchange_rates"
    TO sitebook_admin;
  END IF;
END $$;
