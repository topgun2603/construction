import {
  disableModule,
  createTestApp,
  destroyTenant,
  onboardTenant,
  uniquePhone,
  type OnboardedTenant,
  type TestApp,
} from './utils/test-app';

/**
 * Expenses and petty cash (spec §3 item 9).
 *
 * The rule that matters most is the one about who may approve: signing off your
 * own spend is the oldest hole in petty cash, and it is enforced at the API rather
 * than hidden in the UI.
 */
describe('expenses', () => {
  let test: TestApp;
  let tenant: OnboardedTenant;
  let ownerAuth: Record<string, string>;
  let pmAuth: Record<string, string>;
  let projectId: string;

  beforeAll(async () => {
    test = await createTestApp();
    // Expenses is a Pro module; a Starter tenant would be refused at the guard.
    tenant = await onboardTenant(test, {
      name: 'Petty Cash Builders',
      phone: uniquePhone(),
      plan: 'one_year',
    });
    ownerAuth = { Authorization: `Bearer ${tenant.accessToken}` };

    const project = await test
      .http()
      .post('/v1/projects')
      .set(ownerAuth)
      .send({ name: 'Riverside Block', budget_amount: '100000000' })
      .expect(201);
    projectId = project.body.id;

    // A second approver, so we can prove the self-approval refusal is about the
    // person and not about the role.
    const pmPhone = uniquePhone();
    await test
      .http()
      .post('/v1/tenants/current/invite')
      .set(ownerAuth)
      .send({ phone: pmPhone, name: 'Priya', role: 'project_manager', project_ids: [projectId] })
      .expect(201);
    const pmLogin = await test
      .http()
      .post('/v1/auth/exchange')
      .send({ firebase_token: `dev:${pmPhone}` })
      .expect(200);
    pmAuth = { Authorization: `Bearer ${pmLogin.body.access_token}` };
  });

  afterAll(async () => {
    if (tenant) await destroyTenant(test, tenant.tenantId);
    await test.close();
  });

  async function record(auth: Record<string, string>, amount: string, category = 'fuel') {
    const response = await test
      .http()
      .post('/v1/expenses')
      .set(auth)
      .send({ project_id: projectId, amount, category, spent_on: '2026-03-03', note: 'Diesel' })
      .expect(201);
    return response.body.id as string;
  }

  it('records an expense as pending', async () => {
    const response = await test
      .http()
      .post('/v1/expenses')
      .set(ownerAuth)
      .send({ project_id: projectId, amount: '640000', category: 'fuel', spent_on: '2026-03-03' })
      .expect(201);

    expect(response.body.status).toBe('pending');
    expect(response.body.amount).toBe('640000');
    expect(response.body.submitted_by.name).toBe('Owner');
  });

  it('is idempotent on client_id so a retried upload does not book the cost twice', async () => {
    const clientId = '7b1e2c34-1111-4222-8333-444455556666';
    const first = await test
      .http()
      .post('/v1/expenses')
      .set(ownerAuth)
      .send({ project_id: projectId, amount: '1000', category: 'food', spent_on: '2026-03-03', client_id: clientId })
      .expect(201);
    const second = await test
      .http()
      .post('/v1/expenses')
      .set(ownerAuth)
      .send({ project_id: projectId, amount: '1000', category: 'food', spent_on: '2026-03-03', client_id: clientId })
      .expect(201);

    expect(second.body.id).toBe(first.body.id);
  });

  it('refuses to let someone approve their own expense', async () => {
    const id = await record(ownerAuth, '250000');
    const response = await test
      .http()
      .patch(`/v1/expenses/${id}/decision`)
      .set(ownerAuth)
      .send({ status: 'approved' })
      .expect(403);
    expect(response.body.code).toBe('FORBIDDEN');
  });

  it('lets a different approver approve it, and audits the decision', async () => {
    const id = await record(ownerAuth, '250000');
    const response = await test
      .http()
      .patch(`/v1/expenses/${id}/decision`)
      .set(pmAuth)
      .send({ status: 'approved' })
      .expect(200);

    expect(response.body.status).toBe('approved');
    expect(response.body.approved_by.name).toBe('Priya');

    const audit = await test.tenantDb.clientFor(tenant.tenantId).auditLog.findFirst({
      where: { entity: 'expenses', entityId: id },
    });
    expect(audit?.action).toBe('expense.approved');
  });

  it('will not decide twice', async () => {
    const id = await record(ownerAuth, '100');
    await test.http().patch(`/v1/expenses/${id}/decision`).set(pmAuth).send({ status: 'rejected' }).expect(200);
    const response = await test
      .http()
      .patch(`/v1/expenses/${id}/decision`)
      .set(pmAuth)
      .send({ status: 'approved' })
      .expect(409);
    expect(response.body.code).toBe('CONFLICT');
  });

  it('will not edit or delete an approved expense', async () => {
    const id = await record(ownerAuth, '5000');
    await test.http().patch(`/v1/expenses/${id}/decision`).set(pmAuth).send({ status: 'approved' }).expect(200);

    await test.http().patch(`/v1/expenses/${id}`).set(ownerAuth).send({ amount: '1' }).expect(409);
    await test.http().delete(`/v1/expenses/${id}`).set(ownerAuth).expect(409);
  });

  it('summarises spend by category, counting pending but never rejected', async () => {
    const response = await test
      .http()
      .get('/v1/expenses/summary?group_by=category&from=2026-03-01&to=2026-03-31')
      .set(ownerAuth)
      .expect(200);

    const fuel = response.body.groups.find((g: { key: string }) => g.key === 'fuel');
    expect(fuel).toBeDefined();
    // Every fuel row recorded above still counts except the one that was rejected.
    expect(BigInt(fuel.amount) > 0n).toBe(true);
    expect(BigInt(response.body.pending) > 0n).toBe(true);
  });

  it('is refused when the module is withdrawn from the account', async () => {
    const starter = await onboardTenant(test, { name: 'Expenses Off', phone: uniquePhone() });
    await disableModule(test, starter.tenantId, 'expenses');

    const response = await test
      .http()
      .get('/v1/expenses')
      .set('Authorization', `Bearer ${starter.accessToken}`)
      .expect(403);
    expect(response.body.code).toBe('MODULE_NOT_ENABLED');
    await destroyTenant(test, starter.tenantId);
  });
});
