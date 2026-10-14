import { todayIn } from '@sitebook/shared';
import { createTestApp, destroyTenant, type TestApp } from './utils/test-app';

/**
 * VAT on expenses and on client instalments (roadmap Phase 1, item 5), for a UAE company at 5%.
 */
const random = (digits: number) =>
  String(Math.floor(Math.random() * 10 ** digits)).padStart(digits, '0');

describe('VAT on expenses and instalments', () => {
  let test: TestApp;
  let tenantId: string;
  let auth: { Authorization: string };
  let projectId: string;
  let stageId: string;
  const today = todayIn('Asia/Dubai');

  beforeAll(async () => {
    test = await createTestApp();
    const exchange = await test
      .http()
      .post('/v1/auth/exchange')
      .send({ firebase_token: `dev:+97150${random(7)}` })
      .expect(200);
    const created = await test
      .http()
      .post('/v1/tenants')
      .set('X-Onboarding-Token', exchange.body.onboarding_token)
      .send({
        name: 'Al Noor Contracting',
        owner_name: 'Owner',
        country: 'AE',
        currency: 'AED',
        timezone: 'Asia/Dubai',
        locale: 'en-AE',
        tax_regime: 'vat_ae',
      })
      .expect(201);
    tenantId = created.body.tenant.id;
    auth = { Authorization: `Bearer ${created.body.tokens.access_token}` };
    projectId = (
      await test
        .http()
        .post('/v1/projects')
        .set(auth)
        .send({ name: 'Marina Tower', status: 'active' })
        .expect(201)
    ).body.id;
  });

  afterAll(async () => {
    if (tenantId) await destroyTenant(test, tenantId);
    await test.close();
  });

  it('records the VAT inside an expense, with the supplier’s TRN', async () => {
    const expense = await test
      .http()
      .post('/v1/expenses')
      .set(auth)
      .send({
        project_id: projectId,
        // AED 105.00, of which 5.00 is VAT.
        amount: '10500',
        tax_amount: '500',
        supplier_tax_id: '100-1234-5678-9012',
        category: 'fuel',
        spent_on: today,
      })
      .expect(201);
    expect(expense.body).toMatchObject({ tax_amount: '500', supplier_tax_id: '100123456789012' });
  });

  it('refuses a TRN that is not one, and tax larger than the bill', async () => {
    const base = { project_id: projectId, amount: '10500', category: 'fuel', spent_on: today };
    await test
      .http()
      .post('/v1/expenses')
      .set(auth)
      .send({ ...base, tax_amount: '500', supplier_tax_id: '27AAPFU0939F1ZV' })
      .expect(422);
    await test
      .http()
      .post('/v1/expenses')
      .set(auth)
      .send({ ...base, tax_amount: '20000' })
      .expect(422);
  });

  it('charges VAT on top of an instalment, and counts it as owed', async () => {
    const stage = await test
      .http()
      .post(`/v1/projects/${projectId}/payment-schedule`)
      .set(auth)
      .send({ label: 'Slab complete', amount: '100000', tax_amount: '5000' })
      .expect(201);
    stageId = stage.body.id;
    expect(stage.body).toMatchObject({ tax_amount: '5000', total: '105000' });

    await test
      .http()
      .patch(`/v1/payment-stages/${stageId}`)
      .set(auth)
      .send({ raised: true })
      .expect(200);
    await test
      .http()
      .post(`/v1/projects/${projectId}/payment-schedule/receipts`)
      .set(auth)
      .send({ amount: '100000', received_on: today, stage_id: stageId, mode: 'bank' })
      .expect(201);

    const schedule = await test
      .http()
      .get(`/v1/projects/${projectId}/payment-schedule`)
      .set(auth)
      .expect(200);
    const row = schedule.body.items.find((item: { id: string }) => item.id === stageId);
    // Paid the instalment but not its VAT: still part paid, 50.00 outstanding.
    expect(row).toMatchObject({ status: 'part_paid', outstanding: '5000' });
  });

  it('reports input and output VAT for the period', async () => {
    const { body } = await test
      .http()
      .get(`/v1/reports/tax?from=${today.slice(0, 8)}01&to=${today}`)
      .set(auth)
      .expect(200);
    expect(body).toMatchObject({
      tax_name: 'VAT',
      standard_rate_bp: 500,
      input_tax: '500',
      output_tax: '5000',
      net_tax: '4500',
      taxable_sales: '100000',
      missing_supplier_tax_id: 0,
    });
    expect(body.by_month).toEqual([
      { month: today.slice(0, 7), input_tax: '500', output_tax: '5000' },
    ]);
  });
});
