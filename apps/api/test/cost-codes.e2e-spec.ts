import { STANDARD_WBS, addDays, todayIn } from '@sitebook/shared';
import { CostCommitmentsService } from '../src/modules/cost-codes/cost-commitments.service';
import {
  createTestApp,
  destroyTenant,
  onboardTenant,
  uniquePhone,
  type OnboardedTenant,
  type TestApp,
} from './utils/test-app';

/**
 * Cost codes and budgets (roadmap Phase 2, module 1): the breakdown per site, the template
 * library, expenses booked to a line, and the budget report rolled up the tree.
 */
describe('cost codes and budgets', () => {
  let test: TestApp;
  let alpha: OnboardedTenant;
  let beta: OnboardedTenant;
  let auth: { Authorization: string };
  let other: { Authorization: string };
  let site: string;
  let otherSite: string;
  const codes = new Map<string, string>();
  const today = todayIn('Asia/Kolkata');

  const http = () => test.http();
  const newSite = async (body: Record<string, unknown>) =>
    (await http().post('/v1/projects').set(auth).send(body).expect(201)).body.id as string;
  const refreshCodes = async (projectId: string) => {
    const { body } = await http().get(`/v1/projects/${projectId}/cost-codes`).set(auth).expect(200);
    codes.clear();
    for (const row of body) codes.set(row.code, row.id);
    return body as Array<{ id: string; code: string; parent_id: string | null; budget: string }>;
  };
  const expense = (projectId: string, amount: string, costCodeId?: string) =>
    http()
      .post('/v1/expenses')
      .set(auth)
      .send({
        project_id: projectId,
        amount,
        category: 'materials',
        spent_on: today,
        ...(costCodeId ? { cost_code_id: costCodeId } : {}),
      });

  beforeAll(async () => {
    test = await createTestApp();
    alpha = await onboardTenant(test, { name: 'Budget Builders', phone: uniquePhone() });
    beta = await onboardTenant(test, { name: 'Nosy Builders', phone: uniquePhone() });
    auth = { Authorization: `Bearer ${alpha.accessToken}` };
    other = { Authorization: `Bearer ${beta.accessToken}` };
    site = await newSite({ name: 'Palm Villa', status: 'active' });
    otherSite = await newSite({ name: 'Second Villa', status: 'active' });
  });

  afterAll(async () => {
    await destroyTenant(test, alpha.tenantId);
    await destroyTenant(test, beta.tenantId);
    await test.close();
  });

  it('starts a site from the built-in template, and applying it twice changes nothing', async () => {
    const first = await http()
      .post(`/v1/projects/${site}/cost-codes/apply-template`)
      .set(auth)
      .send({ template_id: 'standard' })
      .expect(200);
    expect(first.body).toEqual({ created: STANDARD_WBS.length, updated: 0, skipped: 0 });

    const again = await http()
      .post(`/v1/projects/${site}/cost-codes/apply-template`)
      .set(auth)
      .send({ template_id: 'standard' })
      .expect(200);
    expect(again.body).toEqual({ created: 0, updated: 0, skipped: STANDARD_WBS.length });

    const list = await refreshCodes(site);
    expect(list.map((row) => row.code).slice(0, 3)).toEqual(['01', '01.10', '01.20']);
    expect(list.find((row) => row.code === '03.20')!.parent_id).toBe(codes.get('03'));
  });

  it('adds, edits and refuses duplicates and loops', async () => {
    const made = await http()
      .post(`/v1/projects/${site}/cost-codes`)
      .set(auth)
      .send({ code: '03.25', name: 'Pile caps', parent_id: codes.get('03'), unit: 'm3' })
      .expect(201);
    expect(made.body).toMatchObject({ code: '03.25', budget: '0', parent_id: codes.get('03') });

    await http()
      .post(`/v1/projects/${site}/cost-codes`)
      .set(auth)
      .send({ code: '03.25', name: 'Again' })
      .expect(409);
    // 03 under its own child.
    await http()
      .patch(`/v1/projects/${site}/cost-codes/${codes.get('03')}`)
      .set(auth)
      .send({ parent_id: made.body.id })
      .expect(409);

    await http()
      .patch(`/v1/projects/${site}/cost-codes/${made.body.id}`)
      .set(auth)
      .send({ name: 'Pile caps & ties' })
      .expect(200);
    await http().delete(`/v1/projects/${site}/cost-codes/${made.body.id}`).set(auth).expect(204);
    // A parent with lines under it stays.
    await http().delete(`/v1/projects/${site}/cost-codes/${codes.get('03')}`).set(auth).expect(409);
  });

  it('books expenses to a line, and only to a line on the same site', async () => {
    const budget = (code: string, amount: string) =>
      http()
        .patch(`/v1/projects/${site}/cost-codes/${codes.get(code)}`)
        .set(auth)
        .send({ budget: amount })
        .expect(200);
    await budget('03', '10000');
    await budget('03.20', '100000');
    await budget('03.30', '50000');
    await http()
      .patch(`/v1/projects/${site}/cost-codes/${codes.get('04.10')}`)
      .set(auth)
      .send({ labour_default: true })
      .expect(200);

    const booked = await expense(site, '30000', codes.get('03.20')).expect(201);
    expect(booked.body.cost_code).toEqual({ id: codes.get('03.20'), code: '03.20', name: 'Footings & foundations' });
    await expense(site, '200000', codes.get('03.30')).expect(201);
    await expense(site, '5000').expect(201);

    // A line from another site would put this spend on somebody else's report.
    const elsewhere = await http()
      .post(`/v1/projects/${otherSite}/cost-codes`)
      .set(auth)
      .send({ code: '01', name: 'Prelims' })
      .expect(201);
    await expense(site, '100', elsewhere.body.id).expect(422);

    // Spend booked to a line keeps it.
    await http().delete(`/v1/projects/${site}/cost-codes/${codes.get('03.30')}`).set(auth).expect(409);

    // A day of labour lands on the labour line.
    const worker = await http()
      .post('/v1/workers')
      .set(auth)
      .send({ name: 'Ravi', daily_wage: '15000' })
      .expect(201);
    await http()
      .post('/v1/attendance')
      .set(auth)
      .send({
        project_id: site,
        attendance_date: today,
        rows: [{ worker_id: worker.body.id, status: 'present' }],
      })
      .expect(201);
  });

  it('reports budget, committed, actual and forecast rolled up the tree', async () => {
    // What purchase orders will do once they exist: register, and say what is still open.
    test.app.get(CostCommitmentsService).register({
      name: 'test_orders',
      outstanding: async (_tx, projectId) =>
        projectId === site ? [{ costCodeId: codes.get('03.20')!, amount: 20000n }] : [],
    });

    const { body } = await http().get(`/v1/projects/${site}/cost-report`).set(auth).expect(200);
    const line = (code: string) => body.lines.find((row: { code: string }) => row.code === code);

    expect(body.committed_sources).toContain('test_orders');
    expect(line('03.20').own).toEqual({
      budget: '100000',
      committed: '20000',
      actual: '30000',
      forecast: '100000',
      variance: '0',
    });
    expect(line('03.30').own).toMatchObject({ actual: '200000', forecast: '200000', variance: '-150000' });
    expect(line('03').own).toMatchObject({ budget: '10000', forecast: '10000' });
    expect(line('03').total).toEqual({
      budget: '160000',
      committed: '20000',
      actual: '230000',
      forecast: '310000',
      variance: '-150000',
    });
    expect(line('03').has_children).toBe(true);
    expect(line('03.20').depth).toBe(1);
    expect(line('04.10').own).toMatchObject({ actual: '15000', forecast: '15000' });
    expect(body.unallocated).toMatchObject({ actual: '5000', forecast: '5000' });
    expect(body.totals).toEqual({
      budget: '160000',
      committed: '20000',
      actual: '250000',
      forecast: '330000',
      variance: '-170000',
    });
  });

  it('spreads the site trend over the budget each line has left', async () => {
    const trending = await newSite({
      name: 'Trend Tower',
      status: 'active',
      start_date: addDays(today, -10),
      target_end_date: addDays(today, 29),
    });
    const add = async (code: string, budget: string) =>
      (
        await http()
          .post(`/v1/projects/${trending}/cost-codes`)
          .set(auth)
          .send({ code, name: `Line ${code}`, budget })
          .expect(201)
      ).body.id as string;
    const a = await add('A', '120000');
    await add('B', '300000');
    await expense(trending, '100000', a).expect(201);

    // One day of spend at 1,000 a day with 29 days to go: 2,900,000 still to come, split 20k:300k.
    const { body } = await http().get(`/v1/projects/${trending}/cost-report`).set(auth).expect(200);
    expect(body.method).toBe('burn_rate');
    expect(body.site_forecast).toBe('3000000');
    const line = (code: string) => body.lines.find((row: { code: string }) => row.code === code);
    expect(line('A').own.forecast).toBe('281250');
    expect(line('B').own.forecast).toBe('2718750');
    expect(body.totals.forecast).toBe('3000000');
  });

  it('imports codes and budgets from a sheet, updating what exists', async () => {
    const { body } = await http()
      .post(`/v1/projects/${site}/cost-codes/import`)
      .set(auth)
      .send({
        rows: [
          { code: '03.20', name: 'Footings', budget: '120000' },
          { code: '12.10', name: 'Pool shell', budget: '70000', unit: 'm3' },
          { code: '12', name: 'Swimming pool' },
        ],
      })
      .expect(200);
    expect(body).toEqual({ created: 2, updated: 1, skipped: 0 });

    const list = await refreshCodes(site);
    const pool = list.find((row) => row.code === '12.10')!;
    expect(pool.parent_id).toBe(codes.get('12'));
    expect(list.find((row) => row.code === '03.20')!.budget).toBe('120000');

    await http()
      .post(`/v1/projects/${site}/cost-codes/import`)
      .set(auth)
      .send({ rows: [{ code: '13.10', name: 'Orphan', parent_code: '13' }] })
      .expect(422);
  });

  it('keeps a template library: copy the built-in one, save a site, edit, delete', async () => {
    const copy = await http()
      .post('/v1/cost-code-templates')
      .set(auth)
      .send({ name: 'Our villas', from_template_id: 'standard' })
      .expect(201);
    expect(copy.body.lines).toHaveLength(STANDARD_WBS.length);

    const fromSite = await http()
      .post('/v1/cost-code-templates')
      .set(auth)
      .send({ name: 'Palm Villa breakdown', from_project_id: site })
      .expect(201);
    expect(fromSite.body.lines.find((row: { code: string }) => row.code === '12.10')).toMatchObject({
      parent_code: '12',
    });

    const edited = await http()
      .put(`/v1/cost-code-templates/${copy.body.id}`)
      .set(auth)
      .send({
        items: [
          { code: '1', name: 'Shell' },
          { code: '1.1', name: 'Frame', parent_code: '1' },
        ],
      })
      .expect(200);
    expect(edited.body.items).toBe(2);
    await http()
      .put(`/v1/cost-code-templates/${copy.body.id}`)
      .set(auth)
      .send({ items: [{ code: '1.1', name: 'Frame', parent_code: '9' }] })
      .expect(422);
    await http().put('/v1/cost-code-templates/standard').set(auth).send({ name: 'Mine' }).expect(409);

    await http()
      .post(`/v1/projects/${otherSite}/cost-codes/apply-template`)
      .set(auth)
      .send({ template_id: copy.body.id })
      .expect(200);
    const listed = await http().get('/v1/cost-code-templates').set(auth).expect(200);
    expect(listed.body.map((row: { name: string }) => row.name)).toEqual([
      'Standard building WBS',
      'Our villas',
      'Palm Villa breakdown',
    ]);

    await http().delete(`/v1/cost-code-templates/${fromSite.body.id}`).set(auth).expect(204);
  });

  it('never shows one company another company’s codes, budgets or templates', async () => {
    await http().get(`/v1/projects/${site}/cost-codes`).set(other).expect(404);
    await http().get(`/v1/projects/${site}/cost-report`).set(other).expect(404);
    await http()
      .patch(`/v1/projects/${site}/cost-codes/${codes.get('03')}`)
      .set(other)
      .send({ budget: '1' })
      .expect(404);

    const templates = await http().get('/v1/cost-code-templates').set(other).expect(200);
    expect(templates.body.map((row: { id: string }) => row.id)).toEqual(['standard']);

    // Underneath the API: row-level security alone hides them.
    const seen = await test.tenantDb.transaction(beta.tenantId, (tx) =>
      Promise.all([tx.costCode.count(), tx.costCodeTemplate.count(), tx.costCodeTemplateItem.count()]),
    );
    expect(seen).toEqual([0, 0, 0]);
  });
});
