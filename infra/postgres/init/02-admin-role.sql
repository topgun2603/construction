-- The superadmin role (spec §6.1, last bullet).
--
-- WHY A SECOND ROLE
--
-- Platform operations are cross-tenant by nature: "list every tenant", "how many
-- accounts signed up this month", "suspend this builder". There is no single
-- `app.tenant_id` that could be set for those queries, so they cannot run as
-- `sitebook_app` — every RLS policy would match zero rows and the console would show
-- an empty database.
--
-- The answer is NOT to hand the application role BYPASSRLS. That role serves every
-- tenant request, and one missing `set_config` would then silently return the whole
-- table instead of failing closed. Isolation has to be the default that mistakes fall
-- back to.
--
-- So `sitebook_admin` exists purely for the platform console: BYPASSRLS, reachable
-- only through ADMIN_DATABASE_URL, and used by exactly one Nest provider whose routes
-- all sit behind PlatformGuard. It owns nothing and runs no migrations.
--
-- It is NOT a superuser. BYPASSRLS lets it read across tenants; it still cannot alter
-- the schema, change roles, or read the filesystem. If this credential leaks the damage
-- is reading and writing tenant rows — bad, but bounded, and not enough to take the
-- cluster.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sitebook_admin') THEN
    CREATE ROLE sitebook_admin LOGIN PASSWORD 'sitebook_admin' NOSUPERUSER BYPASSRLS;
  ELSE
    ALTER ROLE sitebook_admin WITH LOGIN NOSUPERUSER BYPASSRLS;
  END IF;
END $$;

GRANT CONNECT ON DATABASE sitebook TO sitebook_admin;
GRANT USAGE ON SCHEMA public TO sitebook_admin;

-- Table privileges on everything that exists now, plus anything a later migration
-- creates. The default-privileges grant is keyed to sitebook_app because that is the
-- role migrations run as, so it is the role that will own new tables.
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO sitebook_admin;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO sitebook_admin;

ALTER DEFAULT PRIVILEGES FOR ROLE sitebook_app IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO sitebook_admin;
ALTER DEFAULT PRIVILEGES FOR ROLE sitebook_app IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO sitebook_admin;
