// Must come first: the proxy setting has to be in the environment before the app loads, so a test
// can stand at an address of its choosing with X-Forwarded-For (see security-env).
import { restoreSecurityEnv } from './utils/security-env';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { RequestMethod } from '@nestjs/common';
import { PUBLIC_API_KEY_PATTERN, PUBLIC_API_SCOPES } from '@sitebook/shared';
import {
  createTestApp,
  destroyTenant,
  onboardTenant,
  uniquePhone,
  type OnboardedTenant,
  type TestApp,
} from './utils/test-app';
import { useKeepAlive } from './utils/keep-alive';
import { PublicApiController } from '../src/modules/public-api/public-api.controller';
import { PublicRateLimiter } from '../src/modules/public-api/public-rate-limiter';
import { publicOpenApiDocument } from '../src/modules/public-api/openapi';
import { TenantCache } from '../src/common/auth/tenant-cache.service';

/**
 * The public REST API (roadmap Phase 3), end to end against a real database: making and revoking
 * keys, every check a key passes on its way in (scope, expiry, revocation, the company's IP
 * allow-list and the key's own, the rate limit), idempotent writes, cursor pages and
 * `updated_since`, one company's key never seeing another's data, keys and sessions never crossing
 * between `/public/v1` and `/v1`, audit entries naming the key, and the OpenAPI document matching
 * the routes that exist.
 */
describe('Public API', () => {
  let test: TestApp;
  let a: OnboardedTenant;
  let b: OnboardedTenant;
  let siteA: string;
  let siteB: string;
  let workerA: string;
  let releaseKeepAlive: () => Promise<void> = async () => undefined;

  const session = (tenant: OnboardedTenant) => ({ Authorization: `Bearer ${tenant.accessToken}` });
  const bearer = (key: string) => ({ Authorization: `Bearer ${key}` });
  const from = (ip: string) => ({ 'X-Forwarded-For': ip });

  async function makeKey(
    tenant: OnboardedTenant,
    body: { name?: string; scopes: string[]; expires_at?: string; allowed_cidrs?: string[] },
  ): Promise<{ id: string; secret: string }> {
    const response = await test
      .http()
      .post('/v1/developers/api-keys')
      .set(session(tenant))
      .send({ name: body.name ?? 'Integration', ...body })
      .expect(201);
    return { id: response.body.key.id, secret: response.body.secret };
  }

  beforeAll(async () => {
    test = await createTestApp();
    releaseKeepAlive = await useKeepAlive(test);
    a = await onboardTenant(test, { name: 'Keyed Builders', phone: uniquePhone(), plan: 'one_year' });
    b = await onboardTenant(test, { name: 'Other Builders', phone: uniquePhone(), plan: 'one_year' });

    siteA = (await test.http().post('/v1/projects').set(session(a)).send({ name: 'Harbour View', budget_amount: '500000000' }).expect(201)).body.id;
    siteB = (await test.http().post('/v1/projects').set(session(b)).send({ name: 'Elsewhere' }).expect(201)).body.id;
    workerA = (
      await test
        .http()
        .post('/v1/workers')
        .set(session(a))
        .send({ name: 'Raju', trade: 'Mason', skill_level: 'skilled', daily_wage: '90000', project_id: siteA, from_date: '2026-09-01' })
        .expect(201)
    ).body.id;
    await test
      .http()
      .post('/v1/attendance')
      .set(session(a))
      .send({ project_id: siteA, attendance_date: '2026-09-02', rows: [{ worker_id: workerA, status: 'present', overtime_hours: '1.5' }] })
      .expect(201);
    await test
      .http()
      .post('/v1/expenses')
      .set(session(b))
      .send({ project_id: siteB, amount: '1000', category: 'fuel', spent_on: '2026-09-02' })
      .expect(201);
  });

  afterAll(async () => {
    for (const tenant of [a, b]) if (tenant) await destroyTenant(test, tenant.tenantId);
    await releaseKeepAlive();
    await test.close();
    restoreSecurityEnv();
  });

  describe('keys', () => {
    it('shows the key once, stores only a hash, and lists it by its last four', async () => {
      const response = await test
        .http()
        .post('/v1/developers/api-keys')
        .set(session(a))
        .send({ name: 'Tally sync', scopes: ['expenses:read'] })
        .expect(201);
      const secret: string = response.body.secret;
      expect(secret).toMatch(PUBLIC_API_KEY_PATTERN);
      expect(response.body.key).toMatchObject({ name: 'Tally sync', scopes: ['expenses:read'], state: 'active', hint: `bk_live_…${secret.slice(-4)}` });

      const stored = await test.tenantDb.transaction(a.tenantId, (tx) =>
        tx.apiKey.findUniqueOrThrow({ where: { id: response.body.key.id } }),
      );
      expect(stored.keyHash).toMatch(/^[0-9a-f]{64}$/);
      expect(JSON.stringify(stored)).not.toContain(secret);

      const list = await test.http().get('/v1/developers/api-keys').set(session(a)).expect(200);
      expect(JSON.stringify(list.body)).not.toContain(secret);
      expect(list.body.keys.some((key: { id: string }) => key.id === response.body.key.id)).toBe(true);
    });

    it('refuses unknown scopes, a past expiry, and anyone but an owner', async () => {
      await test.http().post('/v1/developers/api-keys').set(session(a)).send({ name: 'x', scopes: ['everything:write'] }).expect(422);
      await test
        .http()
        .post('/v1/developers/api-keys')
        .set(session(a))
        .send({ name: 'x', scopes: ['projects:read'], expires_at: '2020-01-01T00:00:00Z' })
        .expect(422);

      const pmPhone = uniquePhone();
      await test.http().post('/v1/tenants/current/invite').set(session(a)).send({ phone: pmPhone, name: 'Priya', role: 'project_manager' }).expect(201);
      const pm = await test.http().post('/v1/auth/exchange').send({ firebase_token: `dev:${pmPhone}` }).expect(200);
      await test
        .http()
        .post('/v1/developers/api-keys')
        .set({ Authorization: `Bearer ${pm.body.access_token}` })
        .send({ name: 'x', scopes: ['projects:read'] })
        .expect(403);
    });

    it('records making and revoking a key in the audit log', async () => {
      const key = await makeKey(a, { name: 'Audited key', scopes: ['projects:read'] });
      await test.http().post(`/v1/developers/api-keys/${key.id}/revoke`).set(session(a)).expect(200);
      const log = await test.http().get(`/v1/audit?entity=api_keys&entity_id=${key.id}`).set(session(a)).expect(200);
      const actions = (log.body.items as Array<{ action: string; after: Record<string, unknown> | null }>).map((row) => row.action);
      expect(actions).toEqual(expect.arrayContaining(['create', 'update']));
      // The hash is redacted by the trigger, by its column name.
      expect(JSON.stringify(log.body)).not.toMatch(/[0-9a-f]{64}/);
    });
  });

  describe('using a key', () => {
    it('reads what its scopes allow, as JSON with money in minor units', async () => {
      const key = await makeKey(a, { scopes: ['projects:read', 'workers:read', 'attendance:read'] });

      const me = await test.http().get('/public/v1/key').set(bearer(key.secret)).expect(200);
      expect(me.body).toMatchObject({ id: key.id, scopes: ['projects:read', 'workers:read', 'attendance:read'] });
      expect(me.body.company.id).toBe(a.tenantId);

      const projects = await test.http().get('/public/v1/projects').set(bearer(key.secret)).expect(200);
      expect(projects.body).toMatchObject({ has_more: false, next_cursor: null });
      const site = projects.body.data.find((row: { id: string }) => row.id === siteA);
      expect(site).toMatchObject({ name: 'Harbour View', budget_amount: 500000000, currency: 'INR', status: expect.any(String) });
      expect(typeof site.updated_at).toBe('string');

      const one = await test.http().get(`/public/v1/projects/${siteA}`).set(bearer(key.secret)).expect(200);
      expect(one.body.id).toBe(siteA);

      const workers = await test.http().get('/public/v1/workers').set(bearer(key.secret)).expect(200);
      expect(workers.body.data).toEqual([expect.objectContaining({ id: workerA, name: 'Raju', daily_wage: 90000, currency: 'INR' })]);

      const attendance = await test
        .http()
        .get(`/public/v1/attendance?from=2026-09-01&to=2026-09-30&project_id=${siteA}`)
        .set(bearer(key.secret))
        .expect(200);
      expect(attendance.body.data).toEqual([
        expect.objectContaining({ worker_id: workerA, date: '2026-09-02', status: 'present', overtime_hours: 1.5, daily_wage: 90000 }),
      ]);
      // A range is required and bounded.
      await test.http().get('/public/v1/attendance').set(bearer(key.secret)).expect(422);
      await test.http().get('/public/v1/attendance?from=2026-01-01&to=2026-12-31').set(bearer(key.secret)).expect(422);
    });

    it('answers 403 with the missing scope', async () => {
      const key = await makeKey(a, { scopes: ['projects:read'] });
      const refused = await test.http().get('/public/v1/expenses').set(bearer(key.secret)).expect(403);
      expect(refused.body).toMatchObject({ code: 'FORBIDDEN', details: { required_scope: 'expenses:read' } });
      await test
        .http()
        .post('/public/v1/expenses')
        .set(bearer(key.secret))
        .send({ project_id: siteA, amount: 100, category: 'fuel', spent_on: '2026-09-02' })
        .expect(403);
    });

    it('stops working the moment it is revoked', async () => {
      const key = await makeKey(a, { scopes: ['projects:read'] });
      await test.http().get('/public/v1/projects').set(bearer(key.secret)).expect(200);
      await test.http().post(`/v1/developers/api-keys/${key.id}/revoke`).set(session(a)).expect(200);
      const refused = await test.http().get('/public/v1/projects').set(bearer(key.secret)).expect(401);
      expect(refused.body.code).toBe('INVALID_TOKEN');
      // And the directory no longer knows it.
      const entries = await test.prisma.apiKeyDirectory.count({ where: { tenantId: a.tenantId } });
      const live = await test.tenantDb.transaction(a.tenantId, (tx) => tx.apiKey.count({ where: { revokedAt: null } }));
      expect(entries).toBe(live);
    });

    it('refuses an expired key, saying so', async () => {
      const key = await makeKey(a, { scopes: ['projects:read'], expires_at: new Date(Date.now() + 60_000).toISOString() });
      await test.http().get('/public/v1/projects').set(bearer(key.secret)).expect(200);
      await test.tenantDb.transaction(a.tenantId, (tx) =>
        tx.apiKey.update({ where: { id: key.id }, data: { expiresAt: new Date(Date.now() - 1000) } }),
      );
      const refused = await test.http().get('/public/v1/projects').set(bearer(key.secret)).expect(401);
      expect(refused.body.code).toBe('TOKEN_EXPIRED');
      const list = await test.http().get('/v1/developers/api-keys').set(session(a)).expect(200);
      expect(list.body.keys.find((row: { id: string }) => row.id === key.id).state).toBe('expired');
    });

    it('refuses garbage, an unknown key and a missing header alike', async () => {
      await test.http().get('/public/v1/projects').expect(401);
      await test.http().get('/public/v1/projects').set(bearer('not-a-key')).expect(401);
      await test.http().get('/public/v1/projects').set(bearer(`bk_live_${'x'.repeat(43)}`)).expect(401);
    });

    it('records last use', async () => {
      const key = await makeKey(a, { scopes: ['projects:read'] });
      await test.http().get('/public/v1/projects').set(bearer(key.secret)).set(from('198.51.100.9')).expect(200);
      const list = await test.http().get('/v1/developers/api-keys').set(session(a)).expect(200);
      const row = list.body.keys.find((entry: { id: string }) => entry.id === key.id);
      expect(row.last_used_at).not.toBeNull();
      expect(row.last_used_ip).toBe('198.51.100.9');
    });
  });

  describe('addresses', () => {
    it('honours the key’s own allow-list', async () => {
      const key = await makeKey(a, { scopes: ['projects:read'], allowed_cidrs: ['203.0.113.0/24'] });
      await test.http().get('/public/v1/projects').set(bearer(key.secret)).set(from('203.0.113.8')).expect(200);
      const refused = await test.http().get('/public/v1/projects').set(bearer(key.secret)).set(from('198.51.100.1')).expect(403);
      expect(refused.body.code).toBe('IP_NOT_ALLOWED');
    });

    it('applies the company’s IP allow-list to every key, in either mode, owner exemption or not', async () => {
      const company = await onboardTenant(test, { name: 'Walled Builders', phone: uniquePhone(), plan: 'one_year' });
      try {
        const key = await makeKey(company, { scopes: ['projects:read'] });
        for (const mode of ['web', 'everyone']) {
          await test
            .http()
            .put('/v1/security/ip-policy')
            .set(session(company))
            .set(from('203.0.113.40'))
            .send({ ip_mode: mode, ip_rules: [{ cidr: '203.0.113.0/24' }], ip_exempt_owners: true })
            .expect(200);
          test.app.get(TenantCache).invalidate(company.tenantId);
          await test.http().get('/public/v1/projects').set(bearer(key.secret)).set(from('203.0.113.99')).expect(200);
          const refused = await test.http().get('/public/v1/projects').set(bearer(key.secret)).set(from('198.51.100.2')).expect(403);
          expect(refused.body.code).toBe('IP_NOT_ALLOWED');
        }
      } finally {
        await destroyTenant(test, company.tenantId);
      }
    });
  });

  describe('rate limit', () => {
    it('answers 429 with Retry-After past the per-key limit, and other keys are unaffected', async () => {
      const limiter = test.app.get(PublicRateLimiter);
      const before = limiter.limit;
      limiter.limit = 3;
      try {
        const busy = await makeKey(a, { scopes: ['projects:read'] });
        const quiet = await makeKey(a, { scopes: ['projects:read'] });
        for (let i = 0; i < 3; i++) {
          const ok = await test.http().get('/public/v1/projects').set(bearer(busy.secret)).expect(200);
          expect(ok.headers['x-ratelimit-limit']).toBe('3');
        }
        const refused = await test.http().get('/public/v1/projects').set(bearer(busy.secret)).expect(429);
        expect(refused.body.code).toBe('RATE_LIMITED');
        expect(Number(refused.headers['retry-after'])).toBeGreaterThan(0);
        await test.http().get('/public/v1/projects').set(bearer(quiet.secret)).expect(200);
      } finally {
        limiter.limit = before;
      }
    });
  });

  describe('writes', () => {
    let writer: { id: string; secret: string };

    beforeAll(async () => {
      writer = await makeKey(a, { name: 'Expense import', scopes: ['expenses:read', 'expenses:write'] });
    });

    it('records an expense, pending, filed under the owner who made the key', async () => {
      const created = await test
        .http()
        .post('/public/v1/expenses')
        .set(bearer(writer.secret))
        .send({ project_id: siteA, amount: 125050, tax_amount: '0', currency: 'INR', category: 'fuel', spent_on: '2026-09-03', note: 'Diesel' })
        .expect(201);
      expect(created.body).toMatchObject({
        project_id: siteA,
        amount: 125050,
        currency: 'INR',
        status: 'pending',
        spent_on: '2026-09-03',
        submitted_by: { id: a.ownerId },
      });

      // The audit log names the key, not the owner.
      const log = await test.http().get(`/v1/audit?entity=expenses&entity_id=${created.body.id}`).set(session(a)).expect(200);
      expect(log.body.items[0]).toMatchObject({ action: 'create', actor_type: 'api_key', actor: { id: writer.id, name: 'Expense import' } });
    });

    it('refuses another currency, a site of another company, and an outsider as submitter', async () => {
      await test
        .http()
        .post('/public/v1/expenses')
        .set(bearer(writer.secret))
        .send({ project_id: siteA, amount: 100, currency: 'AED', category: 'fuel', spent_on: '2026-09-03' })
        .expect(422);
      await test
        .http()
        .post('/public/v1/expenses')
        .set(bearer(writer.secret))
        .send({ project_id: siteB, amount: 100, category: 'fuel', spent_on: '2026-09-03' })
        .expect(404);
      await test
        .http()
        .post('/public/v1/expenses')
        .set(bearer(writer.secret))
        .send({ project_id: siteA, amount: 100, category: 'fuel', spent_on: '2026-09-03', submitted_by: b.ownerId })
        .expect(422);
      await test
        .http()
        .post('/public/v1/expenses')
        .set(bearer(writer.secret))
        .send({ project_id: siteA, amount: 12.5, category: 'fuel', spent_on: '2026-09-03' })
        .expect(422);
    });

    it('replays an Idempotency-Key instead of recording twice, and refuses it for a different body', async () => {
      const body = { project_id: siteA, amount: 7700, category: 'fuel', spent_on: '2026-09-04' };
      const first = await test.http().post('/public/v1/expenses').set(bearer(writer.secret)).set('Idempotency-Key', 'import-42').send(body).expect(201);
      const again = await test.http().post('/public/v1/expenses').set(bearer(writer.secret)).set('Idempotency-Key', 'import-42').send(body).expect(201);
      expect(again.headers['idempotent-replayed']).toBe('true');
      expect(again.body.id).toBe(first.body.id);

      const count = await test.tenantDb.transaction(a.tenantId, (tx) => tx.expense.count({ where: { amount: 7700n, spentOn: new Date('2026-09-04') } }));
      expect(count).toBe(1);

      const reused = await test
        .http()
        .post('/public/v1/expenses')
        .set(bearer(writer.secret))
        .set('Idempotency-Key', 'import-42')
        .send({ ...body, amount: 7701 })
        .expect(409);
      expect(reused.body.details).toEqual({ idempotency: 'key_reused' });

      // A failed request does not keep its key: the corrected retry runs.
      await test.http().post('/public/v1/expenses').set(bearer(writer.secret)).set('Idempotency-Key', 'import-43').send({ ...body, category: 'nope' }).expect(422);
      await test.http().post('/public/v1/expenses').set(bearer(writer.secret)).set('Idempotency-Key', 'import-43').send(body).expect(201);
    });

    it('stops writes, not reads, when the plan has run out', async () => {
      await test.tenantDb.transaction(a.tenantId, (tx) =>
        tx.tenant.update({ where: { id: a.tenantId }, data: { planExpiresOn: new Date('2020-01-01') } }),
      );
      test.app.get(TenantCache).invalidate(a.tenantId);
      try {
        await test.http().get('/public/v1/expenses').set(bearer(writer.secret)).expect(200);
        const refused = await test
          .http()
          .post('/public/v1/expenses')
          .set(bearer(writer.secret))
          .send({ project_id: siteA, amount: 100, category: 'fuel', spent_on: '2026-09-03' })
          .expect(403);
        expect(refused.body.code).toBe('PLAN_EXPIRED');
      } finally {
        await test.tenantDb.transaction(a.tenantId, (tx) =>
          tx.tenant.update({ where: { id: a.tenantId }, data: { planExpiresOn: new Date(Date.now() + 365 * 86_400_000) } }),
        );
        test.app.get(TenantCache).invalidate(a.tenantId);
      }
    });
  });

  describe('lists', () => {
    it('pages with a cursor and syncs with updated_since', async () => {
      const key = await makeKey(a, { scopes: ['expenses:read', 'expenses:write'] });
      for (let i = 0; i < 5; i++) {
        await test
          .http()
          .post('/public/v1/expenses')
          .set(bearer(key.secret))
          .send({ project_id: siteA, amount: 1000 + i, category: 'other', spent_on: '2026-09-10' })
          .expect(201);
      }
      const all = await test.http().get('/public/v1/expenses?limit=200').set(bearer(key.secret)).expect(200);
      const total = all.body.data.length as number;
      expect(total).toBeGreaterThanOrEqual(5);

      const seen: string[] = [];
      let cursor: string | null = null;
      let pages = 0;
      do {
        const response: { body: { data: Array<{ id: string }>; next_cursor: string | null; has_more: boolean } } = await test
          .http()
          .get(`/public/v1/expenses?limit=2${cursor ? `&cursor=${cursor}` : ''}`)
          .set(bearer(key.secret))
          .expect(200);
        expect(response.body.data.length).toBeLessThanOrEqual(2);
        seen.push(...response.body.data.map((row: { id: string }) => row.id));
        cursor = response.body.next_cursor;
        expect(response.body.has_more).toBe(cursor !== null);
        pages += 1;
      } while (cursor && pages < 100);
      expect(seen).toHaveLength(total);
      expect(new Set(seen).size).toBe(total);
      // Oldest change first.
      const stamps = all.body.data.map((row: { updated_at: string }) => row.updated_at);
      expect([...stamps].sort()).toEqual(stamps);

      // Sync: only what changed since the last record seen.
      const last = all.body.data[total - 1];
      await new Promise((resolve) => setTimeout(resolve, 5));
      const fresh = await test
        .http()
        .post('/public/v1/expenses')
        .set(bearer(key.secret))
        .send({ project_id: siteA, amount: 999, category: 'other', spent_on: '2026-09-11' })
        .expect(201);
      const since = await test
        .http()
        .get(`/public/v1/expenses?updated_since=${encodeURIComponent(new Date(new Date(last.updated_at).getTime() + 1).toISOString())}`)
        .set(bearer(key.secret))
        .expect(200);
      expect(since.body.data.map((row: { id: string }) => row.id)).toEqual([fresh.body.id]);

      await test.http().get('/public/v1/expenses?cursor=forged').set(bearer(key.secret)).expect(422);
    });
  });

  describe('isolation', () => {
    it('a key of one company never sees another’s records', async () => {
      const key = await makeKey(a, { scopes: [...PUBLIC_API_SCOPES] });
      await test.http().get(`/public/v1/projects/${siteB}`).set(bearer(key.secret)).expect(404);
      await test.http().get(`/public/v1/projects/${siteB}/cost-report`).set(bearer(key.secret)).expect(404);
      const expenses = await test.http().get(`/public/v1/expenses?project_id=${siteB}`).set(bearer(key.secret)).expect(200);
      expect(expenses.body.data).toEqual([]);
      const projects = await test.http().get('/public/v1/projects?limit=200').set(bearer(key.secret)).expect(200);
      expect(projects.body.data.map((row: { id: string }) => row.id)).not.toContain(siteB);
    });

    it('reads every resource with every scope', async () => {
      const key = await makeKey(a, { scopes: [...PUBLIC_API_SCOPES] });
      for (const path of ['/daily-reports', '/change-orders', '/rfis', '/purchase-orders', `/projects/${siteA}/cost-report`]) {
        const response = await test.http().get(`/public/v1${path}`).set(bearer(key.secret));
        expect([path, response.status]).toEqual([path, 200]);
      }
      const report = await test.http().get(`/public/v1/projects/${siteA}/cost-report`).set(bearer(key.secret)).expect(200);
      expect(report.body).toMatchObject({ project_id: siteA, currency: 'INR', totals: { budget: expect.any(Number) } });
    });
  });

  describe('keys and sessions never cross', () => {
    it('the internal API refuses an API key', async () => {
      const key = await makeKey(a, { scopes: [...PUBLIC_API_SCOPES] });
      const refused = await test.http().get('/v1/projects').set(bearer(key.secret)).expect(401);
      expect(refused.body.message).toMatch(/public API/);
      await test.http().get('/v1/developers/api-keys').set(bearer(key.secret)).expect(401);
    });

    it('the public API refuses a session token', async () => {
      await test.http().get('/public/v1/projects').set(session(a)).expect(401);
    });

    it('nothing public is reachable under /v1, and nothing internal under /public', async () => {
      const key = await makeKey(a, { scopes: ['projects:read'] });
      await test.http().get('/v1/public/v1/projects').set(bearer(key.secret)).expect(404);
      await test.http().get('/public/v1/me').set(bearer(key.secret)).expect(404);
    });
  });

  describe('OpenAPI', () => {
    it('is served without a key', async () => {
      const response = await test.http().get('/public/v1/openapi.json').expect(200);
      expect(response.body.openapi).toBe('3.1.0');
      expect(response.body.components.securitySchemes.apiKey).toMatchObject({ type: 'http', scheme: 'bearer' });
    });

    it('documents every public route, and nothing that is not one', () => {
      const document = publicOpenApiDocument() as { paths: Record<string, Record<string, { 'x-required-scope'?: string }>> };
      const prototype = PublicApiController.prototype as unknown as Record<string, unknown>;
      const routes = Object.getOwnPropertyNames(prototype)
        .filter((name) => name !== 'constructor')
        .map((name) => {
          const handler = prototype[name] as object;
          const path = Reflect.getMetadata(PATH_METADATA, handler) as string | undefined;
          const method = Reflect.getMetadata(METHOD_METADATA, handler) as RequestMethod | undefined;
          return path === undefined || method === undefined
            ? null
            : { path: `/${path}`.replace(/:(\w+)/g, '{$1}').replace(/\/$/, ''), method: RequestMethod[method].toLowerCase() };
        })
        .filter((route): route is { path: string; method: string } => route !== null);

      expect(routes.length).toBeGreaterThan(10);
      for (const route of routes) {
        expect([route.method, route.path, Boolean(document.paths[route.path]?.[route.method])]).toEqual([route.method, route.path, true]);
      }
      const documented = Object.entries(document.paths).flatMap(([path, operations]) =>
        Object.keys(operations).map((method) => `${method} ${path}`),
      );
      expect(documented.sort()).toEqual(routes.map((route) => `${route.method} ${route.path}`).sort());
    });

    it('names a scope for every route that needs one, and only real scopes', () => {
      const document = publicOpenApiDocument() as { paths: Record<string, Record<string, { 'x-required-scope'?: string }>> };
      for (const operations of Object.values(document.paths)) {
        for (const operation of Object.values(operations)) {
          const scope = operation['x-required-scope'];
          if (scope !== undefined) expect(PUBLIC_API_SCOPES).toContain(scope);
        }
      }
    });
  });
});
