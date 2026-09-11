import {
  createTestApp,
  destroyTenant,
  onboardTenant,
  uniquePhone,
  type OnboardedTenant,
  type TestApp,
} from './utils/test-app';

/**
 * Materials stock (spec §3 item 10, §7 Phase 2).
 *
 * Stock is a running sum, so the tests that matter are about the arithmetic staying exact and the
 * ledger never claiming something that did not happen — particularly when a GRN is corrected,
 * where the naive fix posts phantom consumption.
 */
describe('stock', () => {
  let test: TestApp;
  let tenant: OnboardedTenant;
  let owner: Record<string, string>;
  let projectId: string;
  let cementId: string;
  let steelId: string;

  beforeAll(async () => {
    test = await createTestApp();
    // Stock is a Pro module; a Starter tenant is refused at the plan guard.
    tenant = await onboardTenant(test, {
      name: 'Stock Builders',
      phone: uniquePhone(),
      plan: 'pro',
    });
    owner = { Authorization: `Bearer ${tenant.accessToken}` };

    const project = await test
      .http()
      .post('/v1/projects')
      .set(owner)
      .send({ name: 'Stock Site' })
      .expect(201);
    projectId = project.body.id;

    const make = async (name: string, unit: string) => {
      const response = await test
        .http()
        .post('/v1/materials')
        .set(owner)
        .send({ name: `${name} ${Date.now()}`, unit })
        .expect(201);
      return response.body.id as string;
    };
    cementId = await make('Cement', 'bag');
    steelId = await make('Steel', 'kg');
  });

  afterAll(async () => {
    if (tenant) await destroyTenant(test, tenant.tenantId);
    await test.close();
  });

  /**
   * Not `async`: supertest's chainable object is thenable, and wrapping it in a promise would
   * lose `.expect()` at the call site.
   */
  function move(
    materialId: string,
    type: 'in' | 'out',
    quantity: string,
    movedOn = '2026-10-05',
  ) {
    return test
      .http()
      .post('/v1/stock/movements')
      .set(owner)
      .send({ project_id: projectId, material_id: materialId, type, quantity, moved_on: movedOn });
  }

  async function onHand(materialId: string) {
    const response = await test
      .http()
      .get(`/v1/stock?project_id=${projectId}`)
      .set(owner)
      .expect(200);
    return response.body.items.find(
      (row: { material_id: string }) => row.material_id === materialId,
    );
  }

  it('adds up the ledger exactly', async () => {
    await move(cementId, 'in', '100').expect(201);
    await move(cementId, 'out', '37.5').expect(201);
    await move(cementId, 'in', '0.25').expect(201);

    const row = await onHand(cementId);
    expect(row.received).toBe('100.25');
    expect(row.used).toBe('37.5');
    expect(row.on_hand).toBe('62.75');
    // Trailing zeros trimmed: "62.75 bags", not "62.750 bags".
    expect(row.on_hand).not.toMatch(/0$/);
  });

  it('sums fractions that floating point would get wrong', async () => {
    for (const q of ['0.1', '0.2', '0.3']) await move(steelId, 'in', q).expect(201);

    const row = await onHand(steelId);
    // 0.1 + 0.2 + 0.3 is 0.6000000000000001 in floating point.
    expect(row.received).toBe('0.6');
  });

  it('refuses to issue more than the site has', async () => {
    const response = await move(steelId, 'out', '5').expect(409);
    expect(response.body.message).toMatch(/on site/i);
    expect(response.body.details.on_hand).toBe('0.6');

    // And the balance is untouched by the refusal.
    expect((await onHand(steelId)).on_hand).toBe('0.6');
  });

  it('rejects more precision than a quantity can hold', async () => {
    // A caller sending 0.3333 has a unit conversion wrong and should hear about it.
    await move(cementId, 'in', '0.3333').expect(422);
    await move(cementId, 'in', '0').expect(422);
    await move(cementId, 'in', '-5').expect(422);
  });

  describe('GRN on receipt', () => {
    async function raiseAndApprove(materialId: string, quantity: string) {
      const indent = await test
        .http()
        .post('/v1/indents')
        .set(owner)
        .send({
          project_id: projectId,
          urgency: 'normal',
          items: [{ material_id: materialId, quantity }],
        })
        .expect(201);
      await test
        .http()
        .patch(`/v1/indents/${indent.body.id}/status`)
        .set(owner)
        .send({ status: 'approved' })
        .expect(200);
      return indent.body.id as string;
    }

    it('books stock in when an indent is received', async () => {
      const before = (await onHand(cementId)).on_hand;
      const indentId = await raiseAndApprove(cementId, '40');

      // 40 ordered, 37 turned up. The gap is the point of recording it per line.
      await test
        .http()
        .patch(`/v1/indents/${indentId}/status`)
        .set(owner)
        .send({
          status: 'received',
          received: [{ material_id: cementId, received_quantity: '37' }],
        })
        .expect(200);

      const after = await onHand(cementId);
      expect(Number(after.on_hand)).toBeCloseTo(Number(before) + 37, 3);

      // The movement traces back to the indent it came from.
      const ledger = await test
        .http()
        .get(`/v1/stock/movements?project_id=${projectId}&material_id=${cementId}`)
        .set(owner)
        .expect(200);
      const grn = ledger.body.items.find(
        (row: { indent_id: string | null }) => row.indent_id === indentId,
      );
      expect(grn).toBeDefined();
      expect(grn.quantity).toBe('37');
      expect(grn.type).toBe('in');
    });

    it('rewrites the GRN on correction instead of inventing consumption', async () => {
      const indentId = await raiseAndApprove(steelId, '100');

      await test
        .http()
        .patch(`/v1/indents/${indentId}/status`)
        .set(owner)
        .send({
          status: 'received',
          received: [{ material_id: steelId, received_quantity: '100' }],
        })
        .expect(200);
      const afterFirst = await onHand(steelId);

      /*
       * Recount: only 97 actually arrived. This goes through the receipt endpoint, not the status
       * one — `received` is a terminal status, so a second status call is correctly refused, and
       * what changed is the count rather than where the indent has got to.
       */
      await test
        .http()
        .patch(`/v1/indents/${indentId}/status`)
        .set(owner)
        .send({
          status: 'received',
          received: [{ material_id: steelId, received_quantity: '97' }],
        })
        .expect(409);

      await test
        .http()
        .patch(`/v1/indents/${indentId}/receipt`)
        .set(owner)
        .send({ items: [{ material_id: steelId, received_quantity: '97' }] })
        .expect(200);

      const afterCorrection = await onHand(steelId);
      // Three fewer on hand, and crucially `used` has not moved — posting the difference as an
      // `out` movement would have claimed three kilos were consumed on site.
      expect(Number(afterCorrection.on_hand)).toBeCloseTo(Number(afterFirst.on_hand) - 3, 3);
      expect(afterCorrection.used).toBe(afterFirst.used);
    });

    it('refuses to correct a delivery that has not happened', async () => {
      const indentId = await raiseAndApprove(cementId, '10');
      const refused = await test
        .http()
        .patch(`/v1/indents/${indentId}/receipt`)
        .set(owner)
        .send({ items: [{ material_id: cementId, received_quantity: '10' }] })
        .expect(409);
      expect(refused.body.message).toMatch(/no delivery to correct/i);
    });
  });

  describe('estimates and overrun', () => {
    it('sets estimates idempotently and revises them', async () => {
      const first = await test
        .http()
        .put(`/v1/stock/estimates/${projectId}`)
        .set(owner)
        .send({
          items: [
            { material_id: cementId, estimated_quantity: '120', note: 'Ground floor slab' },
            { material_id: steelId, estimated_quantity: '2500' },
          ],
        })
        .expect(200);
      expect(first.body).toHaveLength(2);

      // Sending it again revises rather than duplicating — a bill of quantities gets reissued.
      const second = await test
        .http()
        .put(`/v1/stock/estimates/${projectId}`)
        .set(owner)
        .send({ items: [{ material_id: cementId, estimated_quantity: '150' }] })
        .expect(200);
      expect(second.body).toHaveLength(2);
      const cement = second.body.find(
        (row: { material_id: string }) => row.material_id === cementId,
      );
      expect(cement.estimated_quantity).toBe('150');
      // The material not sent this time is left alone, not wiped.
      expect(
        second.body.some((row: { material_id: string }) => row.material_id === steelId),
      ).toBe(true);
    });

    it('measures consumption against estimate, not delivery', async () => {
      const response = await test
        .http()
        .get(`/v1/stock/overrun?project_id=${projectId}`)
        .set(owner)
        .expect(200);

      const cement = response.body.items.find(
        (row: { material_id: string }) => row.material_id === cementId,
      );
      expect(cement.estimated).toBe('150');
      // Material in the store has been paid for but not used; counting delivery as consumption
      // would flag an overrun on a site that simply took delivery early.
      expect(Number(cement.received)).toBeGreaterThan(Number(cement.consumed));
      expect(cement.over).toBe(false);
    });

    it('flags a material that has gone over', async () => {
      const small = await test
        .http()
        .post('/v1/materials')
        .set(owner)
        .send({ name: `Sand ${Date.now()}`, unit: 'cum' })
        .expect(201);

      await test
        .http()
        .put(`/v1/stock/estimates/${projectId}`)
        .set(owner)
        .send({ items: [{ material_id: small.body.id, estimated_quantity: '10' }] })
        .expect(200);
      await move(small.body.id, 'in', '20').expect(201);
      await move(small.body.id, 'out', '13').expect(201);

      const response = await test
        .http()
        .get(`/v1/stock/overrun?project_id=${projectId}`)
        .set(owner)
        .expect(200);

      const sand = response.body.items.find(
        (row: { material_id: string }) => row.material_id === small.body.id,
      );
      expect(sand.consumed).toBe('13');
      expect(sand.variance).toBe('3');
      expect(sand.over).toBe(true);
      expect(sand.percent_used).toBe(130);

      // Worst overrun first: the report exists to surface the problem.
      expect(response.body.items[0].material_id).toBe(small.body.id);
      expect(response.body.totals.over_estimate).toBeGreaterThanOrEqual(1);
    });

    it('says nothing rather than zero when no estimate exists', async () => {
      const response = await test
        .http()
        .get(`/v1/stock/overrun?project_id=${projectId}&estimated_only=false`)
        .set(owner)
        .expect(200);

      const unestimated = response.body.items.find(
        (row: { estimated: string }) => row.estimated === '0',
      );
      if (unestimated) {
        // "0% used" reads as on budget, which is not the same as "nobody said what this takes".
        expect(unestimated.percent_used).toBeNull();
      }
    });
  });

  it('is refused entirely on a Starter plan', async () => {
    const starter = await onboardTenant(test, {
      name: 'Starter Stock',
      phone: uniquePhone(),
    });
    try {
      const refused = await test
        .http()
        .get('/v1/stock')
        .set({ Authorization: `Bearer ${starter.accessToken}` })
        .expect(403);
      expect(refused.body.code).toBe('MODULE_NOT_ENABLED');
    } finally {
      await destroyTenant(test, starter.tenantId);
    }
  });
});
