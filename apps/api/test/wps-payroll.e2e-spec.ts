import { minorToDecimal } from '@sitebook/shared';
import { createTestApp, destroyTenant, type TestApp } from './utils/test-app';

/**
 * A UAE payroll month, end to end (roadmap Phase 1, items 1 and 2): a salaried worker paid their
 * month less an absent day plus overtime, and the WPS salary file the bank takes.
 */
const random = (digits: number) =>
  String(Math.floor(Math.random() * 10 ** digits)).padStart(digits, '0');

describe('UAE payroll and the WPS salary file', () => {
  let test: TestApp;
  let tenantId: string;
  let auth: { Authorization: string };
  let periodId: string;
  let salaried: string;

  beforeAll(async () => {
    test = await createTestApp();
    const exchange = await test
      .http()
      .post('/v1/auth/exchange')
      .send({ firebase_token: `dev:+97150${random(7)}` })
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
  });

  afterAll(async () => {
    if (tenantId) await destroyTenant(test, tenantId);
    await test.close();
  });

  it('pays a salaried worker the month, less an absent day, plus overtime', async () => {
    const project = (
      await test
        .http()
        .post('/v1/projects')
        .set(auth)
        .send({ name: 'Marina Tower', status: 'active' })
        .expect(201)
    ).body.id;

    const worker = await test
      .http()
      .post('/v1/workers')
      .set(auth)
      .send({
        name: 'Ram Thapa',
        pay_basis: 'monthly',
        // AED 2,000 basic + 600 housing, in fils.
        basic_salary: '200000',
        housing_allowance: '60000',
        overtime_rate_per_hour: '5000',
        wps_person_id: '10012345678901',
        wps_agent_code: '803320101',
        wps_account: 'ae070331234567890123456',
      })
      .expect(201);
    salaried = worker.body.id;
    // The day rate is the fixed pay over thirty, for the dashboards.
    expect(worker.body.daily_wage).toBe(String(260_000n / 30n));
    expect(worker.body.wps_account).toBe('AE070331234567890123456');

    // A daily worker with no WPS details, to be listed rather than silently dropped.
    const daily = (
      await test
        .http()
        .post('/v1/workers')
        .set(auth)
        .send({ name: 'Day Hire', daily_wage: '12000' })
        .expect(201)
    ).body.id;

    const roll = (date: string, rows: object[]) =>
      test
        .http()
        .post('/v1/attendance')
        .set(auth)
        .send({ project_id: project, attendance_date: date, rows })
        .expect(201);
    await roll('2026-09-07', [
      { worker_id: salaried, status: 'absent' },
      { worker_id: daily, status: 'present' },
    ]);
    await roll('2026-09-08', [{ worker_id: salaried, status: 'present', overtime_hours: '2' }]);

    const period = await test
      .http()
      .post('/v1/wage-periods/generate')
      .set(auth)
      .send({ period_start: '2026-09-01', period_end: '2026-09-30' })
      .expect(201);
    periodId = period.body.id;

    const line = period.body.lines.find((l: { worker_id: string }) => l.worker_id === salaried);
    const fixed = 260_000n - 260_000n / 30n;
    expect(line).toMatchObject({
      pay_basis: 'monthly',
      fixed_amount: fixed.toString(),
      variable_amount: '10000',
      gross_amount: (fixed + 10_000n).toString(),
      leave_days: '1.0',
    });
  });

  it('will not write a salary file until the company and the period are ready', async () => {
    const early = await test.http().get(`/v1/wage-periods/${periodId}/wps`).set(auth).expect(200);
    expect(early.body.ready).toBe(false);
    expect(early.body.content).toBeNull();
    expect(early.body.problems.join(' ')).toMatch(/establishment id/);
    expect(early.body.problems.join(' ')).toMatch(/Finalise/);
  });

  it('writes the SIF once it is, listing whoever cannot be paid through WPS yet', async () => {
    await test
      .http()
      .patch('/v1/tenants/current')
      .set(auth)
      .send({ wps_employer_id: '1000000123456', wps_bank_code: '802920101' })
      .expect(200);
    await test.http().post(`/v1/wage-periods/${periodId}/finalise`).set(auth).expect(201);

    const { body } = await test
      .http()
      .get(`/v1/wage-periods/${periodId}/wps`)
      .set(auth)
      .expect(200);
    expect(body.included).toBe(1);
    expect(body.missing).toEqual([
      expect.objectContaining({
        worker_name: 'Day Hire',
        missing: ['MOL personal number', 'bank routing code', 'IBAN or card number'],
      }),
    ]);
    expect(body.file_name).toMatch(/^1000000123456\d{12}\.SIF$/);

    const lines = body.content.trimEnd().split('\r\n');
    const fixed = 260_000n - 260_000n / 30n;
    // AED 2,600 less a thirtieth (86.66) is 2,513.34 fixed; two overtime hours are 100.00.
    expect(lines[0]).toBe(
      `EDR,10012345678901,803320101,AE070331234567890123456,2026-09-01,2026-09-30,30,${minorToDecimal(fixed, 2)},100.00,1.0`,
    );
    expect(lines[1]).toMatch(/^SCR,1000000123456,802920101,\d{4}-\d{2}-\d{2},\d{4},092026,1,/);
    expect(lines[1]).toContain(',AED,');
  });
});
