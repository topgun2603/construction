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
 * Procurement (roadmap Phase 2, module 2): suppliers, quotes and their comparison, purchase orders
 * under approval limits, goods received into stock, the three-way match, invoices into expenses,
 * and the committed figure on the cost report rising and falling with all of it.
 */
describe('procurement', () => {
  let test: TestApp;
  let alpha: OnboardedTenant;
  let beta: OnboardedTenant;
  let owner: Auth;
  let other: Auth;
  let pm: { id: string; auth: Auth };
  let supervisor: { id: string; auth: Auth };
  let accounts: { id: string; auth: Auth };
  let site: string;
  let cement: string;
  let steel: string;
  let concreteCode: string;
  let steelCode: string;
  let vendorA: string;
  let vendorB: string;
  const today = todayIn('Asia/Kolkata');

  const http = () => test.http();

  async function invite(role: string, name: string, projectIds: string[]) {
    const phone = uniquePhone();
    const created = await http()
      .post('/v1/tenants/current/invite')
      .set(owner)
      .send({ phone, name, role, project_ids: projectIds })
      .expect(201);
    const login = await http().post('/v1/auth/exchange').send({ firebase_token: `dev:${phone}` }).expect(200);
    return { id: created.body.id as string, auth: { Authorization: `Bearer ${login.body.access_token}` } };
  }

  async function committed(code: string) {
    const { body } = await http().get(`/v1/projects/${site}/cost-report`).set(owner).expect(200);
    const line = body.lines.find((row: { id: string }) => row.id === code);
    return { line: line.own as { committed: string; actual: string }, body };
  }

  async function onHand(materialId: string): Promise<string> {
    const { body } = await http().get('/v1/stock').query({ project_id: site }).set(owner).expect(200);
    return body.items.find((row: { material_id: string }) => row.material_id === materialId)?.on_hand ?? '0';
  }

  beforeAll(async () => {
    test = await createTestApp();
    alpha = await onboardTenant(test, { name: 'Buying Builders', phone: uniquePhone(), plan: 'one_year' });
    beta = await onboardTenant(test, { name: 'Prying Builders', phone: uniquePhone(), plan: 'one_year' });
    owner = { Authorization: `Bearer ${alpha.accessToken}` };
    other = { Authorization: `Bearer ${beta.accessToken}` };

    site = (await http().post('/v1/projects').set(owner).send({ name: 'Harbour Flats', status: 'active' }).expect(201))
      .body.id;
    const material = async (name: string, unit: string) =>
      (await http().post('/v1/materials').set(owner).send({ name: `${name} ${Date.now()}`, unit }).expect(201)).body
        .id as string;
    cement = await material('Cement', 'bag');
    steel = await material('Steel', 'kg');
    const code = async (code: string, name: string) =>
      (await http().post(`/v1/projects/${site}/cost-codes`).set(owner).send({ code, name, budget: '100000000' }).expect(201))
        .body.id as string;
    concreteCode = await code('03', 'Concrete');
    steelCode = await code('04', 'Reinforcement');

    pm = await invite('project_manager', 'Priya PM', [site]);
    supervisor = await invite('site_supervisor', 'Sam Supervisor', [site]);
    accounts = await invite('accounts', 'Asha Accounts', []);
  });

  afterAll(async () => {
    if (alpha) await destroyTenant(test, alpha.tenantId);
    if (beta) await destroyTenant(test, beta.tenantId);
    await test.close();
  });

  describe('suppliers', () => {
    it('adds, edits and lists suppliers, validating the tax number against the regime', async () => {
      // India: a GSTIN with a wrong check digit is refused, not stored.
      const bad = await http()
        .post('/v1/vendors')
        .set(owner)
        .send({ name: 'Bad GST Traders', tax_id: '27AAPFU0939F1ZX' })
        .expect(422);
      expect(bad.body.message).toMatch(/GSTIN/);

      const a = await http()
        .post('/v1/vendors')
        .set(owner)
        .send({
          name: 'Anand Cements',
          contact_name: 'Anand',
          phone: '9876543210',
          email: 'Sales@Anand.example',
          tax_id: '27aapfu0939f1zv',
          payment_terms_days: 30,
        })
        .expect(201);
      expect(a.body).toMatchObject({
        name: 'Anand Cements',
        tax_id: '27AAPFU0939F1ZV',
        phone: '919876543210',
        email: 'sales@anand.example',
        payment_terms_days: 30,
        active: true,
      });
      vendorA = a.body.id;

      vendorB = (await http().post('/v1/vendors').set(owner).send({ name: 'Bharat Steel' }).expect(201)).body.id;
      await http().post('/v1/vendors').set(owner).send({ name: 'anand cements' }).expect(409);

      const edited = await http()
        .patch(`/v1/vendors/${vendorB}`)
        .set(owner)
        .send({ address: 'Plot 4, MIDC', payment_terms_days: 15 })
        .expect(200);
      expect(edited.body.address).toBe('Plot 4, MIDC');
      await http().patch(`/v1/vendors/${vendorB}`).set(owner).send({ tax_id: 'NOT-A-GSTIN' }).expect(422);

      // Deleting one nothing references is allowed.
      const spare = (await http().post('/v1/vendors').set(owner).send({ name: 'Spare Supplier' }).expect(201)).body.id;
      await http().delete(`/v1/vendors/${spare}`).set(owner).expect(204);

      const list = await http().get('/v1/vendors').set(owner).expect(200);
      expect(list.body.map((row: { name: string }) => row.name)).toEqual(['Anand Cements', 'Bharat Steel']);
      // A supervisor manages no suppliers.
      await http().post('/v1/vendors').set(supervisor.auth).send({ name: 'Nope' }).expect(403);
    });
  });

  describe('quotes and the comparison', () => {
    let rfqId: string;
    let items: Array<{ id: string; material_id: string }>;
    let quoteA: string;
    let quoteB: string;

    it('starts an RFQ from an approved indent', async () => {
      const indent = await http()
        .post('/v1/indents')
        .set(supervisor.auth)
        .send({
          project_id: site,
          items: [
            { material_id: cement, quantity: '100' },
            { material_id: steel, quantity: '500' },
          ],
        })
        .expect(201);
      // Not approved yet: quotes are asked for an approved indent.
      await http()
        .post('/v1/rfqs')
        .set(pm.auth)
        .send({ project_id: site, title: 'Slab 2', indent_id: indent.body.id })
        .expect(409);
      await http().patch(`/v1/indents/${indent.body.id}/status`).set(pm.auth).send({ status: 'approved' }).expect(200);

      const rfq = await http()
        .post('/v1/rfqs')
        .set(pm.auth)
        .send({ project_id: site, title: 'Slab 2', indent_id: indent.body.id })
        .expect(201);
      expect(rfq.body.number).toMatch(/^RFQ-\d{4}$/);
      expect(rfq.body.items).toHaveLength(2);
      rfqId = rfq.body.id;
      items = rfq.body.items;
    });

    it('compares quotes side by side: cheapest per item and overall', async () => {
      const cementItem = items.find((item) => item.material_id === cement)!.id;
      const steelItem = items.find((item) => item.material_id === steel)!.id;
      const a = await http()
        .put(`/v1/rfqs/${rfqId}/quotes`)
        .set(pm.auth)
        .send({
          vendor_id: vendorA,
          delivery_days: 3,
          lines: [
            { rfq_item_id: cementItem, unit_rate: '40000', tax_rate_bp: 1800 },
            { rfq_item_id: steelItem, unit_rate: '7000', tax_rate_bp: 1800 },
          ],
        })
        .expect(200);
      quoteA = a.body.quotes[0].id;
      const b = await http()
        .put(`/v1/rfqs/${rfqId}/quotes`)
        .set(pm.auth)
        .send({
          vendor_id: vendorB,
          delivery_days: 5,
          lines: [
            { rfq_item_id: cementItem, unit_rate: '42000', tax_rate_bp: 1800 },
            { rfq_item_id: steelItem, unit_rate: '6500', tax_rate_bp: 1800 },
          ],
        })
        .expect(200);
      quoteB = b.body.quotes.find((quote: { vendor: { id: string } }) => quote.vendor.id === vendorB).id;

      const comparison = b.body.comparison;
      const lowest = (item: string) =>
        comparison.items.find((row: { rfq_item_id: string }) => row.rfq_item_id === item).lowest_quote_id;
      expect(lowest(cementItem)).toBe(quoteA);
      expect(lowest(steelItem)).toBe(quoteB);
      // A: 4,000,000 + 3,500,000 = 7,500,000 net; B: 4,200,000 + 3,250,000 = 7,450,000 net.
      expect(comparison.lowest_quote_id).toBe(quoteB);
      expect(comparison.quotes.find((q: { quote_id: string }) => q.quote_id === quoteB).total).toBe(
        String(7_450_000 + 1_341_000),
      );
      // Cement from A (4,720,000 with tax) and steel from B (3,835,000 with tax).
      expect(comparison.best_split_total).toBe('8555000');
    });

    it('awards the winner as a draft purchase order with the RFQ’s items', async () => {
      const award = await http()
        .post(`/v1/rfqs/${rfqId}/award`)
        .set(pm.auth)
        .send({ quote_id: quoteB })
        .expect(200);
      expect(award.body.rfq.status).toBe('awarded');
      const order = await http().get(`/v1/purchase-orders/${award.body.purchase_order_id}`).set(pm.auth).expect(200);
      expect(order.body).toMatchObject({ status: 'draft', rfq_id: rfqId, total: String(7_450_000 + 1_341_000) });
      expect(order.body.vendor.id).toBe(vendorB);
      expect(order.body.number).toMatch(/^PO-\d{5}$/);
      // An awarded RFQ takes no more quotes.
      await http()
        .put(`/v1/rfqs/${rfqId}/quotes`)
        .set(pm.auth)
        .send({ vendor_id: vendorA, lines: [{ rfq_item_id: items[0]!.id, unit_rate: '1', tax_rate_bp: 0 }] })
        .expect(409);
      // Tidy: cancel this order so the rest of the suite starts from a known commitment.
      await http().post(`/v1/purchase-orders/${order.body.id}/cancel`).set(pm.auth).expect(200);
    });
  });

  describe('approval limits', () => {
    let small: string;
    let big: string;

    const draft = (quantity: string, rate: string, auth: Auth = pm.auth) =>
      http()
        .post('/v1/purchase-orders')
        .set(auth)
        .send({
          project_id: site,
          vendor_id: vendorA,
          lines: [{ material_id: cement, quantity, unit_rate: rate, tax_rate_bp: 1800, cost_code_id: concreteCode }],
        })
        .expect(201);

    it('lets only the owner set limits', async () => {
      const roles = await http().get('/v1/roles').set(owner).expect(200);
      const pmRole = roles.body.find((role: { base_role: string; is_system: boolean }) =>
        role.base_role === 'project_manager' && role.is_system,
      );
      await http()
        .put('/v1/procurement/settings')
        .set(pm.auth)
        .send({ limits: [{ role_id: pmRole.id, max_amount: null }] })
        .expect(403);
      // Project managers may approve up to ₹50,000; the tolerance for the match is 2%.
      const saved = await http()
        .put('/v1/procurement/settings')
        .set(owner)
        .send({ match_tolerance_bp: 200, limits: [{ role_id: pmRole.id, max_amount: '5000000' }] })
        .expect(200);
      expect(saved.body.limits).toHaveLength(1);
      const mine = await http().get('/v1/procurement/settings').set(pm.auth).expect(200);
      expect(mine.body.my_limit).toBe('5000000');
    });

    it('approves an order within the requester’s own limit on submission', async () => {
      // 100 bags × ₹400 + 18% = ₹47,200 — under ₹50,000.
      small = (await draft('100', '40000')).body.id;
      const submitted = await http().post(`/v1/purchase-orders/${small}/submit`).set(pm.auth).expect(200);
      expect(submitted.body.status).toBe('approved');
      expect(submitted.body.approved_by.id).toBe(pm.id);
      expect(submitted.body.approved_at).toBeTruthy();
    });

    it('sends one above the limit for approval, notifies, and refuses an approver without the limit', async () => {
      // 200 bags × ₹400 + 18% = ₹94,400.
      big = (await draft('200', '40000')).body.id;
      const submitted = await http().post(`/v1/purchase-orders/${big}/submit`).set(pm.auth).expect(200);
      expect(submitted.body.status).toBe('pending_approval');

      // The owner, the only one whose limit covers it, is told.
      const inbox = await http().get('/v1/notifications').set(owner).expect(200);
      const items = inbox.body.items ?? inbox.body;
      expect(
        items.some(
          (row: { type: string; payload: { purchase_order_id?: string } }) =>
            row.type === 'purchase_order.approval_needed' && row.payload.purchase_order_id === big,
        ),
      ).toBe(true);

      const refused = await http().post(`/v1/purchase-orders/${big}/approve`).set(pm.auth).send({}).expect(403);
      expect(refused.body.message).toMatch(/above your approval limit/);
      // Accounts cannot approve orders at all.
      await http().post(`/v1/purchase-orders/${big}/approve`).set(accounts.auth).send({}).expect(403);

      // Sent back with a reason, raised again, approved by the owner.
      const back = await http()
        .post(`/v1/purchase-orders/${big}/reject`)
        .set(owner)
        .send({ note: 'Split by pour' })
        .expect(200);
      expect(back.body).toMatchObject({ status: 'draft', decision_note: 'Split by pour' });
      await http().post(`/v1/purchase-orders/${big}/submit`).set(pm.auth).expect(200);
      const approved = await http()
        .post(`/v1/purchase-orders/${big}/approve`)
        .set(owner)
        .send({ note: 'OK for slab 2' })
        .expect(200);
      expect(approved.body).toMatchObject({ status: 'approved', decision_note: 'OK for slab 2' });
      expect(approved.body.approved_by.id).toBe(alpha.ownerId);

      // Cancel the big one: the rest of the suite runs on `small`.
      await http().post(`/v1/purchase-orders/${big}/cancel`).set(owner).expect(200);
      await http().post(`/v1/purchase-orders/${big}/approve`).set(owner).send({}).expect(409);
    });

    it('commits the approved order on the cost report', async () => {
      const { line, body } = await committed(concreteCode);
      expect(body.committed_sources).toContain('purchase_orders');
      expect(line.committed).toBe('4720000');
    });

    describe('goods received', () => {
      it('receives part of the order into stock, then the rest', async () => {
        const order = await http().get(`/v1/purchase-orders/${small}`).set(supervisor.auth).expect(200);
        // A supervisor signs for deliveries but does not see what they cost.
        expect(order.body.total).toBeNull();
        const lineId = order.body.lines[0].id;
        await http().post(`/v1/purchase-orders/${small}/send`).set(pm.auth).expect(200);

        const before = Number(await onHand(cement));
        const first = await http()
          .post(`/v1/purchase-orders/${small}/receipts`)
          .set(supervisor.auth)
          .send({ received_on: today, ref: 'CH-101', lines: [{ po_line_id: lineId, quantity: '60' }] })
          .expect(201);
        expect(first.body.status).toBe('partially_received');
        expect(first.body.lines[0].received_quantity).toBe('60');
        expect(Number(await onHand(cement))).toBe(before + 60);

        // More than is still to come is refused.
        await http()
          .post(`/v1/purchase-orders/${small}/receipts`)
          .set(supervisor.auth)
          .send({ received_on: today, lines: [{ po_line_id: lineId, quantity: '41' }] })
          .expect(409);

        const movements = await http()
          .get('/v1/stock/movements')
          .query({ project_id: site, material_id: cement })
          .set(owner)
          .expect(200);
        expect(movements.body.items.some((row: { ref: string | null }) => row.ref === 'CH-101')).toBe(true);
      });
    });

    describe('three-way match and invoices', () => {
      let lineId: string;

      beforeAll(async () => {
        const order = await http().get(`/v1/purchase-orders/${small}`).set(owner).expect(200);
        lineId = order.body.lines[0].id;
      });

      const record = (number: string, quantity: string, rate: string, tax: string) =>
        http()
          .post(`/v1/purchase-orders/${small}/invoices`)
          .set(accounts.auth)
          .send({
            invoice_number: number,
            invoice_date: today,
            lines: [{ po_line_id: lineId, quantity, unit_rate: rate, tax_amount: tax }],
          });

      it('flags billed-but-not-received, a price variance and a tax variance', async () => {
        // 80 billed, 60 received.
        const ahead = await record('INV-AHEAD', '80', '40000', '576000').expect(201);
        expect(ahead.body.status).toBe('mismatch');
        expect(ahead.body.flags.map((flag: { type: string }) => flag.type)).toEqual(['billed_not_received']);
        await http().post(`/v1/purchase-invoices/${ahead.body.id}/reject`).set(accounts.auth).send({ note: 'Ahead of delivery' }).expect(200);

        const pricey = await record('INV-PRICE', '60', '42000', '453600').expect(201);
        expect(pricey.body.flags.map((flag: { type: string }) => flag.type)).toEqual(['price_variance']);
        await http().delete(`/v1/purchase-invoices/${pricey.body.id}`).set(accounts.auth).expect(204);

        const taxed = await record('INV-TAX', '60', '40000', '600000').expect(201);
        expect(taxed.body.flags.map((flag: { type: string }) => flag.type)).toEqual(['tax_variance']);
        // A flagged invoice is not approved by default, and accounts cannot accept the difference.
        await http().post(`/v1/purchase-invoices/${taxed.body.id}/approve`).set(accounts.auth).send({}).expect(409);
        await http()
          .post(`/v1/purchase-invoices/${taxed.body.id}/approve`)
          .set(accounts.auth)
          .send({ accept_variance: true, note: 'fine' })
          .expect(403);
        await http().delete(`/v1/purchase-invoices/${taxed.body.id}`).set(accounts.auth).expect(204);
      });

      it('matches an invoice for what was received, and booking it moves committed to actual', async () => {
        const before = await committed(concreteCode);
        const invoice = await record('INV-001', '60', '40000', '432000').expect(201);
        expect(invoice.body).toMatchObject({ status: 'matched', flags: [], total: '2832000' });
        // The same supplier invoice twice is how a bill gets paid twice.
        await record('INV-001', '1', '40000', '7200').expect(409);

        const approved = await http()
          .post(`/v1/purchase-invoices/${invoice.body.id}/approve`)
          .set(accounts.auth)
          .send({})
          .expect(200);
        expect(approved.body.status).toBe('approved');
        const expenseId = approved.body.lines[0].expense_id;
        expect(expenseId).toBeTruthy();

        const expense = await http().get(`/v1/expenses/${expenseId}`).set(owner).expect(200);
        expect(expense.body).toMatchObject({
          amount: '2832000',
          tax_amount: '432000',
          status: 'approved',
          supplier_tax_id: '27AAPFU0939F1ZV',
          cost_code: { id: concreteCode, code: '03', name: 'Concrete' },
        });

        const after = await committed(concreteCode);
        expect(BigInt(after.line.committed)).toBe(BigInt(before.line.committed) - 2_832_000n);
        expect(BigInt(after.line.actual)).toBe(BigInt(before.line.actual) + 2_832_000n);
        expect(after.line.committed).toBe('1888000');
      });

      it('flags over-billing beyond the order once the rest arrives', async () => {
        await http()
          .post(`/v1/purchase-orders/${small}/receipts`)
          .set(supervisor.auth)
          .send({ received_on: today, lines: [{ po_line_id: lineId, quantity: '40' }] })
          .expect(201)
          .expect((res) => expect(res.body.status).toBe('received'));

        // 60 billed already; 45 more would be 105 against an order of 100 (more than 2% over).
        const over = await record('INV-OVER', '45', '40000', '324000').expect(201);
        expect(over.body.flags.map((flag: { type: string }) => flag.type).sort()).toEqual([
          'billed_not_received',
          'over_billed_qty',
        ]);
        await http().post(`/v1/purchase-invoices/${over.body.id}/reject`).set(accounts.auth).send({ note: 'Over' }).expect(200);

        // The owner may accept a difference, with a reason: ₹410 against an agreed ₹400 is 2.5%.
        const close = await record('INV-002', '40', '41000', '295200').expect(201);
        expect(close.body.flags.map((flag: { type: string }) => flag.type)).toEqual(['price_variance']);
        await http()
          .post(`/v1/purchase-invoices/${close.body.id}/approve`)
          .set(owner)
          .send({ accept_variance: true, note: 'Diesel surcharge agreed by phone' })
          .expect(200);

        // Fully billed: nothing left committed on the line, never below zero.
        const after = await committed(concreteCode);
        expect(after.line.committed).toBe('0');
      });
    });
  });

  describe('cost codes', () => {
    it('refuses to delete a cost code a purchase order line uses', async () => {
      // A line with only an order against it — no expense yet — is still in use.
      await http()
        .post('/v1/purchase-orders')
        .set(pm.auth)
        .send({
          project_id: site,
          vendor_id: vendorA,
          lines: [{ material_id: steel, quantity: '10', unit_rate: '7000', tax_rate_bp: 1800, cost_code_id: steelCode }],
        })
        .expect(201);
      const res = await http().delete(`/v1/projects/${site}/cost-codes/${steelCode}`).set(owner).expect(409);
      expect(res.body.message).toMatch(/Purchase orders/);
      // An unused code still goes.
      const spare = await http()
        .post(`/v1/projects/${site}/cost-codes`)
        .set(owner)
        .send({ code: '09', name: 'Spare' })
        .expect(201);
      await http().delete(`/v1/projects/${site}/cost-codes/${spare.body.id}`).set(owner).expect(204);
    });
  });

  describe('listing, export and isolation', () => {
    it('lists orders and exports them as CSV', async () => {
      const list = await http().get('/v1/purchase-orders').query({ project_id: site }).set(owner).expect(200);
      expect(list.body.length).toBeGreaterThanOrEqual(3);
      const csv = await http().get('/v1/purchase-orders/export').query({ project_id: site }).set(owner).expect(200);
      expect(csv.headers['content-type']).toMatch(/text\/csv/);
      expect(csv.text.split('\r\n')[0]).toContain('PO number');
      expect(csv.text).toContain('Anand Cements');
      // Supervisors do not export prices.
      await http().get('/v1/purchase-orders/export').set(supervisor.auth).expect(403);
    });

    it('keeps another company out of every procurement record', async () => {
      const orders = await http().get('/v1/purchase-orders').set(owner).expect(200);
      const orderId = orders.body[0].id;
      await http().get(`/v1/purchase-orders/${orderId}`).set(other).expect(404);
      await http().get(`/v1/vendors/${vendorA}`).set(other).expect(404);
      await http().patch(`/v1/vendors/${vendorA}`).set(other).send({ name: 'Mine now' }).expect(404);
      expect((await http().get('/v1/vendors').set(other).expect(200)).body).toEqual([]);
      expect((await http().get('/v1/purchase-orders').set(other).expect(200)).body).toEqual([]);
      expect((await http().get('/v1/purchase-invoices').set(other).expect(200)).body).toEqual([]);
      expect((await http().get('/v1/rfqs').set(other).expect(200)).body).toEqual([]);
      await http()
        .post('/v1/purchase-orders')
        .set(other)
        .send({
          project_id: site,
          vendor_id: vendorA,
          lines: [{ description: 'x', unit: 'nos', quantity: '1', unit_rate: '1', tax_rate_bp: 0 }],
        })
        .expect(404);
    });

    it('writes every change to the audit log', async () => {
      const orders = await http().get('/v1/purchase-orders').set(owner).expect(200);
      const orderId = orders.body.find((row: { status: string }) => row.status === 'received').id;
      const log = await http()
        .get('/v1/audit')
        .query({ entity: 'purchase_orders', entity_id: orderId })
        .set(owner)
        .expect(200);
      const actions = log.body.items.map((row: { action: string }) => row.action);
      expect(actions).toContain('create');
      expect(actions).toContain('update');
      const approval = log.body.items.find((row: { changed_fields: string[] }) =>
        row.changed_fields.includes('approved_by'),
      );
      expect(approval).toBeTruthy();

      for (const entity of ['vendors', 'goods_receipts', 'purchase_invoices', 'purchase_rfqs', 'purchase_quotes']) {
        const rows = await http().get('/v1/audit').query({ entity }).set(owner).expect(200);
        expect(rows.body.items.length).toBeGreaterThan(0);
      }
    });
  });
});
