import {
  createTestApp,
  destroyTenant,
  onboardTenant,
  uniquePhone,
  type OnboardedTenant,
  type TestApp,
} from './utils/test-app';

/**
 * The overview's command-centre signals.
 *
 * These are the three numbers somebody acts on without opening anything else — is the site busier
 * than last week, is a wage period overdue, is a material past its estimate — and each of them has
 * an arithmetic edge that is easy to get wrong and invisible when it is: a percentage from zero, a
 * period that closes today rather than yesterday, consumption counted as delivery.
 */
describe('the overview signals', () => {
  let test: TestApp;
  let tenant: OnboardedTenant;
  let auth: Record<string, string>;
  let projectId: string;

  const WAGE = '60000';

  beforeAll(async () => {
    test = await createTestApp();
    tenant = await onboardTenant(test, { name: 'Signal Builders', phone: uniquePhone() });
    auth = { Authorization: `Bearer ${tenant.accessToken}` };

    const project = await test
      .http()
      .post('/v1/projects')
      .set(auth)
      .send({ name: 'Signal Site' })
      .expect(201);
    projectId = project.body.id;
  });

  afterAll(async () => {
    if (tenant) await destroyTenant(test, tenant.tenantId);
    await test.close();
  });

  function isoDaysAgo(days: number): string {
    const date = new Date();
    date.setUTCDate(date.getUTCDate() - days);
    return date.toISOString().slice(0, 10);
  }

  async function overview() {
    const response = await test.http().get('/v1/dashboard/overview').set(auth).expect(200);
    return response.body;
  }

  describe('headcount, week on week', () => {
    it('reports no percentage when nobody worked last week', async () => {
      const body = await overview();
      // Zero is not a baseline. "+100%" from nothing is the kind of number a dashboard should
      // refuse to print rather than compute.
      expect(body.headcount_trend.change_pct).toBeNull();
      expect(body.headcount_trend.last_week).toBe(0);
    });

    it('counts man-days across a fortnight and compares the halves', async () => {
      const workers = await Promise.all(
        ['Trend A', 'Trend B', 'Trend C'].map(async (name) => {
          const response = await test
            .http()
            .post('/v1/workers')
            .set(auth)
            .send({
              name,
              trade: 'Mason',
              skill_level: 'skilled',
              daily_wage: WAGE,
              project_id: projectId,
            })
            .expect(201);
          return response.body.id as string;
        }),
      );

      // One person ten days ago, three people two days ago: last week 1, this week 3.
      await test
        .http()
        .post('/v1/attendance')
        .set(auth)
        .send({
          project_id: projectId,
          attendance_date: isoDaysAgo(10),
          rows: [{ worker_id: workers[0], status: 'present' }],
        })
        .expect(201);

      await test
        .http()
        .post('/v1/attendance')
        .set(auth)
        .send({
          project_id: projectId,
          attendance_date: isoDaysAgo(2),
          rows: workers.map((id) => ({ worker_id: id, status: 'present' })),
        })
        .expect(201);

      const body = await overview();
      expect(body.headcount_trend.this_week).toBe(3);
      expect(body.headcount_trend.last_week).toBe(1);
      expect(body.headcount_trend.change_pct).toBe(200);

      // The chart itself still shows one week; the second week exists only to compare against.
      expect(body.headcount_series).toHaveLength(7);
    });
  });

  describe('wage periods', () => {
    it('counts a period whose end date has passed as overdue, not as closing soon', async () => {
      await test
        .http()
        .post('/v1/wage-periods/generate')
        .set(auth)
        .send({ period_start: isoDaysAgo(13), period_end: isoDaysAgo(6) })
        .expect(201);

      const body = await overview();
      expect(body.wage_periods.open_count).toBeGreaterThanOrEqual(1);
      // Wages are not paid until somebody finalises it, so a past end date is money owed today.
      expect(body.wage_periods.overdue_count).toBeGreaterThanOrEqual(1);
    });

    it('reports the days left on the next period that has not ended', async () => {
      await test
        .http()
        .post('/v1/wage-periods/generate')
        .set(auth)
        .send({ period_start: isoDaysAgo(2), period_end: isoDaysAgo(-3) })
        .expect(201);

      const body = await overview();
      expect(body.wage_periods.next_close).toBe(isoDaysAgo(-3));
      expect(body.wage_periods.days_to_close).toBe(3);
    });
  });

  describe('material overruns', () => {
    it('flags consumption past the estimate, and ignores stock that only arrived', async () => {
      const material = await test
        .http()
        .post('/v1/materials')
        .set(auth)
        .send({ name: `Cement ${Date.now()}`, unit: 'bag', category: 'cement' })
        .expect(201);
      const materialId = material.body.id as string;

      await test
        .http()
        .put(`/v1/stock/estimates/${projectId}`)
        .set(auth)
        .send({ items: [{ material_id: materialId, estimated_quantity: '100' }] })
        .expect(200);

      // 150 bags delivered. Nothing is over yet: it is in the store, not in the slab.
      await test
        .http()
        .post('/v1/stock/movements')
        .set(auth)
        .send({
          project_id: projectId,
          material_id: materialId,
          type: 'in',
          quantity: '150',
          moved_on: isoDaysAgo(1),
        })
        .expect(201);

      expect((await overview()).overruns).toHaveLength(0);

      // 120 used against an estimate of 100.
      await test
        .http()
        .post('/v1/stock/movements')
        .set(auth)
        .send({
          project_id: projectId,
          material_id: materialId,
          type: 'out',
          quantity: '120',
          moved_on: isoDaysAgo(1),
        })
        .expect(201);

      const body = await overview();
      const row = body.overruns.find(
        (item: { material_name: string }) => item.material_name === material.body.name,
      );
      expect(row).toBeDefined();
      expect(row.percent_used).toBe(120);
    });
  });
});
