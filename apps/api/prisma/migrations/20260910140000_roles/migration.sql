-- Custom roles (owner-defined) alongside the five built-in ones.
--
-- The built-in roles become rows here too, so permission checking has one code path
-- instead of branching on "preset or custom". They are marked is_system and the API
-- refuses to edit or delete them: an owner who could strip roles.manage from the owner
-- role would lock the account's last administrator out of undoing it.
--
-- base_role is kept because two things are not expressible as permissions — which role a
-- person holds on a specific project (project_members.role_on_project) and the wage-sheet
-- semantics that depend on it. A custom role therefore always names the built-in role it
-- behaves like underneath.

CREATE TABLE "roles" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "base_role" "user_role" NOT NULL,
    "permissions" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "sees_all_projects" BOOLEAN NOT NULL DEFAULT false,
    "is_system" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "roles_tenant_id_name_key" ON "roles"("tenant_id", "name");
CREATE INDEX "roles_tenant_id_idx" ON "roles"("tenant_id");

ALTER TABLE "roles" ADD CONSTRAINT "roles_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "users" ADD COLUMN "role_id" UUID;

-- SET NULL rather than RESTRICT: deleting a role must not be blocked by the people on it,
-- and a null role_id falls back to the user's base `role` enum, so nobody is ever left
-- without any permissions at all. The API reassigns members before deleting a role, so
-- this is the safety net rather than the normal path.
ALTER TABLE "users" ADD CONSTRAINT "users_role_id_fkey"
  FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "users_role_id_idx" ON "users"("role_id");

-- Tenant isolation, exactly as every other tenant-scoped table (spec §6.1). FORCE so the
-- policy binds even for the table's owner, which is the role migrations run as.
ALTER TABLE "roles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "roles" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "roles"
  USING (tenant_id = current_tenant_id());

-- ===========================================================================
-- Seed the built-in roles for every tenant that already exists, and point each
-- existing user at the matching row.
--
-- The permission lists below are transcribed from packages/shared/src/permissions.ts at
-- the time of this migration. They are duplicated here on purpose: a migration has to keep
-- working against the code as it was the day it ran, so it must not read from a constant
-- that later changes. `packages/shared/src/permissions.test.ts` pins the presets so the two
-- cannot drift silently, and new tenants are seeded from the shared constant in code.
-- ===========================================================================

INSERT INTO "roles" (tenant_id, name, base_role, permissions, sees_all_projects, is_system)
SELECT t.id, r.name, r.base_role::"user_role", r.permissions, r.sees_all, true
FROM "tenants" t
CROSS JOIN (
  VALUES
    ('Owner', 'owner', ARRAY[
      'projects.view','projects.manage','projects.delete','milestones.manage',
      'dpr.view','dpr.file',
      'workers.view','workers.manage','workers.delete',
      'contractors.manage','contractors.delete',
      'attendance.view','attendance.record',
      'wages.view','wages.generate','wages.finalise','wages.pay',
      'payments.view','payments.record','payments.reconcile',
      'materials.manage','indents.raise','indents.approve',
      'expenses.view','expenses.record','expenses.approve',
      'reports.view','reports.people',
      'team.manage','roles.manage','tenant.manage'
    ], true),
    ('Project manager', 'project_manager', ARRAY[
      'projects.view','projects.manage','milestones.manage',
      'dpr.view','dpr.file',
      'workers.view','workers.manage','workers.delete',
      'contractors.manage',
      'attendance.view','attendance.record',
      'wages.view','payments.view','payments.record',
      'materials.manage','indents.raise','indents.approve',
      'expenses.view','expenses.record','expenses.approve',
      'reports.view'
    ], false),
    ('Site supervisor', 'site_supervisor', ARRAY[
      'projects.view',
      'dpr.view','dpr.file',
      'workers.view',
      'attendance.view','attendance.record',
      'payments.record',
      'indents.raise',
      'expenses.view','expenses.record'
    ], false),
    ('Accounts', 'accounts', ARRAY[
      'projects.view','dpr.view',
      'workers.view','workers.manage','contractors.manage',
      'attendance.view',
      'wages.view','wages.generate','wages.finalise','wages.pay',
      'payments.view','payments.record','payments.reconcile',
      'expenses.view','expenses.record','expenses.approve',
      'reports.view','reports.people'
    ], true),
    ('Client', 'client', ARRAY['projects.view','dpr.view'], false)
) AS r(name, base_role, permissions, sees_all)
ON CONFLICT (tenant_id, name) DO NOTHING;

-- Point every existing user at their tenant's matching system role.
UPDATE "users" u
SET role_id = r.id
FROM "roles" r
WHERE r.tenant_id = u.tenant_id
  AND r.base_role = u.role
  AND r.is_system = true
  AND u.role_id IS NULL;

GRANT SELECT, INSERT, UPDATE, DELETE ON "roles" TO sitebook_admin;
