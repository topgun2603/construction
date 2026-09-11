-- Backfill the built-in roles for tenants that existed before the `roles` table.
--
-- WHY THIS IS A SEPARATE MIGRATION
--
-- The seed in 20260910140000_roles inserted nothing, silently. Migrations run as
-- `sitebook_app`, which is NOBYPASSRLS and is also the tables' owner — and because every
-- tenant table is FORCE ROW LEVEL SECURITY, the policy binds to the owner too. With no
-- `app.tenant_id` set there is no tenant context, so `SELECT FROM tenants` returned zero
-- rows, the INSERT ... SELECT had nothing to iterate, and the statement succeeded having
-- done nothing.
--
-- That is exactly the behaviour the tenancy model is designed for: no context means no
-- rows, never "all rows". It just makes a data backfill impossible without saying so.
--
-- So FORCE is lifted for the three tables involved, the backfill runs, and FORCE is put
-- back. ENABLE stays on throughout, so the policies still apply to every role other than
-- the owner, and Prisma runs this file in a transaction — a failure anywhere rolls the
-- whole thing back, FORCE included.
--
-- Any future migration that needs to read or write tenant rows has to do the same thing.

ALTER TABLE "tenants" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "users" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "roles" NO FORCE ROW LEVEL SECURITY;

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

UPDATE "users" u
SET role_id = r.id
FROM "roles" r
WHERE r.tenant_id = u.tenant_id
  AND r.base_role = u.role
  AND r.is_system = true
  AND u.role_id IS NULL;

ALTER TABLE "tenants" FORCE ROW LEVEL SECURITY;
ALTER TABLE "users" FORCE ROW LEVEL SECURITY;
ALTER TABLE "roles" FORCE ROW LEVEL SECURITY;
