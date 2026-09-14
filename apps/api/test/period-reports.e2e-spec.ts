import {
  createTestApp,
  destroyTenant,
  onboardTenant,
  uniquePhone,
  type OnboardedTenant,
  type TestApp,
} from './utils/test-app';

/**
 * The attendance register and the per-person accountability sheet (spec §8A).
 *
 * Both are read models over the same snapshots the wage sheet uses, so the figures
 * here must agree with what the wage sheet would pay for the same days.
 */
describe('period reports', () => {
  let test: TestApp;
  let tenant: OnboardedTenant;
  let owner: Record<string, string>;
  let projectId: string;
  let workerId: string;

  beforeAll(async () => {
    test = await createTestApp();
    tenant = await onboardTenant(test, {
      name: 'Register Builders',
      phone: uniquePhone(),
      plan: 'one_year',
    });
    owner = { Authorization: `Bearer ${tenant.accessToken}` };

    const project = await test
      .http()
      .post('/v1/projects')
      .set(owner)
      .send({ name: 'Register Site' })
      .expect(201);
    projectId = project.body.id;

    const worker = await test
      .http()
      .post('/v1/workers')
      .set(owner)
      .send({ name: 'Register Worker', trade: 'mason', skill_level: 'skilled', daily_wage: '80000' })
      .expect(201);
    workerId = worker.body.id;

    await test
      .http()
      .post(`/v1/workers/${workerId}/assign`)
      .set(owner)
      .send({ project_id: projectId, from_date: '2026-08-01' })
      .expect(201);

    // Three days: a full day with overtime, a half day, and an absence.
    const days: Array<[string, string, string]> = [
      ['2026-08-03', 'present', '2'],
      ['2026-08-04', 'half_day', '0'],
      ['2026-08-05', 'absent', '0'],
    ];
    for (const [date, status, overtime] of days) {
      await test
        .http()
        .post('/v1/attendance')
        .set(owner)
        .send({
          project_id: projectId,
          attendance_date: date,
          rows: [{ worker_id: workerId, status, overtime_hours: overtime }],
        })
        .expect(201);
    }
  });

  afterAll(async () => {
    if (tenant) await destroyTenant(test, tenant.tenantId);
    await test.close();
  });

  describe('attendance register', () => {
    it('returns a cell per recorded day and counts the statuses', async () => {
      const response = await test
        .http()
        .get('/v1/reports/attendance-register?from=2026-08-01&to=2026-08-07')
        .set(owner)
        .expect(200);

      // One column per calendar day in the range, recorded or not.
      expect(response.body.dates).toHaveLength(7);
      expect(response.body.dates[0]).toBe('2026-08-01');
      expect(response.body.dates[6]).toBe('2026-08-07');

      const row = response.body.workers.find(
        (w: { worker_id: string }) => w.worker_id === workerId,
      );
      expect(row).toBeDefined();
      expect(row.present_count).toBe(1);
      expect(row.half_day_count).toBe(1);
      expect(row.absent_count).toBe(1);

      // 1 full + 0.5 half = 1.5 worker-days.
      expect(row.days_present).toBe('1.5');
      expect(row.overtime_hours).toBe('2.0');

      // Days with no record are absent from the map rather than marked absent.
      expect(Object.keys(row.days).sort()).toEqual(['2026-08-03', '2026-08-04', '2026-08-05']);
      expect(row.days['2026-08-03'].status).toBe('present');
      expect(row.days['2026-08-05'].status).toBe('absent');
    });

    it('agrees with the labour cost report over the same range', async () => {
      const [register, cost] = await Promise.all([
        test
          .http()
          .get('/v1/reports/attendance-register?from=2026-08-01&to=2026-08-07')
          .set(owner)
          .expect(200),
        test
          .http()
          .get('/v1/reports/labour-cost?group_by=worker&from=2026-08-01&to=2026-08-07')
          .set(owner)
          .expect(200),
      ]);
      expect(register.body.totals.earned).toBe(cost.body.total);
    });

    it('accepts exactly 31 days and refuses 32', async () => {
      // The boundary is worth pinning: the grid is one column per day, and an off-by-one
      // here is the difference between a readable sheet and an unreadable one.
      const ok = await test
        .http()
        .get('/v1/reports/attendance-register?from=2026-08-01&to=2026-08-31')
        .set(owner)
        .expect(200);
      expect(ok.body.dates).toHaveLength(31);

      await test
        .http()
        .get('/v1/reports/attendance-register?from=2026-08-01&to=2026-09-01')
        .set(owner)
        .expect(422);

      await test
        .http()
        .get('/v1/reports/attendance-register?from=2026-01-01&to=2026-12-31')
        .set(owner)
        .expect(422);
    });
  });

  describe('person ledger', () => {
    it('attributes expenses and roll calls to the person who entered them', async () => {
      await test
        .http()
        .post('/v1/expenses')
        .set(owner)
        .send({
          project_id: projectId,
          amount: '250000',
          category: 'fuel',
          spent_on: '2026-08-04',
        })
        .expect(201);

      const response = await test
        .http()
        .get('/v1/reports/person-ledger?from=2026-08-01&to=2026-08-07')
        .set(owner)
        .expect(200);

      const me = await test.http().get('/v1/me').set(owner).expect(200);
      const row = response.body.people.find(
        (p: { user_id: string }) => p.user_id === me.body.user.id,
      );
      expect(row).toBeDefined();
      expect(row.expenses_pending).toBe('250000');
      expect(row.expenses_approved).toBe('0');
      expect(row.roll_calls).toBe(3);
      expect(row.days_booked).toBe('1.5');
    });

    it('leaves out people who did nothing in the window', async () => {
      const phone = uniquePhone();
      await test
        .http()
        .post('/v1/tenants/current/invite')
        .set(owner)
        .send({ phone, name: 'Idle Supervisor', role: 'site_supervisor', project_ids: [projectId] })
        .expect(201);

      const response = await test
        .http()
        .get('/v1/reports/person-ledger?from=2026-08-01&to=2026-08-07')
        .set(owner)
        .expect(200);
      expect(
        response.body.people.some((p: { name: string }) => p.name === 'Idle Supervisor'),
      ).toBe(false);
    });
  });
});
