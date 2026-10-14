import {
  EXPENSE_CATEGORIES,
  PUBLIC_API_IDEMPOTENCY_HOURS,
  PUBLIC_API_MAX_ATTENDANCE_DAYS,
  PUBLIC_API_PAGE_SIZE,
  PUBLIC_API_SCOPES,
  PUBLIC_API_SCOPE_COPY,
  WEBHOOK_EVENT_COPY,
  WEBHOOK_EVENT_TYPES,
  WEBHOOK_MAX_ATTEMPTS,
  WEBHOOK_SIGNATURE_TOLERANCE_SECONDS,
  type PublicApiScope,
} from '@sitebook/shared';
import { env } from '../../config/env';

/**
 * The OpenAPI 3.1 description of `/public/v1`, served at `/public/v1/openapi.json` and rendered by the
 * web app at `/developers/docs`.
 *
 * Written by hand rather than generated from decorators: it is a public contract, and a contract
 * should change because somebody changed it on purpose, not because an internal type moved. The e2e
 * suite holds it to the code — every route on `PublicApiController` must appear here with its method,
 * and every operation here must exist — so the two cannot drift silently.
 */

type Schema = Record<string, unknown>;

const ref = (name: string): Schema => ({ $ref: `#/components/schemas/${name}` });
const nullable = (schema: Schema): Schema => ({ oneOf: [schema, { type: 'null' }] });
const str: Schema = { type: 'string' };
const uuid: Schema = { type: 'string', format: 'uuid' };
const date: Schema = { type: 'string', format: 'date', example: '2026-10-01' };
const dateTime: Schema = { type: 'string', format: 'date-time', example: '2026-10-01T09:30:00.000Z' };
const int: Schema = { type: 'integer' };
const minor = (description = 'Integer minor units (paise, fils, cents) of `currency`.'): Schema => ({
  type: 'integer',
  description,
  example: 125050,
});
const currency: Schema = { type: 'string', pattern: '^[A-Z]{3}$', description: 'ISO 4217 code of the company’s currency.', example: 'INR' };
const person: Schema = {
  type: 'object',
  properties: { id: uuid, name: str },
  required: ['id', 'name'],
};

function object(properties: Record<string, Schema>, description?: string): Schema {
  return {
    type: 'object',
    ...(description ? { description } : {}),
    properties,
    required: Object.keys(properties),
  };
}

const schemas: Record<string, Schema> = {
  Error: object(
    {
      code: {
        type: 'string',
        description: 'Machine-readable; branch on this, not on the message.',
        enum: [
          'UNAUTHENTICATED',
          'INVALID_TOKEN',
          'TOKEN_EXPIRED',
          'FORBIDDEN',
          'MODULE_NOT_ENABLED',
          'NOT_FOUND',
          'VALIDATION_FAILED',
          'CONFLICT',
          'TENANT_SUSPENDED',
          'PLAN_EXPIRED',
          'IP_NOT_ALLOWED',
          'RATE_LIMITED',
          'INTERNAL',
        ],
      },
      message: { type: 'string', description: 'For a person reading a log.' },
    },
    'Every error has this shape. `details` is present when there is more to say (the missing scope, the field that failed).',
  ),
  Key: object({
    id: uuid,
    name: str,
    scopes: { type: 'array', items: { type: 'string', enum: [...PUBLIC_API_SCOPES] } },
    company: object({ id: uuid, currency, timezone: { type: 'string', example: 'Asia/Kolkata' }, country: { type: 'string', example: 'IN' } }),
  }),
  Project: object({
    id: uuid,
    name: str,
    client_name: nullable(str),
    address: nullable(str),
    location: nullable(object({ lat: { type: 'number' }, lng: { type: 'number' } })),
    status: { type: 'string', enum: ['planning', 'active', 'on_hold', 'completed'] },
    start_date: nullable(date),
    target_end_date: nullable(date),
    budget_amount: nullable(minor()),
    contract_value: nullable(minor()),
    currency,
    created_at: dateTime,
    updated_at: dateTime,
  }),
  Worker: object({
    id: uuid,
    name: str,
    phone: nullable({ type: 'string', description: 'E.164 without the plus.' }),
    trade: nullable(str),
    skill_level: str,
    status: str,
    contractor_id: nullable(uuid),
    pay_basis: { type: 'string', enum: ['daily', 'monthly'] },
    daily_wage: minor(),
    overtime_rate_per_hour: minor(),
    basic_salary: nullable(minor()),
    currency,
    created_at: dateTime,
    updated_at: dateTime,
  }),
  Attendance: object({
    id: uuid,
    project_id: uuid,
    worker_id: uuid,
    date,
    status: { type: 'string', enum: ['present', 'half_day', 'absent'] },
    overtime_hours: { type: 'number', example: 1.5 },
    daily_wage: minor('The day’s wage as it stood when attendance was marked, in minor units.'),
    overtime_rate_per_hour: minor(),
    currency,
    recorded_at: dateTime,
    created_at: dateTime,
    updated_at: dateTime,
  }),
  Expense: object({
    id: uuid,
    project_id: uuid,
    amount: minor('The whole amount paid, tax included, in minor units.'),
    tax_amount: minor('VAT or GST included in `amount`, in minor units.'),
    currency,
    category: { type: 'string', enum: [...EXPENSE_CATEGORIES] },
    spent_on: date,
    note: nullable(str),
    supplier_tax_id: nullable(str),
    status: { type: 'string', enum: ['pending', 'approved', 'rejected'] },
    cost_code: nullable(object({ id: uuid, code: str, name: str })),
    submitted_by: person,
    approved_by: nullable(person),
    approved_at: nullable(dateTime),
    created_at: dateTime,
    updated_at: dateTime,
  }),
  ExpenseCreate: {
    type: 'object',
    properties: {
      project_id: uuid,
      amount: { oneOf: [{ type: 'integer', minimum: 1 }, { type: 'string', pattern: '^\\d+$' }], description: 'Integer minor units, tax included.' },
      currency: { ...currency, description: 'Optional; when sent it must be the company’s own currency. Nothing is converted.' },
      category: { type: 'string', enum: [...EXPENSE_CATEGORIES] },
      spent_on: date,
      note: { type: 'string', maxLength: 1000 },
      tax_amount: { oneOf: [{ type: 'integer', minimum: 0 }, { type: 'string', pattern: '^\\d+$' }], description: 'Part of `amount`; never more than it.' },
      supplier_tax_id: { type: 'string', maxLength: 30, description: 'GSTIN or TRN; checked against the company’s tax regime.' },
      cost_code_id: { ...uuid, description: 'One of the site’s own cost codes.' },
      submitted_by: { ...uuid, description: 'An active person in the company the spend is filed under. Default: the owner who made the key.' },
    },
    required: ['project_id', 'amount', 'category', 'spent_on'],
    additionalProperties: false,
  },
  PurchaseOrder: object({
    id: uuid,
    number: { type: 'string', example: 'PO-2026-0042' },
    project_id: uuid,
    vendor: object({ id: uuid, name: str }),
    status: {
      type: 'string',
      enum: ['draft', 'pending_approval', 'approved', 'sent', 'partially_received', 'received', 'closed', 'cancelled'],
    },
    expected_on: nullable(date),
    subtotal: minor(),
    tax_total: minor(),
    total: minor(),
    currency,
    submitted_at: nullable(dateTime),
    approved_at: nullable(dateTime),
    sent_at: nullable(dateTime),
    closed_at: nullable(dateTime),
    cancelled_at: nullable(dateTime),
    created_at: dateTime,
    updated_at: dateTime,
  }),
  PurchaseOrderLine: object({
    id: uuid,
    description: str,
    unit: str,
    quantity: { type: 'string', description: 'Decimal with up to three places, as a string so it stays exact.', example: '12.500' },
    received_quantity: { type: 'string', example: '0.000' },
    unit_rate: minor(),
    tax_rate_bp: { type: 'integer', description: 'Basis points: 1800 is 18%.' },
    amount: minor(),
    tax_amount: minor(),
    material_id: nullable(uuid),
    cost_code_id: nullable(uuid),
  }),
  PurchaseOrderDetail: {
    allOf: [ref('PurchaseOrder'), object({ lines: { type: 'array', items: ref('PurchaseOrderLine') } })],
  },
  CostFigures: object({ budget: minor(), committed: minor(), actual: minor(), forecast: minor(), variance: minor('Budget minus forecast.') }),
  CostReport: object({
    project_id: uuid,
    project_name: str,
    as_of: date,
    currency,
    project_budget: nullable(minor()),
    approved_changes: minor('Budget added by approved change orders.'),
    lines: {
      type: 'array',
      items: object({
        id: uuid,
        code: str,
        name: str,
        parent_id: nullable(uuid),
        depth: int,
        unit: nullable(str),
        has_children: { type: 'boolean' },
        own: ref('CostFigures'),
        total: ref('CostFigures'),
      }),
    },
    unallocated: ref('CostFigures'),
    totals: ref('CostFigures'),
  }),
  DailyReport: object({
    id: uuid,
    project_id: uuid,
    date,
    status: { type: 'string', enum: ['draft', 'submitted'] },
    weather: nullable(str),
    work_done: nullable(str),
    issues: nullable(str),
    submitted_by: person,
    submitted_at: nullable(dateTime),
    created_at: dateTime,
    updated_at: dateTime,
  }),
  ChangeOrder: object({
    id: uuid,
    project_id: uuid,
    number: int,
    revision: int,
    title: str,
    description: nullable(str),
    reason: str,
    status: { type: 'string', enum: ['draft', 'submitted', 'sent', 'approved', 'rejected', 'implemented', 'cancelled'] },
    raised_on: date,
    cost_impact: minor(),
    client_price: minor(),
    tax_amount: minor(),
    client_total: minor(),
    currency,
    time_impact_days: int,
    submitted_at: nullable(dateTime),
    approved_at: nullable(dateTime),
    implemented_at: nullable(dateTime),
    cancelled_at: nullable(dateTime),
    created_at: dateTime,
    updated_at: dateTime,
  }),
  Rfi: object({
    id: uuid,
    project_id: uuid,
    number: int,
    subject: str,
    question: str,
    discipline: str,
    priority: str,
    status: { type: 'string', enum: ['draft', 'open', 'answered', 'closed', 'void'] },
    raised_on: date,
    due_on: nullable(date),
    addressed_to_company: nullable(str),
    cost_impact: { type: 'boolean' },
    schedule_impact: { type: 'boolean' },
    sent_at: nullable(dateTime),
    answered_at: nullable(dateTime),
    closed_at: nullable(dateTime),
    created_at: dateTime,
    updated_at: dateTime,
  }),
  WebhookEvent: object(
    {
      id: { ...uuid, description: 'The event’s id: the same on every retry and every endpoint. De-duplicate on it.' },
      type: { type: 'string', enum: [...WEBHOOK_EVENT_TYPES, 'webhook.ping'] },
      api_version: { type: 'string', const: 'v1' },
      created_at: dateTime,
      data: { type: 'object', description: 'The resource(s) the event is about, shaped exactly as this API returns them.' },
    },
    'The body of every webhook POST.',
  ),
};

function pageOf(name: string): Schema {
  return object({
    data: { type: 'array', items: ref(name) },
    has_more: { type: 'boolean' },
    next_cursor: nullable({ type: 'string', description: 'Pass as `cursor` for the next page.' }),
  });
}
for (const name of ['Project', 'Worker', 'Attendance', 'Expense', 'PurchaseOrder', 'DailyReport', 'ChangeOrder', 'Rfi']) {
  schemas[`${name}Page`] = pageOf(name);
}

const parameters: Record<string, Schema> = {
  limit: {
    name: 'limit',
    in: 'query',
    description: `Records per page (default ${PUBLIC_API_PAGE_SIZE.default}, at most ${PUBLIC_API_PAGE_SIZE.max}).`,
    schema: { type: 'integer', minimum: 1, maximum: PUBLIC_API_PAGE_SIZE.max, default: PUBLIC_API_PAGE_SIZE.default },
  },
  cursor: {
    name: 'cursor',
    in: 'query',
    description: '`next_cursor` from the previous page. Opaque: do not build or edit one.',
    schema: { type: 'string' },
  },
  updated_since: {
    name: 'updated_since',
    in: 'query',
    description:
      'ISO date-time. Only records created or changed at or after it. Lists are always ordered oldest change first, so keep the `updated_at` of the last record you saw and pass it next time to sync.',
    schema: dateTime,
  },
  project_id: { name: 'project_id', in: 'query', description: 'Only this site.', schema: uuid },
  id: { name: 'id', in: 'path', required: true, schema: uuid },
};

const listParams = ['limit', 'cursor', 'updated_since'].map((name) => ({ $ref: `#/components/parameters/${name}` }));
const siteListParams = [...listParams, { $ref: '#/components/parameters/project_id' }];
const idParam = [{ $ref: '#/components/parameters/id' }];

function errorResponse(description: string): Schema {
  return { description, content: { 'application/json': { schema: ref('Error') } } };
}

const commonErrors = {
  '401': errorResponse('No key, a key that is not valid or revoked (`INVALID_TOKEN`), or one past its expiry (`TOKEN_EXPIRED`).'),
  '403': errorResponse(
    'The key lacks the scope (`FORBIDDEN`, `details.required_scope`), the address is not allowed (`IP_NOT_ALLOWED`), the module is switched off, or the company is suspended.',
  ),
  '429': {
    description: 'Over the key’s rate limit. Wait `Retry-After` seconds.',
    headers: { 'Retry-After': { schema: { type: 'integer' }, description: 'Seconds to wait.' } },
    content: { 'application/json': { schema: ref('Error') } },
  },
};

function op(
  operationId: string,
  summary: string,
  scope: PublicApiScope | null,
  responseSchema: string,
  extra: { parameters?: Schema[]; description?: string; notFound?: boolean } = {},
): Schema {
  return {
    operationId,
    summary,
    ...(extra.description ? { description: extra.description } : {}),
    ...(scope ? { 'x-required-scope': scope } : {}),
    security: [{ apiKey: scope ? [scope] : [] }],
    ...(extra.parameters ? { parameters: extra.parameters } : {}),
    responses: {
      '200': { description: 'OK', content: { 'application/json': { schema: ref(responseSchema) } } },
      ...(extra.notFound ? { '404': errorResponse('No such record in this company.') } : {}),
      '422': errorResponse('A parameter is not valid (`VALIDATION_FAILED`).'),
      ...commonErrors,
    },
  };
}

/** The operations, keyed by path and lower-case method. The e2e suite checks them against the controller. */
export function publicOpenApiPaths(): Record<string, Record<string, Schema>> {
  return {
    '/key': { get: op('getKey', 'The key you are using: its name, scopes and company', null, 'Key') },
    '/projects': { get: op('listProjects', 'List sites', 'projects:read', 'ProjectPage', { parameters: listParams }) },
    '/projects/{id}': { get: op('getProject', 'Get a site', 'projects:read', 'Project', { parameters: idParam, notFound: true }) },
    '/projects/{id}/cost-report': {
      get: op('getCostReport', 'A site’s cost report: budget, committed, actual and forecast per cost code', 'cost_report:read', 'CostReport', {
        parameters: idParam,
        notFound: true,
      }),
    },
    '/workers': { get: op('listWorkers', 'List workers', 'workers:read', 'WorkerPage', { parameters: listParams }) },
    '/workers/{id}': { get: op('getWorker', 'Get a worker', 'workers:read', 'Worker', { parameters: idParam, notFound: true }) },
    '/attendance': {
      get: op('listAttendance', 'Attendance for a date range', 'attendance:read', 'AttendancePage', {
        description: `One row per worker per site per day. \`from\` and \`to\` are required and inclusive; a range is at most ${PUBLIC_API_MAX_ATTENDANCE_DAYS} days.`,
        parameters: [
          ...siteListParams,
          { name: 'from', in: 'query', required: true, schema: date },
          { name: 'to', in: 'query', required: true, schema: date },
        ],
      }),
    },
    '/expenses': {
      get: op('listExpenses', 'List expenses', 'expenses:read', 'ExpensePage', {
        parameters: [
          ...siteListParams,
          { name: 'status', in: 'query', schema: { type: 'string', enum: ['pending', 'approved', 'rejected'] } },
          { name: 'from', in: 'query', description: 'Spent on or after.', schema: date },
          { name: 'to', in: 'query', description: 'Spent on or before.', schema: date },
        ],
      }),
      post: {
        operationId: 'createExpense',
        summary: 'Record an expense',
        description:
          'Recorded as pending, for approval in BUILDR like any other. Send an `Idempotency-Key` header so a retried request cannot record it twice.',
        'x-required-scope': 'expenses:write',
        security: [{ apiKey: ['expenses:write'] }],
        parameters: [
          {
            name: 'Idempotency-Key',
            in: 'header',
            description: `Any unique string up to 255 characters. A retry with the same key and body gets the first answer back (with \`Idempotent-Replayed: true\`) for ${PUBLIC_API_IDEMPOTENCY_HOURS} hours; the same key with a different body is a 409.`,
            schema: { type: 'string', maxLength: 255 },
          },
        ],
        requestBody: { required: true, content: { 'application/json': { schema: ref('ExpenseCreate') } } },
        responses: {
          '201': { description: 'Recorded', content: { 'application/json': { schema: ref('Expense') } } },
          '404': errorResponse('No such site in this company.'),
          '409': errorResponse('The Idempotency-Key was used for a different request, or is still in flight (`details.idempotency`).'),
          '422': errorResponse('The body is not valid (`VALIDATION_FAILED`).'),
          ...commonErrors,
        },
      },
    },
    '/expenses/{id}': { get: op('getExpense', 'Get an expense', 'expenses:read', 'Expense', { parameters: idParam, notFound: true }) },
    '/purchase-orders': {
      get: op('listPurchaseOrders', 'List purchase orders', 'purchase_orders:read', 'PurchaseOrderPage', { parameters: siteListParams }),
    },
    '/purchase-orders/{id}': {
      get: op('getPurchaseOrder', 'Get a purchase order with its lines', 'purchase_orders:read', 'PurchaseOrderDetail', {
        parameters: idParam,
        notFound: true,
      }),
    },
    '/daily-reports': {
      get: op('listDailyReports', 'List daily progress reports', 'daily_reports:read', 'DailyReportPage', { parameters: siteListParams }),
    },
    '/change-orders': {
      get: op('listChangeOrders', 'List change orders', 'change_orders:read', 'ChangeOrderPage', { parameters: siteListParams }),
    },
    '/rfis': { get: op('listRfis', 'List RFIs', 'rfis:read', 'RfiPage', { parameters: siteListParams }) },
  };
}

const DESCRIPTION = `
The BUILDR public API reads your company's sites, workers, attendance, expenses, purchase orders, cost
reports, daily reports, change orders and RFIs, and records expenses — for your accounting system, BI
tool or client portal.

## Authentication

An owner makes an API key in **Settings → Developers**. Send it on every request:

    Authorization: Bearer bk_live_…

A key holds the scopes it was made with and nothing else; a route needing one it lacks answers 403
with \`details.required_scope\`. A key may expire and may be limited to certain IP addresses. If your
company has an IP allow-list switched on (Settings → Security), it applies to every key as well,
whichever mode it is in. Keys work only here, under \`/public/v1\`; the app's own API does not accept
them, and this API does not accept the app's sign-in tokens.

## Conventions

- JSON with snake_case keys.
- **Money** is an integer number of minor units (paise, fils, cents) with the company's \`currency\`
  beside it: 125050 with \`INR\` is ₹1,250.50. Never a float.
- Calendar dates are \`YYYY-MM-DD\`; moments are ISO 8601 in UTC.
- **Lists** are ordered by \`updated_at\`, oldest first, and paged with \`limit\` and \`cursor\`: pass
  \`next_cursor\` from one page to get the next, until \`has_more\` is false. To sync, keep the
  \`updated_at\` of the last record you saw and pass it as \`updated_since\` next time.
- **Errors** are \`{ "code", "message", "details"? }\` with a meaningful HTTP status; branch on \`code\`.
- **Rate limit**: ${env().PUBLIC_API_RATE_LIMIT_PER_MINUTE} requests per minute per key, per API server. Every answer carries
  \`X-RateLimit-Limit\`, \`X-RateLimit-Remaining\` and \`X-RateLimit-Reset\`; over the limit you get 429 with
  \`Retry-After\`.
- **Idempotency**: send \`Idempotency-Key\` on a POST and retry safely.

## Webhooks

An owner registers an https endpoint in **Settings → Developers** and chooses its events:

${WEBHOOK_EVENT_TYPES.map((type) => `- \`${type}\` — ${WEBHOOK_EVENT_COPY[type]}`).join('\n')}

Each event is POSTed as JSON (see the \`WebhookEvent\` schema) with these headers:

- \`X-Buildr-Event\`: the event type; \`X-Buildr-Event-Id\`: the event id (de-duplicate on it).
- \`X-Buildr-Delivery\`: this delivery; \`X-Buildr-Attempt\`: which try.
- \`X-Buildr-Signature: t=<unix seconds>,v1=<hex>\`, where the hex is
  HMAC-SHA256(your endpoint's signing secret, \`<t>.<raw body>\`). Recompute it over the raw bytes
  you received, compare in constant time, and refuse a \`t\` more than ${WEBHOOK_SIGNATURE_TOLERANCE_SECONDS} seconds from your clock.

Answer with any 2xx within 10 seconds. Anything else is retried ${WEBHOOK_MAX_ATTEMPTS - 1} more times with
growing waits (1 minute up to 8 hours, about a day in all). An endpoint that accepts nothing for that
whole day is switched off and the company's owners are told. Webhooks are only sent to public https
addresses.

## Scopes

${PUBLIC_API_SCOPES.map((scope) => `- \`${scope}\` — ${PUBLIC_API_SCOPE_COPY[scope]}`).join('\n')}
`.trim();

/** The whole document. Built on request (it reads the configured rate limit and public URL). */
export function publicOpenApiDocument(): Schema {
  const base = env().API_PUBLIC_URL;
  return {
    openapi: '3.1.0',
    info: {
      title: 'BUILDR public API',
      version: 'v1',
      description: DESCRIPTION,
    },
    servers: [{ url: base ? `${base.replace(/\/$/, '')}/public/v1` : '/public/v1' }],
    security: [{ apiKey: [] }],
    tags: [{ name: 'public', description: 'Everything under /public/v1' }],
    paths: publicOpenApiPaths(),
    components: {
      securitySchemes: {
        apiKey: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'bk_live_…',
          description: 'An API key from Settings → Developers.',
        },
      },
      parameters,
      schemas,
    },
  };
}
