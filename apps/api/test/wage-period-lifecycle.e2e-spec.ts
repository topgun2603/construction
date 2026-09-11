import {
  createTestApp,
  destroyTenant,
  onboardTenant,
  uniquePhone,
  type OnboardedTenant,
  type TestApp,
} from './utils/test-app';

/**
 * Discarding and reopening a wage period.
 *
 * Both exist because the nightly job drafts periods unattended: a sheet nobody asked for has
 * to be removable, and one finalised by mistake has to be recoverable.
 *
 * The test that matters most is the advance release. Finalising stamps every advance it
 * deducted with the period's id, which is what stops the same money being deducted twice.
 * Reopening without clearing those stamps would leave the worker's advance consumed by a sheet
 * that no longer deducts anything — taken off once, never credited back, and invisible.
 */
describe('wage period lifecycle', () => {
  let test: TestApp;
  let tenant: OnboardedTenant;
  let owner: Record<string, string>;
  let projectId: string;
  let workerId: string;

  beforeAll(async () => {
    test = await createTestApp();
    tenant = await onboardTenant(test, { name: 'Lifecycle Builders', phone: uniquePhone() });
    owner = { Authorization: `Bearer ${tenant.accessToken}` };

    const project = await test
      .http()
      .post('/v1/projects')
      .set(owner)
      .send({ name: 'Lifecycle Site' })
      .expect(201);
    projectId = project.body.id;

    const worker = await test
      .http()
      .post('/v1/workers')
      .set(owner)
      .send({ name: 'Lifecycle Worker', trade: 'mason', skill_level: 'skilled', daily_wage: '100000' })
      .expect(201);
    workerId = worker.body.id;

    await test
      .http()
      .post(`/v1/workers/${workerId}/assign`)
      .set(owner)
      .send({ project_id: projectId, from_date: '2026-10-01' })
      .expect(201);
  });

  afterAll(async () => {
    if (tenant) await destroyTenant(test, tenant.tenantId);
    await test.close();
  });

  async function markPresent(date: string) {
    await test
      .http()
      .post('/v1/attendance')
      .set(owner)
      .send({
        project_id: projectId,
        attendance_date: date,
        rows: [{ worker_id: workerId, status: 'present', overtime_hours: '0' }],
      })
      .expect(201);
  }

  async function generate(from: string, to: string) {
    const response = await test
      .http()
      .post('/v1/wage-periods/generate')
      .set(owner)
      .send({ period_start: from, period_end: to })
      .expect(201);
    return response.body.id as string;
  }

  it('records who asked for the period', async () => {
    await markPresent('2026-10-01');
    const id = await generate('2026-10-01', '2026-10-07');

    const response = await test.http().get(`/v1/wage-periods/${id}`).set(owner).expect(200);
    // A person generated this one, so it must not claim the scheduler did.
    expect(response.body.source).toBe('manual');

    await test.http().delete(`/v1/wage-periods/${id}`).set(owner).expect(204);
  });

  it('discards an open period and frees the dates', async () => {
    await markPresent('2026-10-08');
    const id = await generate('2026-10-08', '2026-10-14');

    await test.http().delete(`/v1/wage-periods/${id}`).set(owner).expect(204);
    await test.http().get(`/v1/wage-periods/${id}`).set(owner).expect(404);

    // Gone rather than hidden, so the same window can be generated again.
    const again = await generate('2026-10-08', '2026-10-14');
    expect(again).not.toBe(id);
    await test.http().delete(`/v1/wage-periods/${again}`).set(owner).expect(204);
  });

  it('refuses to discard a finalised period', async () => {
    await markPresent('2026-10-15');
    const id = await generate('2026-10-15', '2026-10-21');
    await test.http().post(`/v1/wage-periods/${id}/finalise`).set(owner).expect(201);

    const refused = await test.http().delete(`/v1/wage-periods/${id}`).set(owner).expect(409);
    expect(refused.body.message).toMatch(/open period can be discarded/i);
  });

  it('reopens an unpaid period and gives the advances back', async () => {
    await markPresent('2026-10-22');
    await markPresent('2026-10-23');

    // An advance the worker has taken but not yet worked off.
    const advance = await test
      .http()
      .post('/v1/labour-payments')
      .set(owner)
      .send({
        project_id: projectId,
        worker_id: workerId,
        type: 'advance',
        amount: '50000',
        paid_on: '2026-10-22',
        mode: 'cash',
      })
      .expect(201);

    const id = await generate('2026-10-22', '2026-10-28');

    const draft = await test.http().get(`/v1/wage-periods/${id}`).set(owner).expect(200);
    // Two days at ₹1,000 less the ₹500 advance.
    expect(draft.body.total_earned).toBe('200000');
    expect(draft.body.total_advances).toBe('50000');

    await test.http().post(`/v1/wage-periods/${id}/finalise`).set(owner).expect(201);

    // Finalising consumes the advance: it is now attached to this sheet, so a second sheet
    // cannot deduct it again.
    const afterFinalise = await test
      .http()
      .get(`/v1/labour-payments?worker_id=${workerId}`)
      .set(owner)
      .expect(200);
    const stamped = afterFinalise.body.items.find(
      (row: { id: string }) => row.id === advance.body.id,
    );
    expect(stamped.wage_period_id).toBe(id);

    const reopened = await test
      .http()
      .post(`/v1/wage-periods/${id}/reopen`)
      .set(owner)
      .expect(201);
    expect(reopened.body.status).toBe('open');

    /*
     * The advance is unstamped. Without this it would be owed by nobody: deducted on a sheet
     * that has been reopened and no longer deducts it, and invisible to the next one.
     */
    const afterReopen = await test
      .http()
      .get(`/v1/labour-payments?worker_id=${workerId}`)
      .set(owner)
      .expect(200);
    const released = afterReopen.body.items.find(
      (row: { id: string }) => row.id === advance.body.id,
    );
    expect(released.wage_period_id).toBeNull();

    // And it is deducted again when the period is regenerated, not silently dropped.
    await test
      .http()
      .post('/v1/wage-periods/generate')
      .set(owner)
      .send({ period_start: '2026-10-22', period_end: '2026-10-28' })
      .expect(201);
    const regenerated = await test.http().get(`/v1/wage-periods/${id}`).set(owner).expect(200);
    expect(regenerated.body.total_advances).toBe('50000');
  });

  it('unlocks attendance once reopened', async () => {
    await markPresent('2026-11-02');
    const id = await generate('2026-11-01', '2026-11-07');
    await test.http().post(`/v1/wage-periods/${id}/finalise`).set(owner).expect(201);

    // Finalised, so the day is frozen.
    const locked = await test
      .http()
      .post('/v1/attendance')
      .set(owner)
      .send({
        project_id: projectId,
        attendance_date: '2026-11-02',
        rows: [{ worker_id: workerId, status: 'half_day', overtime_hours: '0' }],
      })
      .expect(409);
    expect(locked.body.code).toBe('PERIOD_FINALISED');

    await test.http().post(`/v1/wage-periods/${id}/reopen`).set(owner).expect(201);

    // Reopened, so the correction the whole feature exists for is now possible.
    await test
      .http()
      .post('/v1/attendance')
      .set(owner)
      .send({
        project_id: projectId,
        attendance_date: '2026-11-02',
        rows: [{ worker_id: workerId, status: 'half_day', overtime_hours: '0' }],
      })
      .expect(201);
  });

  it('refuses to reopen once money has been paid', async () => {
    await markPresent('2026-11-10');
    const id = await generate('2026-11-08', '2026-11-14');
    await test.http().post(`/v1/wage-periods/${id}/finalise`).set(owner).expect(201);

    await test
      .http()
      .post(`/v1/wage-periods/${id}/pay`)
      .set(owner)
      .send({ worker_id: workerId, amount: '50000', paid_on: '2026-11-15', mode: 'cash' })
      .expect(201);

    // The sheet is now the record of what was paid against what.
    const refused = await test
      .http()
      .post(`/v1/wage-periods/${id}/reopen`)
      .set(owner)
      .expect(409);
    expect(refused.body.message).toMatch(/already been paid/i);
  });
});
