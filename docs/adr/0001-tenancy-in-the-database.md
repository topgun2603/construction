# ADR 0001 — Tenancy is enforced in Postgres, with FORCE ROW LEVEL SECURITY

Status: accepted
Date: 2026-09-09

## Context

SiteBook is a shared-database, shared-schema multi-tenant app (spec §6.1). The
failure we most need to make impossible is one builder reading another's data: it
ends the company. The usual approach — `where tenantId` in every query — fails the
first time someone writes a query and forgets, and nothing about the code makes that
omission visible.

## Decision

Every tenant-scoped table gets a row-level security policy on
`current_setting('app.tenant_id')`, created in the same migration as the table.
`TenantDb` sets that setting with `set_config(..., is_local => true)` inside the
transaction wrapping each operation.

Three choices inside that are worth recording.

### The application connects as a non-superuser role

A superuser bypasses RLS unconditionally — `FORCE ROW LEVEL SECURITY` does not
constrain it, and there is no policy you can write that will. A Postgres container's
`POSTGRES_USER` *is* the cluster superuser, so the obvious `DATABASE_URL` is exactly
the one that disables the whole mechanism.

We hit this: the first run of the isolation suite showed an untenanted query
returning every project in the database and a cross-tenant `UPDATE` succeeding. The
schema, the policies and the application code were all correct; the connection was
not.

So `infra/postgres/init/01-app-role.sql` creates `sitebook_app` — `NOSUPERUSER`,
`NOBYPASSRLS` — which owns the schema and runs both the migrations and the app.
`DATABASE_URL` must point at it. If tenancy ever appears not to work, check
`SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user` first.

### FORCE ROW LEVEL SECURITY, not just ENABLE

`ENABLE ROW LEVEL SECURITY` exempts the table owner. Because `sitebook_app` owns the
schema it creates, `ENABLE` alone would leave every policy inactive for the
application, and the mandatory isolation test would pass while proving nothing at
all.

`FORCE` costs us something real: *all* row access now needs a tenant context,
including the seed script and any backfill. We accept that. A migration that has to
think about which tenant it is touching is better than a policy that looks present
and is not.

Cross-tenant work uses a separate `sitebook_admin` role with `BYPASSRLS`
(`infra/sql/superadmin-role.sql`), whose connection string is not in the app's
environment and which is never reachable through the public API.

### The policy compares against NULL when unset

`current_setting('app.tenant_id', true)` returns NULL rather than raising when the
setting is missing, and `tenant_id = NULL` is never true. So an untenanted query
returns no rows instead of the whole table. Fail closed. The alternative —
`current_setting` without the `missing_ok` flag — raises a Postgres error, which is
louder but turns every health check and every framework-internal query into a 500.

### `set_config` rather than `SET LOCAL`

`SET LOCAL` takes a literal, which would mean splicing the tenant id into SQL text.
`set_config` accepts a bound parameter. Both are transaction-scoped, so the setting
cannot leak onto the next request that reuses the pooled connection.

## Consequences

- Application-level `where tenantId` filters become defence in depth rather than the
  only defence. We still write them where they help the planner.
- RLS cannot express project-level membership, so that stays in application code
  (`ProjectAccess`). Two layers, two different questions: *which tenant* is the
  database's job, *which project* is ours.
- Reading another tenant's row by id returns 404, not 403. A 403 would confirm the
  id exists, which is an existence oracle across tenants.
- `auth_identities` is exempt by necessity: `/auth/exchange` resolves a phone to a
  tenant before any context exists. It holds a phone and two ids, nothing more, and
  is maintained by a trigger so application code cannot let it drift.
- New tables are easy to get wrong. The checklist in spec §17 — every tenant-scoped
  model has `tenantId` and a policy in the same migration — is not optional, and
  `test/tenancy.e2e-spec.ts` should grow a case whenever a table holds something new
  worth stealing.

## Alternatives considered

**Database per tenant.** Strongest isolation, but 50+ builders means 50+ migration
runs, and the reporting queries the owner dashboard needs would have to fan out.
Revisit past a few hundred tenants.

**Schema per tenant.** Same migration-fan-out problem with weaker isolation than
separate databases. No.

**Application-layer filtering only.** Cheapest to build, and one forgotten `where`
clause away from the failure that ends the company.
