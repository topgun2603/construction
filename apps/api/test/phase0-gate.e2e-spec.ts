import { addDays, todayIn } from '@sitebook/shared';
import { createTestApp, destroyTenant, type TestApp } from './utils/test-app';

/**
 * The Phase 0 gate (roadmap): "a test tenant set to UAE, AED, Asia/Dubai can run a full day —
 * sign in, roll call, site report, expense, wage period — with no ₹, IST or GST appearing
 * anywhere, and every existing Indian test still passes."
 *
 * Every response of that day, and every screen's data the owner would open afterwards, is
 * collected and searched for an India-only trace. A new endpoint that formats in rupees or says
 * "today" in Kolkata fails here rather than in front of a Gulf pilot.
 *
 * Arabic is the one part of the gate this does not check: the interface has not been translated.
 */
const INDIA_TRACES: Array<[string, RegExp]> = [
  ['the rupee sign', /₹/],
  ['the rupee code', /\bINR\b/],
  ['India Standard Time', /Asia\/Kolkata|\bIST\b/],
  ['GST', /\bGST(IN)?\b|gst_in/i],
  ['lakh or crore', /\d\s?(L|Cr)\b/],
];

const random = (digits: number) =>
  String(Math.floor(Math.random() * 10 ** digits)).padStart(digits, '0');

describe('Phase 0 gate: a UAE company runs a full day', () => {
  let test: TestApp;
  let tenantId: string;
  let auth: { Authorization: string };
  const seen: Array<{ step: string; body: string }> = [];

  // The week that just ended in Dubai, so the wage period covers finished days.
  const today = todayIn('Asia/Dubai');
  const weekEnd = addDays(today, -1);
  const weekStart = addDays(weekEnd, -6);

  /** Every response goes through here, so nothing the day touches escapes the search. */
  const record = (step: string, body: unknown) => {
    seen.push({ step, body: JSON.stringify(body) });
    return body as Record<string, unknown> & { id: string };
  };

  beforeAll(async () => {
    test = await createTestApp();
  });

  afterAll(async () => {
    if (tenantId) await destroyTenant(test, tenantId);
    await test.close();
  });

  it('signs up and signs in with a +971 number', async () => {
    const phone = `97150${random(7)}`;
    const exchange = await test
      .http()
      .post('/v1/auth/exchange')
      .send({ firebase_token: `dev:+${phone}` })
      .expect(200);
    const created = await test
      .http()
      .post('/v1/tenants')
      .set('X-Onboarding-Token', exchange.body.onboarding_token)
      .send({
        name: 'Al Noor Contracting',
        owner_name: 'Owner',
        country: 'AE',
        currency: 'AED',
        timezone: 'Asia/Dubai',
        locale: 'en-AE',
        tax_regime: 'vat_ae',
      })
      .expect(201);
    tenantId = created.body.tenant.id;
    auth = { Authorization: `Bearer ${created.body.tokens.access_token}` };
    record('onboarding', created.body.tenant);

    const me = await test.http().get('/v1/me').set(auth).expect(200);
    record('me', me.body);
    expect(me.body.tenant).toMatchObject({ currency: 'AED', timezone: 'Asia/Dubai' });
  });

  it('takes a roll call, a site report and an expense, and pays the week', async () => {
    const http = () => test.http();

    const project = record(
      'site',
      (
        await http()
          .post('/v1/projects')
          .set(auth)
          .send({ name: 'Marina Tower', budget_amount: '420000000', status: 'active' })
          .expect(201)
      ).body,
    );
    const contractor = record(
      'contractor',
      (
        await http()
          .post('/v1/contractors')
          .set(auth)
          .send({ name: 'Gulf Steel Fixers', phone: '+971 50 765 4321', payment_terms: 'weekly' })
          .expect(201)
      ).body,
    );
    const worker = record(
      'worker',
      (
        await http()
          .post('/v1/workers')
          .set(auth)
          .send({
            name: 'Ram Thapa',
            phone: '+977 984 1234567',
            contractor_id: contractor.id,
            daily_wage: '15000', // AED 150.00
            overtime_rate_per_hour: '2500',
            project_id: project.id,
            from_date: weekStart,
          })
          .expect(201)
      ).body,
    );

    for (let day = 0; day < 6; day += 1) {
      record(
        'roll call',
        (
          await http()
            .post('/v1/attendance')
            .set(auth)
            .send({
              project_id: project.id,
              attendance_date: addDays(weekStart, day),
              rows: [{ worker_id: worker.id, status: 'present', overtime_hours: '1' }],
            })
            .expect(201)
        ).body,
      );
    }

    const report = record(
      'site report',
      (
        await http()
          .post('/v1/dpr')
          .set(auth)
          .send({ project_id: project.id, report_date: today, work_done: 'Level 4 slab poured' })
          .expect(201)
      ).body,
    );
    record('site report submit', (await http().post(`/v1/dpr/${report.id}/submit`).set(auth)).body);

    record(
      'expense',
      (
        await http()
          .post('/v1/expenses')
          .set(auth)
          .send({ project_id: project.id, amount: '64000', category: 'fuel', spent_on: today })
          .expect(201)
      ).body,
    );

    const period = record(
      'wage period',
      (
        await http()
          .post('/v1/wage-periods/generate')
          .set(auth)
          .send({ contractor_id: contractor.id, period_start: weekStart, period_end: weekEnd })
          .expect(201)
      ).body,
    );
    record(
      'finalise',
      (await http().post(`/v1/wage-periods/${period.id}/finalise`).set(auth).expect(201)).body,
    );

    // What the owner opens afterwards.
    for (const path of [
      '/v1/dashboard/overview',
      '/v1/dashboard/today',
      '/v1/automation',
      `/v1/reports/wage-sheet/${period.id}`,
      `/v1/reports/labour-cost?group_by=contractor&from=${weekStart}&to=${weekEnd}`,
      `/v1/reports/attendance-register?from=${weekStart}&to=${weekEnd}`,
      '/v1/tenants/current',
    ]) {
      record(path, (await http().get(path).set(auth).expect(200)).body);
    }

    // The site report defaulted to Dubai's today, not Kolkata's.
    expect(report.report_date).toBe(today);
  });

  it('would notice India if it were there (control)', async () => {
    // The same search over an Indian company's own data must find something, or the clean
    // result below would prove nothing.
    const exchange = await test
      .http()
      .post('/v1/auth/exchange')
      .send({ firebase_token: `dev:+9198${random(8)}` })
      .expect(200);
    const created = await test
      .http()
      .post('/v1/tenants')
      .set('X-Onboarding-Token', exchange.body.onboarding_token)
      .send({ name: 'Chennai Control', owner_name: 'Owner' })
      .expect(201);
    try {
      const me = await test
        .http()
        .get('/v1/me')
        .set('Authorization', `Bearer ${created.body.tokens.access_token}`)
        .expect(200);
      const body = JSON.stringify(me.body);
      expect(INDIA_TRACES.some(([, pattern]) => pattern.test(body))).toBe(true);
    } finally {
      await destroyTenant(test, created.body.tenant.id);
    }
  });

  it('shows no trace of India anywhere in the day', () => {
    expect(seen.length).toBeGreaterThan(15);
    const found = seen.flatMap(({ step, body }) =>
      INDIA_TRACES.filter(([, pattern]) => pattern.test(body)).map(
        ([what, pattern]) =>
          `${what} in ${step}: …${body
            .match(pattern)
            ?.input?.slice(
              Math.max(0, (body.search(pattern) ?? 0) - 60),
              (body.search(pattern) ?? 0) + 60,
            )}…`,
      ),
    );
    expect(found).toEqual([]);
  });
});
