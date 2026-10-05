import ExcelJS from 'exceljs';
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

interface BoqItemView {
  id: string;
  parent_id: string | null;
  kind: 'section' | 'item';
  item_no: string;
  quantity: string | null;
  rate: string | null;
  amount: string | null;
  cost_code: { code: string } | null;
  measured_quantity: string | null;
  billed_quantity: string | null;
  percent_bp: number;
  over: boolean;
  excess_quantity: string | null;
}

const base64 = (text: string | Buffer) => Buffer.from(text).toString('base64');

/** Supertest hands binary bodies over only when told how to collect them. */
const binary = (res: NodeJS.ReadableStream, done: (error: Error | null, body: unknown) => void) => {
  const chunks: Buffer[] = [];
  res.on('data', (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
  res.on('end', () => done(null, Buffer.concat(chunks)));
};

/**
 * Bill of quantities (roadmap Phase 2, module 5): importing a BOQ from CSV and Excel with every
 * problem reported and nothing half-imported, cost-code mapping, the measurement book and its
 * over-quantity flag, two running bills to the client with retention, advance recovery and GST —
 * certified for less than claimed — and how a certified bill becomes an instalment in the existing
 * payment schedule, paid through the existing receipts. Then who may do what, and tenant isolation.
 *
 * Money is minor units: 35000 is ₹350.00.
 */
describe('bill of quantities', () => {
  let test: TestApp;
  let alpha: OnboardedTenant;
  let beta: OnboardedTenant;
  let uaeTenantId: string | undefined;
  let owner: Auth;
  let pm: Auth;
  let supervisor: Auth;
  let accounts: Auth;
  let client: Auth;
  let stranger: Auth;
  let site: string;
  let otherSite: string;
  let bill1: string;
  let bill2: string;
  const items = new Map<string, string>();
  const today = todayIn('Asia/Kolkata');

  const http = () => test.http();
  const boq = async (who: Auth = owner, projectId = site) =>
    (await http().get(`/v1/projects/${projectId}/boq`).set(who).expect(200)).body as {
      id: string | null;
      terms: { retention_bp: number; tax_rate_bp: number; advance_amount: string | null } | null;
      items: BoqItemView[];
      totals: { contract: string; measured: string; billed: string; over_quantity: number } | null;
      bills: Array<{ id: string; number: number; status: string; payment_status: string }>;
      can_replace: boolean;
    };
  const item = (view: Awaited<ReturnType<typeof boq>>, no: string) => view.items.find((row) => row.item_no === no)!;

  async function invite(role: string, projectIds: string[]): Promise<Auth> {
    const phone = uniquePhone();
    await http()
      .post('/v1/tenants/current/invite')
      .set(owner)
      .send({ phone, name: `A ${role}`, role, project_ids: projectIds })
      .expect(201);
    const login = await http().post('/v1/auth/exchange').send({ firebase_token: `dev:${phone}` }).expect(200);
    return { Authorization: `Bearer ${login.body.access_token}` };
  }

  const csv = [
    'Lake View Residences — Bill of Quantities',
    '',
    'Item,Description,Unit,Qty,Rate,Amount',
    '1,Earthwork,,,,',
    '1.1,Excavation in ordinary soil,m3,100,350,"35,000.00"',
    '1.2,Backfilling,m3,50,120.50,6025',
    ',Total carried to summary,,,,"41,025.00"',
    '2,Concrete,,,,',
    '2.1,PCC 1:4:8,m3,10,4500,45000',
  ].join('\r\n');

  beforeAll(async () => {
    test = await createTestApp();
    alpha = await onboardTenant(test, { name: 'Measured Builders', phone: uniquePhone() });
    beta = await onboardTenant(test, { name: 'Curious Builders', phone: uniquePhone() });
    owner = { Authorization: `Bearer ${alpha.accessToken}` };
    stranger = { Authorization: `Bearer ${beta.accessToken}` };

    site = (await http().post('/v1/projects').set(owner).send({ name: 'Lake View', status: 'active' }).expect(201)).body.id;
    otherSite = (await http().post('/v1/projects').set(owner).send({ name: 'Hill View', status: 'active' }).expect(201))
      .body.id;
    for (const [code, name] of [
      ['01', 'Earthwork'],
      ['02', 'Concrete'],
    ] as const) {
      await http().post(`/v1/projects/${site}/cost-codes`).set(owner).send({ code, name }).expect(201);
    }
    pm = await invite('project_manager', [site, otherSite]);
    supervisor = await invite('site_supervisor', [site]);
    accounts = await invite('accounts', []);
    client = await invite('client', [site]);
  });

  afterAll(async () => {
    if (alpha) await destroyTenant(test, alpha.tenantId);
    if (beta) await destroyTenant(test, beta.tenantId);
    if (uaeTenantId) await destroyTenant(test, uaeTenantId);
    await test.close();
  });

  it('shows an empty BOQ on a site that has none', async () => {
    const empty = await boq();
    expect(empty).toMatchObject({ id: null, items: [], bills: [], can_replace: true });
  });

  it('lists every problem in a bad sheet and imports nothing', async () => {
    const bad = [
      'Item,Description,Unit,Qty,Rate,Amount',
      '1,Excavation,m3,ten,350,',
      '2,Backfill,m3,10,120,1500',
      '3,Steel,kg,10,60,',
      '3,Steel again,kg,10,60,',
    ].join('\n');
    const preview = await http()
      .post(`/v1/projects/${site}/boq/import/preview`)
      .set(pm)
      .send({ file_name: 'bad.csv', content_base64: base64(bad) })
      .expect(200);
    expect(preview.body.can_import).toBe(false);
    expect(preview.body.errors).toEqual([
      { line: 2, field: 'quantity', message: '1: "ten" is not a quantity' },
      { line: 3, field: 'amount', message: '2: the amount 1500.00 is not quantity × rate (1200.00)' },
      { line: 5, field: 'item_no', message: '3: appears twice' },
    ]);

    const refused = await http()
      .post(`/v1/projects/${site}/boq/import`)
      .set(pm)
      .send({ file_name: 'bad.csv', content_base64: base64(bad) })
      .expect(422);
    expect(refused.body.message).toBe('3 rows have problems; nothing was imported');
    expect(refused.body.details.errors).toHaveLength(3);
    expect((await boq()).items).toEqual([]);

    await http()
      .post(`/v1/projects/${site}/boq/import/preview`)
      .set(pm)
      .send({ file_name: 'boq.pdf', content_base64: base64(bad) })
      .expect(422);
  });

  it('previews and imports a CSV BOQ with its sections, skipping the sub-total', async () => {
    const preview = await http()
      .post(`/v1/projects/${site}/boq/import/preview`)
      .set(pm)
      .send({ file_name: 'lake-view.csv', content_base64: base64(csv) })
      .expect(200);
    expect(preview.body).toMatchObject({
      header_row: 2,
      mapping: { item_no: 0, description: 1, unit: 2, quantity: 3, rate: 4, amount: 5 },
      items: 3,
      sections: 2,
      total: '8602500',
      can_import: true,
      errors: [],
    });
    expect(preview.body.skipped).toHaveLength(1);

    const imported = await http()
      .post(`/v1/projects/${site}/boq/import`)
      .set(pm)
      .send({ file_name: 'lake-view.csv', content_base64: base64(csv) })
      .expect(201);
    expect(imported.body.imported).toBe(5);
    const view = imported.body.boq as Awaited<ReturnType<typeof boq>>;
    for (const row of view.items) items.set(row.item_no, row.id);
    expect(view.items.map((row) => [row.item_no, row.kind])).toEqual([
      ['1', 'section'],
      ['1.1', 'item'],
      ['1.2', 'item'],
      ['2', 'section'],
      ['2.1', 'item'],
    ]);
    expect(item(view, '1.1')).toMatchObject({ parent_id: items.get('1'), quantity: '100', rate: '35000', amount: '3500000' });
    // A section's amount is what is under it.
    expect(item(view, '1').amount).toBe('4102500');
    expect(view.totals?.contract).toBe('8602500');
  });

  it('reads an Excel BOQ: title rows, numeric cells, float noise and formula results', async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('BOQ');
    sheet.addRow(['Hill View — Bill of Quantities']);
    sheet.addRow([]);
    sheet.addRow(['S.No', 'Description of work', 'Unit', 'Qty', 'Rate (Rs)', 'Amount (Rs)']);
    sheet.addRow([1, 'Masonry']);
    sheet.addRow([1.1, 'Brickwork in CM 1:6', 'm3', 25.5, 5200.75, { formula: 'D5*E5', result: 132619.125 }]);
    sheet.addRow([1.2, 'Plaster 12 mm', 'm2', 0.1 + 0.2, 150, 45]);
    const file = Buffer.from(await workbook.xlsx.writeBuffer());

    const preview = await http()
      .post(`/v1/projects/${otherSite}/boq/import/preview`)
      .set(pm)
      .send({ file_name: 'hill-view.xlsx', content_base64: file.toString('base64') })
      .expect(200);
    expect(preview.body).toMatchObject({ sheets: ['BOQ'], sheet: 'BOQ', header_row: 2, errors: [], can_import: true });
    expect(preview.body.rows.map((row: { item_no: string; quantity: string | null }) => [row.item_no, row.quantity])).toEqual([
      ['1', null],
      ['1.1', '25500'],
      ['1.2', '300'],
    ]);
    // 25.5 × 5,200.75 = 1,32,619.125 → 1,32,619.13
    expect(preview.body.total).toBe(String(13_261_913 + 4500));

    await http()
      .post(`/v1/projects/${otherSite}/boq/import`)
      .set(pm)
      .send({ file_name: 'hill-view.xlsx', content_base64: file.toString('base64') })
      .expect(201);
    expect((await boq(owner, otherSite)).items).toHaveLength(3);

    // Not a workbook at all.
    await http()
      .post(`/v1/projects/${otherSite}/boq/import/preview`)
      .set(pm)
      .send({ file_name: 'broken.xlsx', content_base64: base64('not a zip') })
      .expect(422);
  });

  it('maps items to cost codes by code and name, falling back to the section', async () => {
    const proposals = await http().post(`/v1/projects/${site}/boq/auto-map`).set(pm).send({}).expect(200);
    expect(proposals.body.applied).toBe(0);
    expect(proposals.body.proposals).toHaveLength(5);
    await http().post(`/v1/projects/${site}/boq/auto-map`).set(pm).send({ apply: true }).expect(200);
    const view = await boq();
    expect(view.items.map((row) => row.cost_code?.code)).toEqual(['01', '01', '01', '02', '02']);
  });

  it('lets a supervisor measure, without seeing a single rate, and flags measuring past the contract', async () => {
    const theirs = await boq(supervisor);
    expect(item(theirs, '1.1').rate).toBeNull();
    expect(item(theirs, '1.1').amount).toBeNull();
    expect(theirs.totals).toBeNull();

    const measure = (no: string, body: Record<string, unknown>, who: Auth = supervisor) =>
      http().post(`/v1/boq-items/${items.get(no)}/measurements`).set(who).send({ measured_on: today, ...body });

    // 10 × 5 × 1.2 = 60
    const first = await measure('1.1', { location: 'Block A footings', length: '10', breadth: '5', height: '1.2' }).expect(201);
    expect(first.body.measurement).toMatchObject({ quantity: '60', length: '10', deduction: false });
    expect(first.body.item).toMatchObject({ measured_quantity: '60', percent_bp: 6000, over: false });
    await measure('1.1', { count: '2', length: '10' }).expect(201);
    // A sump measured twice: taken off again.
    const taken = await measure('1.1', { length: '1', breadth: '1', height: '2', deduction: true }).expect(201);
    expect(taken.body.measurement.quantity).toBe('-2');
    await measure('1.2', { length: '30' }).expect(201);
    const over = await measure('2.1', { count: '12', note: 'Extra PCC under the lift pit' }).expect(201);
    expect(over.body.item).toMatchObject({ measured_quantity: '12', percent_bp: 12_000, over: true, excess_quantity: '2' });

    await measure('1', { count: '1' }).expect(422); // a section
    await measure('1.1', {}).expect(422); // nothing measured
    await measure('1.1', { count: '1', photo_keys: [`${beta.tenantId}/site_media/x.jpg`] }).expect(422);
    // Accounts bills; it does not measure.
    await measure('1.1', { count: '1' }, accounts).expect(403);

    const view = await boq();
    expect(item(view, '1.1')).toMatchObject({ measured_quantity: '78', percent_bp: 7800 });
    expect(view.totals?.over_quantity).toBe(1);

    const book = await http().get(`/v1/boq-items/${items.get('1.1')}/measurements`).set(supervisor).expect(200);
    expect(book.body.items).toHaveLength(3);
    expect(book.body.items[0].measured_by.name).toBe('A site_supervisor');
  });

  it('keeps the supervisor out of the money and the client out altogether', async () => {
    await http().patch(`/v1/projects/${site}/boq`).set(supervisor).send({ retention_bp: 500 }).expect(403);
    await http().post(`/v1/projects/${site}/boq/bills`).set(supervisor).send({ period_to: today }).expect(403);
    await http().get(`/v1/projects/${site}/boq/export`).set(supervisor).expect(403);
    await http().get(`/v1/projects/${site}/boq`).set(client).expect(403);
    await http().post(`/v1/projects/${site}/boq/import`).set(accounts).send({ file_name: 'a.csv', content_base64: base64(csv) }).expect(403);
  });

  it('will not bill a GST client until the GST rate is set', async () => {
    const refused = await http().post(`/v1/projects/${site}/boq/bills`).set(accounts).send({ period_to: today }).expect(409);
    expect(refused.body.message).toMatch(/GST rate/);
    const terms = await http()
      .patch(`/v1/projects/${site}/boq`)
      .set(pm)
      .send({ retention_bp: 500, advance_amount: '10000000', advance_recovery_bp: 1000, tax_rate_bp: 1800 })
      .expect(200);
    expect(terms.body.terms).toEqual({ retention_bp: 500, advance_amount: '10000000', advance_recovery_bp: 1000, tax_rate_bp: 1800 });
  });

  it('drafts the first bill from the measurement book and refuses a claim beyond it', async () => {
    const draft = await http().post(`/v1/projects/${site}/boq/bills`).set(accounts).send({ period_to: today }).expect(201);
    bill1 = draft.body.id;
    expect(draft.body.number).toBe(1);
    const lines = new Map<string, { claimed_quantity: string; over_contract: boolean }>(
      draft.body.lines.map((line: { item_no: string }) => [line.item_no, line]),
    );
    expect(lines.get('1.1')!.claimed_quantity).toBe('78');
    expect(lines.get('2.1')).toMatchObject({ claimed_quantity: '12', over_contract: true });
    // 78 × 350 + 30 × 120.50 + 12 × 4,500 = 27,300 + 3,615 + 54,000
    expect(draft.body.figures).toMatchObject({
      gross: '8491500',
      retention: '424575',
      advance_recovery: '849150',
      tax_rate_bp: 1800,
      tax: '1528470',
      net_payable: '8746245',
    });

    const tooMuch = await http()
      .patch(`/v1/boq-bills/${bill1}`)
      .set(accounts)
      .send({ lines: [{ item_id: items.get('1.1'), quantity_to_date: '90' }] })
      .expect(422);
    expect(tooMuch.body.message).toBe('1.1 is more than has been measured; record the measurement first');
    // Only one open bill at a time.
    await http().post(`/v1/projects/${site}/boq/bills`).set(accounts).send({ period_to: today }).expect(409);
  });

  it('records a certificate for less than was claimed, and freezes it', async () => {
    const submitted = await http().post(`/v1/boq-bills/${bill1}/submit`).set(accounts).expect(200);
    expect(submitted.body).toMatchObject({ status: 'submitted', figures: { claimed_gross: '8491500' } });

    await http()
      .post(`/v1/boq-bills/${bill1}/certify`)
      .set(accounts)
      .send({ lines: [{ item_id: items.get('1.2'), certified_quantity_to_date: '31' }] })
      .expect(422);

    const certified = await http()
      .post(`/v1/boq-bills/${bill1}/certify`)
      .set(accounts)
      .send({
        lines: [
          { item_id: items.get('1.1'), certified_quantity_to_date: '75' },
          { item_id: items.get('2.1'), certified_quantity_to_date: '10' },
        ],
        note: 'Certificate IPC-01; lift pit PCC held for a variation',
      })
      .expect(200);
    // 75 × 350 + 30 × 120.50 + 10 × 4,500 = 26,250 + 3,615 + 45,000
    expect(certified.body).toMatchObject({
      status: 'certified',
      certified_by: { name: 'A accounts' },
      figures: {
        claimed_gross: '8491500',
        gross: '7486500',
        retention: '374325',
        advance_recovery: '748650',
        tax: '1347570',
        net_payable: '7711095',
      },
    });
    await http().patch(`/v1/boq-bills/${bill1}`).set(accounts).send({ note: 'late' }).expect(409);
  });

  it('invoices the certified bill as an instalment in the existing payment schedule', async () => {
    const invoiced = await http().post(`/v1/boq-bills/${bill1}/invoice`).set(accounts).send({ due_date: today }).expect(200);
    expect(invoiced.body).toMatchObject({
      status: 'invoiced',
      payment_status: 'unpaid',
      invoice: { amount: '6363525', tax_amount: '1347570', paid: '0', outstanding: '7711095' },
    });
    const stageId = invoiced.body.invoice.payment_stage_id as string;

    const schedule = await http().get(`/v1/projects/${site}/payment-schedule`).set(owner).expect(200);
    const stage = schedule.body.items.find((row: { id: string }) => row.id === stageId);
    expect(stage).toMatchObject({ amount: '6363525', tax_amount: '1347570', total: '7711095', boq_bill: { number: 1 } });
    expect(schedule.body.totals.scheduled).toBe('7711095');
    // The client sees it with everything else they owe.
    const theirs = await http().get(`/v1/projects/${site}/payment-schedule`).set(client).expect(200);
    expect(theirs.body.items.map((row: { id: string }) => row.id)).toContain(stageId);

    // Its amount is the certificate's, and it stays while the bill does.
    await http().patch(`/v1/payment-stages/${stageId}`).set(owner).send({ amount: '1' }).expect(409);
    await http().delete(`/v1/payment-stages/${stageId}`).set(owner).expect(409);
    await http().patch(`/v1/payment-stages/${stageId}`).set(owner).send({ label: 'RA-1 (IPC-01)' }).expect(200);
    await http().post(`/v1/boq-bills/${bill1}/invoice`).set(accounts).send({}).expect(409);

    // Paid through the ordinary receipts.
    await http()
      .post(`/v1/projects/${site}/payment-schedule/receipts`)
      .set(accounts)
      .send({ amount: '7711095', received_on: today, mode: 'bank', stage_id: stageId })
      .expect(201);
    const paid = await http().get(`/v1/boq-bills/${bill1}`).set(accounts).expect(200);
    expect(paid.body).toMatchObject({ payment_status: 'paid', invoice: { paid: '7711095', outstanding: '0' } });
  });

  it('bills only the increment the second time, with retention and recovery cumulative', async () => {
    await http()
      .post(`/v1/boq-items/${items.get('1.1')}/measurements`)
      .set(supervisor)
      .send({ measured_on: today, count: '22' })
      .expect(201);
    const draft = await http()
      .post(`/v1/projects/${site}/boq/bills`)
      .set(accounts)
      .send({
        period_to: today,
        lines: [
          { item_id: items.get('1.1'), quantity_to_date: '100' },
          { item_id: items.get('2.1'), quantity_to_date: '12' },
        ],
      })
      .expect(201);
    bill2 = draft.body.id;
    const line = (no: string) => draft.body.lines.find((row: { item_no: string }) => row.item_no === no);
    expect(line('1.1')).toMatchObject({ previous_quantity: '75', claimed_quantity: '100', this_bill: '875000' });
    expect(line('1.2')).toMatchObject({ previous_quantity: '30', claimed_quantity: '30', this_bill: '0' });
    expect(draft.body.previous).toEqual({ retention_to_date: '374325', advance_recovered_to_date: '748650' });
    // Value to date 35,000 + 3,615 + 54,000 = 92,615; less 74,865 certified before.
    expect(draft.body.figures).toMatchObject({
      gross_to_date: '9261500',
      previous_gross: '7486500',
      gross: '1775000',
      retention_to_date: '463075',
      retention: '88750',
      advance_recovered_to_date: '926150',
      advance_recovery: '177500',
      tax: '319500',
      net_payable: '1828250',
    });

    // Below what the client certified last time is a correction, not a bill.
    await http()
      .patch(`/v1/boq-bills/${bill2}`)
      .set(accounts)
      .send({ lines: [{ item_id: items.get('1.1'), quantity_to_date: '70' }] })
      .expect(422);

    await http().post(`/v1/boq-bills/${bill2}/submit`).set(accounts).expect(200);
    await http().post(`/v1/boq-bills/${bill2}/certify`).set(pm).send({}).expect(200);
    const invoiced = await http().post(`/v1/boq-bills/${bill2}/invoice`).set(pm).send({}).expect(200);
    expect(invoiced.body.invoice).toMatchObject({ amount: String(1_775_000 - 88_750 - 177_500), tax_amount: '319500' });

    const view = await boq();
    expect(view.bills.map((bill) => [bill.number, bill.status, bill.payment_status])).toEqual([
      [1, 'invoiced', 'paid'],
      [2, 'invoiced', 'unpaid'],
    ]);
    expect(item(view, '1.1')).toMatchObject({ billed_quantity: '100', measured_quantity: '100' });
    expect(view.totals?.billed).toBe('9261500');
  });

  it('protects what has been measured and billed', async () => {
    const replace = await http()
      .post(`/v1/projects/${site}/boq/import`)
      .set(pm)
      .send({ file_name: 'lake-view.csv', content_base64: base64(csv) })
      .expect(409);
    expect(replace.body.message).toMatch(/cannot be replaced/);
    // Appending the same numbers again is the same items twice.
    await http()
      .post(`/v1/projects/${site}/boq/import`)
      .set(pm)
      .send({ file_name: 'lake-view.csv', content_base64: base64(csv), mode: 'append' })
      .expect(422);
    await http()
      .post(`/v1/projects/${site}/boq/import`)
      .set(pm)
      .send({
        file_name: 'extra.csv',
        content_base64: base64('Item,Description,Unit,Qty,Rate\n3,Finishes,,,\n3.1,Plaster,m2,200,180'),
        mode: 'append',
      })
      .expect(201);
    expect(item(await boq(), '3.1').parent_id).toBe(item(await boq(), '3').id);

    await http().patch(`/v1/boq-items/${items.get('1.1')}`).set(pm).send({ rate: '36000' }).expect(409);
    await http().patch(`/v1/boq-items/${items.get('1.1')}`).set(pm).send({ quantity: '110' }).expect(200);
    await http().delete(`/v1/boq-items/${items.get('1.1')}`).set(pm).expect(409);
    const book = await http().get(`/v1/boq-items/${items.get('1.1')}/measurements`).set(pm).expect(200);
    // Taking 22 out would leave 78 measured against 100 billed.
    const last = book.body.items.find((row: { quantity: string }) => row.quantity === '22');
    await http().delete(`/v1/boq-measurements/${last.id}`).set(pm).expect(409);
  });

  it('exports the BOQ and its abstract as CSV and Excel', async () => {
    const csvOut = await http().get(`/v1/projects/${site}/boq/export`).query({ format: 'csv' }).set(owner).expect(200);
    expect(csvOut.headers['content-type']).toMatch(/text\/csv/);
    const lines = csvOut.text.replace(/^\uFEFF/, '').trim().split('\r\n');
    expect(lines[0]!.startsWith('Item no.,Description,Unit,Quantity,Rate,Amount')).toBe(true);
    expect(lines[2]).toBe('1.1,Excavation in ordinary soil,m3,110,350.00,38500.00,01,100,100,35000.00,35000.00,90.91');

    const abstract = await http()
      .get(`/v1/projects/${site}/boq/export`)
      .query({ format: 'csv', report: 'abstract' })
      .set(owner)
      .expect(200);
    expect(abstract.text).toContain('1,Earthwork,44525.00,38615.00,38615.00,5910.00,86.73');

    const xlsx = await http()
      .get(`/v1/projects/${site}/boq/export`)
      .query({ format: 'xlsx' })
      .set(owner)
      .buffer(true)
      .parse(binary as never)
      .expect(200);
    expect(xlsx.headers['content-type']).toMatch(/spreadsheetml/);
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(xlsx.body as ArrayBuffer);
    expect(book.worksheets.map((sheet) => sheet.name)).toEqual(['BOQ', 'Abstract']);
    const row = book.getWorksheet('BOQ')!.getRow(3);
    expect([row.getCell(1).value, row.getCell(4).value, row.getCell(6).value]).toEqual(['1.1', 110, 38500]);
  });

  it('keeps one company’s BOQ invisible to another', async () => {
    await http().get(`/v1/projects/${site}/boq`).set(stranger).expect(404);
    await http().get(`/v1/boq-bills/${bill1}`).set(stranger).expect(404);
    await http().get(`/v1/boq-items/${items.get('1.1')}/measurements`).set(stranger).expect(404);
    await http()
      .post(`/v1/boq-items/${items.get('1.1')}/measurements`)
      .set(stranger)
      .send({ measured_on: today, count: '1' })
      .expect(404);
    await http().post(`/v1/boq-bills/${bill2}/certify`).set(stranger).send({}).expect(404);
  });

  it('records every change and every decision in the audit log', async () => {
    const entries = async (query: Record<string, string>) =>
      (await http().get('/v1/audit').query(query).set(owner).expect(200)).body.items as Array<{
        action: string;
        after: Record<string, unknown> | null;
      }>;
    const onBill = await entries({ entity: 'boq_bills', entity_id: bill1 });
    const actions = onBill.map((row) => row.action);
    expect(actions).toEqual(expect.arrayContaining(['create', 'update', 'boq_bill.certified', 'boq_bill.invoiced']));
    expect(onBill.find((row) => row.action === 'boq_bill.certified')!.after).toMatchObject({
      gross: '7486500',
      net_payable: '7711095',
    });
    expect((await entries({ entity: 'boq_measurements' })).length).toBeGreaterThanOrEqual(6);
    expect((await entries({ entity: 'boq_items' })).length).toBeGreaterThanOrEqual(5);
    expect((await entries({ entity: 'boqs', action: 'boq.imported' })).length).toBeGreaterThanOrEqual(2);
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
        name: 'Gulf Contracting LLC',
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
    const imported = await http()
      .post(`/v1/projects/${project}/boq/import`)
      .set(uae)
      .send({
        file_name: 'marina.csv',
        content_base64: base64('Item,Description,Unit,Qty,Rate,Amount\n1,Gypsum ceiling,m2,20,100,2000'),
      })
      .expect(201);
    expect(imported.body.boq.terms.tax_rate_bp).toBe(500);
    const ceiling = imported.body.boq.items[0].id as string;
    await http()
      .post(`/v1/boq-items/${ceiling}/measurements`)
      .set(uae)
      .send({ measured_on: todayIn('Asia/Dubai'), length: '10' })
      .expect(201);
    const bill = await http()
      .post(`/v1/projects/${project}/boq/bills`)
      .set(uae)
      .send({ period_to: todayIn('Asia/Dubai') })
      .expect(201);
    expect(bill.body.figures).toMatchObject({ gross: '100000', retention: '0', tax_rate_bp: 500, tax: '5000', net_payable: '105000' });
    expect(bill.body.boq.tax_name).toBe('VAT');
  });
});
