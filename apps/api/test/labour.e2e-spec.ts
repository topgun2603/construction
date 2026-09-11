import {
  createTestApp,
  destroyTenant,
  onboardTenant,
  uniquePhone,
  type OnboardedTenant,
  type TestApp,
} from './utils/test-app';

/**
 * The labour money path (spec §8A).
 *
 * Attendance → wage period → payment is the sequence that decides what a real
 * person is handed in cash on Saturday. Every rule in it is tested here against a
 * real database, because "the arithmetic was off by a rupee" is not a bug anyone
 * finds by reading code.
 */
describe('labour: attendance, wage periods and payments', () => {
  let test: TestApp;
  let tenant: OnboardedTenant;
  let auth: Record<string, string>;
  let projectId: string;
  let otherProjectId: string;
  let contractorId: string;
  let raju: string;
  let selvam: string;

  // A fixed past week, so the run never straddles a month boundary or "today".
  const MONDAY = '2026-03-02';
  const TUESDAY = '2026-03-03';
  const WEDNESDAY = '2026-03-04';
  const SUNDAY = '2026-03-08';

  const WAGE = '85000'; // ₹850/day in paise
  const OT_RATE = '11000'; // ₹110/hour

  beforeAll(async () => {
    test = await createTestApp();
    tenant = await onboardTenant(test, { name: 'Labour Test Builders', phone: uniquePhone() });
    auth = { Authorization: `Bearer ${tenant.accessToken}` };

    projectId = await createProject('Green Meadows');
    otherProjectId = await createProject('OMR Skyline');

    const contractor = await test
      .http()
      .post('/v1/contractors')
      .set(auth)
      .send({ name: 'Murugan Masonry', trade: 'Masonry', payment_terms: 'weekly' })
      .expect(201);
    contractorId = contractor.body.id;

    raju = await createWorker('Raju M');
    selvam = await createWorker('Selvam P');
  });

  afterAll(async () => {
    if (tenant) await destroyTenant(test, tenant.tenantId);
    await test.close();
  });

  async function createProject(name: string): Promise<string> {
    const response = await test
      .http()
      .post('/v1/projects')
      .set(auth)
      .send({ name })
      .expect(201);
    return response.body.id;
  }

  async function createWorker(name: string): Promise<string> {
    const response = await test
      .http()
      .post('/v1/workers')
      .set(auth)
      .send({
        name,
        trade: 'Mason',
        skill_level: 'skilled',
        contractor_id: contractorId,
        daily_wage: WAGE,
        overtime_rate_per_hour: OT_RATE,
        project_id: projectId,
        from_date: MONDAY,
      })
      .expect(201);
    return response.body.id;
  }

  describe('roll call', () => {
    it('records a roll call and freezes the wage onto each row', async () => {
      const response = await test
        .http()
        .post('/v1/attendance')
        .set(auth)
        .send({
          project_id: projectId,
          attendance_date: MONDAY,
          rows: [
            { worker_id: raju, status: 'present', overtime_hours: '2' },
            { worker_id: selvam, status: 'half_day' },
          ],
        })
        .expect(201);

      expect(response.body.items).toHaveLength(2);
      const rajuRow = response.body.items.find((r: { worker_id: string }) => r.worker_id === raju);
      // ₹850 + 2h × ₹110 = ₹1,070
      expect(rajuRow.earned).toBe('107000');
      expect(rajuRow.wage_snapshot).toBe(WAGE);

      const selvamRow = response.body.items.find(
        (r: { worker_id: string }) => r.worker_id === selvam,
      );
      expect(selvamRow.earned).toBe('42500'); // half of ₹850
      expect(response.body.total_earned).toBe('149500');
    });

    it('lists workers on a site for a date', async () => {
      const response = await test
        .http()
        .get(`/v1/workers?project_id=${projectId}&on_date=${MONDAY}`)
        .set(auth)
        .expect(200);
      expect(response.body.items.map((w: { id: string }) => w.id).sort()).toEqual(
        [raju, selvam].sort(),
      );
    });

    it('is idempotent — re-recording the same day replaces, never duplicates', async () => {
      await test
        .http()
        .post('/v1/attendance')
        .set(auth)
        .send({
          project_id: projectId,
          attendance_date: MONDAY,
          rows: [{ worker_id: raju, status: 'present', overtime_hours: '0' }],
        })
        .expect(201);

      const response = await test
        .http()
        .get(`/v1/attendance?project_id=${projectId}&date=${MONDAY}`)
        .set(auth)
        .expect(200);

      expect(response.body.items).toHaveLength(2);
      const rajuRow = response.body.items.find((r: { worker_id: string }) => r.worker_id === raju);
      expect(rajuRow.earned).toBe('85000'); // overtime was corrected away
    });

    it('refuses to mark a worker present on two sites the same day', async () => {
      const response = await test
        .http()
        .post('/v1/attendance')
        .set(auth)
        .send({
          project_id: otherProjectId,
          attendance_date: MONDAY,
          rows: [{ worker_id: raju, status: 'present' }],
        })
        .expect(409);

      expect(response.body.code).toBe('WORKER_OVERBOOKED');
      expect(response.body.details.conflicts[0].worker_id).toBe(raju);
    });

    it('allows a half day on each of two sites', async () => {
      await test
        .http()
        .post('/v1/attendance')
        .set(auth)
        .send({
          project_id: projectId,
          attendance_date: TUESDAY,
          rows: [{ worker_id: raju, status: 'half_day' }],
        })
        .expect(201);

      await test
        .http()
        .post('/v1/attendance')
        .set(auth)
        .send({
          project_id: otherProjectId,
          attendance_date: TUESDAY,
          rows: [{ worker_id: raju, status: 'half_day' }],
        })
        .expect(201);
    });

    it('rejects an unknown worker rather than silently skipping them', async () => {
      const response = await test
        .http()
        .post('/v1/attendance')
        .set(auth)
        .send({
          project_id: projectId,
          attendance_date: WEDNESDAY,
          rows: [{ worker_id: '00000000-0000-4000-8000-000000000000', status: 'present' }],
        })
        .expect(422);
      expect(response.body.code).toBe('VALIDATION_FAILED');
    });
  });

  describe('wage period', () => {
    let periodId: string;

    it('deducts an outstanding advance when generating lines', async () => {
      // ₹300 handed over on site mid-week.
      await test
        .http()
        .post('/v1/labour-payments')
        .set(auth)
        .send({ type: 'advance', amount: '30000', paid_on: TUESDAY, worker_id: raju })
        .expect(201);

      const response = await test
        .http()
        .post('/v1/wage-periods/generate')
        .set(auth)
        .send({ contractor_id: contractorId, period_start: MONDAY, period_end: SUNDAY })
        .expect(201);

      periodId = response.body.id;
      expect(response.body.status).toBe('open');

      const rajuLine = response.body.lines.find((l: { worker_id: string }) => l.worker_id === raju);
      // Monday full day + Tuesday two half days across two sites = 2.0 days
      expect(rajuLine.days_present).toBe('2.0');
      expect(rajuLine.gross_amount).toBe('170000');
      expect(rajuLine.advances_deducted).toBe('30000');
      expect(rajuLine.net_payable).toBe('140000');

      const selvamLine = response.body.lines.find(
        (l: { worker_id: string }) => l.worker_id === selvam,
      );
      expect(selvamLine.days_present).toBe('0.5');
      expect(selvamLine.net_payable).toBe('42500');
    });

    it('recomputes an open period rather than duplicating it', async () => {
      await test
        .http()
        .post('/v1/attendance')
        .set(auth)
        .send({
          project_id: projectId,
          attendance_date: WEDNESDAY,
          rows: [{ worker_id: selvam, status: 'present' }],
        })
        .expect(201);

      const response = await test
        .http()
        .post('/v1/wage-periods/generate')
        .set(auth)
        .send({ contractor_id: contractorId, period_start: MONDAY, period_end: SUNDAY })
        .expect(201);

      expect(response.body.id).toBe(periodId);
      const selvamLine = response.body.lines.find(
        (l: { worker_id: string }) => l.worker_id === selvam,
      );
      expect(selvamLine.days_present).toBe('1.5');
      expect(selvamLine.gross_amount).toBe('127500');
    });

    it('refuses to pay before the period is finalised', async () => {
      const response = await test
        .http()
        .post(`/v1/wage-periods/${periodId}/pay`)
        .set(auth)
        .send({ paid_on: SUNDAY })
        .expect(409);
      expect(response.body.code).toBe('CONFLICT');
    });

    it('locks attendance for the range once finalised', async () => {
      const finalised = await test
        .http()
        .post(`/v1/wage-periods/${periodId}/finalise`)
        .set(auth)
        .expect(201);
      expect(finalised.body.status).toBe('finalised');

      const blocked = await test
        .http()
        .post('/v1/attendance')
        .set(auth)
        .send({
          project_id: projectId,
          attendance_date: WEDNESDAY,
          rows: [{ worker_id: raju, status: 'present' }],
        })
        .expect(409);

      expect(blocked.body.code).toBe('PERIOD_FINALISED');
      expect(blocked.body.details.wage_period_id).toBe(periodId);
    });

    it('refuses to regenerate a finalised period', async () => {
      const response = await test
        .http()
        .post('/v1/wage-periods/generate')
        .set(auth)
        .send({ contractor_id: contractorId, period_start: MONDAY, period_end: SUNDAY })
        .expect(409);
      expect(response.body.code).toBe('PERIOD_FINALISED');
    });

    it('rejects a payment larger than what is outstanding', async () => {
      const response = await test
        .http()
        .post(`/v1/wage-periods/${periodId}/pay`)
        .set(auth)
        .send({
          paid_on: SUNDAY,
          lines: [{ worker_id: raju, amount: '99900000' }],
        })
        .expect(422);
      expect(response.body.message).toMatch(/exceeds/i);
    });

    it('settles partially, then fully', async () => {
      const partial = await test
        .http()
        .post(`/v1/wage-periods/${periodId}/pay`)
        .set(auth)
        .send({ paid_on: SUNDAY, mode: 'cash', lines: [{ worker_id: raju, amount: '100000' }] })
        .expect(201);

      // Still outstanding on both lines, so the period is not yet `paid`.
      expect(partial.body.status).toBe('finalised');
      const rajuLine = partial.body.lines.find((l: { worker_id: string }) => l.worker_id === raju);
      expect(rajuLine.paid_amount).toBe('100000');
      expect(rajuLine.outstanding).toBe('40000');

      const full = await test
        .http()
        .post(`/v1/wage-periods/${periodId}/pay`)
        .set(auth)
        .send({ paid_on: SUNDAY, mode: 'cash' })
        .expect(201);

      expect(full.body.status).toBe('paid');
      expect(full.body.lines.every((l: { outstanding: string }) => l.outstanding === '0')).toBe(
        true,
      );
    });
  });

  describe('worker ledger', () => {
    it('nets attendance against payments with a running balance', async () => {
      const response = await test
        .http()
        .get(`/v1/workers/${raju}/ledger`)
        .set(auth)
        .expect(200);

      // Earned ₹1,700; received ₹300 advance + ₹1,400 wages = ₹1,700. Settled.
      expect(response.body.total_earned).toBe('170000');
      expect(response.body.total_paid).toBe('170000');
      expect(response.body.outstanding).toBe('0');
      expect(response.body.entries.length).toBeGreaterThan(0);
    });
  });

  describe('reports', () => {
    it('groups labour cost by contractor', async () => {
      const response = await test
        .http()
        .get(`/v1/reports/labour-cost?group_by=contractor&from=${MONDAY}&to=${SUNDAY}`)
        .set(auth)
        .expect(200);

      expect(response.body.groups).toHaveLength(1);
      expect(response.body.groups[0].label).toBe('Murugan Masonry');
      expect(response.body.total).toBe('297500'); // ₹1,700 + ₹1,275
    });

    it('produces a printable wage sheet', async () => {
      const periods = await test.http().get('/v1/wage-periods').set(auth).expect(200);
      const periodId = periods.body.items[0].id;

      const sheet = await test
        .http()
        .get(`/v1/reports/wage-sheet/${periodId}`)
        .set(auth)
        .expect(200);

      expect(sheet.body.contractor.name).toBe('Murugan Masonry');
      expect(sheet.body.rows).toHaveLength(2);
      expect(sheet.body.rows[0].serial).toBe(1);
      expect(sheet.body.totals.net).toBe('267500');
    });
  });
});
