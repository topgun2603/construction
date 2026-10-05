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
 * Subcontracts and progress (RA) billing (roadmap Phase 2, module 3): the contract and its schedule
 * of rates, variations, running bills with retention, advance recovery, back-charges and tax,
 * certification for less than claimed, payment, retention release, and how all of it reaches the
 * budget report as committed and then actual cost — once.
 *
 * Money below is minor units: 25000 is ₹250.00.
 */
describe('subcontracts and RA billing', () => {
  let test: TestApp;
  let alpha: OnboardedTenant;
  let beta: OnboardedTenant;
  let uaeTenantId: string | undefined;
  let owner: Auth;
  let pm: Auth;
  let supervisor: Auth;
  let accounts: Auth;
  let stranger: Auth;
  let site: string;
  let otherSite: string;
  let contractor: string;
  let subcontract: string;
  let plaster: string;
  let tiling: string;
  let waterproofing: string;
  let bill1: string;
  let bill2: string;
  let materialExpense: string;
  const codes = new Map<string, string>();
  const today = todayIn('Asia/Kolkata');

  const http = () => test.http();
  const report = async () =>
    (await http().get(`/v1/projects/${site}/cost-report`).set(owner).expect(200)).body as {
      committed_sources: string[];
      lines: Array<{ code: string; own: { committed: string; actual: string } }>;
      unallocated: { committed: string; actual: string };
      totals: { committed: string; actual: string };
    };
  const line = (body: Awaited<ReturnType<typeof report>>, code: string) =>
    body.lines.find((row) => row.code === code)!.own;
  const detail = async (who: Auth = owner) =>
    (await http().get(`/v1/subcontracts/${subcontract}`).set(who).expect(200)).body;

  async function invite(role: string, projectIds: string[]): Promise<Auth> {
    const phone = uniquePhone();
    await http()
      .post('/v1/tenants/current/invite')
      .set(owner)
      .send({ phone, name: `A ${role}`, role, project_ids: projectIds })
      .expect(201);
    const login = await http()
      .post('/v1/auth/exchange')
      .send({ firebase_token: `dev:${phone}` })
      .expect(200);
    return { Authorization: `Bearer ${login.body.access_token}` };
  }

  beforeAll(async () => {
    test = await createTestApp();
    alpha = await onboardTenant(test, { name: 'Running Account Builders', phone: uniquePhone() });
    beta = await onboardTenant(test, { name: 'Peeking Builders', phone: uniquePhone() });
    owner = { Authorization: `Bearer ${alpha.accessToken}` };
    stranger = { Authorization: `Bearer ${beta.accessToken}` };

    site = (await http().post('/v1/projects').set(owner).send({ name: 'Lake View', status: 'active' }).expect(201))
      .body.id;
    otherSite = (
      await http().post('/v1/projects').set(owner).send({ name: 'Hill View', status: 'active' }).expect(201)
    ).body.id;
    for (const [code, name] of [
      ['03', 'Finishes'],
      ['03.10', 'Plaster'],
      ['04.10', 'Tiling'],
    ] as const) {
      const made = await http()
        .post(`/v1/projects/${site}/cost-codes`)
        .set(owner)
        .send({ code, name, ...(code === '03.10' ? { parent_id: codes.get('03') } : {}) })
        .expect(201);
      codes.set(code, made.body.id);
    }

    pm = await invite('project_manager', [site]);
    supervisor = await invite('site_supervisor', [site]);
    accounts = await invite('accounts', []);
  });

  afterAll(async () => {
    if (alpha) await destroyTenant(test, alpha.tenantId);
    if (beta) await destroyTenant(test, beta.tenantId);
    if (uaeTenantId) await destroyTenant(test, uaeTenantId);
    await test.close();
  });

  it('keeps one party table: a contractor carries the tax number its bills print', async () => {
    await http()
      .post('/v1/contractors')
      .set(owner)
      .send({ name: 'Bad Number Co', tax_id: '100123456789012' })
      .expect(422);
    const made = await http()
      .post('/v1/contractors')
      .set(owner)
      .send({ name: 'Sharma Plastering', trade: 'Plaster', tax_id: '27aapfu0939f1zv', address: 'Pune' })
      .expect(201);
    expect(made.body).toMatchObject({ tax_id: '27AAPFU0939F1ZV', address: 'Pune', worker_count: 0 });
    contractor = made.body.id;
  });

  it('writes a subcontract with its schedule of rates, and edits it while a draft', async () => {
    const base = {
      project_id: site,
      contractor_id: contractor,
      title: 'Internal plaster and tiling',
      retention_bp: 500,
      retention_release_at_completion_bp: 5000,
      defects_liability_months: 12,
      advance_amount: '5000000',
      advance_recovery_bp: 1000,
      payment_terms: '14 days from certification',
      lines: [
        { item_code: '1.1', description: 'Internal plaster 12mm', unit: 'm2', quantity: '1000', rate: '25000', cost_code_id: codes.get('03.10') },
        { item_code: '2.1', description: 'Vitrified floor tiling', unit: 'm2', quantity: '400', rate: '90000', cost_code_id: codes.get('04.10') },
      ],
    };
    // India's GST on works depends on the work, so it is never guessed.
    await http().post('/v1/subcontracts').set(owner).send(base).expect(422);
    // A cost code from another site would put this commitment on somebody else's report.
    const foreign = await http()
      .post(`/v1/projects/${otherSite}/cost-codes`)
      .set(owner)
      .send({ code: '01', name: 'Prelims' })
      .expect(201);
    await http()
      .post('/v1/subcontracts')
      .set(owner)
      .send({ ...base, tax_rate_bp: 1800, lines: [{ ...base.lines[0], cost_code_id: foreign.body.id }] })
      .expect(422);

    const made = await http()
      .post('/v1/subcontracts')
      .set(pm)
      .send({ ...base, tax_rate_bp: 1800 })
      .expect(201);
    subcontract = made.body.id;
    expect(made.body).toMatchObject({
      number: 'SC-001',
      status: 'draft',
      tax_rate_bp: 1800,
      current_value: '61000000',
      contractor: { id: contractor, tax_id: '27AAPFU0939F1ZV' },
      project: { id: site, name: 'Lake View' },
    });
    plaster = made.body.lines[0].id;
    tiling = made.body.lines[1].id;
    expect(made.body.lines[0]).toMatchObject({ amount: '25000000', cost_code: { code: '03.10' } });

    // Lines change freely before the contract is let.
    const added = await http()
      .post(`/v1/subcontracts/${subcontract}/lines`)
      .set(pm)
      .send({ description: 'Scaffolding', unit: 'LS', quantity: '1', rate: '100000' })
      .expect(201);
    const scaffold = added.body.lines.at(-1).id;
    await http()
      .patch(`/v1/subcontracts/${subcontract}/lines/${scaffold}`)
      .set(pm)
      .send({ quantity: '2' })
      .expect(200)
      .expect((res) => expect(res.body.current_value).toBe('61200000'));
    await http().delete(`/v1/subcontracts/${subcontract}/lines/${scaffold}`).set(pm).expect(200);
    await http()
      .patch(`/v1/subcontracts/${subcontract}`)
      .set(pm)
      .send({ title: 'Internal plaster & tiling', scope: 'All floors, block A' })
      .expect(200);

    // Nothing committed while it is a draft.
    expect(line(await report(), '03.10').committed).toBe('0');

    const let_ = await http()
      .post(`/v1/subcontracts/${subcontract}/status`)
      .set(pm)
      .send({ status: 'active' })
      .expect(200);
    expect(let_.body).toMatchObject({ status: 'active', title: 'Internal plaster & tiling' });

    // Once let, the price is fixed: changes are variations.
    await http()
      .post(`/v1/subcontracts/${subcontract}/lines`)
      .set(pm)
      .send({ description: 'More', unit: 'm2', quantity: '1', rate: '1' })
      .expect(409);
    await http().patch(`/v1/subcontracts/${subcontract}`).set(pm).send({ retention_bp: 1000 }).expect(409);
    await http().delete(`/v1/subcontracts/${subcontract}`).set(pm).expect(409);
  });

  it('commits the contract against the cost codes, and keeps the codes from being deleted', async () => {
    const body = await report();
    expect(body.committed_sources).toContain('subcontracts');
    expect(line(await report(), '03.10')).toMatchObject({ committed: '25000000', actual: '0' });
    expect(line(body, '04.10')).toMatchObject({ committed: '36000000', actual: '0' });
    await http().delete(`/v1/projects/${site}/cost-codes/${codes.get('03.10')}`).set(owner).expect(409);
  });

  it('raises the contract value only when a variation is approved', async () => {
    const proposed = await http()
      .post(`/v1/subcontracts/${subcontract}/variations`)
      .set(pm)
      .send({
        title: 'Waterproofing in wet areas',
        reason: 'Client added two bathrooms',
        lines: [{ description: 'Waterproofing coat', unit: 'm2', quantity: '100', rate: '30000', cost_code_id: codes.get('03.10') }],
      })
      .expect(201);
    const variation = proposed.body.variations[0];
    expect(variation).toMatchObject({ number: 1, status: 'pending', value: '3000000' });
    expect(proposed.body.current_value).toBe('61000000');
    expect(line(await report(), '03.10').committed).toBe('25000000');

    // Approving is a certifier's decision, not the site's.
    await http()
      .post(`/v1/subcontracts/${subcontract}/variations/${variation.id}/decide`)
      .set(supervisor)
      .send({ status: 'approved' })
      .expect(403);
    const approved = await http()
      .post(`/v1/subcontracts/${subcontract}/variations/${variation.id}/decide`)
      .set(pm)
      .send({ status: 'approved', note: 'Agreed on site' })
      .expect(200);
    expect(approved.body.current_value).toBe('64000000');
    expect(approved.body.statement).toMatchObject({ originalValue: '61000000', variationsValue: '3000000' });
    waterproofing = approved.body.lines.find((row: { description: string }) => row.description === 'Waterproofing coat').id;
    expect(line(await report(), '03.10').committed).toBe('28000000');
    await http()
      .post(`/v1/subcontracts/${subcontract}/variations/${variation.id}/decide`)
      .set(pm)
      .send({ status: 'rejected' })
      .expect(409);
  });

  it('pays the advance, never more than was agreed', async () => {
    await http()
      .post(`/v1/subcontracts/${subcontract}/payments`)
      .set(pm)
      .send({ kind: 'advance', amount: '5000000', paid_on: today })
      .expect(403);
    await http()
      .post(`/v1/subcontracts/${subcontract}/payments`)
      .set(accounts)
      .send({ kind: 'advance', amount: '5000001', paid_on: today })
      .expect(422);
    const paid = await http()
      .post(`/v1/subcontracts/${subcontract}/payments`)
      .set(accounts)
      .send({ kind: 'advance', amount: '5000000', paid_on: today, mode: 'bank', reference: 'NEFT 1' })
      .expect(201);
    expect(paid.body.statement.advancePaid).toBe('5000000');
  });

  it('lets the site measure RA-1 without seeing the money, and tells the certifier', async () => {
    materialExpense = (
      await http()
        .post('/v1/expenses')
        .set(owner)
        .send({ project_id: site, amount: '200000', category: 'materials', spent_on: today, cost_code_id: codes.get('03.10') })
        .expect(201)
    ).body.id;

    // The site's view: the lines, but not their rates.
    const seen = await detail(supervisor);
    expect(seen.lines[0]).toMatchObject({ description: 'Internal plaster 12mm', rate: null, amount: null });
    expect(seen.statement).toBeNull();
    await http().post('/v1/subcontracts').set(supervisor).send({}).expect(403);

    // Below nothing and above the contract are both refused.
    await http()
      .post(`/v1/subcontracts/${subcontract}/bills`)
      .set(supervisor)
      .send({ period_to: today, lines: [{ line_id: plaster, quantity_to_date: '1001' }] })
      .expect(422);

    const drafted = await http()
      .post(`/v1/subcontracts/${subcontract}/bills`)
      .set(supervisor)
      .send({
        period_from: today,
        period_to: today,
        lines: [
          { line_id: plaster, quantity_to_date: '400' },
          { line_id: tiling, quantity_to_date: '100' },
        ],
        deductions: [{ kind: 'material', description: 'Cement issued from our store', amount: '150000', expense_id: materialExpense }],
      })
      .expect(201);
    bill1 = drafted.body.id;
    expect(drafted.body).toMatchObject({ number: 1, status: 'draft', figures: null, paid: null });
    expect(drafted.body.lines.find((row: { line_id: string }) => row.line_id === plaster)).toMatchObject({
      claimed_quantity: '400',
      previous_quantity: '0',
      rate: null,
    });
    // The recovery goes back to the line the cement was booked to.
    expect(drafted.body.deductions[0]).toMatchObject({ amount: '150000', cost_code: { code: '03.10' } });

    // One open bill at a time: two would both claim the same work.
    await http()
      .post(`/v1/subcontracts/${subcontract}/bills`)
      .set(supervisor)
      .send({ period_to: today })
      .expect(409);

    await http().post(`/v1/subcontract-bills/${bill1}/submit`).set(supervisor).expect(200);
    const inbox = await http().get('/v1/notifications').set(pm).expect(200);
    expect(inbox.body.items.map((row: { type: string }) => row.type)).toContain('subcontract_bill_submitted');
    // Submitted bills are not the site's to change.
    await http()
      .patch(`/v1/subcontract-bills/${bill1}`)
      .set(supervisor)
      .send({ note: 'late change' })
      .expect(409);
  });

  it('certifies RA-1 for less than claimed, and works out retention, advance, deductions and GST', async () => {
    await http().post(`/v1/subcontract-bills/${bill1}/certify`).set(supervisor).send({}).expect(403);
    await http().post(`/v1/subcontract-bills/${bill1}/certify`).set(accounts).send({}).expect(403);
    // A certifier can cut a claim, not grow it.
    await http()
      .post(`/v1/subcontract-bills/${bill1}/certify`)
      .set(pm)
      .send({ lines: [{ line_id: plaster, certified_quantity_to_date: '410' }] })
      .expect(422);

    const certified = await http()
      .post(`/v1/subcontract-bills/${bill1}/certify`)
      .set(pm)
      .send({ lines: [{ line_id: plaster, certified_quantity_to_date: '380' }], note: 'Block A level 3 not finished' })
      .expect(200);
    // 380 × 250 + 100 × 900 = 1,85,000; 5% retention; 10% advance recovery; 18% GST on the gross.
    expect(certified.body.figures).toEqual({
      gross_to_date: '18500000',
      previous_gross: '0',
      gross: '18500000',
      retention_to_date: '925000',
      retention: '925000',
      advance_recovered_to_date: '1850000',
      advance_recovery: '1850000',
      deductions: '150000',
      tax_rate_bp: 1800,
      tax: '3330000',
      net_payable: '18905000',
    });
    expect(certified.body.status).toBe('certified');
    expect(certified.body.lines.find((row: { line_id: string }) => row.line_id === plaster)).toMatchObject({
      claimed_quantity: '400',
      certified_quantity: '380',
      this_bill: '9500000',
    });
  });

  it('moves certified work from committed to actual, once', async () => {
    const body = await report();
    // Plaster: 28,000,000 contract less 9,500,000 certified is still committed. Actual is the cement
    // expense, plus the certified plaster, less the cement charged back — not the cement twice.
    expect(line(body, '03.10')).toMatchObject({
      committed: '18500000',
      actual: String(200000 + 9500000 - 150000),
    });
    expect(line(body, '04.10')).toMatchObject({ committed: '27000000', actual: '9000000' });
    // Committed + actual on a line stays at its contract value: certifying moves money, never adds it.
    const tilingLine = line(body, '04.10');
    expect(BigInt(tilingLine.committed) + BigInt(tilingLine.actual)).toBe(36000000n);
    // Tax, retention and advance recovery are not cost.
    expect(body.totals.actual).toBe(String(200000 + 18500000 - 150000));
  });

  it('pays RA-1 in parts and marks it paid', async () => {
    await http()
      .post(`/v1/subcontract-bills/${bill1}/payments`)
      .set(pm)
      .send({ amount: '100', paid_on: today })
      .expect(403);
    await http()
      .post(`/v1/subcontract-bills/${bill1}/payments`)
      .set(accounts)
      .send({ amount: '18905001', paid_on: today })
      .expect(422);
    const part = await http()
      .post(`/v1/subcontract-bills/${bill1}/payments`)
      .set(accounts)
      .send({ amount: '10000000', paid_on: today, mode: 'bank' })
      .expect(201);
    expect(part.body).toMatchObject({ status: 'certified', paid: '10000000', balance: '8905000' });
    const rest = await http()
      .post(`/v1/subcontract-bills/${bill1}/payments`)
      .set(accounts)
      .send({ amount: '8905000', paid_on: today, mode: 'upi' })
      .expect(201);
    expect(rest.body).toMatchObject({ status: 'paid', paid: '18905000', balance: '0' });
  });

  it('bills the increment on RA-2, on cumulative retention and recovery', async () => {
    // Work cannot be un-done on a new bill.
    await http()
      .post(`/v1/subcontracts/${subcontract}/bills`)
      .set(supervisor)
      .send({ period_to: today, lines: [{ line_id: plaster, quantity_to_date: '300' }] })
      .expect(422);

    const drafted = await http()
      .post(`/v1/subcontracts/${subcontract}/bills`)
      .set(supervisor)
      .send({ period_to: today, lines: [{ line_id: plaster, quantity_to_date: '600' }] })
      .expect(201);
    bill2 = drafted.body.id;
    // Lines left out carry the last certified quantity.
    expect(drafted.body.lines.find((row: { line_id: string }) => row.line_id === tiling)).toMatchObject({
      previous_quantity: '100',
      claimed_quantity: '100',
    });
    // Re-measured before submitting, including the variation's line.
    await http()
      .patch(`/v1/subcontract-bills/${bill2}`)
      .set(supervisor)
      .send({
        lines: [
          { line_id: plaster, quantity_to_date: '700' },
          { line_id: waterproofing, quantity_to_date: '50' },
        ],
      })
      .expect(200);
    await http().post(`/v1/subcontract-bills/${bill2}/submit`).set(supervisor).expect(200);
    const certified = await http().post(`/v1/subcontract-bills/${bill2}/certify`).set(pm).send({}).expect(200);
    // To date: 700 × 250 + 100 × 900 + 50 × 300 = 2,80,000; previously 1,85,000.
    expect(certified.body.figures).toEqual({
      gross_to_date: '28000000',
      previous_gross: '18500000',
      gross: '9500000',
      retention_to_date: '1400000',
      retention: '475000',
      advance_recovered_to_date: '2800000',
      advance_recovery: '950000',
      deductions: '0',
      tax_rate_bp: 1800,
      tax: '1710000',
      net_payable: '9785000',
    });
    expect(line(await report(), '03.10').committed).toBe(String(28000000 - 17500000 - 1500000));
  });

  it('releases retention, which becomes payable', async () => {
    await http()
      .post(`/v1/subcontracts/${subcontract}/retention-releases`)
      .set(pm)
      .send({ amount: '1400001', released_on: today })
      .expect(422);
    await http()
      .post(`/v1/subcontracts/${subcontract}/retention-releases`)
      .set(accounts)
      .send({ amount: '700000', released_on: today })
      .expect(403);
    const released = await http()
      .post(`/v1/subcontracts/${subcontract}/retention-releases`)
      .set(pm)
      .send({ amount: '700000', released_on: today, note: 'Half at practical completion' })
      .expect(201);
    expect(released.body.retention_tranches).toEqual({ at_completion: '700000', after_defects: '700000' });
    const release = released.body.retention_releases[0];
    expect(release).toMatchObject({ amount: '700000', paid: '0' });
    expect(released.body.statement).toMatchObject({ retentionBalance: '700000', balanceDue: String(9785000 + 700000) });

    const paid = await http()
      .post(`/v1/subcontracts/${subcontract}/payments`)
      .set(accounts)
      .send({ kind: 'retention', retention_release_id: release.id, amount: '700000', paid_on: today })
      .expect(201);
    expect(paid.body.retention_releases[0].paid).toBe('700000');
  });

  it('states the account with the subcontractor', async () => {
    const body = await detail(accounts);
    expect(body.statement).toEqual({
      originalValue: '61000000',
      variationsValue: '3000000',
      currentValue: '64000000',
      certifiedGross: '28000000',
      remainingValue: '36000000',
      tax: '5040000',
      retentionHeld: '1400000',
      retentionReleased: '700000',
      retentionBalance: '700000',
      advancePaid: '5000000',
      advanceRecovered: '2800000',
      advanceOutstanding: '2200000',
      deductions: '150000',
      netCertified: String(18905000 + 9785000),
      paidOnBills: '18905000',
      retentionPaid: '700000',
      totalPaid: String(18905000 + 700000 + 5000000),
      balanceDue: '9785000',
    });
    expect(body.bills.map((row: { number: number; status: string }) => [row.number, row.status])).toEqual([
      [1, 'paid'],
      [2, 'certified'],
    ]);
    // Cannot close with money still owed.
    await http()
      .post(`/v1/subcontracts/${subcontract}/status`)
      .set(pm)
      .send({ status: 'completed', completed_on: today })
      .expect(200);
    await http().post(`/v1/subcontracts/${subcontract}/status`).set(pm).send({ status: 'closed' }).expect(409);

    const list = await http().get(`/v1/subcontracts?project_id=${site}`).set(owner).expect(200);
    expect(list.body.items).toHaveLength(1);
    expect(list.body.items[0]).toMatchObject({ number: 'SC-001', certified: '28000000', balance_due: '9785000' });
  });

  it('keeps sites and companies apart', async () => {
    await http().get(`/v1/subcontracts/${subcontract}`).set(stranger).expect(404);
    await http().get(`/v1/subcontract-bills/${bill1}`).set(stranger).expect(404);
    expect((await http().get('/v1/subcontracts').set(stranger).expect(200)).body.items).toEqual([]);

    // A supervisor sees their own site's subcontracts, not another's.
    const elsewhere = await http()
      .post('/v1/subcontracts')
      .set(owner)
      .send({ project_id: otherSite, contractor_id: contractor, title: 'Hill View plaster', tax_rate_bp: 1800 })
      .expect(201);
    await http().get(`/v1/subcontracts/${elsewhere.body.id}`).set(supervisor).expect(403);
    const theirs = await http().get('/v1/subcontracts').set(supervisor).expect(200);
    expect(theirs.body.items.map((row: { id: string }) => row.id)).toEqual([subcontract]);
    expect(theirs.body.items[0].current_value).toBeNull();
  });

  it('records who certified what in the audit log', async () => {
    const entries = async (query: Record<string, string>) =>
      (await http().get('/v1/audit').query(query).set(owner).expect(200)).body.items as Array<{
        action: string;
        after: Record<string, unknown> | null;
      }>;
    const onBill = await entries({ entity: 'subcontract_bills', entity_id: bill1 });
    const actions = onBill.map((row) => row.action);
    expect(actions).toContain('create');
    expect(actions).toContain('subcontract_bill.certified');
    const certifiedEntry = onBill.find((row) => row.action === 'subcontract_bill.certified')!;
    expect(certifiedEntry.after).toMatchObject({ gross: '18500000', net_payable: '18905000' });
    expect((await entries({ entity: 'subcontracts', entity_id: subcontract })).length).toBeGreaterThan(0);
    expect((await entries({ entity: 'subcontract_payments' })).length).toBeGreaterThanOrEqual(4);
  });

  it('charges 5% VAT for a UAE company without being told the rate', async () => {
    const exchange = await http()
      .post('/v1/auth/exchange')
      .send({ firebase_token: `dev:+97150${String(Math.floor(Math.random() * 1e7)).padStart(7, '0')}` })
      .expect(200);
    const created = await http()
      .post('/v1/tenants')
      .set('X-Onboarding-Token', exchange.body.onboarding_token)
      .send({
        name: 'Gulf Fitout LLC',
        owner_name: 'Owner',
        country: 'AE',
        currency: 'AED',
        timezone: 'Asia/Dubai',
        locale: 'en-AE',
        tax_regime: 'vat_ae',
      })
      .expect(201);
    uaeTenantId = created.body.tenant.id;
    const uae = { Authorization: `Bearer ${created.body.tokens.access_token}` };
    const project = (await http().post('/v1/projects').set(uae).send({ name: 'Marina Villa' }).expect(201)).body.id;
    const party = (
      await http().post('/v1/contractors').set(uae).send({ name: 'Al Noor Gypsum', tax_id: '100-1234-5678-9012' }).expect(201)
    ).body;
    expect(party.tax_id).toBe('100123456789012');

    const sc = await http()
      .post('/v1/subcontracts')
      .set(uae)
      .send({
        project_id: project,
        contractor_id: party.id,
        title: 'Gypsum ceilings',
        retention_bp: 1000,
        lines: [{ description: 'Gypsum ceiling', unit: 'm2', quantity: '20', rate: '10000' }],
      })
      .expect(201);
    expect(sc.body).toMatchObject({ tax_rate_bp: 500, current_value: '200000' });
    await http().post(`/v1/subcontracts/${sc.body.id}/status`).set(uae).send({ status: 'active' }).expect(200);
    const bill = await http()
      .post(`/v1/subcontracts/${sc.body.id}/bills`)
      .set(uae)
      .send({ period_to: todayIn('Asia/Dubai'), lines: [{ line_id: sc.body.lines[0].id, quantity_to_date: '10' }] })
      .expect(201);
    expect(bill.body.figures).toMatchObject({ gross: '100000', retention: '10000', tax: '5000', net_payable: '95000' });

    // Uncoded work is committed under "Unallocated", not lost.
    const costs = await http().get(`/v1/projects/${project}/cost-report`).set(uae).expect(200);
    expect(costs.body.unallocated.committed).toBe('200000');
  });
});
