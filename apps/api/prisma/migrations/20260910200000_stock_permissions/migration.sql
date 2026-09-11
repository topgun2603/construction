-- Bring the built-in roles' stored permissions in line with the stock module.
--
-- The rows were seeded once, so the three permissions stock added (`stock.view`, `stock.record`,
-- `estimates.manage`) were missing from every existing tenant — including the Owner role, which is
-- meant to hold everything by definition. The owner was refused their own new feature.
--
-- Authorisation no longer depends on this column for a built-in role: `RoleCache` reads the preset
-- from code, so a permission added in a later release applies immediately with nothing to migrate.
-- This update exists so the table is not misleading to anything reading it directly — the roles
-- screen, the platform console, or a person with psql.
--
-- Custom roles are untouched. Somebody chose their permissions deliberately, and silently widening
-- them would be the opposite of what the role editor is for.

ALTER TABLE "roles" NO FORCE ROW LEVEL SECURITY;

-- Owner: everything, always.
UPDATE "roles"
SET permissions = array_cat(
      permissions,
      ARRAY['stock.view', 'stock.record', 'estimates.manage']
    ),
    updated_at = now()
WHERE is_system = true
  AND base_role = 'owner'
  AND NOT ('stock.view' = ANY (permissions));

-- Project manager runs the store as well as the site.
UPDATE "roles"
SET permissions = array_cat(
      permissions,
      ARRAY['stock.view', 'stock.record', 'estimates.manage']
    ),
    updated_at = now()
WHERE is_system = true
  AND base_role = 'project_manager'
  AND NOT ('stock.view' = ANY (permissions));

-- Supervisor signs for what arrives and issues what is used, but does not set the estimate their
-- consumption is judged against.
UPDATE "roles"
SET permissions = array_cat(permissions, ARRAY['stock.view', 'stock.record']),
    updated_at = now()
WHERE is_system = true
  AND base_role = 'site_supervisor'
  AND NOT ('stock.view' = ANY (permissions));

-- Accounts reads stock because material cost lands on the books, but does not move it.
UPDATE "roles"
SET permissions = array_cat(permissions, ARRAY['stock.view']),
    updated_at = now()
WHERE is_system = true
  AND base_role = 'accounts'
  AND NOT ('stock.view' = ANY (permissions));

ALTER TABLE "roles" FORCE ROW LEVEL SECURITY;
