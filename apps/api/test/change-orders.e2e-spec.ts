import { todayIn } from '@sitebook/shared';
import {
  createTestApp,
  destroyTenant,
  onboardTenant,
  uniquePhone,
  type OnboardedTenant,
  type TestApp,
} from './utils/test-app';

type Auth = { Authorization: string };

/**
 * Change orders (roadmap Phase 2, module 4): raising and pricing one against cost codes, the
 * internal sign-off, the client's answer through the existing portal approvals, a rejection and a
 * revision, and what a yes moves — cost code budgets (with a revision row each), the site's
 * handover date and its contract value. Plus the scope-creep catcher, with no AI key.
 *
 * Money below is minor units: 500000 is ₹5,000.00.
 */
describe('change orders', () => {
  let test: TestApp;
  let alpha: OnboardedTenant;
  let beta: OnboardedTenant;
  let owner: Auth;
  let pm: Auth;
  let supervisor: Auth;
  let accounts: Auth;
  let client: Auth;
  let stranger: Auth;
  let site: string;
  let otherSite: string;
  let otherSiteCode: string;
  let changeOrder: string;
  let firstApproval: string;
  let secondApproval: string;
  const codes = new Map<string, string>();
  const today = todayIn('Asia/Kolkata');

  const http = () => test.http();
  const detail = async (id = changeOrder, who: Auth = owner) =>
    (await http().get(`/v1/change-orders/${id}`).set(who).expect(200)).body;
  const budgets = async () => {
    const report = (await http().get(`/v1/projects/${site}/cost-report`).set(owner).expect(200)).body as {
      lines: Array<{ code: string; own: { budget: string }; approved_changes: { own: string; total: string } }>;
      approved_changes: string;
    };
    return report;
  };

  async function invite(role: string, projectIds: string[], name = `A ${role}`): Promise<Auth> {
    const phone = uniquePhone();
    await http()
      .post('/v1/tenants/current/invite')
      .set(owner)
      .send({ phone, name, role, project_ids: projectIds })
      .expect(201);
    const login = await http().post('/v1/auth/exchange').send({ firebase_token: `dev:${phone}` }).expect(200);
    return { Authorization: `Bearer ${login.body.access_token}` };
  }

  beforeAll(async () => {
    test = await createTestApp();
    alpha = await onboardTenant(test, { name: 'Variation Builders', phone: uniquePhone() });
    beta = await onboardTenant(test, { name: 'Nosy Builders', phone: uniquePhone() });
    owner = { Authorization: `Bearer ${alpha.accessToken}` };
    stranger = { Authorization: `Bearer ${beta.accessToken}` };

    site = (
      await http()
        .post('/v1/projects')
        .set(owner)
        .send({
          name: 'Lake View Villa',
          status: 'active',
          start_date: '2026-06-01',
          target_end_date: '2027-03-31',
          budget_amount: '8000000000',
        })
        .expect(201)
    ).body.id;
    otherSite = (await http().post('/v1/projects').set(owner).send({ name: 'Hill View', status: 'active' }).expect(201))
      .body.id;
    for (const [code, name, budget] of [
      ['01', 'Civil', '0'],
      ['01.10', 'Brickwork', '1000000'],
      ['02', 'Electrical', '500000'],
    ] as const) {
      const made = await http()
        .post(`/v1/projects/${site}/cost-codes`)
        .set(owner)
        .send({ code, name, budget, ...(code === '01.10' ? { parent_id: codes.get('01') } : {}) })
        .expect(201);
      codes.set(code, made.body.id);
    }
    otherSiteCode = (
      await http().post(`/v1/projects/${otherSite}/cost-codes`).set(owner).send({ code: '09', name: 'Elsewhere' }).expect(201)
    ).body.id;

    pm = await invite('project_manager', [site]);
    supervisor = await invite('site_supervisor', [site]);
    accounts = await invite('accounts', []);
    client = await invite('client', [site], 'Vikram Shah');
  });

  afterAll(async () => {
    if (alpha) await destroyTenant(test, alpha.tenantId);
    if (beta) await destroyTenant(test, beta.tenantId);
    await test.close();
  });

  it('records the contract value as signed, which change orders then revise', async () => {
    const summary = await http()
      .put(`/v1/projects/${site}/contract-value`)
      .set(owner)
      .send({ contract_value: '100000000' })
      .expect(200);
    expect(summary.body).toMatchObject({
      contract_value: '100000000',
      approved_changes: '0',
      revised_contract_value: '100000000',
      original_handover: '2027-03-31',
      handover: '2027-03-31',
    });
    // Setting the contract is managing change orders; accounts only reads.
    await http().put(`/v1/projects/${site}/contract-value`).set(accounts).send({ contract_value: '1' }).expect(403);
  });

  it('raises a change order with lines against cost codes and works out cost, price and tax', async () => {
    const base = {
      project_id: site,
      title: 'Extra partition wall and two light points',
      description: 'Client wants the study split into two rooms.',
      reason: 'client_request',
      markup_bp: 1500,
      time_impact_days: 7,
      lines: [
        { description: 'Brick partition 115mm', unit: 'm2', quantity: '10', rate: '50000', cost_code_id: codes.get('01.10') },
        { description: 'Two light points with wiring', amount: '200000', cost_code_id: codes.get('02') },
        { description: 'Omit one fan point', amount: '-100000', cost_code_id: codes.get('02') },
      ],
    };
    // A cost code from another site is refused rather than quietly moving that site's budget.
    await http()
      .post('/v1/change-orders')
      .set(pm)
      .send({ ...base, lines: [{ description: 'x', amount: '1', cost_code_id: otherSiteCode }] })
      .expect(422);
    // A quantity without a rate is neither measured nor a lump sum.
    await http()
      .post('/v1/change-orders')
      .set(pm)
      .send({ ...base, lines: [{ description: 'x', quantity: '2' }] })
      .expect(422);

    const made = await http().post('/v1/change-orders').set(pm).send(base).expect(201);
    changeOrder = made.body.id;
    expect(made.body).toMatchObject({
      label: 'CO-001',
      status: 'draft',
      raised_on: today,
      cost_impact: '600000',
      client_price: '690000',
      margin: '90000',
      // India's GST is never guessed: no rate unless one is given.
      tax_rate_bp: 0,
      tax: '0',
      client_total: '690000',
      time_impact_days: 7,
    });
    expect(made.body.lines).toHaveLength(3);
    expect(made.body.lines[0]).toMatchObject({ quantity: '10', rate: '50000', amount: '500000' });
    expect(made.body.lines[0].cost_code.code).toBe('01.10');
  });

  it('recalculates a draft as it is edited, tax included', async () => {
    const edited = await http()
      .patch(`/v1/change-orders/${changeOrder}`)
      .set(pm)
      .send({ tax_rate_bp: 1800, markup_bp: 2000 })
      .expect(200);
    expect(edited.body).toMatchObject({ client_price: '720000', tax: '129600', client_total: '849600' });
  });

  it('keeps change orders from people who cannot see the margin', async () => {
    await http().get('/v1/change-orders').set(supervisor).expect(403);
    await http().get(`/v1/change-orders/${changeOrder}`).set(client).expect(403);
    await http().post('/v1/change-orders').set(accounts).send({ project_id: site, title: 'x', reason: 'design_change' }).expect(403);
    const read = await http().get('/v1/change-orders').set(accounts).expect(200);
    expect(read.body.items.map((row: { id: string }) => row.id)).toContain(changeOrder);
  });

  it('needs somebody else to approve it, and can be returned with a reason', async () => {
    const submitted = await http().post(`/v1/change-orders/${changeOrder}/submit`).set(pm).expect(200);
    expect(submitted.body.status).toBe('submitted');
    // Fixed once submitted: what is being approved cannot change underneath the approver.
    await http().patch(`/v1/change-orders/${changeOrder}`).set(pm).send({ markup_bp: 0 }).expect(409);
    // The PM holds the permission, but not for their own.
    await http().post(`/v1/change-orders/${changeOrder}/approve`).set(pm).send({}).expect(403);

    const returned = await http()
      .post(`/v1/change-orders/${changeOrder}/return`)
      .set(owner)
      .send({ note: 'Attach the client’s sketch' })
      .expect(200);
    expect(returned.body).toMatchObject({ status: 'draft', review_note: 'Attach the client’s sketch' });
    await http().post(`/v1/change-orders/${changeOrder}/submit`).set(pm).expect(200);
  });

  it('sends it to the client as a portal approval showing price and days, never cost', async () => {
    const sent = await http().post(`/v1/change-orders/${changeOrder}/approve`).set(owner).send({ note: 'OK' }).expect(200);
    expect(sent.body.status).toBe('sent');
    expect(sent.body.approval.status).toBe('pending');
    firstApproval = sent.body.approval.id;

    const theirs = await http().get(`/v1/approvals?project_id=${site}`).set(client).expect(200);
    const approval = theirs.body.items.find((row: { id: string }) => row.id === firstApproval);
    expect(approval.title).toBe('Change order CO-001: Extra partition wall and two light points');
    expect(approval.body).toContain('Adds 7 days to the handover date');
    expect(approval.change_order).toMatchObject({
      label: 'CO-001',
      client_price: '720000',
      tax: '129600',
      client_total: '849600',
      time_impact_days: 7,
    });
    expect(approval.change_order.items[0]).toEqual({ description: 'Brick partition 115mm', quantity: '10', unit: 'm2' });
    // The cost and the margin are the builder's business.
    expect(JSON.stringify(approval.change_order)).not.toMatch(/cost|margin|600000|amount/);

    // Withdrawing it is cancelling the change order, never pulling the approval from under it.
    await http().delete(`/v1/approvals/${firstApproval}`).set(owner).expect(409);
  });

  it('takes a rejection from the client and is revised for a second try', async () => {
    const before = await budgets();
    const rejected = await http()
      .patch(`/v1/approvals/${firstApproval}`)
      .set(client)
      .send({ status: 'rejected', note: 'Too expensive — can you do it for 6,500?' })
      .expect(200);
    expect(rejected.body.decided_by.role).toBe('client');

    const row = await detail();
    expect(row).toMatchObject({ status: 'rejected', client_note: 'Too expensive — can you do it for 6,500?', applied_at: null });
    expect(row.client_decided_by.name).toBe('Vikram Shah');
    // Nothing moved on a no.
    expect((await budgets()).lines).toEqual(before.lines);
    await http().patch(`/v1/change-orders/${changeOrder}`).set(pm).send({ markup_bp: 0 }).expect(409);

    const revised = await http().post(`/v1/change-orders/${changeOrder}/revise`).set(pm).expect(200);
    expect(revised.body).toMatchObject({ status: 'draft', revision: 1, label: 'CO-001 rev 1', approval: null });
    const priced = await http()
      .patch(`/v1/change-orders/${changeOrder}`)
      .set(pm)
      .send({ client_price: '650000', tax_rate_bp: 0 })
      .expect(200);
    expect(priced.body).toMatchObject({ entered_price: '650000', client_price: '650000', margin: '50000', client_total: '650000' });
    await http().post(`/v1/change-orders/${changeOrder}/submit`).set(pm).expect(200);
    secondApproval = (await http().post(`/v1/change-orders/${changeOrder}/approve`).set(owner).send({}).expect(200)).body
      .approval.id;
    expect(secondApproval).not.toBe(firstApproval);
  });

  it('on the client’s yes, moves the budgets, the handover date and the contract value — with history', async () => {
    await http().patch(`/v1/approvals/${secondApproval}`).set(client).send({ status: 'approved', note: 'Go ahead' }).expect(200);

    const row = await detail();
    expect(row.status).toBe('approved');
    expect(row.applied_at).not.toBeNull();
    const byCode = Object.fromEntries(
      row.budget_revisions.map((revision: { cost_code: { code: string } }) => [revision.cost_code.code, revision]),
    );
    expect(byCode['01.10']).toMatchObject({ requested: '500000', amount: '500000', budget_before: '1000000', budget_after: '1500000' });
    expect(byCode['02']).toMatchObject({ requested: '100000', amount: '100000', budget_before: '500000', budget_after: '600000' });
    expect(row.site_revision).toMatchObject({
      time_impact_days: 7,
      handover_before: '2027-03-31',
      handover_after: '2027-04-07',
      contract_before: '100000000',
      contract_after: '100650000',
      site_budget_before: '8000000000',
      site_budget_after: '8000600000',
    });

    // The budget report: the budget includes the change, and says how much of it was a change.
    const report = await budgets();
    const line = (code: string) => report.lines.find((row) => row.code === code)!;
    expect(line('01.10').own.budget).toBe('1500000');
    expect(line('01.10').approved_changes).toEqual({ own: '500000', total: '500000' });
    expect(line('01').approved_changes).toEqual({ own: '0', total: '500000' });
    expect(report.approved_changes).toBe('600000');

    const project = (await http().get(`/v1/projects/${site}`).set(owner).expect(200)).body;
    expect(project.target_end_date).toBe('2027-04-07');

    const summary = (await http().get(`/v1/projects/${site}/change-order-summary`).set(owner).expect(200)).body;
    expect(summary).toMatchObject({
      contract_value: '100000000',
      approved_changes: '650000',
      revised_contract_value: '100650000',
      original_handover: '2027-03-31',
      handover: '2027-04-07',
      extension_days: 7,
    });
    expect(summary.history).toHaveLength(1);
    expect(summary.history[0].change_order.label).toBe('CO-001 rev 1');

    // A decision is final, and an approved change order cannot be quietly cancelled.
    await http().patch(`/v1/approvals/${secondApproval}`).set(client).send({ status: 'rejected' }).expect(409);
    await http().post(`/v1/change-orders/${changeOrder}/cancel`).set(pm).send({}).expect(409);

    const done = await http().post(`/v1/change-orders/${changeOrder}/implement`).set(pm).expect(200);
    expect(done.body.status).toBe('implemented');
  });

  it('lets an owner record a decision taken over the phone, and never takes a budget below zero', async () => {
    const credit = await http()
      .post('/v1/change-orders')
      .set(owner)
      .send({
        project_id: site,
        title: 'Drop the second electrical panel',
        reason: 'design_change',
        time_impact_days: -2,
        lines: [{ description: 'Omit panel', amount: '-900000', cost_code_id: codes.get('02') }],
      })
      .expect(201);
    const id = credit.body.id;
    expect(credit.body.label).toBe('CO-002');
    await http().post(`/v1/change-orders/${id}/submit`).set(owner).expect(200);
    // An owner-run company has nobody else to ask.
    await http().post(`/v1/change-orders/${id}/approve`).set(owner).send({}).expect(200);
    // A client answers from the approvals list, not from the cost side.
    await http().post(`/v1/change-orders/${id}/client-decision`).set(client).send({ status: 'approved' }).expect(403);
    const decided = await http()
      .post(`/v1/change-orders/${id}/client-decision`)
      .set(owner)
      .send({ status: 'approved', note: 'Agreed on the phone' })
      .expect(200);
    expect(decided.body.client_decided_by.role).toBe('owner');
    expect(decided.body.budget_revisions[0]).toMatchObject({
      requested: '-900000',
      amount: '-600000',
      budget_before: '600000',
      budget_after: '0',
    });
    expect(decided.body.site_revision).toMatchObject({
      handover_before: '2027-04-07',
      handover_after: '2027-04-05',
      contract_before: '100650000',
      contract_after: '99750000',
    });
  });

  it('withdraws the pending approval when a sent change order is cancelled', async () => {
    const made = await http()
      .post('/v1/change-orders')
      .set(pm)
      .send({ project_id: site, title: 'Rock excavation', reason: 'site_condition', lines: [{ description: 'Rock', amount: '300000' }] })
      .expect(201);
    await http().post(`/v1/change-orders/${made.body.id}/submit`).set(pm).expect(200);
    const sent = await http().post(`/v1/change-orders/${made.body.id}/approve`).set(owner).send({}).expect(200);
    const cancelled = await http()
      .post(`/v1/change-orders/${made.body.id}/cancel`)
      .set(pm)
      .send({ note: 'Absorbed in the contract' })
      .expect(200);
    expect(cancelled.body).toMatchObject({ status: 'cancelled', cancel_reason: 'Absorbed in the contract', approval: null });
    const list = await http().get(`/v1/approvals?project_id=${site}`).set(client).expect(200);
    expect(list.body.items.map((row: { id: string }) => row.id)).not.toContain(sent.body.approval.id);
  });

  describe('the scope-creep catcher, with no AI key', () => {
    let suggestion: string;

    it('suggests a change order from a daily report that mentions extra work', async () => {
      await http()
        .post('/v1/dpr')
        .set(supervisor)
        .send({
          project_id: site,
          report_date: today,
          work_done: 'Plastering on the first floor. Client asked for an extra window in the master bedroom. Curing ongoing.',
          status: 'submitted',
        })
        .expect(201);
      const list = await http().get(`/v1/change-order-suggestions?project_id=${site}`).set(pm).expect(200);
      expect(list.body.items).toHaveLength(1);
      expect(list.body.items[0]).toMatchObject({
        source_kind: 'daily_report',
        excerpt: 'Client asked for an extra window in the master bedroom.',
        detected_by: 'rules',
        status: 'open',
        source_author: 'A site_supervisor',
      });
      suggestion = list.body.items[0].id;

      // The managers are told.
      const inbox = await http().get('/v1/notifications').set(pm).expect(200);
      const types = (inbox.body.items as Array<{ type: string }>).map((row) => row.type);
      expect(types).toContain('change_order_suggestion');
      // Seeing suggestions is part of raising change orders.
      await http().get('/v1/change-order-suggestions').set(supervisor).expect(403);
    });

    it('ignores a report with nothing extra in it', async () => {
      await http()
        .post('/v1/dpr')
        .set(supervisor)
        .send({ project_id: otherSite, report_date: today, work_done: 'Extra cement bags arrived. No extra work today.', status: 'submitted' })
        .expect(403); // not on that site
      await http()
        .post('/v1/dpr')
        .set(owner)
        .send({ project_id: otherSite, report_date: today, work_done: 'Extra cement bags arrived. No extra work today.', status: 'submitted' })
        .expect(201);
      const list = await http().get(`/v1/change-order-suggestions?project_id=${otherSite}`).set(owner).expect(200);
      expect(list.body.items).toHaveLength(0);
    });

    it('turns a suggestion into a draft change order', async () => {
      const made = await http()
        .post('/v1/change-orders')
        .set(pm)
        .send({ project_id: site, title: 'Extra window, master bedroom', reason: 'client_request', suggestion_id: suggestion })
        .expect(201);
      expect(made.body.status).toBe('draft');
      const converted = await http()
        .get(`/v1/change-order-suggestions?project_id=${site}&status=converted`)
        .set(pm)
        .expect(200);
      expect(converted.body.items[0]).toMatchObject({ id: suggestion, change_order_id: made.body.id });
      // Taken up once.
      await http()
        .post('/v1/change-orders')
        .set(pm)
        .send({ project_id: site, title: 'Again', reason: 'client_request', suggestion_id: suggestion })
        .expect(409);
    });

    it('reads the client’s own messages as requests, and can be dismissed', async () => {
      await http()
        .post(`/v1/projects/${site}/messages`)
        .set(client)
        .send({ body: 'Can you add a window in the study as well?' })
        .expect(201);
      const list = await http().get(`/v1/change-order-suggestions?project_id=${site}`).set(owner).expect(200);
      const fromMessage = list.body.items.find((row: { source_kind: string }) => row.source_kind === 'site_message');
      expect(fromMessage.excerpt).toBe('Can you add a window in the study as well?');
      await http().post(`/v1/change-order-suggestions/${fromMessage.id}/dismiss`).set(pm).expect(204);
      await http().post(`/v1/change-order-suggestions/${fromMessage.id}/dismiss`).set(pm).expect(409);
    });
  });

  it('keeps a register with approved totals, and exports it', async () => {
    const register = await http().get('/v1/change-orders').set(owner).expect(200);
    expect(register.body.totals).toMatchObject({
      approved_count: 2,
      approved_cost: String(600000 - 900000),
      approved_price: String(650000 - 900000),
      approved_days: 5,
    });
    const csv = await http().get(`/v1/change-orders/export?project_id=${site}`).set(owner).expect(200);
    expect(csv.headers['content-type']).toContain('text/csv');
    expect(csv.text).toContain('CO-001 rev 1,Lake View Villa,Extra partition wall and two light points,Client request,implemented');
    expect(csv.text).toContain('Approved total');
  });

  it('keeps one company’s change orders from another', async () => {
    await http().get(`/v1/change-orders/${changeOrder}`).set(stranger).expect(404);
    expect((await http().get('/v1/change-orders').set(stranger).expect(200)).body.items).toEqual([]);
    await http().put(`/v1/projects/${site}/contract-value`).set(stranger).send({ contract_value: '1' }).expect(404);
    expect((await http().get('/v1/change-order-suggestions').set(stranger).expect(200)).body.items).toEqual([]);
  });

  it('records every change in the audit log', async () => {
    const entries = async (query: Record<string, string>) =>
      (await http().get('/v1/audit').query(query).set(owner).expect(200)).body.items as Array<{
        action: string;
        after: Record<string, unknown> | null;
      }>;
    const onOrder = await entries({ entity: 'change_orders', entity_id: changeOrder });
    expect(onOrder.map((row) => row.action)).toEqual(expect.arrayContaining(['create', 'update']));
    expect((await entries({ entity: 'change_order_lines' })).length).toBeGreaterThan(0);
    expect((await entries({ entity: 'change_order_budget_revisions' })).length).toBeGreaterThanOrEqual(3);
    expect((await entries({ entity: 'change_order_site_revisions' })).length).toBe(2);
    expect((await entries({ entity: 'change_order_suggestions' })).length).toBeGreaterThan(0);
  });
});
