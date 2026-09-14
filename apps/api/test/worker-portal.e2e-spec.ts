import {
  createTestApp,
  destroyTenant,
  onboardTenant,
  uniquePhone,
  type OnboardedTenant,
  type TestApp,
} from './utils/test-app';

/**
 * A worker's own record, opened from a link (spec §3 item 15).
 *
 * The reader has no account, so the token *is* the credential and the tests that matter are the
 * ones about what it cannot do: name a different worker, reach a different tenant, or keep working
 * after the worker has been taken off the books.
 */
describe('worker self-service', () => {
  let test: TestApp;
  let builder: OnboardedTenant;
  let other: OnboardedTenant;
  let workerId: string;
  let projectId: string;
  let link: string;

  const auth = () => ({ Authorization: `Bearer ${builder.accessToken}` });

  beforeAll(async () => {
    test = await createTestApp();
    builder = await onboardTenant(test, { name: 'Link Builders', phone: uniquePhone() });
    other = await onboardTenant(test, { name: 'Other Builders', phone: uniquePhone() });

    const project = await test
      .http()
      .post('/v1/projects')
      .set(auth())
      .send({ name: 'Lakeview Tower' })
      .expect(201);
    projectId = project.body.id;

    const worker = await test
      .http()
      .post('/v1/workers')
      .set(auth())
      .send({
        name: 'Raju M',
        phone: '9876500011',
        trade: 'Mason',
        daily_wage: '85000',
        skill_level: 'skilled',
        project_id: projectId,
        from_date: '2026-09-01',
      })
      .expect(201);
    workerId = worker.body.id;

    await test
      .http()
      .post('/v1/attendance')
      .set(auth())
      .send({
        project_id: projectId,
        attendance_date: '2026-09-02',
        rows: [{ worker_id: workerId, status: 'present', overtime_hours: '0' }],
      })
      .expect(201);

    await test
      .http()
      .post('/v1/labour-payments')
      .set(auth())
      .send({
        type: 'advance',
        amount: '20000',
        paid_on: '2026-09-03',
        mode: 'cash',
        worker_id: workerId,
        project_id: projectId,
      })
      .expect(201);

    const minted = await test
      .http()
      .post(`/v1/workers/${workerId}/self-service-link`)
      .set(auth())
      .expect(201);
    link = minted.body.url.split('/w/')[1];
  });

  afterAll(async () => {
    if (builder) await destroyTenant(test, builder.tenantId);
    if (other) await destroyTenant(test, other.tenantId);
    await test.close();
  });

  it('shows the worker their own days and money, with no session at all', async () => {
    const response = await test
      .http()
      .get('/v1/worker-portal/summary')
      .query({ token: link })
      .expect(200);

    expect(response.body.worker.name).toBe('Raju M');
    expect(response.body.company.name).toBe('Link Builders');
    expect(response.body.totals.days_present).toBe(1);

    // Earned ₹850 for the day, drew ₹200 against it. The arithmetic runs through the same function
    // the wage sheet uses, so a worker is never shown a figure that disagrees with their pay.
    expect(response.body.totals.earned).toBe('85000');
    expect(response.body.totals.drawn).toBe('20000');
    expect(response.body.totals.balance).toBe('65000');
  });

  it('shows nothing beyond that one worker', async () => {
    const response = await test
      .http()
      .get('/v1/worker-portal/summary')
      .query({ token: link })
      .expect(200);

    const body = JSON.stringify(response.body);
    // Not the site budget, not another tenant, not an id anybody could walk back to a session.
    expect(body).not.toContain(other.tenantId);
    expect(body).not.toContain('budget');
    expect(response.body).not.toHaveProperty('access_token');
  });

  it('refuses a token that was not signed for this purpose', async () => {
    // A tenant session is a perfectly valid JWT from the same secret. The audience is what stops
    // it being replayed here, and that check is the signature's, not a claim this code inspects.
    await test
      .http()
      .get('/v1/worker-portal/summary')
      .query({ token: builder.accessToken })
      .expect(401);

    await test
      .http()
      .get('/v1/worker-portal/summary')
      .query({ token: `${link}tampered` })
      .expect(401);
  });

  it('stops working when the worker comes off the books', async () => {
    const doomed = await test
      .http()
      .post('/v1/workers')
      .set(auth())
      .send({ name: 'Gone Soon', daily_wage: '50000', skill_level: 'unskilled' })
      .expect(201);

    const minted = await test
      .http()
      .post(`/v1/workers/${doomed.body.id}/self-service-link`)
      .set(auth())
      .expect(201);
    const token = minted.body.url.split('/w/')[1];

    await test.http().get('/v1/worker-portal/summary').query({ token }).expect(200);

    await test.http().delete(`/v1/workers/${doomed.body.id}`).set(auth()).expect(204);

    // No revocation list and no row to clean up: the reader checks the worker still exists, which
    // covers every case a list of dead tokens would have.
    await test.http().get('/v1/worker-portal/summary').query({ token }).expect(404);
  });

  it('cannot be minted by somebody who may not see the money', async () => {
    // The link discloses exactly the ledger, so it sits behind the same permission the ledger does.
    await test
      .http()
      .post(`/v1/workers/${workerId}/self-service-link`)
      .set({ Authorization: `Bearer ${other.accessToken}` })
      .expect(404);
  });
});
