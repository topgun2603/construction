# SiteBook — Technical Specification

> Multi-tenant SaaS for small and mid-size construction builders in India.
> This document is the source of truth for Claude Code. Read it fully before writing code.

---

## 1. Product overview

**Problem.** Small builders run sites on WhatsApp groups and Excel. Owners don't know today's status, labour cost, or material overruns until it's too late.

**Solution.** One app per builder (tenant) covering daily site reporting, attendance, materials, expenses, and a client portal — with an owner dashboard that answers "what happened today and what is it costing me".

**Business model.** Subscription per builder, plan-based module gating (Starter / Pro). Billed via Razorpay.

**Design principle.** Site staff must finish any task in under 60 seconds on a mid-range Android phone with no signal. Everything the supervisor touches is offline-first.

---

## 2. Users and roles

| Role | Device | What they do |
|---|---|---|
| `owner` | Web, phone | Sees everything across all sites, approves big expenses, manages subscription |
| `project_manager` | Web, phone | Manages assigned projects, approves indents/expenses, tracks milestones |
| `site_supervisor` | Android app | Files daily progress report, attendance, material indents, site expenses |
| `accounts` | Web | Weekly wage sheets from attendance, record labour payments, expense reconciliation, reports |
| `client` | Mobile web portal | Views their own project's progress, payments, approvals |

Roles are per tenant. A user belongs to exactly one tenant. Project-level assignment controls which projects a supervisor/PM/client can see.

---

## 3. Modules and MVP scope

### Phase 1 — MVP (ship this first)
1. **Auth & tenants** — phone OTP login, tenant onboarding, team invites
2. **Projects & sites** — create project, assign team, milestones
3. **Daily progress reports (DPR)** — work done, photos, manpower, weather, issues; offline
4. **Labour attendance** — per-worker daily attendance (present / half-day / overtime) per site, grouped by contractor; offline
5. **Labour payments** — weekly wage sheet computed from attendance, record advances and payments, outstanding balance per worker and per contractor
6. **Material indents** — supervisor requests → PM approves → mark received
7. **Notifications** — push (FCM) + WhatsApp daily summary to owner
8. **Owner dashboard** — all-sites overview, single project view, DPR feed, labour cost

### Phase 2
9. **Expenses & petty cash** — bill photo, category, approval flow
10. **Materials stock** — GRN, site-wise stock, consumption vs estimate
11. **Reports** — labour cost by site/week/contractor, worker payment history, material overrun, expense summary
12. **Subscription billing** — Razorpay plans, module gating UI

### Phase 3
13. **Client portal** — progress photos, milestone tracker, payment schedule, approvals
14. **Documents** — drawings, permits, contracts with versioning
15. **Worker self-service** — worker views own attendance and payments via WhatsApp/link

---

## 4. Technology stack

| Layer | Choice | Why |
|---|---|---|
| Mobile app | **Flutter** (Dart), Riverpod, Drift (SQLite), Dio | One codebase, mature offline libs |
| Web dashboard + client portal | **Next.js 15** (App Router), TypeScript, Tailwind, shadcn/ui, TanStack Query | Fast to build, SSR for portal |
| API | **NestJS** (Node 22, TypeScript), Prisma ORM | Modular, matches web language |
| Database | **PostgreSQL 16** with row-level security | Reporting needs SQL; RLS enforces tenancy |
| Cache / queues | **Redis 7** + **BullMQ** | Background jobs, rate limits |
| Object storage | **S3-compatible** (AWS S3 in prod, MinIO locally) | Photos, drawings |
| Auth | **Firebase Auth** (phone OTP) — exchanged for our own JWT | Cheap OTP, no SMS vendor to manage |
| Push | **Firebase Cloud Messaging** | Free, reliable on Android |
| WhatsApp | **WhatsApp Cloud API** (Meta) | Daily summaries, alerts |
| Payments | **Razorpay Subscriptions** | Indian billing, UPI/cards |
| Maps | Google Maps SDK | Site location, geofenced attendance (Phase 2) |
| Packaging | **Docker** + docker-compose | Dev/prod parity |
| Hosting (initial) | Single VPS or Railway/Fly.io | No Kubernetes until >50 tenants |
| CI | GitHub Actions | Lint, test, build images |
| Monorepo | **pnpm workspaces** + Turborepo (web/api/shared); Flutter app in `/apps/mobile` | Shared types between API and web |

---

## 5. Repository structure

```
sitebook/
├── apps/
│   ├── api/            # NestJS
│   ├── web/            # Next.js — owner dashboard + client portal
│   └── mobile/         # Flutter — supervisor app
├── packages/
│   ├── shared/         # TS types, zod schemas, enums (used by api + web)
│   └── config/         # eslint, tsconfig, tailwind presets
├── infra/
│   ├── docker-compose.yml
│   ├── docker-compose.prod.yml
│   └── Dockerfile.api, Dockerfile.web
├── docs/
│   └── this file, ADRs
├── turbo.json
├── pnpm-workspace.yaml
└── package.json
```

---

## 6. Architecture

```
Clients (Flutter / Next.js / client portal)
        │  HTTPS, JWT
        ▼
API layer (NestJS)
  ├─ AuthModule        — Firebase token → app JWT with tenant_id + role
  ├─ TenantMiddleware  — sets app.tenant_id on the DB connection per request
  ├─ PlanGuard         — blocks routes for modules not in tenant plan
  └─ Domain modules    — projects, dpr, attendance, materials, expenses, notifications, sync
        │
        ▼
Data layer
  ├─ PostgreSQL (RLS on every tenant table)
  ├─ Redis (BullMQ queues, caching)
  └─ S3 (presigned uploads for photos)
        │
        ▼
External
  ├─ WhatsApp Cloud API   ├─ FCM   ├─ Razorpay   └─ Google Maps
```

### 6.1 Multi-tenancy
- Shared database, shared schema. Every tenant-scoped table has `tenant_id UUID NOT NULL`.
- Postgres RLS policy on every such table: `USING (tenant_id = current_setting('app.tenant_id')::uuid)`.
- `TenantMiddleware` runs `SET LOCAL app.tenant_id = '<uuid>'` inside a transaction per request. Prisma uses a per-request extended client for this.
- The API never accepts `tenant_id` from the request body. It always comes from the JWT.
- Superadmin operations use a separate role that bypasses RLS and is never exposed through the public API.

### 6.2 Auth flow
1. Mobile/web signs in with Firebase phone auth, gets a Firebase ID token.
2. `POST /auth/exchange` verifies the Firebase token, looks up `users` by phone, and returns an app JWT (`{ sub, tenant_id, role, project_ids[] }`, 15 min) + refresh token (30 days, stored hashed).
3. First-time phone → onboarding: create tenant, create owner user.
4. Invites: owner adds a phone number + role; the user is created in `pending` state and activated on first login.

### 6.3 Plan gating
- `tenants.plan` — `starter | pro`, `tenants.enabled_modules text[]`.
- `@RequiresModule('expenses')` decorator on controllers; `PlanGuard` returns `403 MODULE_NOT_ENABLED`.
- Web and mobile read `/me` (includes `enabled_modules`) and hide navigation for disabled modules.
- Plan → default modules map lives in `packages/shared/plans.ts`.

---

## 7. Data model (core tables)

All tables: `id uuid pk default gen_random_uuid()`, `created_at`, `updated_at`, and `tenant_id` where tenant-scoped. Soft delete via `deleted_at` on user-editable records.

```
tenants          id, name, logo_url, plan, enabled_modules[], razorpay_customer_id, status
users            id, tenant_id, phone (unique per tenant), name, role, status, fcm_tokens[]
projects         id, tenant_id, name, client_name, address, lat, lng, start_date, target_end_date,
                 budget_amount, status (planning|active|on_hold|completed)
project_members  project_id, user_id, role_on_project
milestones       id, tenant_id, project_id, name, planned_date, actual_date, sort_order
contractors      id, tenant_id, name, trade, phone, payment_terms (weekly|fortnightly|monthly)
workers          id, tenant_id, contractor_id (nullable = direct labour), name, phone, trade,
                 skill_level (unskilled|semi|skilled), daily_wage, overtime_rate_per_hour,
                 id_proof_s3_key, photo_s3_key, status (active|inactive), client_id
worker_projects  worker_id, project_id, from_date, to_date   -- which sites a worker is on

daily_reports    id, tenant_id, project_id, report_date, submitted_by, weather,
                 work_done text, issues text, status (draft|submitted), client_id (uuid from device)
                 UNIQUE (project_id, report_date)
dpr_activities   id, daily_report_id, activity text, quantity, unit
dpr_photos       id, daily_report_id, s3_key, caption, taken_at
dpr_manpower     id, daily_report_id, trade, count

attendance       id, tenant_id, project_id, attendance_date, worker_id,
                 status (present|half_day|absent), overtime_hours numeric(4,1) default 0,
                 wage_snapshot bigint (paise, copied from worker.daily_wage at record time),
                 recorded_by, recorded_at, lat, lng, client_id
                 UNIQUE (project_id, attendance_date, worker_id)

wage_periods     id, tenant_id, contractor_id (nullable), period_start, period_end,
                 status (open|finalised|paid), total_earned, total_advances, total_paid,
                 finalised_by, finalised_at
wage_lines       id, wage_period_id, worker_id, days_present numeric(4,1), overtime_hours,
                 gross_amount, advances_deducted, net_payable, paid_amount
labour_payments  id, tenant_id, project_id, worker_id (nullable), contractor_id (nullable),
                 wage_period_id (nullable), type (advance|wage|bonus|deduction),
                 amount bigint, paid_on, mode (cash|upi|bank), reference, note,
                 recorded_by, client_id

materials        id, tenant_id, name, unit, category
material_indents id, tenant_id, project_id, requested_by, status
                 (requested|approved|rejected|ordered|received), urgency, notes, client_id
indent_items     id, indent_id, material_id, quantity, received_quantity
material_estimates project_id, material_id, estimated_quantity   -- Phase 2
stock_movements  id, tenant_id, project_id, material_id, type (in|out), quantity, ref  -- Phase 2

expenses         id, tenant_id, project_id, amount, category, bill_s3_key, note,
                 submitted_by, status (pending|approved|rejected), approved_by, client_id  -- Phase 2

notifications    id, tenant_id, user_id, type, payload jsonb, read_at
sync_log         id, tenant_id, device_id, entity, entity_id, op, server_ts
```

**`client_id`** on offline-created entities is the UUID generated on the device; it's the idempotency key for sync.

---

## 8. Offline-first sync protocol

The mobile app must work with zero connectivity for days.

**Local store (Drift/SQLite):** mirrors `daily_reports`, `attendance`, `workers`, `worker_projects`, `labour_payments` (advances recorded on site), `material_indents`, `projects`, `contractors`, `materials`, plus an `outbox` table.

**Outbox entry:** `{ id, entity, op (create|update), payload jsonb, created_at, attempts, last_error }`.

**Push:** `POST /sync/push` with an array of outbox entries. Server processes in order, per entity:
- `create`: upsert by `client_id`. If it already exists, treat as update (idempotent).
- `update`: apply if `payload.updated_at >= server.updated_at`, else return `conflict` with server copy.
- Returns `{ results: [{ outbox_id, status: ok|conflict|error, server_id, server_record? }] }`.

**Pull:** `GET /sync/pull?since=<server_ts>&device_id=` returns changed rows for the user's projects across all synced entities plus a new `since` cursor. Uses `updated_at` indexes.

**Conflict policy (v1):** last-write-wins by server timestamp. Conflicts are rare (one supervisor per site per day). Log them to `sync_log` for visibility.

**Photos:** stored locally, uploaded separately via presigned S3 URLs (`POST /uploads/presign`) in a background queue; the DPR record references the `s3_key` once uploaded. DPR can be submitted before all photos finish.

**Trigger:** sync runs on app foreground, on connectivity regained, and every 5 minutes while online.

---

## 8A. Labour attendance and payments — business rules

**Worker registry**
- Workers belong to a contractor (subcontracted gang) or are direct labour (`contractor_id` null).
- Each worker has a `daily_wage` and `overtime_rate_per_hour`. Changing a wage does not alter past attendance — `attendance.wage_snapshot` freezes the rate on the day.
- A worker can be assigned to multiple projects over time via `worker_projects`; the supervisor's roll call shows only workers assigned to that site on that date.

**Daily roll call (mobile, offline)**
- Screen lists workers grouped by contractor with three-state toggles: present, half day, absent. Optional overtime hours per worker.
- Bulk actions: "mark all present" per contractor group.
- Supervisor can add a new worker on the spot (name, phone, trade, wage, photo) — it syncs with `client_id`.
- Attendance is editable until the wage period containing that date is finalised; after that it's locked (API returns `409 PERIOD_FINALISED`).
- Device GPS is captured on submit for later geofence checks (Phase 2).

**Daily earned amount** = `present: wage_snapshot`, `half_day: wage_snapshot / 2`, `absent: 0`, plus `overtime_hours × overtime_rate`.

**Advances**
- Supervisor or accounts records an advance against a worker (`labour_payments.type = advance`). Advances are deducted in the next wage period.
- Contractor-level advances (`worker_id` null) are deducted from the contractor's period total.

**Wage periods**
1. `POST /wage-periods/generate` with `contractor_id` (or null for direct labour), `period_start`, `period_end` → creates one `wage_line` per worker: days present, overtime hours, gross, undeducted advances, net payable.
2. Accounts reviews and edits lines if needed (e.g. bonus/deduction rows via `labour_payments`).
3. `finalise` locks the attendance for that range and freezes the lines.
4. `pay` records one or more `labour_payments` of type `wage` and updates `paid_amount`; period status → `paid` when fully settled. Partial payments are allowed.

**Balances**
- Worker outstanding = Σ earned (all attendance) − Σ payments (wage + advance) ± bonus/deduction.
- Contractor outstanding = Σ over its workers + contractor-level payments.
- Exposed via `/workers/:id/ledger` and on the labour dashboard.

**Reports**
- Labour cost by project / contractor / worker for any date range (`/reports/labour-cost`).
- Wage sheet PDF per period: worker, days, OT, gross, advances, net, signature column — printable for cash disbursement at site.
- Worker ledger: chronological attendance and payments with running balance.
- Owner overview shows this week's labour cost and total outstanding to labour.

**Edge cases to handle**
- Worker moves contractor mid-period: past lines stay with the old contractor.
- Same worker on two sites the same day: allowed only as half day + half day; API rejects two `present` rows on the same date.
- Backdated attendance edits after payment: blocked; require a `deduction`/`bonus` adjustment in the next period instead.

---

## 9. API design

- REST, JSON, base path `/v1`. OpenAPI generated via NestJS Swagger at `/docs`.
- Auth: `Authorization: Bearer <app JWT>`.
- Errors: `{ code: 'STRING_CODE', message, details? }` with proper HTTP status.
- Pagination: cursor-based (`?cursor=&limit=`) on list endpoints.
- Validation: zod schemas from `packages/shared`, applied via a NestJS pipe.

Key endpoints (Phase 1):

```
POST   /auth/exchange           POST /auth/refresh          GET /me
POST   /tenants                 PATCH /tenants/:id           POST /tenants/:id/invite
GET    /projects                POST /projects               GET /projects/:id
PATCH  /projects/:id            POST /projects/:id/members   GET /projects/:id/summary
GET    /projects/:id/dpr        POST /dpr                    PATCH /dpr/:id
POST   /dpr/:id/submit
GET    /workers                 POST /workers                PATCH /workers/:id
POST   /workers/:id/assign      GET  /workers/:id/ledger     # attendance + payments history
GET    /attendance?project_id&date   POST /attendance (bulk upsert, one row per worker)
GET    /attendance/summary?project_id&from&to     # days per worker, cost per contractor
GET    /wage-periods            POST /wage-periods/generate  # from attendance for a date range
GET    /wage-periods/:id        POST /wage-periods/:id/finalise   POST /wage-periods/:id/pay
GET    /labour-payments         POST /labour-payments        # advances, ad-hoc payments
GET    /reports/labour-cost?group_by=project|contractor|worker&from&to
GET    /reports/wage-sheet/:wage_period_id.pdf
GET    /indents                 POST /indents                PATCH /indents/:id/status
GET    /materials               POST /materials
GET    /contractors             POST /contractors
POST   /uploads/presign
POST   /sync/push               GET  /sync/pull
GET    /dashboard/overview      GET  /dashboard/today
GET    /notifications           PATCH /notifications/:id/read
```

---

## 10. Background jobs (BullMQ)

| Queue | Job | Schedule / trigger |
|---|---|---|
| `notifications` | Push to FCM on indent status change, DPR submitted, expense approval | Event |
| `whatsapp` | Owner daily summary: per site — DPR submitted?, headcount, photos count, issues | Cron 19:00 IST per tenant |
| `whatsapp` | Missing DPR reminder to supervisor | Cron 17:30 IST |
| `reports` | Nightly rollups: labour cost per project per day (sum of wage_snapshot × status + overtime), material consumption vs estimate | Cron 01:00 IST |
| `reports` | Auto-generate draft wage periods per contractor at period end; notify accounts | Cron 02:00 IST |
| `whatsapp` | Wage sheet summary to contractor when period finalised | Event |
| `media` | Generate photo thumbnails after upload | S3 event / after presign complete |
| `billing` | Razorpay webhook processing, plan downgrade on failed payment | Webhook |

---

## 11. Notifications

- **Push (FCM):** tokens stored on `users.fcm_tokens`. Topics per project for broadcast.
- **WhatsApp Cloud API:** pre-approved message templates:
  - `daily_site_summary` — {builder}, {date}, {site_count}, {sites_reported}, {total_headcount}, {issues_count}
  - `dpr_reminder` — {site_name}
  - `indent_status` — {site_name}, {status}
- In-app: `notifications` table, unread badge on `/me`.

---

## 12. Web app structure (Next.js)

```
apps/web/app/
├── (auth)/login
├── (dashboard)/            # owner, PM, accounts
│   ├── overview
│   ├── projects/[id]/{today,dpr,materials,people,milestones}
│   ├── labour/{workers,attendance,wage-periods,payments}
│   ├── indents
│   ├── expenses            # Phase 2
│   ├── reports             # Phase 2
│   └── settings/{team,plan,materials,contractors}
└── (portal)/p/[projectId]  # client portal, Phase 3
```

- Server components for data-heavy pages; TanStack Query for interactive tables.
- Tenant branding (logo, name) loaded once in the layout from `/me`.
- shadcn/ui components; design tokens imported from the Claude Design export.

---

## 13. Mobile app structure (Flutter)

```
apps/mobile/lib/
├── core/        # dio client, auth, sync engine, drift db, theme
├── features/
│   ├── auth/
│   ├── sites/       # my sites list, site detail
│   ├── dpr/
│   ├── attendance/  # per-worker roll call, grouped by contractor
│   ├── workers/     # add worker with photo, record advance
│   ├── indents/
│   └── notifications/
└── shared/      # widgets: photo grid, stepper, status pill, offline banner
```

- State: Riverpod. Persistence: Drift. Networking: Dio with auth interceptor and retry.
- Photos: `image_picker` → compress to ≤1600px / ~300 KB → local path → upload queue.
- Localisation ready: `flutter_localizations`, strings in ARB files (English first, Tamil/Hindi later).
- Minimum Android 8 (API 26). iOS later.

---

## 14. Local development

`infra/docker-compose.yml` services: `postgres`, `redis`, `minio`, `api`, `web`. One command:

```bash
pnpm install
docker compose -f infra/docker-compose.yml up -d
pnpm --filter api prisma migrate dev
pnpm --filter api seed        # demo tenant, 2 projects, users for each role
pnpm dev                       # turbo runs api + web
cd apps/mobile && flutter run  # points at http://10.0.2.2:3000
```

Environment variables (`.env.example` in each app): `DATABASE_URL`, `REDIS_URL`, `S3_*`, `FIREBASE_SERVICE_ACCOUNT`, `JWT_SECRET`, `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_ID`, `RAZORPAY_KEY_ID`, `RAZORPAY_SECRET`.

---

## 15. Non-functional requirements

- **Security:** RLS on all tenant tables; JWT 15 min; refresh rotation; presigned URLs expire in 10 min; rate limit OTP exchange; audit log on approvals.
- **Performance:** dashboard overview < 500 ms for 50 projects; sync push handles 500 outbox entries in one request.
- **Reliability:** all writes idempotent via `client_id`; jobs retried 3× with backoff.
- **Data:** daily Postgres backups; photos versioned in S3.
- **Observability:** pino JSON logs, request IDs, Sentry on api/web/mobile.
- **Testing:** unit tests for sync merge logic and plan guard; e2e (supertest) for auth + tenancy isolation — a test that proves tenant A cannot read tenant B's project is mandatory.

---

## 16. Build order for Claude Code

Work in this sequence; each step should leave the repo runnable.

1. Monorepo scaffold, docker-compose, Prisma schema for Phase 1 tables, RLS migration, seed script.
2. API: auth exchange, tenant middleware, `/me`, projects CRUD, plan guard. Tenancy isolation e2e test.
3. API: DPR, workers, per-worker attendance, labour payments, indents, contractors, materials, presigned uploads.
   3b. API: wage period generation and finalisation, labour cost and wage sheet reports (PDF via puppeteer or pdfmake).
4. API: `/sync/push` and `/sync/pull` with idempotent upserts. Unit tests for merge rules.
5. API: BullMQ setup, FCM push, WhatsApp daily summary job, dashboard endpoints.
6. Web: auth, layout with tenant branding, overview, project pages, labour section (workers, attendance grid, wage periods, payments), indents approval, settings/team.
7. Mobile: auth, Drift schema, sync engine, sites list, DPR form with photos, per-worker attendance roll call, add worker, record advance, indents.
8. Phase 2 modules in order: expenses → stock → reports → Razorpay billing.

## 17. Conventions

- TypeScript strict everywhere; no `any`.
- Zod schema is the single source of truth for a payload; Prisma types for DB rows.
- Every tenant-scoped Prisma model must include `tenantId` and have an RLS policy in the same migration.
- Money stored as `bigint` paise, never float.
- Dates: `date` columns for report/attendance dates (no timezone); `timestamptz` for everything else. App timezone is `Asia/Kolkata`.
- Commit messages: conventional commits. One module per PR-sized change.

---

## Deviations from this spec in the implementation

Recorded here so the gap is deliberate rather than forgotten. Each has an ADR.

| Deviation | Reason |
|---|---|
| Child tables (`dpr_activities`, `dpr_photos`, `dpr_manpower`, `wage_lines`, `indent_items`) carry `tenant_id` | §17 requires a policy on every tenant-scoped model; relying on the parent would leave them unprotected if ever queried directly. ADR 0001 |
| `FORCE ROW LEVEL SECURITY`, not just `ENABLE` | `ENABLE` exempts the table owner, which is also the app's login role in local dev and on a single VPS — the policies would be silently inactive. ADR 0001 |
| `auth_identities` table with no RLS | `/auth/exchange` must resolve a phone to a tenant before any tenant context exists. ADR 0001 |
| `attendance.overtime_rate_snapshot` added | "Changing a wage does not alter past attendance" is not true if the overtime rate can still move under recorded hours. ADR 0003 |
| Money crosses the wire as a decimal string | A JSON number is a double in every client and loses paise above 2^53. ADR 0003 |
| Refresh tokens are signed JWTs (still stored hashed) | `refresh_tokens` is behind RLS, so the tenant must be known before the row can be read. |
| `GET/PATCH /tenants/current` instead of `/tenants/:id` | The tenant id comes from the JWT; accepting it in the path invites passing someone else's. |
| Tenant onboarding generates the tenant UUID in the app | Under `FORCE` RLS a `tenants` row can only be inserted once `app.tenant_id` equals the id being inserted. |
