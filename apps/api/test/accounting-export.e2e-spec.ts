import {
  createTestApp,
  destroyTenant,
  onboardTenant,
  uniquePhone,
  type OnboardedTenant,
  type TestApp,
} from './utils/test-app';

/**
 * Accounting exports (roadmap Phase 3), end to end against a real database.
 *
 * One month of a company's money is written straight to the tables — an approved supplier invoice
 * (and the expense its approval booked), a cash expense, a wage period, a certified RA bill, an
 * instalment raised to the client and the money that moved — and then exported to every system.
 * What is under test is the export: which records it reads, that an unmapped account refuses it,
 * that a batch is recorded and the next export leaves out what it carried, who may do it, and that
 * one company never sees another's.
 */
describe('Accounting exports', () => {
  let test: TestApp;
  let alpha: OnboardedTenant;
  let beta: OnboardedTenant;
  let owner: { Authorization: string };
  let stranger: { Authorization: string };
  let accounts: { Authorization: string };
  let pm: { Authorization: string };
  let lakeview: string;
  let hillside: string;
  let tallyBatch: string;

  const http = () => test.http();
  const period = { from: '2026-04-01', to: '2026-04-30' };
  const everything = ['purchases', 'payroll', 'subcontract_bills', 'sales', 'payments', 'masters'];

  async function invite(role: string, projectIds: string[]): Promise<{ Authorization: string }> {
    const phone = uniquePhone();
    await http()
      .post('/v1/tenants/current/invite')
      .set(owner)
      .send({ phone, name: `A ${role}`, role, project_ids: projectIds })
      .expect(201);
    const login = await http().post('/v1/auth/exchange').send({ firebase_token: `dev:${phone}` }).expect(200);
    return { Authorization: `Bearer ${login.body.access_token}` };
  }

  /** The month's transactions, written directly: the export reads tables, not workflows. */
  async function seed(tenant: OnboardedTenant) {
    const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
    await test.tenantDb.transaction(tenant.tenantId, async (tx) => {
      const by = tenant.ownerId;
      const vendor = await tx.vendor.create({
        data: { tenantId: tenant.tenantId, name: 'Sri Murugan Steels & Co', taxId: '33AAAAA0000A1Z5' },
      });
      const order = await tx.purchaseOrder.create({
        data: {
          tenantId: tenant.tenantId,
          projectId: lakeview,
          vendorId: vendor.id,
          number: 'PO-00001',
          status: 'approved',
          subtotal: 1_000_000n,
          taxTotal: 180_000n,
          total: 1_180_000n,
          createdBy: by,
        },
      });
      const orderLine = await tx.purchaseOrderLine.create({
        data: {
          tenantId: tenant.tenantId,
          purchaseOrderId: order.id,
          description: 'TMT bars 12mm',
          unit: 'kg',
          quantity: '1000',
          unitRate: 1_000n,
          taxRateBp: 1800,
          amount: 1_000_000n,
          taxAmount: 180_000n,
        },
      });
      // What approving the invoice books for the cost report: must not be exported a second time.
      const booked = await tx.expense.create({
        data: {
          tenantId: tenant.tenantId,
          projectId: lakeview,
          amount: 1_180_000n,
          taxAmount: 180_000n,
          category: 'materials',
          spentOn: day('2026-04-05'),
          status: 'approved',
          submittedBy: by,
          approvedBy: by,
          approvedAt: new Date(),
        },
      });
      const invoice = await tx.purchaseInvoice.create({
        data: {
          tenantId: tenant.tenantId,
          purchaseOrderId: order.id,
          projectId: lakeview,
          vendorId: vendor.id,
          invoiceNumber: 'SMS/26/0042',
          invoiceDate: day('2026-04-05'),
          subtotal: 1_000_000n,
          taxTotal: 180_000n,
          total: 1_180_000n,
          status: 'approved',
          toleranceBp: 200,
          recordedBy: by,
          approvedBy: by,
          approvedAt: new Date(),
        },
      });
      await tx.purchaseInvoiceLine.create({
        data: {
          tenantId: tenant.tenantId,
          invoiceId: invoice.id,
          purchaseOrderLineId: orderLine.id,
          quantity: '1000',
          unitRate: 1_000n,
          amount: 1_000_000n,
          taxAmount: 180_000n,
          expenseId: booked.id,
        },
      });

      // Diesel from Karnataka (IGST), approved; one pending and one rejected that must not go.
      for (const [status, projectId, amount] of [
        ['approved', lakeview, 118_000n],
        ['pending', lakeview, 50_000n],
        ['rejected', lakeview, 70_000n],
        ['approved', hillside, 23_600n],
      ] as const) {
        await tx.expense.create({
          data: {
            tenantId: tenant.tenantId,
            projectId,
            amount,
            taxAmount: amount === 118_000n ? 18_000n : 0n,
            supplierTaxId: amount === 118_000n ? '29CCCCC2222C1Z7' : null,
            category: 'fuel',
            spentOn: day('2026-04-08'),
            note: 'Diesel for the JCB',
            status,
            submittedBy: by,
          },
        });
      }
      // Outside the period: never read.
      await tx.expense.create({
        data: {
          tenantId: tenant.tenantId,
          projectId: lakeview,
          amount: 99_900n,
          category: 'transport',
          spentOn: day('2026-05-02'),
          status: 'approved',
          submittedBy: by,
        },
      });

      const worker = await tx.worker.create({ data: { tenantId: tenant.tenantId, name: 'Muthu', dailyWage: 80_000n } });
      const wages = await tx.wagePeriod.create({
        data: {
          tenantId: tenant.tenantId,
          periodStart: day('2026-04-01'),
          periodEnd: day('2026-04-15'),
          status: 'finalised',
          totalEarned: 5_000_000n,
          totalAdvances: 500_000n,
          finalisedBy: by,
          finalisedAt: new Date(),
        },
      });
      await tx.wageLine.create({
        data: {
          tenantId: tenant.tenantId,
          wagePeriodId: wages.id,
          workerId: worker.id,
          daysPresent: '12.5',
          grossAmount: 5_000_000n,
          advancesDeducted: 500_000n,
          netPayable: 4_500_000n,
        },
      });
      await tx.labourPayment.create({
        data: {
          tenantId: tenant.tenantId,
          projectId: lakeview,
          workerId: worker.id,
          wagePeriodId: wages.id,
          type: 'wage',
          amount: 4_500_000n,
          paidOn: day('2026-04-16'),
          mode: 'cash',
          recordedBy: by,
        },
      });

      const contractor = await tx.contractor.create({
        data: { tenantId: tenant.tenantId, name: 'Ravi "Mason" Works', taxId: '33BBBBB1111B1Z6' },
      });
      const subcontract = await tx.subcontract.create({
        data: {
          tenantId: tenant.tenantId,
          projectId: lakeview,
          contractorId: contractor.id,
          number: 'SC-007',
          title: 'Brickwork',
          retentionBp: 500,
          taxRateBp: 1800,
          status: 'active',
        },
      });
      const bill = await tx.subcontractBill.create({
        data: {
          tenantId: tenant.tenantId,
          subcontractId: subcontract.id,
          number: 2,
          periodTo: day('2026-04-19'),
          billDate: day('2026-04-20'),
          status: 'certified',
          grossToDate: 10_000_000n,
          gross: 10_000_000n,
          retentionToDate: 500_000n,
          retention: 500_000n,
          advanceRecoveredToDate: 1_000_000n,
          advanceRecovery: 1_000_000n,
          deductions: 200_000n,
          taxRateBp: 1800,
          tax: 1_800_000n,
          netPayable: 10_100_000n,
          createdBy: by,
          certifiedBy: by,
          certifiedAt: new Date(),
        },
      });
      await tx.subcontractPayment.create({
        data: {
          tenantId: tenant.tenantId,
          subcontractId: subcontract.id,
          kind: 'bill',
          billId: bill.id,
          amount: 10_100_000n,
          paidOn: day('2026-04-30'),
          recordedBy: by,
        },
      });

      const stage = await tx.paymentStage.create({
        data: {
          tenantId: tenant.tenantId,
          projectId: lakeview,
          label: 'Slab casting',
          amount: 10_000_000n,
          taxAmount: 1_800_000n,
          raisedAt: new Date('2026-04-25T06:00:00.000Z'),
        },
      });
      // Raised at 23:30 IST on 30 April — 18:00 UTC: still April for an Indian company.
      await tx.paymentStage.create({
        data: {
          tenantId: tenant.tenantId,
          projectId: lakeview,
          label: 'Late on the last day',
          amount: 1_000_000n,
          raisedAt: new Date('2026-04-30T18:00:00.000Z'),
        },
      });
      // Not raised yet: not a sale.
      await tx.paymentStage.create({
        data: { tenantId: tenant.tenantId, projectId: lakeview, label: 'Handover', amount: 5_000_000n },
      });
      await tx.clientPayment.create({
        data: {
          tenantId: tenant.tenantId,
          projectId: lakeview,
          stageId: stage.id,
          amount: 5_000_000n,
          receivedOn: day('2026-04-28'),
          mode: 'bank',
          reference: 'NEFT 8812',
          recordedBy: by,
        },
      });
    });
  }

  beforeAll(async () => {
    test = await createTestApp();
    alpha = await onboardTenant(test, { name: 'Ledger Builders', phone: uniquePhone() });
    beta = await onboardTenant(test, { name: 'Other Books Builders', phone: uniquePhone() });
    owner = { Authorization: `Bearer ${alpha.accessToken}` };
    stranger = { Authorization: `Bearer ${beta.accessToken}` };
    lakeview = (
      await http().post('/v1/projects').set(owner).send({ name: 'Lakeview Towers', client_name: "Lakeview Residents' Association", status: 'active' }).expect(201)
    ).body.id;
    hillside = (await http().post('/v1/projects').set(owner).send({ name: 'Hillside', status: 'active' }).expect(201)).body.id;
    accounts = await invite('accounts', []);
    pm = await invite('project_manager', [lakeview]);
    await seed(alpha);
  });

  afterAll(async () => {
    if (alpha) await destroyTenant(test, alpha.tenantId);
    if (beta) await destroyTenant(test, beta.tenantId);
    await test.close();
  });

  it('is for accounts and owners: a project manager can neither map nor export', async () => {
    await http().get('/v1/accounting/settings').set(pm).expect(403);
    await http().put('/v1/accounting/mappings').set(pm).send({ system: 'tally', rows: [] }).expect(403);
    await http().post('/v1/accounting/preview').set(pm).send({ system: 'tally', ...period, include: ['purchases'] }).expect(403);
    await http().post('/v1/accounting/exports').set(pm).send({ system: 'tally', ...period, include: ['purchases'] }).expect(403);
    await http().get('/v1/accounting/exports').set(pm).expect(403);
    await http().get('/v1/accounting/settings').expect(401);

    const settings = await http().get('/v1/accounting/settings').set(accounts).expect(200);
    expect(settings.body).toMatchObject({ system: 'tally', tax_regime: 'gst_in', can_manage: true, posts_to_party_ledger: true });
    // Nothing is mapped until somebody accepts it: the suggestions are only suggestions.
    expect(settings.body.completeness.mapped).toBe(0);
    const fuel = settings.body.keys.find((row: { key: string }) => row.key === 'expense:fuel');
    expect(fuel).toMatchObject({ account: null, suggested: { code: '', name: 'Fuel Expenses' }, required: true });
    expect(settings.body.optional.map((row: { key: string }) => row.key)).toEqual(
      expect.arrayContaining(['expense:materials@1800', `site:${lakeview}`, `site:${hillside}`]),
    );
  });

  it('refuses an export while accounts are unmapped, and lists them', async () => {
    const preview = await http()
      .post('/v1/accounting/preview')
      .set(accounts)
      .send({ system: 'tally', ...period, include: everything })
      .expect(200);
    expect(preview.body.complete).toBe(false);

    const refused = await http()
      .post('/v1/accounting/exports')
      .set(accounts)
      .send({ system: 'tally', ...period, include: everything })
      .expect(409);
    const missing = refused.body.details.missing.map((item: { key: string }) => item.key);
    expect(missing).toEqual(
      expect.arrayContaining([
        'accounts_payable',
        'accounts_receivable',
        'expense:materials',
        'expense:fuel',
        // No GST state code saved yet: the Karnataka bill is taken as local, CGST and SGST.
        'input_cgst',
        'input_sgst',
        'wages_expense',
        'retention_payable',
        'sales_revenue',
        'output_cgst',
        'bank',
        'cash',
      ]),
    );
    expect(refused.body.details.missing[0]).toHaveProperty('example');
    expect(await test.tenantDb.clientFor(alpha.tenantId).accountingExportBatch.count()).toBe(0);
  });

  it('saves a mapping, needs codes where the system goes by code, and fills in the suggestions', async () => {
    await http()
      .put('/v1/accounting/settings')
      .set(accounts)
      .send({ system: 'tally', gst_home_state: '33', tally_company: 'Ledger Builders' })
      .expect(200);
    const saved = await http()
      .put('/v1/accounting/mappings')
      .set(accounts)
      .send({ system: 'tally', rows: [{ key: 'expense:fuel', name: 'Diesel & Fuel' }, { key: `site:${lakeview}`, name: 'LKV Towers' }] })
      .expect(200);
    expect(saved.body.keys.find((row: { key: string }) => row.key === 'expense:fuel').account).toEqual({ code: '', name: 'Diesel & Fuel' });

    // Xero identifies accounts by code.
    await http().put('/v1/accounting/mappings').set(accounts).send({ system: 'xero', rows: [{ key: 'bank', name: 'Bank' }] }).expect(422);
    await http().put('/v1/accounting/mappings').set(accounts).send({ system: 'tally', rows: [{ key: 'nonsense', name: 'x' }] }).expect(422);

    const filled = await http().post('/v1/accounting/mappings/defaults').set(accounts).send({ system: 'tally' }).expect(200);
    expect(filled.body.completeness.missing).toEqual([]);
    // Accepting the suggestions does not overwrite what was mapped by hand.
    expect(filled.body.keys.find((row: { key: string }) => row.key === 'expense:fuel').account.name).toBe('Diesel & Fuel');
  });

  it('previews the period: each record once, balanced, with totals by account', async () => {
    const preview = await http()
      .post('/v1/accounting/preview')
      .set(accounts)
      .send({ system: 'tally', ...period, include: everything })
      .expect(200);
    expect(preview.body.missing).toEqual([]);
    expect(preview.body.complete).toBe(true);
    expect(preview.body.counts).toEqual({ purchases: 3, payroll: 1, subcontract_bills: 1, sales: 2, payments: 3 });
    expect(preview.body.debit_total).toBe(preview.body.credit_total);
    const expenses = preview.body.vouchers.filter((voucher: { source_type: string }) => voucher.source_type === 'expense');
    // The two cash expenses; the one booked by the invoice's approval is not a second purchase.
    expect(expenses.map((voucher: { amount: string }) => voucher.amount).sort()).toEqual(['118000', '23600']);
    expect(preview.body.vouchers.filter((voucher: { source_type: string }) => voucher.source_type === 'purchase_invoice')).toHaveLength(1);
    const accountsByName = Object.fromEntries(
      preview.body.accounts.map((row: { name: string; debit: string; credit: string }) => [row.name, row]),
    );
    expect(accountsByName['Purchase @18%']).toMatchObject({ debit: '1000000', credit: '0' });
    // Lakeview's diesel net of IGST, and Hillside's untaxed bill.
    expect(accountsByName['Diesel & Fuel']).toMatchObject({ debit: '123600' });
    expect(accountsByName['Input IGST']).toMatchObject({ debit: '18000' });
    expect(accountsByName['Retention Money Payable']).toMatchObject({ credit: '500000' });
    expect(accountsByName['Labour Wages']).toMatchObject({ debit: '5000000' });
    // The late instalment counts in April on the company's clock.
    const sales = preview.body.vouchers.filter((voucher: { category: string }) => voucher.category === 'sales');
    expect(sales.map((voucher: { date: string }) => voucher.date)).toEqual(['2026-04-25', '2026-04-30']);
    expect(preview.body.masters.parties).toBeGreaterThanOrEqual(3);
    expect(preview.body.payroll_left_out).toBe(false);

    // One site: only its records, and wage periods — the company's — are left out.
    const oneSite = await http()
      .post('/v1/accounting/preview')
      .set(accounts)
      .send({ system: 'tally', ...period, project_ids: [hillside], include: everything })
      .expect(200);
    expect(oneSite.body.voucher_count).toBe(1);
    expect(oneSite.body.vouchers[0]).toMatchObject({ source_type: 'expense', site: 'Hillside', amount: '23600' });
    expect(oneSite.body.payroll_left_out).toBe(true);
  });

  it('exports to Tally, records the batch, and leaves the same transactions out next time', async () => {
    const created = await http()
      .post('/v1/accounting/exports')
      .set(accounts)
      .send({ system: 'tally', ...period, include: everything })
      .expect(201);
    tallyBatch = created.body.id;
    expect(created.body).toMatchObject({ number: 1, system: 'tally', voucher_count: 10, from: '2026-04-01', to: '2026-04-30' });
    expect(created.body.summary.debit_total).toBe(created.body.summary.credit_total);
    expect(created.body.files.map((file: { name: string }) => file.name)).toEqual([
      'batch-0001-tally-masters.xml',
      'batch-0001-tally-vouchers.xml',
      'batch-0001-chart-of-accounts-mapping.csv',
    ]);
    const db = test.tenantDb.clientFor(alpha.tenantId);
    expect(await db.accountingExportItem.count({ where: { batchId: tallyBatch } })).toBe(10);

    const vouchersFile = created.body.files.find((file: { name: string }) => file.name.endsWith('vouchers.xml'));
    const download = await http()
      .get(`/v1/accounting/exports/${tallyBatch}/files/${vouchersFile.id}`)
      .set(accounts)
      .buffer(true)
      .parse((response, done) => {
        let text = '';
        response.on('data', (chunk: Buffer) => (text += chunk.toString('utf8')));
        response.on('end', () => done(null, text));
      })
      .expect(200);
    expect(download.headers['content-disposition']).toContain('batch-0001-tally-vouchers.xml');
    const xml = download.body as string;
    expect(xml).toContain('<SVCURRENTCOMPANY>Ledger Builders</SVCURRENTCOMPANY>');
    expect(xml.match(/<VOUCHER /g)).toHaveLength(10);
    expect(xml).toContain('<LEDGERNAME>Diesel &amp; Fuel</LEDGERNAME>');
    expect(xml).toContain('<NAME>LKV Towers</NAME>');
    expect(xml).toContain('<LEDGERNAME>Input IGST</LEDGERNAME>');

    // Again: nothing new, so nothing to export — and the preview says why.
    const again = await http()
      .post('/v1/accounting/exports')
      .set(accounts)
      .send({ system: 'tally', ...period, include: ['purchases', 'payroll', 'subcontract_bills', 'sales', 'payments'] })
      .expect(409);
    expect(again.body.details.skipped).toBe(10);
    const preview = await http()
      .post('/v1/accounting/preview')
      .set(accounts)
      .send({ system: 'tally', ...period, include: ['purchases'] })
      .expect(200);
    expect(preview.body.voucher_count).toBe(0);
    expect(preview.body.skipped[0].exported_in).toMatchObject({ number: 1, system: 'tally' });

    // Ticking "include previously exported" brings them back, each marked with its batch.
    const included = await http()
      .post('/v1/accounting/preview')
      .set(accounts)
      .send({ system: 'tally', ...period, include: ['purchases'], include_exported: true })
      .expect(200);
    expect(included.body.voucher_count).toBe(3);
    expect(included.body.vouchers[0].exported_in.number).toBe(1);
  });

  it.each([
    ['quickbooks_online', ['quickbooks-online-bills.csv', 'quickbooks-online-invoices.csv', 'quickbooks-online-journal-entries.csv']],
    ['quickbooks_desktop', ['quickbooks-desktop.iif']],
    ['xero', ['xero-bills.csv', 'xero-sales-invoices.csv', 'xero-manual-journals.csv']],
    ['sap_b1', ['OPCH-ap-invoices.txt', 'PCH1-ap-invoices-lines.txt', 'OINV-ar-invoices.txt', 'OJDT-journal-entries.txt']],
    ['netsuite', ['netsuite-vendor-bills.csv', 'netsuite-invoices.csv', 'netsuite-journal-entries.csv']],
  ])('exports to %s once its mapping is complete', async (system, expected) => {
    const body = { system, ...period, include: everything, include_exported: true };
    const refused = await http().post('/v1/accounting/exports').set(owner).send(body).expect(409);
    expect(refused.body.details.missing.length).toBeGreaterThan(0);
    if (system === 'netsuite') {
      await http().put('/v1/accounting/settings').set(owner).send({ system, gst_home_state: '33', netsuite_subsidiary: 'Ledger Builders' }).expect(200);
    }
    await http().post('/v1/accounting/mappings/defaults').set(owner).send({ system }).expect(200);
    const created = await http().post('/v1/accounting/exports').set(owner).send(body).expect(201);
    expect(created.body.voucher_count).toBe(10);
    const names = created.body.files.map((file: { name: string }) => file.name.replace(/^batch-\d{4}-/, ''));
    expect(names).toEqual(expect.arrayContaining(expected));
    expect(created.body.summary.debit_total).toBe(created.body.summary.credit_total);
  });

  it('keeps the batch history, re-downloads what was written, and audits mappings and exports', async () => {
    const list = await http().get('/v1/accounting/exports').set(accounts).expect(200);
    expect(list.body.items.map((batch: { number: number }) => batch.number)).toEqual([6, 5, 4, 3, 2, 1]);
    expect(list.body.items.at(-1).id).toBe(tallyBatch);

    const audit = await test.tenantDb.clientFor(alpha.tenantId).auditLog.findMany({
      where: { entity: { in: ['accounting_account_maps', 'accounting_export_batches', 'accounting_settings'] } },
      select: { entity: true, action: true, actorId: true },
    });
    const entries = audit.map((row) => `${row.entity}:${row.action}`);
    expect(entries).toContain('accounting_settings:create');
    expect(entries).toContain('accounting_account_maps:create');
    expect(entries.filter((entry) => entry === 'accounting_export_batches:create')).toHaveLength(6);
    expect(audit.every((row) => row.actorId !== null)).toBe(true);
  });

  it('keeps one company’s books from another', async () => {
    await http().get(`/v1/accounting/exports/${tallyBatch}`).set(stranger).expect(404);
    const files = (await http().get(`/v1/accounting/exports/${tallyBatch}`).set(accounts).expect(200)).body.files;
    await http().get(`/v1/accounting/exports/${tallyBatch}/files/${files[0].id}`).set(stranger).expect(404);
    expect((await http().get('/v1/accounting/exports').set(stranger).expect(200)).body.items).toEqual([]);
    const settings = await http().get('/v1/accounting/settings').set(stranger).expect(200);
    expect(settings.body.completeness.mapped).toBe(0);

    await http().post('/v1/accounting/mappings/defaults').set(stranger).send({ system: 'tally' }).expect(200);
    const theirs = await http()
      .post('/v1/accounting/preview')
      .set(stranger)
      .send({ system: 'tally', ...period, include: everything })
      .expect(200);
    expect(theirs.body.voucher_count).toBe(0);
    expect(theirs.body.masters.parties).toBe(0);
    // Another company's site cannot be named in the filter either.
    const leaked = await http()
      .post('/v1/accounting/preview')
      .set(stranger)
      .send({ system: 'tally', ...period, project_ids: [lakeview], include: everything })
      .expect(200);
    expect(leaked.body.voucher_count).toBe(0);
  });
});
