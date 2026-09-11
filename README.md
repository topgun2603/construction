# BUILDR

Multi-tenant SaaS for small and mid-size construction builders in India. Daily site
reporting, labour attendance and wages, material indents, and an owner dashboard
that answers "what happened today and what is it costing me".

`docs/sitebook-technical-spec.md` is the source of truth. This README only covers
how to run what is built.

---

## Status

Build order per spec §16:

| Step | Scope | State |
|---|---|---|
| 1 | Monorepo, docker-compose, Prisma schema (Phase 1), RLS migration, seed | **done** |
| 2 | Auth exchange, tenant scoping, `/me`, projects CRUD, plan guard, isolation e2e | **done** |
| 3 | DPR, workers, attendance, labour payments, indents, contractors, materials, presigned uploads | **done** |
| 3b | Wage period generation and finalisation, labour cost and wage sheet reports | **done** |
| 4 | `/sync/push`, `/sync/pull` | **done** |
| 5 | BullMQ, FCM push, WhatsApp summary, dashboard endpoints | **done** |
| 6 | Web: labour section, indent approval, settings | **done** |
| 8 | Expenses: record, approve, reject, summary, dashboard spend-vs-budget | **done** |
| 8b | Project timeline (milestones), attendance register, per-person ledger | **done** |
| 8c | Platform console (superadmin): tenants, analytics, plans, modules, suspension | **done** |
| 8d | Permissions model and owner-defined roles | **done** |
| 9 | Stock: ledger, GRN on receipt, estimates, material overrun report | **done** |
| 9b | Site photos and videos, location capture and map | **done** |
| 12 | Razorpay subscriptions, webhook, plan downgrade, MRR in the console | **done** |
| 7 | Flutter supervisor app | **in progress** — sign-in, offline sync, sites, DPR, roll call, workers, indents, expenses, stock, push. Recording an advance is outstanding; see `apps/mobile/README.md` |

`apps/web` ships the full dashboard flow — login and onboarding, overview, projects
with an editable milestone timeline, the labour section (workers, roll call, a
per-worker account, wage periods, payments), the approvals queue, expenses, reports
(labour cost, attendance register, per-person ledger, printable wage sheet), and
settings — built against the **BUILDR UI System** design (IBM Plex, violet accent,
dark navigation rail).

It also serves the platform console at `/admin`, which is a different application
wearing the same components: its own cookie, its own token audience, and its own
env-based allowlist. See "The platform console" below.

Stack: shadcn-style components owned in `components/ui` (Radix + CVA), TanStack
Table for every list, framer-motion for entrances and value changes, Tailwind for
everything else. Tokens live in `packages/config/tailwind/preset.js` — see
`docs/adr/0002-design-tokens.md` before adding a colour.

Mutations go through server actions in `lib/actions.ts`, so the session token never
leaves the server and each write revalidates only the paths it changed.

---

## Local development

Prerequisites: Node 22+, pnpm 9, Docker.

```bash
pnpm install
pnpm infra:up                      # postgres, redis, minio

cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env.local

pnpm --filter @sitebook/shared build
pnpm --filter @sitebook/api prisma:generate
pnpm --filter @sitebook/api prisma:deploy
pnpm db:seed

pnpm dev                           # api on :3000, web on :3001
```

API docs (non-production only): <http://localhost:3000/docs>

### Signing in locally

With `DEV_AUTH_BYPASS=true` no SMS is sent — the API accepts a `dev:<phone>` token
in place of a Firebase one. The seeded demo tenant gives you a user per role:

| Role | Phone |
|---|---|
| owner | `9000000001` |
| project_manager | `9000000002` |
| site_supervisor | `9000000003` |
| accounts | `9000000004` |
| client | `9000000005` |

The supervisor is assigned to one site only — that is the quickest way to see
project-level scoping working.

To use real OTP instead, set `DEV_AUTH_BYPASS=false`, point
`FIREBASE_SERVICE_ACCOUNT_FILE` at the Admin SDK key, and enable the Phone provider
in the Firebase console.

### Firebase credentials

Two different things, easy to confuse:

- **Web SDK config** (`NEXT_PUBLIC_FIREBASE_*` in `apps/web`) — public identifiers,
  ship to the browser by design.
- **Admin SDK service account** (`FIREBASE_SERVICE_ACCOUNT_FILE` in `apps/api`) — a
  private key. Never commit it; `.gitignore` covers `*service-account*.json`. If one
  has ever been committed or shared, rotate it in the Firebase console.

---

## Stock

`stock_movements` is an append-only ledger, not a `stock_on_hand` balance column, so "why do we
have 12 bags" stays answerable. A balance would hold the number and lose the reason, and the first
time the site disagreed there would be nothing to check against.

Three things worth knowing:

1. **Quantities are integer thousandths in every calculation**, like money is paise. `numeric(14,3)`
   on the wire as a trimmed string ("37.5", not "37.500"), scaled via `quantityToThousandths` for
   any sum. `quantity.test.ts` asserts `0.1 + 0.2 + 0.3` comes back as `0.6`. More than three
   decimals is refused rather than rounded — a caller sending `0.3333` has a unit conversion wrong.
2. **The overrun report measures consumption, not delivery.** Material in the store has been paid
   for but not used, and counting it would flag an overrun on a site that simply took delivery
   early. `percent_used` is `null` rather than `0` where nothing was estimated: "0% used" reads as
   on budget, which is not the same as nobody having said what the material should take.
3. **A corrected GRN rewrites itself rather than posting a difference.** Signing for 40 bags and
   finding 37 is ordinary; posting the −3 as an `out` movement would read as three bags used on
   site, inventing consumption that never happened. The earlier rows are soft-deleted so the change
   is still visible, and `used` does not move. `PATCH /indents/:id/receipt` does this — a separate
   action from the status change, because `received` is terminal and what is wrong is the count.

Issuing more than a site holds is refused. A negative balance means either the issue is wrong or an
inward challan was never entered, and both want fixing when somebody notices rather than at month
end when the overrun report reads like nonsense.

---

## Site photos, videos and location

`project_media` is separate from `dpr_photos`. Those are evidence of what happened on one day and
belong to that report; these are the site itself — the approach road, the elevation, the handover
walkthrough — and they outlive any single report.

Bytes go **straight from the browser to storage** through a presigned URL and never pass through the
API, which is what keeps a 200 MB walkthrough video off a request thread. The row recording that the
file exists is written afterwards, so a failed upload leaves nothing behind.

Two things about keys. Every key is built server-side and begins with the tenant id — the client
never chooses where its bytes land. And **a key is not a capability**: attaching one to a project, or
signing a URL to read it, both check the tenant prefix rather than assuming the caller earned it by
knowing the string. `media.e2e-spec.ts` presents another tenant's key to both and expects 403.

Adding `POST /uploads/view` closed a real gap — the API could accept uploads but never show them, so
every key written was write-only from the client's point of view. Read URLs live an hour rather than
the upload URL's ten minutes: a gallery signs one per image on render, and a short expiry means a tab
left open over lunch fills with broken images.

Photos and videos have **separate size ceilings** (25 MB and 200 MB). A single cap generous enough for
a minute of phone video would also let somebody push a 200 MB "photo".

The map is **OpenStreetMap's embed, not Google's**. Google's embed and static-tile APIs both need a
billed API key and this deployment has none — a map that renders beats a grey box waiting on a key
somebody has to buy, and the "Directions" link still hands the driver Google Maps. An iframe rather
than Leaflet: ~150 KB of mapping library for a picture nobody pans would be the heaviest thing on a
screen a supervisor loads over 3G.

Coordinates are set with a **map picker**: search a locality, then click or drag the pin onto the
plot. The pin is the interaction that matters — an empty plot usually has no postal address to search
for, and the owner planning it is in an office rather than standing on it. "Use my location" is there
for the supervisor who *is* standing on it, and typed boxes for somebody working from a survey.

Leaflet is imported dynamically so its weight and CSS load only when the picker opens; setting a
location is an occasional office task and has no business slowing the roll-call screen a supervisor
opens on 3G every morning.

Geocoding is proxied through `GET /geocode` rather than called from the browser. Nominatim's policy
requires a User-Agent identifying the application, which a browser cannot set; results are cached so
twenty people searching "Whitefield" cost one request; and the search terms are a builder's next
project, which should not be attached to that person's IP at a third party.

The location can be set **after** a site exists, not only while creating it — most sites predate ever
having a map. Everything about a site is edited from one dialog (`Edit site`), including the location;
the map's own button opens the same dialog, so exactly one code path writes the address. It sends only
the fields that changed, because a PATCH carrying every value would overwrite whatever a colleague
edited while the dialog sat open.

The sites list leads with a **photograph of each site**, falling back to a generated cover — the
blueprint grid the login screens use, a tint picked from the design palette by hashing the site id, and
the site's initials. Generated rather than a stock photo, because a photograph of somebody else's
building on your card is the kind of small lie that ends up screenshotted into a client meeting; and
per-site rather than one shared placeholder, because otherwise every unphotographed site looks
identical, which defeats the point of leading with an image.

A map briefly sat in that slot and was removed: a dozen cards meant a dozen live tile sessions for
pictures nobody pans, and at card width a locality map is mostly grey with a pin — two sites in the
same suburb looked the same. The real map is on the site page, full size, where somebody has asked for
it. A builder recognises a job by what it looks like long before they read a
name, and a table of names and dates is the same shape whether it lists sites, invoices or workers.
Cover URLs are signed server-side in the list response — signing is local HMAC with no network call, so
twenty of them cost nothing, while twenty round trips from the browser would be the slowest thing on
the page. The table view remains behind a toggle: it is the only one that sorts by budget or handover
date, and dropping it to make the page prettier would have removed the one thing it was good at.

---

## Billing

Razorpay Subscriptions. Prices live in `PLAN_PRICES_PAISE` as paise integers like all money here —
Starter ₹999, Pro ₹2,499 a month.

The trust boundary is the whole design: **a browser may ask to start or cancel, and nothing more.**
What plan a tenant is on, whether it is paid, and until when are set only from a signature-verified
webhook. Four consequences, each with a test:

1. **Checkout does not grant the plan.** No money has moved yet, and upgrading there would hand Pro to
   anyone who opened the dialog and walked away. `subscription.activated` does it, and the module gate
   follows on the next request because the tenant cache is invalidated rather than left to expire.
2. **A failed payment does not cut access.** The period is already paid for, and taking the roll call
   away from site staff mid-shift over an expired card is not a collections strategy. The plan drops
   after the paid period plus `BILLING_GRACE_DAYS`, found by a nightly sweep — nothing arrives to
   announce that, it is the absence of a payment.
3. **Replays are no-ops.** Razorpay retries until it gets a 2xx, so every event arrives more than once.
   The event id is inserted first and a duplicate returns 200 having done nothing; without it a
   retried `subscription.charged` raises a second invoice and extends the period twice.
4. **The signature is verified over the raw bytes**, captured in `app-setup.ts`. A test presents a
   *valid* signature for one payload alongside another body — which is what verifying a re-serialised
   object would let through.

`billing_identities` is a non-RLS directory mapping a Razorpay subscription id to a tenant, kept in
step by a trigger. It exists because a webhook has no tenant context and `subscriptions` is RLS
protected, so reading it to find the tenant returns nothing — which the first version of this did,
silently, so a paid subscription never upgraded the plan. Billing deliberately has **no** BYPASSRLS
connection: the nightly sweep does one scoped query per subscribed tenant instead, so a future bug in
billing cannot read across tenants.

`RAZORPAY_WEBHOOK_SECRET` is not the API secret — Razorpay signs webhooks with a secret you choose
when adding the endpoint. Set it and the webhook works with no Razorpay account at all, which is how
the e2e suite and local development exercise the flow; outbound calls run dry and log what they would
have sent.

---

## Roles and permissions

Access is decided by **permissions**, not by role names. An owner can invent a role the
product never shipped with — a store keeper who raises indents but approves nothing — at
Settings → Roles.

The five built-in roles are rows in `roles` too, marked `is_system` and read-only. An owner
able to edit the Owner role could remove `roles.manage` from themselves and have no way to
put it back; creating a role *based on* a built-in one is the supported way to get something
narrower. `base_role` is kept on every role because two things are not expressible as
permissions — which role somebody holds on a given project (`project_members.role_on_project`)
and the approver identity checks inside the services.

Three properties hold, each with a test:

1. **Permissions are resolved per request, never carried in the JWT.** The token holds a role
   id. A permission list in the token could not be narrowed until it expired, so revoking
   access from the UI would do nothing for up to fifteen minutes. *Which* role a person holds
   is read from the user row for the same reason, so moving somebody between roles also lands
   immediately.
2. **Nobody can grant a permission they do not hold.** Otherwise a project manager given
   `roles.manage` could mint a role holding `tenant.manage`, assign it to themselves, and own
   the account. A custom role also cannot be based on `owner`.
3. **A built-in role is defined by code, not by its stored row.** `RoleCache` reads
   `permissionsForSystemRole` for any `is_system` role. The rows are seeded once, so a permission
   added later would never reach them — which is exactly what happened when stock shipped: every
   existing tenant's Owner role was a snapshot from before those permissions existed, and the owner
   was refused their own new feature. A migration keeps the stored column honest for anything
   reading the table, but it is not what authorises a request.
4. **Every permission the editor offers actually gates something.** `permissions.test.ts` pins
   the built-in presets against what the old `@Roles` decorators allowed, so widening a role
   cannot happen as a side effect of editing a list, and `roles.e2e-spec.ts` walks a narrow
   role against one route per permission it lacks.

The conversion deliberately took access away in one place: `client`. Before permissions, a
client could reach every route with no `@Roles` decorator — recording an expense or an advance
among them. Nothing intended that; the gating simply had no way to say "everyone except the
customer".

---

## The platform console

A separate surface at `/admin` (API: `/v1/admin/*`) for the people who operate
BUILDR, not the people who buy it.

`/admin` is the analytics view: signups per week against the running total, the
activation funnel (signed up → invited → created a site → added workers → took a roll
call → filed a report, with the biggest drop-off marked), the share of tenants doing
real work each week, 30 days of platform volume, plan mix, the busiest accounts, and a
list of accounts that have gone quiet for a fortnight. `/admin/tenants` is the
filterable list, and `/admin/tenants/<id>` holds the levers — plan, individual modules,
suspension.

Two deliberate omissions. There is **no revenue figure**: billing is step 12 and plan
prices exist nowhere in this system, so an MRR here would be invented, and it is the one
number on a console like this that somebody would act on. And "active" means attendance
or a filed report — not a sign-in, because an owner opening an empty dashboard and
closing it is precisely the tenant the engagement chart needs to expose.

Charts are hand-rolled SVG in `app/(platform)/admin/charts.tsx`, matching
`components/headcount-chart.tsx`. Five fixed shapes do not justify a charting library's
bundle, and its defaults would have to be fought back to the design tokens anyway.

It is **off unless configured**. Set both of these or neither — env validation refuses
a half-configured console, because the failure mode is a screen that loads and shows
nothing:

```
ADMIN_DATABASE_URL=postgresql://sitebook_admin:...@localhost:5432/sitebook?schema=public
PLATFORM_ADMIN_PHONES=919876543210,919812345678
```

Four things keep it separate from the tenant app, and all four are enforced rather
than documented:

1. **A different database role.** `sitebook_admin` has `BYPASSRLS`; the application
   role `sitebook_app` never will. Cross-tenant reads are impossible for the code that
   serves tenant requests, so a missing `set_config` fails closed instead of returning
   the whole table. See `infra/postgres/init/02-admin-role.sql`.
2. **A different token audience.** Console tokens are signed with audience `platform`,
   tenant tokens with `api`. Presenting either to the other fails the signature check
   itself — not a claim some route has to remember to inspect.
3. **An allowlist outside the database.** `PLATFORM_ADMIN_PHONES` is env, so the
   console cannot grant access to itself. It is re-read on every request, so removing
   someone takes effect immediately rather than when their 8-hour token expires.
4. **Its own audit table.** `platform_audit_log` has no `tenant_id` and no RLS policy,
   and records every change with the operator's phone and the before/after state. A
   tenant cannot read the operator's trail about their own account.

`test/platform.e2e-spec.ts` covers the boundary explicitly: a tenant token refused at
a console route, a console token refused at a tenant route, a verified OTP from a
number not on the list, and a still-valid token stopping work the moment its number is
removed.

For a database that already exists, apply the role by hand — the init scripts only run
on a fresh volume:

```bash
docker exec -i sitebook-postgres-1 psql -U <superuser> -d sitebook   -f /docker-entrypoint-initdb.d/02-admin-role.sql
```

---

## Tests

```bash
pnpm test                                    # unit tests (money, earnings, plans, guards)
pnpm --filter @sitebook/api test:e2e         # needs Postgres up and migrated
```

Background jobs run in a separate process: `pnpm --filter @sitebook/api worker`.
The API only enqueues; only the worker consumes, so a WhatsApp send never
occupies a request thread. With `JOBS_ENABLED=false` nothing registers and every
enqueue is a logged no-op — which is how the test suite runs without Redis.

Schedules are read in `Asia/Kolkata` (a summary that says "today" must mean the
builder's today): owner summary 19:00, missing-DPR nudge 17:30, labour rollup
01:00, wage-period drafts 02:00.

**Unattended work is visible to the tenant.** Settings → Automation lists what runs, when,
and what it touches, with the one job that *writes* records called out separately from the
three that only send messages. A wage period the scheduler drafted is marked `source:
'scheduled'` and labelled "Drafted automatically" on screen — an owner finding a sheet they
did not create should read why, not conclude somebody else has access to their account.

Because drafts arrive unasked, a period can also be **discarded** while open and **reopened**
while finalised-but-unpaid. Reopening releases the advances that finalising consumed; without
that the worker's advance would stay deducted by a sheet that no longer deducts it — taken off
once, never credited back, and invisible. `wage-period-lifecycle.e2e-spec.ts` covers both,
including that attendance unlocks again. With no `WHATSAPP_TOKEN` the client logs what it
would have sent and reports success, so the summary is inspectable without Meta
credentials.

`test/labour.e2e-spec.ts` covers the money path end to end — roll call → wage
period → partial and full payment → ledger → wage sheet — including the rules that
are easy to get wrong: the wage frozen onto each attendance row, refusing a worker
marked present on two sites the same day, attendance locking once a period is
finalised, and a payment larger than what is outstanding.

`test/deletes.e2e-spec.ts` covers every deletion rule in one place, because each one
refuses in at least one situation and the refusals are the point: a worker on an unpaid
wage sheet, a submitted daily report, an approved indent, a payment a wage period has
already consumed, your own account, and the last owner.

`test/milestones.e2e-spec.ts` covers the timeline, including the two rules that keep it
readable — a reorder must name every stage, and a milestone is not reachable through a
sibling project's URL.

The e2e suite runs against a real Postgres on purpose: the thing under test is
row-level security, and a stubbed database would prove nothing.
`test/tenancy.e2e-spec.ts` is the mandatory isolation test from spec §15.

---

## Repository layout

```
apps/
  api/      NestJS + Prisma
  web/      Next.js 15 — owner dashboard and (later) client portal
  mobile/   Flutter supervisor app (not scaffolded yet)
packages/
  shared/   zod schemas, enums, plan map, money and earnings arithmetic
  config/   tsconfig, eslint, tailwind presets
infra/      docker-compose, Dockerfiles, one-off SQL
docs/       spec and ADRs
```

---

## Things worth knowing before you change anything

**Tenancy is enforced in Postgres, not in application code.** Every tenant table has
`FORCE ROW LEVEL SECURITY` and a policy on `app.tenant_id`. `TenantDb` sets it per
transaction. A query that forgets the tenant context returns *zero rows* rather than
everything — so if a new query mysteriously finds nothing, that is the usual cause.

**The app must connect as `sitebook_app`, never as the `sitebook` superuser.** A
superuser bypasses RLS unconditionally — `FORCE` does not apply to it — so using the
superuser silently disables every tenancy policy. `.env.example` already points at
the right role. If isolation ever looks broken, check this first:

```sql
SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user;
```

Other consequences:

- Cross-tenant work needs the `sitebook_admin` BYPASSRLS role
  (`infra/sql/superadmin-role.sql`), never the app's connection.
- The seed script sets tenant context per tenant, like a request does.
- `auth_identities` is the single table with no RLS: `/auth/exchange` has to resolve
  a phone to a tenant *before* a context can exist. A trigger maintains it; never
  write it from application code.

**Money is `bigint` paise.** No floats, anywhere. It crosses the wire as a decimal
*string* (`"65000"` = ₹650.00) because a JSON number loses paise past 2^53.

**Wage rates are frozen onto attendance.** `attendance.wage_snapshot` and
`overtime_rate_snapshot` are copied at record time, so raising a worker's wage never
rewrites what they already earned.

**Dates.** `date` columns for report and attendance dates — no timezone, carried as
`YYYY-MM-DD` strings. `timestamptz` for everything else. App timezone is
`Asia/Kolkata`.

**Schema changes.** `schema.prisma` and the hand-written migration SQL must agree;
`pnpm db:drift` checks it (needs `SHADOW_DATABASE_URL`). RLS policies and triggers
are invisible to Prisma's differ, so add them to the migration by hand and keep the
policy in the same migration as the table (spec §17).
