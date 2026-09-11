-- Creates the role the application actually connects as.
--
-- WHY THIS EXISTS
--
-- `POSTGRES_USER` in a Postgres container is the cluster superuser, and a superuser
-- bypasses row-level security unconditionally — `FORCE ROW LEVEL SECURITY` does not
-- apply to it. An app connecting as that role would have every tenant policy
-- silently inert: the isolation test fails loudly if you are lucky, and leaks data
-- if you are not.
--
-- So the app gets `sitebook_app`: NOSUPERUSER, NOBYPASSRLS. It owns the schema, so
-- migrations run as it too — and because the tables are created with FORCE RLS, the
-- policies bind even to their own owner.
--
-- Runs automatically from /docker-entrypoint-initdb.d on a fresh volume. For a
-- database that already exists, run it by hand as a superuser and then reassign
-- ownership of the existing objects:
--   REASSIGN OWNED BY sitebook TO sitebook_app;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sitebook_app') THEN
    -- CREATEDB is for local convenience only: `prisma migrate dev` and the drift
    -- check need to create a throwaway shadow database. In production the
    -- application role should not have it.
    CREATE ROLE sitebook_app LOGIN PASSWORD 'sitebook' NOSUPERUSER NOBYPASSRLS CREATEDB;
  ELSE
    ALTER ROLE sitebook_app WITH LOGIN NOSUPERUSER NOBYPASSRLS CREATEDB;
  END IF;
END $$;

GRANT ALL ON DATABASE sitebook TO sitebook_app;
GRANT ALL ON SCHEMA public TO sitebook_app;

-- Owning the schema is what lets migrations create tables as this role.
ALTER SCHEMA public OWNER TO sitebook_app;
