import dns from 'node:dns';
import { createServer, type IncomingHttpHeaders, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { WEBHOOK_SIGNATURE_TOLERANCE_SECONDS } from '@sitebook/shared';
import {
  createTestApp,
  destroyTenant,
  onboardTenant,
  uniquePhone,
  type OnboardedTenant,
  type TestApp,
} from './utils/test-app';
import { useKeepAlive } from './utils/keep-alive';
import { WebhookDeliveryService } from '../src/modules/webhooks/webhook-delivery.service';
import { WebhookSender } from '../src/modules/webhooks/webhook-sender.service';
import { webhookSignatureValid } from '../src/modules/webhooks/webhook-crypto';

interface Received {
  path: string;
  headers: IncomingHttpHeaders;
  body: string;
}

/**
 * A receiver on this machine standing in for a customer's server. Each path answers with whatever
 * status the test sets for it (200 by default), and everything received is kept.
 */
class Receiver {
  readonly received: Received[] = [];
  readonly status = new Map<string, number>();
  readonly bodies = new Map<string, string>();
  /** Decides the status from what was sent, when a path's answer depends on the event. */
  respond: ((path: string, body: string) => number | undefined) | null = null;
  private server: Server | null = null;
  base = '';

  async start(): Promise<void> {
    this.server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (chunk: Buffer) => chunks.push(chunk));
      req.on('end', () => {
        const path = req.url ?? '/';
        const body = Buffer.concat(chunks).toString('utf8');
        this.received.push({ path, headers: req.headers, body });
        res.statusCode = this.respond?.(path, body) ?? this.status.get(path) ?? 200;
        res.end(this.bodies.get(path) ?? 'ok');
      });
    });
    await new Promise<void>((resolve) => this.server!.listen(0, '127.0.0.1', resolve));
    this.base = `http://127.0.0.1:${(this.server!.address() as AddressInfo).port}`;
  }

  at(path: string): Received[] {
    return this.received.filter((entry) => entry.path === path);
  }

  async stop(): Promise<void> {
    await new Promise<void>((resolve) => this.server?.close(() => resolve()));
  }
}

/**
 * Signed webhooks (roadmap Phase 3), end to end: an event written in the same transaction as the
 * change (the outbox), delivered to a real HTTP server with a signature the receiver can verify,
 * retried on failure along the backoff curve, the endpoint switched off (and its owners told) after
 * a day of nothing getting through, manual resend and the test ping, the delivery log, and the
 * SSRF rules — refused at registration and checked again at every send.
 *
 * The worker's clock is the `now` each delivery call takes, so a day of retries runs in seconds
 * without faking timers in a process that also talks to Postgres.
 */
describe('Webhooks', () => {
  let test: TestApp;
  let releaseKeepAlive: () => Promise<void> = async () => undefined;
  let deliveries: WebhookDeliveryService;
  let sender: WebhookSender;
  const receiver = new Receiver();
  let a: OnboardedTenant;
  let siteA: string;
  let pmAuth: Record<string, string>;
  const tenants: string[] = [];

  const session = (tenant: OnboardedTenant) => ({ Authorization: `Bearer ${tenant.accessToken}` });
  const HOUR = 3600 * 1000;

  async function register(tenant: OnboardedTenant, path: string, events: string[]) {
    const response = await test
      .http()
      .post('/v1/developers/webhooks')
      .set(session(tenant))
      .send({ url: `${receiver.base}${path}`, events, description: path })
      .expect(201);
    return { id: response.body.endpoint.id as string, secret: response.body.secret as string };
  }

  async function recordExpense(auth: Record<string, string>, project: string, amount = '125050') {
    const response = await test
      .http()
      .post('/v1/expenses')
      .set(auth)
      .send({ project_id: project, amount, category: 'fuel', spent_on: '2026-09-03' })
      .expect(201);
    return response.body.id as string;
  }

  async function deliveryRows(tenantId: string, endpointId: string) {
    return test.tenantDb.transaction(tenantId, (tx) =>
      tx.webhookDelivery.findMany({ where: { endpointId }, orderBy: { createdAt: 'asc' }, include: { attempts: true, event: true } }),
    );
  }

  beforeAll(async () => {
    test = await createTestApp();
    releaseKeepAlive = await useKeepAlive(test);
    deliveries = test.app.get(WebhookDeliveryService);
    sender = test.app.get(WebhookSender);
    await receiver.start();

    a = await onboardTenant(test, { name: 'Hooked Builders', phone: uniquePhone(), plan: 'one_year' });
    tenants.push(a.tenantId);
    siteA = (await test.http().post('/v1/projects').set(session(a)).send({ name: 'Signal Tower' }).expect(201)).body.id;

    const pmPhone = uniquePhone();
    await test
      .http()
      .post('/v1/tenants/current/invite')
      .set(session(a))
      .send({ phone: pmPhone, name: 'Priya', role: 'project_manager', project_ids: [siteA] })
      .expect(201);
    const pm = await test.http().post('/v1/auth/exchange').send({ firebase_token: `dev:${pmPhone}` }).expect(200);
    pmAuth = { Authorization: `Bearer ${pm.body.access_token}` };
  });

  afterAll(async () => {
    for (const id of tenants) await destroyTenant(test, id);
    await receiver.stop();
    await releaseKeepAlive();
    await test.close();
  });

  afterEach(() => {
    sender.allowLoopback = false;
  });

  describe('where webhooks may go (SSRF)', () => {
    it.each([
      ['http://hooks.example.com/buildr', 'not_https'],
      ['https://localhost/hook', 'internal_host'],
      ['https://intranet/hook', 'internal_host'],
      ['https://127.0.0.1/hook', 'blocked_address'],
      ['https://10.0.0.5/hook', 'blocked_address'],
      ['https://192.168.1.10/hook', 'blocked_address'],
      ['https://169.254.169.254/latest/meta-data', 'blocked_address'],
      ['https://[::1]/hook', 'blocked_address'],
      ['https://[fd00::1]/hook', 'blocked_address'],
      ['https://user:pass@hooks.example.com/', 'credentials'],
    ])('refuses %s', async (url, problem) => {
      const response = await test
        .http()
        .post('/v1/developers/webhooks')
        .set(session(a))
        .send({ url, events: ['expense.created'] })
        .expect(422);
      expect(response.body.details).toEqual({ url: problem });
    });

    it('refuses a public-looking name that resolves to a private address — any of its addresses', async () => {
      for (const addresses of [[{ address: '10.0.0.7', family: 4 }], [{ address: '93.184.216.34', family: 4 }, { address: '169.254.169.254', family: 4 }]]) {
        const spy = jest.spyOn(dns, 'lookup').mockImplementation(((
          _host: string,
          _options: unknown,
          callback: (error: null, result: typeof addresses) => void,
        ) => callback(null, addresses)) as unknown as typeof dns.lookup);
        try {
          const response = await test
            .http()
            .post('/v1/developers/webhooks')
            .set(session(a))
            .send({ url: 'https://hooks.rebind.example/buildr', events: ['expense.created'] })
            .expect(422);
          expect(response.body.details).toEqual({ url: 'blocked_address' });
        } finally {
          spy.mockRestore();
        }
      }
    });

    it('refuses the local receiver too, unless loopback is allowed (development only)', async () => {
      await test
        .http()
        .post('/v1/developers/webhooks')
        .set(session(a))
        .send({ url: `${receiver.base}/x`, events: ['expense.created'] })
        .expect(422);
    });

    it('checks the address again at every send', async () => {
      sender.allowLoopback = true;
      const endpoint = await register(a, '/recheck', ['expense.created']);
      // The rules tighten (as they would if the name were re-pointed at a private address).
      sender.allowLoopback = false;
      await recordExpense(session(a), siteA, '1111');
      await deliveries.processDue(a.tenantId);

      expect(receiver.at('/recheck')).toHaveLength(0);
      const [row] = await deliveryRows(a.tenantId, endpoint.id);
      expect(row!.attempts[0]).toMatchObject({ ok: false, statusCode: null });
      expect(row!.attempts[0]!.error).toMatch(/^Refused: /);
      await test.http().delete(`/v1/developers/webhooks/${endpoint.id}`).set(session(a)).expect(204);
    });
  });

  describe('delivery', () => {
    let endpoint: { id: string; secret: string };

    beforeAll(async () => {
      sender.allowLoopback = true;
      endpoint = await register(a, '/main', ['expense.created', 'expense.approved', 'attendance.recorded']);
    });

    beforeEach(() => {
      sender.allowLoopback = true;
    });

    it('shows the secret once and only its last four after', async () => {
      expect(endpoint.secret).toMatch(/^whsec_/);
      const list = await test.http().get('/v1/developers/webhooks').set(session(a)).expect(200);
      expect(JSON.stringify(list.body)).not.toContain(endpoint.secret);
      expect(list.body.endpoints.find((row: { id: string }) => row.id === endpoint.id)).toMatchObject({
        secret_last4: endpoint.secret.slice(-4),
        status: 'active',
        events: ['expense.created', 'expense.approved', 'attendance.recorded'],
      });
    });

    it('writes the event with the change, then delivers it signed', async () => {
      const expenseId = await recordExpense(pmAuth, siteA);

      // The outbox: written in the expense's own transaction, not sent yet.
      const [pending] = await deliveryRows(a.tenantId, endpoint.id);
      expect(pending).toMatchObject({ status: 'pending', attemptCount: 0 });
      expect(pending!.event.type).toBe('expense.created');

      const sent = await deliveries.processDue(a.tenantId);
      expect(sent).toBeGreaterThanOrEqual(1);

      const [hit] = receiver.at('/main');
      expect(hit).toBeDefined();
      expect(hit!.headers['content-type']).toBe('application/json');
      expect(hit!.headers['x-buildr-event']).toBe('expense.created');
      expect(hit!.headers['x-buildr-event-id']).toBe(pending!.eventId);
      expect(hit!.headers['x-buildr-delivery']).toBe(pending!.id);

      const signature = hit!.headers['x-buildr-signature'] as string;
      expect(signature).toMatch(/^t=\d+,v1=[0-9a-f]{64}$/);
      expect(webhookSignatureValid(endpoint.secret, hit!.body, signature, { toleranceSeconds: WEBHOOK_SIGNATURE_TOLERANCE_SECONDS })).toBe(true);
      // A tampered body, or the wrong secret, does not verify.
      expect(webhookSignatureValid(endpoint.secret, hit!.body.replace('125050', '999999'), signature, { toleranceSeconds: 300 })).toBe(false);
      expect(webhookSignatureValid('whsec_wrong', hit!.body, signature, { toleranceSeconds: 300 })).toBe(false);

      const body = JSON.parse(hit!.body);
      expect(body).toMatchObject({
        id: pending!.eventId,
        type: 'expense.created',
        api_version: 'v1',
        data: { expense: { id: expenseId, amount: 125050, currency: 'INR', status: 'pending', project_id: siteA } },
      });

      const [done] = await deliveryRows(a.tenantId, endpoint.id);
      expect(done).toMatchObject({ status: 'succeeded', attemptCount: 1, lastStatusCode: 200 });
      expect(done!.attempts).toHaveLength(1);
      expect(done!.attempts[0]!.latencyMs).toBeGreaterThanOrEqual(0);
    });

    it('sends only the events an endpoint asked for, and the approval when it happens', async () => {
      receiver.received.length = 0;
      const expenseId = await recordExpense(pmAuth, siteA, '5000');
      await test.http().patch(`/v1/expenses/${expenseId}/decision`).set(session(a)).send({ status: 'approved' }).expect(200);
      await deliveries.processDue(a.tenantId);
      const types = receiver.at('/main').map((hit) => hit.headers['x-buildr-event']);
      expect(types).toEqual(['expense.created', 'expense.approved']);
      const approved = JSON.parse(receiver.at('/main')[1]!.body);
      expect(approved.data.expense).toMatchObject({ id: expenseId, status: 'approved' });
    });

    it('announces a roll call as one attendance.recorded event', async () => {
      receiver.received.length = 0;
      const worker = await test
        .http()
        .post('/v1/workers')
        .set(session(a))
        .send({ name: 'Selvam', daily_wage: '80000', project_id: siteA, from_date: '2026-09-01' })
        .expect(201);
      await test
        .http()
        .post('/v1/attendance')
        .set(session(a))
        .send({ project_id: siteA, attendance_date: '2026-09-05', rows: [{ worker_id: worker.body.id, status: 'present' }] })
        .expect(201);
      await deliveries.processDue(a.tenantId);
      const [hit] = receiver.at('/main');
      expect(hit!.headers['x-buildr-event']).toBe('attendance.recorded');
      expect(JSON.parse(hit!.body).data).toMatchObject({
        project_id: siteA,
        date: '2026-09-05',
        attendance: [{ worker_id: worker.body.id, status: 'present', daily_wage: 80000 }],
      });
    });

    it('retries a failed delivery along the backoff curve, then succeeds', async () => {
      receiver.received.length = 0;
      receiver.status.set('/main', 500);
      await recordExpense(pmAuth, siteA, '7000');
      const start = new Date();

      await deliveries.processDue(a.tenantId, start);
      let [row] = (await deliveryRows(a.tenantId, endpoint.id)).slice(-1);
      expect(row).toMatchObject({ status: 'pending', attemptCount: 1, lastStatusCode: 500 });
      // About a minute later (±10% jitter), not straight away.
      const wait = row!.nextAttemptAt.getTime() - start.getTime();
      expect(wait).toBeGreaterThanOrEqual(54_000);
      expect(wait).toBeLessThanOrEqual(66_000);

      // Not due yet: nothing is sent.
      expect(await deliveries.processDue(a.tenantId, new Date(start.getTime() + 30_000))).toBe(0);

      // Second try, still failing: the next wait is about five minutes.
      const second = new Date(start.getTime() + 70_000);
      await deliveries.processDue(a.tenantId, second);
      [row] = (await deliveryRows(a.tenantId, endpoint.id)).slice(-1);
      expect(row).toMatchObject({ status: 'pending', attemptCount: 2 });
      const wait2 = row!.nextAttemptAt.getTime() - second.getTime();
      expect(wait2).toBeGreaterThanOrEqual(270_000);
      expect(wait2).toBeLessThanOrEqual(330_000);

      // The receiver recovers.
      receiver.status.delete('/main');
      await deliveries.processDue(a.tenantId, new Date(start.getTime() + 10 * 60_000));
      [row] = (await deliveryRows(a.tenantId, endpoint.id)).slice(-1);
      expect(row).toMatchObject({ status: 'succeeded', attemptCount: 3, lastStatusCode: 200 });
      expect(row!.attempts.map((attempt) => attempt.statusCode)).toEqual([500, 500, 200]);
      // Every try carried the same event id, so the receiver can de-duplicate.
      const ids = new Set(receiver.at('/main').map((hit) => hit.headers['x-buildr-event-id']));
      expect(ids.size).toBe(1);

      const endpointRow = await test.tenantDb.transaction(a.tenantId, (tx) => tx.webhookEndpoint.findUniqueOrThrow({ where: { id: endpoint.id } }));
      expect(endpointRow.consecutiveFailures).toBe(0);
    });

    it('resends a delivery now, as the same event', async () => {
      receiver.received.length = 0;
      const [original] = (await deliveryRows(a.tenantId, endpoint.id)).filter((row) => row.status === 'succeeded');
      const outcome = await test
        .http()
        .post(`/v1/developers/webhooks/deliveries/${original!.id}/resend`)
        .set(session(a))
        .expect(200);
      expect(outcome.body).toMatchObject({ status: 'succeeded', attempt: 1, status_code: 200 });
      expect(receiver.at('/main')[0]!.headers['x-buildr-event-id']).toBe(original!.eventId);

      const copy = (await deliveryRows(a.tenantId, endpoint.id)).find((row) => row.resendOfId === original!.id);
      expect(copy).toBeDefined();
      const log = await test.http().get(`/v1/audit?action=webhook.resent`).set(session(a)).expect(200);
      expect(log.body.items[0]).toMatchObject({ entity: 'webhook_endpoints', entity_id: endpoint.id, actor: { id: a.ownerId } });
    });

    it('pings an endpoint and reports what it answered', async () => {
      receiver.received.length = 0;
      const outcome = await test.http().post(`/v1/developers/webhooks/${endpoint.id}/ping`).set(session(a)).expect(200);
      expect(outcome.body).toMatchObject({ status: 'succeeded', status_code: 200 });
      const [hit] = receiver.at('/main');
      expect(hit!.headers['x-buildr-event']).toBe('webhook.ping');
      expect(webhookSignatureValid(endpoint.secret, hit!.body, hit!.headers['x-buildr-signature'] as string, { toleranceSeconds: 300 })).toBe(true);

      receiver.status.set('/main', 503);
      const failed = await test.http().post(`/v1/developers/webhooks/${endpoint.id}/ping`).set(session(a)).expect(200);
      // One try only, and no mark against the endpoint.
      expect(failed.body).toMatchObject({ status: 'failed', status_code: 503 });
      receiver.status.delete('/main');
      const endpointRow = await test.tenantDb.transaction(a.tenantId, (tx) => tx.webhookEndpoint.findUniqueOrThrow({ where: { id: endpoint.id } }));
      expect(endpointRow.consecutiveFailures).toBe(0);
    });

    it('keeps only the first kilobyte of a large answer in the log', async () => {
      receiver.bodies.set('/main', 'x'.repeat(200_000));
      await test.http().post(`/v1/developers/webhooks/${endpoint.id}/ping`).set(session(a)).expect(200);
      receiver.bodies.delete('/main');
      const log = await test.http().get(`/v1/developers/webhooks/${endpoint.id}/deliveries`).set(session(a)).expect(200);
      const latest = log.body.data[0];
      expect(latest.event.type).toBe('webhook.ping');
      expect(latest.attempts[0].response_snippet.length).toBeLessThanOrEqual(1024);
    });

    it('shows the delivery log with every try', async () => {
      const log = await test.http().get(`/v1/developers/webhooks/${endpoint.id}/deliveries`).set(session(a)).expect(200);
      expect(log.body.data.length).toBeGreaterThan(3);
      const retried = log.body.data.find((row: { attempts: unknown[] }) => row.attempts.length === 3);
      expect(retried.attempts.map((attempt: { status_code: number }) => attempt.status_code)).toEqual([500, 500, 200]);
      expect(retried.attempts[0]).toMatchObject({ ok: false, latency_ms: expect.any(Number) });
    });
  });

  describe('switching off', () => {
    it('switches an endpoint off after a day of failures and tells the owners', async () => {
      sender.allowLoopback = true;
      const company = await onboardTenant(test, { name: 'Dead Hook Builders', phone: uniquePhone(), plan: 'one_year' });
      tenants.push(company.tenantId);
      const site = (await test.http().post('/v1/projects').set(session(company)).send({ name: 'Quiet' }).expect(201)).body.id;
      receiver.status.set('/dead', 500);
      const endpoint = await register(company, '/dead', ['expense.created']);
      await recordExpense(session(company), site, '4200');

      let clock = Date.now();
      for (let attempt = 1; attempt <= 8; attempt++) {
        await deliveries.processDue(company.tenantId, new Date(clock));
        clock += 9 * HOUR;
      }
      const [row] = await deliveryRows(company.tenantId, endpoint.id);
      expect(row).toMatchObject({ status: 'failed', attemptCount: 8 });
      expect(receiver.at('/dead')).toHaveLength(8);

      const list = await test.http().get('/v1/developers/webhooks').set(session(company)).expect(200);
      expect(list.body.endpoints[0]).toMatchObject({ status: 'disabled', disabled_reason: 'failing' });

      const notifications = await test.tenantDb.transaction(company.tenantId, (tx) =>
        tx.notification.findMany({ where: { type: 'webhook.endpoint_disabled' } }),
      );
      expect(notifications.map((note) => note.userId)).toContain(company.ownerId);

      // Nothing more is sent to it; switching it back on starts clean.
      await recordExpense(session(company), site, '4300');
      expect((await deliveryRows(company.tenantId, endpoint.id)).length).toBe(1);
      const back = await test.http().patch(`/v1/developers/webhooks/${endpoint.id}`).set(session(company)).send({ status: 'active' }).expect(200);
      expect(back.body).toMatchObject({ status: 'active', disabled_reason: null, consecutive_failures: 0 });
      receiver.status.delete('/dead');
    });

    it('does not switch off an endpoint that is otherwise getting deliveries through', async () => {
      sender.allowLoopback = true;
      const company = await onboardTenant(test, { name: 'Flaky Hook Builders', phone: uniquePhone(), plan: 'one_year' });
      tenants.push(company.tenantId);
      const site = (await test.http().post('/v1/projects').set(session(company)).send({ name: 'Mixed' }).expect(201)).body.id;
      const endpoint = await register(company, '/flaky', ['expense.created']);

      // The receiver chokes on one particular event and accepts the rest.
      receiver.respond = (path, body) => (path === '/flaky' && body.includes('"amount":100,') ? 500 : undefined);
      try {
        await recordExpense(session(company), site, '100');
        let clock = Date.now();
        await deliveries.processDue(company.tenantId, new Date(clock));
        // A later event gets through in between.
        await recordExpense(session(company), site, '200');
        for (let round = 0; round < 8; round++) {
          clock += 9 * HOUR;
          await deliveries.processDue(company.tenantId, new Date(clock));
        }
      } finally {
        receiver.respond = null;
      }
      const rows = await deliveryRows(company.tenantId, endpoint.id);
      expect(rows.map((row) => row.status).sort()).toEqual(['failed', 'succeeded']);
      const list = await test.http().get('/v1/developers/webhooks').set(session(company)).expect(200);
      expect(list.body.endpoints[0].status).toBe('active');
    });
  });

  describe('who may manage webhooks', () => {
    it('is the owner only, and one company never sees another’s', async () => {
      await test.http().get('/v1/developers/webhooks').set(pmAuth).expect(403);
      const other = await onboardTenant(test, { name: 'Nosy Builders', phone: uniquePhone(), plan: 'one_year' });
      tenants.push(other.tenantId);
      const mine = await test.http().get('/v1/developers/webhooks').set(session(a)).expect(200);
      const id = mine.body.endpoints[0].id as string;
      await test.http().patch(`/v1/developers/webhooks/${id}`).set(session(other)).send({ status: 'disabled' }).expect(404);
      await test.http().get(`/v1/developers/webhooks/${id}/deliveries`).set(session(other)).expect(404);
      const theirs = await test.http().get('/v1/developers/webhooks').set(session(other)).expect(200);
      expect(theirs.body.endpoints).toEqual([]);
    });

    it('audits endpoint changes with the secret redacted', async () => {
      const log = await test.http().get('/v1/audit?entity=webhook_endpoints&action=create').set(session(a)).expect(200);
      expect(log.body.items.length).toBeGreaterThan(0);
      expect(log.body.items[0].after.secret_cipher).toBe('[redacted]');
    });
  });
});
