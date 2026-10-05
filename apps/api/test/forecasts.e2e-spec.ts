import { addDays, todayIn } from '@sitebook/shared';
import {
  createTestApp,
  destroyTenant,
  onboardTenant,
  uniquePhone,
  type OnboardedTenant,
  type TestApp,
} from './utils/test-app';

/**
 * Overrun early warning, through the API.
 *
 * A site with a budget, two weeks of labour that got dearer, and an expense: the forecast must be
 * worked out from those records, say why in the company's currency, and stay inside the company.
 */
describe('cost forecasts', () => {
  let test: TestApp;
  let alpha: OnboardedTenant;
  let beta: OnboardedTenant;
  let auth: { Authorization: string };
  let projectId: string;
  const today = todayIn('Asia/Kolkata');

  beforeAll(async () => {
    test = await createTestApp();
    alpha = await onboardTenant(test, { name: 'Forecast Builders', phone: uniquePhone() });
    beta = await onboardTenant(test, { name: 'Nosy Builders', phone: uniquePhone() });
    auth = { Authorization: `Bearer ${alpha.accessToken}` };

    const start = addDays(today, -27);
    const project = await test
      .http()
      .post('/v1/projects')
      .set(auth)
      .send({
        name: 'Anna Nagar Villa',
        status: 'active',
        // ₹60,000 budget for 60 days; ₹33,000 gone in the first 28 is a pace that ends near ₹70,700.
        budget_amount: '6000000',
        start_date: start,
        target_end_date: addDays(start, 59),
      })
      .expect(201);
    projectId = project.body.id;

    const worker = await test
      .http()
      .post('/v1/workers')
      .set(auth)
      .send({
        name: 'Raju',
        trade: 'mason',
        daily_wage: '100000',
        project_id: projectId,
        from_date: start,
      })
      .expect(201);

    // Every day for four weeks.
    for (let day = 0; day < 28; day += 1) {
      await test
        .http()
        .post('/v1/attendance')
        .set(auth)
        .send({
          project_id: projectId,
          attendance_date: addDays(start, day),
          rows: [{ worker_id: worker.body.id, status: 'present' }],
        })
        .expect(201);
    }
    await test
      .http()
      .post('/v1/expenses')
      .set(auth)
      .send({ project_id: projectId, amount: '500000', category: 'fuel', spent_on: today })
      .expect(201);
  });

  afterAll(async () => {
    await destroyTenant(test, alpha.tenantId);
    await destroyTenant(test, beta.tenantId);
    await test.close();
  });

  it('works out a forecast from the site’s own records', async () => {
    const { body } = await test
      .http()
      .get(`/v1/projects/${projectId}/forecast`)
      .set(auth)
      .expect(200);

    expect(body.method).toBe('burn_rate');
    // 28 days of ₹1,000 wages plus ₹5,000 of fuel, then the same pace for the 32 days left.
    expect(body.spent).toBe('3300000');
    expect(body.forecast).toBe('7071428');
    expect(body.overrun_pct).toBe(17);
    expect(body.severity).toBe('critical');
    expect(body.explanation).toMatch(/₹.* budget/);
    expect(body.explained_by).toBe('template');
  });

  it('lists the site among the company’s forecasts, and refreshes on demand', async () => {
    const list = await test.http().get('/v1/forecasts').set(auth).expect(200);
    expect(list.body.map((f: { project_id: string }) => f.project_id)).toContain(projectId);

    const refreshed = await test
      .http()
      .post(`/v1/projects/${projectId}/forecast/refresh`)
      .set(auth)
      .expect(201);
    expect(refreshed.body.as_of).toBe(today);
  });

  it('never shows one company another company’s forecast', async () => {
    const other = { Authorization: `Bearer ${beta.accessToken}` };
    await test.http().get(`/v1/projects/${projectId}/forecast`).set(other).expect(404);
    const list = await test.http().get('/v1/forecasts').set(other).expect(200);
    expect(list.body).toEqual([]);
  });
});
