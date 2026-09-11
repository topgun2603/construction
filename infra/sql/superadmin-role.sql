-- Superadmin role (spec §6.1).
--
-- Tenant tables are created with FORCE ROW LEVEL SECURITY, so even the table
-- owner is subject to the isolation policy. Cross-tenant operations — support
-- tooling, migrations that backfill data, analytics — need a role that bypasses
-- RLS explicitly. That role is never used by the public API; it exists only for
-- out-of-band work, and its connection string lives outside the app's env.
--
-- Run once per database as a superuser:
--   psql "$DATABASE_URL" -f infra/sql/superadmin-role.sql
-- then set a real password:
--   ALTER ROLE sitebook_admin WITH PASSWORD '<from the secret store>';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sitebook_admin') THEN
    CREATE ROLE sitebook_admin LOGIN BYPASSRLS PASSWORD NULL;
  ELSE
    ALTER ROLE sitebook_admin WITH LOGIN BYPASSRLS;
  END IF;
END $$;

GRANT USAGE ON SCHEMA public TO sitebook_admin;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO sitebook_admin;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO sitebook_admin;

-- Tables created by future migrations are owned by `sitebook_app`, so the default
-- privileges have to be declared for that role rather than for whoever runs this.
ALTER DEFAULT PRIVILEGES FOR ROLE sitebook_app IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO sitebook_admin;
ALTER DEFAULT PRIVILEGES FOR ROLE sitebook_app IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO sitebook_admin;
