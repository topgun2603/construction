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
 * The payment schedule and approvals (spec §3 item 13, the last two pieces).
 *
 * The money here is money coming *in*, and the tests that matter most are about the wall between it
 * and the money going out. The difference between the two is the margin on the job, and a client
 * who could see both would know exactly what their builder is making on them.
 */
describe('client billing and approvals', () => {
  let test: TestApp;
  let tenant: OnboardedTenant;
  let owner: Record<string, string>;
  let client: Record<string, string>;
  let supervisor: Record<string, string>;
  let projectId: string;
  let otherProjectId: string;

  async function sessionFor(name: string, role: string, projects: string[]) {
    const phone = uniquePhone();
    await test
      .http()
      .post('/v1/tenants/current/invite')
      .set(owner)
      .send({ name, phone, role, project_ids: projects })
      .expect(201);
    const session = await test
      .http()
      .post('/v1/auth/exchange')
      .send({ firebase_token: `dev:${phone}` })
      .expect(200);
    return { Authorization: `Bearer ${session.body.access_token}` };
  }

  beforeAll(async () => {
    test = await createTestApp();
    tenant = await onboardTenant(test, {
      name: 'Billing Builders',
      phone: uniquePhone(),
      plan: 'one_year',
    });
    owner = { Authorization: `Bearer ${tenant.accessToken}` };

    const project = await test
      .http()
      .post('/v1/projects')
      .set(owner)
      .send({ name: 'Lakeview Tower', budget_amount: '5000000000' })
      .expect(201);
    projectId = project.body.id;

    const other = await test
      .http()
      .post('/v1/projects')
      .set(owner)
      .send({ name: 'Not Their Job' })
      .expect(201);
    otherProjectId = other.body.id;

    client = await sessionFor('Vikram Shah', 'client', [projectId]);
    supervisor = await sessionFor('Ramesh Iyer', 'site_supervisor', [projectId]);
  });

  afterAll(async () => {
    if (tenant) await destroyTenant(test, tenant.tenantId);
    await test.close();
  });

  describe('the schedule', () => {
    let stageId: string;

    it('adds up what is owed, and starts with nothing received', async () => {
      const first = await test
        .http()
        .post(`/v1/projects/${projectId}/payment-schedule`)
        .set(owner)
        .send({ label: 'On signing', amount: '1000000000' })
        .expect(201);
      stageId = first.body.id;
      expect(first.body.status).toBe('upcoming');
      expect(first.body.paid).toBe('0');

      await test
        .http()
        .post(`/v1/projects/${projectId}/payment-schedule`)
        .set(owner)
        .send({ label: 'On completion of the slab', amount: '1500000000' })
        .expect(201);

      const schedule = await test
        .http()
        .get(`/v1/projects/${projectId}/payment-schedule`)
        .set(owner)
        .expect(200);
      expect(schedule.body.items).toHaveLength(2);
      expect(schedule.body.totals.scheduled).toBe('2500000000');
      expect(schedule.body.totals.outstanding).toBe('2500000000');
      // The contract figure, so a builder can see the schedule does not yet add up to it.
      expect(schedule.body.totals.budget).toBe('5000000000');
    });

    it('refuses an instalment for nothing', async () => {
      await test
        .http()
        .post(`/v1/projects/${projectId}/payment-schedule`)
        .set(owner)
        .send({ label: 'Goodwill', amount: '0' })
        .expect(422);
      await test
        .http()
        .post(`/v1/projects/${projectId}/payment-schedule`)
        .set(owner)
        .send({ label: 'Credit note', amount: '-500' })
        .expect(422);
    });

    it('moves an instalment through part-paid to paid as money arrives', async () => {
      await test
        .http()
        .post(`/v1/projects/${projectId}/payment-schedule/receipts`)
        .set(owner)
        .send({ amount: '400000000', received_on: '2026-03-01', stage_id: stageId, mode: 'bank' })
        .expect(201);

      let schedule = await test
        .http()
        .get(`/v1/projects/${projectId}/payment-schedule`)
        .set(owner)
        .expect(200);
      let stage = schedule.body.items.find((row: { id: string }) => row.id === stageId);
      expect(stage.status).toBe('part_paid');
      expect(stage.paid).toBe('400000000');
      expect(stage.outstanding).toBe('600000000');

      await test
        .http()
        .post(`/v1/projects/${projectId}/payment-schedule/receipts`)
        .set(owner)
        .send({ amount: '600000000', received_on: '2026-03-05', stage_id: stageId })
        .expect(201);

      schedule = await test
        .http()
        .get(`/v1/projects/${projectId}/payment-schedule`)
        .set(owner)
        .expect(200);
      stage = schedule.body.items.find((row: { id: string }) => row.id === stageId);
      expect(stage.status).toBe('paid');
      expect(stage.outstanding).toBe('0');
      expect(schedule.body.totals.received).toBe('1000000000');
    });

    it('counts a round sum that arrived against nothing in particular', async () => {
      // Most transfers land before anybody decides which instalment they were for.
      await test
        .http()
        .post(`/v1/projects/${projectId}/payment-schedule/receipts`)
        .set(owner)
        .send({ amount: '250000000', received_on: '2026-03-10' })
        .expect(201);

      const schedule = await test
        .http()
        .get(`/v1/projects/${projectId}/payment-schedule`)
        .set(owner)
        .expect(200);
      expect(schedule.body.totals.unallocated).toBe('250000000');
      expect(schedule.body.totals.received).toBe('1250000000');
      expect(schedule.body.totals.outstanding).toBe('1250000000');
    });

    it('never reports a negative balance when the client overpays', async () => {
      const extra = await test
        .http()
        .post('/v1/projects')
        .set(owner)
        .send({ name: 'Overpaid Villa' })
        .expect(201);
      await test
        .http()
        .post(`/v1/projects/${extra.body.id}/payment-schedule`)
        .set(owner)
        .send({ label: 'All of it', amount: '100000' })
        .expect(201);
      await test
        .http()
        .post(`/v1/projects/${extra.body.id}/payment-schedule/receipts`)
        .set(owner)
        .send({ amount: '150000', received_on: '2026-03-01' })
        .expect(201);

      const schedule = await test
        .http()
        .get(`/v1/projects/${extra.body.id}/payment-schedule`)
        .set(owner)
        .expect(200);
      // Money in hand, not a debt the builder owes back.
      expect(schedule.body.totals.outstanding).toBe('0');
    });

    it('will not delete an instalment money has landed against', async () => {
      const refused = await test
        .http()
        .delete(`/v1/payment-stages/${stageId}`)
        .set(owner)
        .expect(409);
      expect(refused.body.message).toMatch(/receipts/i);
    });

    it('stamps its own time when an instalment is raised, and does not move it on a re-raise', async () => {
      const created = await test
        .http()
        .post(`/v1/projects/${projectId}/payment-schedule`)
        .set(owner)
        .send({ label: 'On handover', amount: '500000' })
        .expect(201);
      expect(created.body.raised_at).toBeNull();

      const raised = await test
        .http()
        .patch(`/v1/payment-stages/${created.body.id}`)
        .set(owner)
        .send({ raised: true })
        .expect(200);
      expect(raised.body.raised_at).not.toBeNull();
      expect(raised.body.status).toBe('due');

      // Raising again must not re-date a demand somebody already made.
      const again = await test
        .http()
        .patch(`/v1/payment-stages/${created.body.id}`)
        .set(owner)
        .send({ raised: true })
        .expect(200);
      expect(again.body.raised_at).toBe(raised.body.raised_at);
    });

    it('does not post the same receipt twice when a phone retries', async () => {
      const body = {
        amount: '111',
        received_on: '2026-03-02',
        client_id: '55555555-6666-4777-8888-999999999999',
      };
      const first = await test
        .http()
        .post(`/v1/projects/${projectId}/payment-schedule/receipts`)
        .set(owner)
        .send(body)
        .expect(201);
      const second = await test
        .http()
        .post(`/v1/projects/${projectId}/payment-schedule/receipts`)
        .set(owner)
        .send(body)
        .expect(201);
      expect(second.body.id).toBe(first.body.id);
    });

    it('refuses a receipt filed against another site s instalment', async () => {
      // It would move money between two clients' balances in one call.
      await test
        .http()
        .post(`/v1/projects/${otherProjectId}/payment-schedule/receipts`)
        .set(owner)
        .send({ amount: '1000', received_on: '2026-03-01', stage_id: stageId })
        .expect(404);
    });
  });

  describe('who may see the money', () => {
    it('lets the client see what they owe on their own site', async () => {
      const schedule = await test
        .http()
        .get(`/v1/projects/${projectId}/payment-schedule`)
        .set(client)
        .expect(200);
      expect(schedule.body.items.length).toBeGreaterThan(0);
    });

    it('keeps the client out of a site they are not on', async () => {
      await test
        .http()
        .get(`/v1/projects/${otherProjectId}/payment-schedule`)
        .set(client)
        .expect(403);
    });

    it('does not let the client write their own schedule or receipt their own money', async () => {
      await test
        .http()
        .post(`/v1/projects/${projectId}/payment-schedule`)
        .set(client)
        .send({ label: 'A discount', amount: '1' })
        .expect(403);
      await test
        .http()
        .post(`/v1/projects/${projectId}/payment-schedule/receipts`)
        .set(client)
        .send({ amount: '9999999999', received_on: '2026-03-01' })
        .expect(403);
    });

    it('shows a supervisor nothing at all', async () => {
      /*
       * The one that matters most after the client wall.
       *
       * A supervisor is on this site and records petty cash against it, so every project-access
       * check passes for them. What the client owes is still none of their business, and the only
       * thing standing between them and it is that `client_payments.view` is not in their preset.
       */
      await test
        .http()
        .get(`/v1/projects/${projectId}/payment-schedule`)
        .set(supervisor)
        .expect(403);
    });

    it('never exposes what the job costs to build through this route', async () => {
      // Expenses and labour payments are the other side of the ledger, and the client has neither
      // permission. Asserted here because it is this feature that puts them one URL apart.
      const me = await test.http().get('/v1/me').set(client).expect(200);
      expect(me.body.permissions).toContain('client_payments.view');
      expect(me.body.permissions).not.toContain('expenses.view');
      expect(me.body.permissions).not.toContain('payments.view');
      expect(me.body.permissions).not.toContain('wages.view');

      await test.http().get('/v1/expenses').set(client).expect(403);
      await test.http().get('/v1/labour-payments').set(client).expect(403);
    });
  });

  describe('approvals', () => {
    let approvalId: string;

    it('lets the site ask and names who asked', async () => {
      const asked = await test
        .http()
        .post(`/v1/projects/${projectId}/approvals`)
        .set(supervisor)
        .send({ title: 'Bathroom tile — the darker one?', body: 'Sample is on the second floor.' })
        .expect(201);
      approvalId = asked.body.id;
      expect(asked.body.status).toBe('pending');
      expect(asked.body.requested_by.name).toBe('Ramesh Iyer');
      expect(asked.body.decided_by).toBeNull();
    });

    it('does not let a supervisor answer their own question', async () => {
      // `approvals.request` is asking. Answering is `approvals.decide`, which they do not have.
      await test
        .http()
        .patch(`/v1/approvals/${approvalId}`)
        .set(supervisor)
        .send({ status: 'approved' })
        .expect(403);
    });

    it('records the client s decision against their name and role', async () => {
      const decided = await test
        .http()
        .patch(`/v1/approvals/${approvalId}`)
        .set(client)
        .send({ status: 'approved', note: 'Yes, the darker one.' })
        .expect(200);
      expect(decided.body.status).toBe('approved');
      expect(decided.body.decided_by.name).toBe('Vikram Shah');
      // The role travels with the name, so a decision recorded by the builder on the client's
      // behalf can never read as the client having given it themselves.
      expect(decided.body.decided_by.role).toBe('client');
      expect(decided.body.decided_at).not.toBeNull();
    });

    it('refuses to let a decision be overwritten', async () => {
      const refused = await test
        .http()
        .patch(`/v1/approvals/${approvalId}`)
        .set(owner)
        .send({ status: 'rejected' })
        .expect(409);
      expect(refused.body.message).toMatch(/already been decided/i);
    });

    it('will not let a decided approval be withdrawn', async () => {
      await test.http().delete(`/v1/approvals/${approvalId}`).set(owner).expect(409);
    });

    it('withdraws one nobody has answered', async () => {
      const asked = await test
        .http()
        .post(`/v1/projects/${projectId}/approvals`)
        .set(owner)
        .send({ title: 'Asked by mistake' })
        .expect(201);
      await test.http().delete(`/v1/approvals/${asked.body.id}`).set(owner).expect(204);
    });

    it('refuses to ask about a drawing the client cannot open', async () => {
      /*
       * Asking somebody to approve a document they cannot see is asking them to sign blind — and
       * sharing it automatically would be a share nobody chose, on a table whose whole default is
       * that nothing reaches the client unless somebody says so.
       */
      const presigned = await test
        .http()
        .post('/v1/uploads/presign')
        .set(owner)
        .send({
          kind: 'document',
          content_type: 'application/pdf',
          content_length: 2000,
          project_id: projectId,
        })
        .expect(200);
      const hidden = await test
        .http()
        .post('/v1/documents')
        .set(owner)
        .send({
          project_id: projectId,
          title: 'Internal costing',
          category: 'other',
          s3_key: presigned.body.s3_key,
          content_type: 'application/pdf',
          size_bytes: 2000,
        })
        .expect(201);
      expect(hidden.body.visible_to_client).toBe(false);

      const refused = await test
        .http()
        .post(`/v1/projects/${projectId}/approvals`)
        .set(owner)
        .send({ title: 'Approve this', document_id: hidden.body.id })
        .expect(409);
      expect(refused.body.message).toMatch(/share that document/i);

      // Shared, it goes through and comes back with a signed link.
      await test
        .http()
        .patch(`/v1/documents/${hidden.body.id}`)
        .set(owner)
        .send({ visible_to_client: true })
        .expect(200);
      const asked = await test
        .http()
        .post(`/v1/projects/${projectId}/approvals`)
        .set(owner)
        .send({ title: 'Approve this', document_id: hidden.body.id })
        .expect(201);
      expect(asked.body.document.url).toContain('http');
    });

    it('shows waiting ones first, because the list exists to be cleared', async () => {
      const list = await test
        .http()
        .get(`/v1/approvals?project_id=${projectId}`)
        .set(owner)
        .expect(200);
      // The enum is declared pending, approved, rejected, and Postgres sorts by that order — so
      // ascending puts the unanswered ones on top, which is the whole intent.
      const statuses = list.body.items.map((row: { status: string }) => row.status);
      expect(statuses[0]).toBe('pending');
      expect(statuses).toContain('approved');
    });

    it('keeps a client out of approvals on a site they are not on', async () => {
      await test
        .http()
        .post(`/v1/projects/${otherProjectId}/approvals`)
        .set(client)
        .send({ title: 'not mine' })
        .expect(403);
    });
  });

  it('is refused when the module is withdrawn from the account', async () => {
    const starter = await onboardTenant(test, { name: 'Billing Off', phone: uniquePhone() });
    await disableModule(test, starter.tenantId, 'client_portal');

    try {
      const project = await test
        .http()
        .post('/v1/projects')
        .set({ Authorization: `Bearer ${starter.accessToken}` })
        .send({ name: 'Small Job' })
        .expect(201);
      const refused = await test
        .http()
        .get(`/v1/projects/${project.body.id}/payment-schedule`)
        .set({ Authorization: `Bearer ${starter.accessToken}` })
        .expect(403);
      expect(refused.body.code).toBe('MODULE_NOT_ENABLED');
    } finally {
      await destroyTenant(test, starter.tenantId);
    }
  });
});
