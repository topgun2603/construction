import { describe, expect, it } from 'vitest';
import {
  CHANGE_ORDER_STATUSES,
  changeOrderApplicableDelta,
  changeOrderCanMove,
  changeOrderExcerpt,
  changeOrderFigures,
  changeOrderLabel,
  changeOrderLineCost,
  changeOrderRegisterCsv,
  changeOrderScopeCreepMatch,
} from './change-orders';
import { changeOrderLineSchema, createChangeOrderSchema } from './schemas/change-orders';

describe('change order figures', () => {
  it('prices a measured line and a lump sum, either of which may be an omission', () => {
    expect(changeOrderLineCost({ quantity: '12.5', rate: 80000n })).toBe(1000000n);
    expect(changeOrderLineCost({ amount: '250000' })).toBe(250000n);
    expect(changeOrderLineCost({ quantity: '-2', rate: '50000' })).toBe(-100000n);
    expect(changeOrderLineCost({ amount: -5000n })).toBe(-5000n);
    expect(changeOrderLineCost({ quantity: '2' })).toBeNull();
  });

  it('adds markup and tax to cost, rounding the tax half up', () => {
    expect(
      changeOrderFigures({ lineCosts: [1000000n, 250000n], markupBp: 1500, enteredPrice: null, taxRateBp: 500 }),
    ).toEqual({ cost: 1250000n, price: 1437500n, margin: 187500n, tax: 71875n, total: 1509375n });
  });

  it('uses an entered price instead of markup', () => {
    const figures = changeOrderFigures({ lineCosts: [100000n], markupBp: 5000, enteredPrice: 120001n, taxRateBp: 1800 });
    expect(figures.price).toBe(120001n);
    expect(figures.margin).toBe(20001n);
    // 18% of 1,200.01 is 216.0018 → 216.00
    expect(figures.tax).toBe(21600n);
  });

  it('never takes a budget below zero', () => {
    expect(changeOrderApplicableDelta(100n, 50n)).toBe(50n);
    expect(changeOrderApplicableDelta(100n, -40n)).toBe(-40n);
    expect(changeOrderApplicableDelta(100n, -400n)).toBe(-100n);
  });
});

describe('change order workflow', () => {
  it('only lets an approved change order become implemented', () => {
    expect(changeOrderCanMove('approved', 'implemented')).toBe(true);
    expect(changeOrderCanMove('approved', 'cancelled')).toBe(false);
    expect(changeOrderCanMove('draft', 'sent')).toBe(false);
    expect(changeOrderCanMove('rejected', 'draft')).toBe(true);
    for (const status of ['implemented', 'cancelled'] as const) {
      for (const to of CHANGE_ORDER_STATUSES) expect(changeOrderCanMove(status, to)).toBe(false);
    }
  });

  it('labels numbers and revisions', () => {
    expect(changeOrderLabel(3)).toBe('CO-003');
    expect(changeOrderLabel(12, 2)).toBe('CO-012 rev 2');
  });
});

describe('change order lines on the wire', () => {
  it('takes a quantity and rate or a lump sum, not both and not neither', () => {
    expect(changeOrderLineSchema.safeParse({ description: 'Wall', quantity: '4', rate: '100' }).success).toBe(true);
    expect(changeOrderLineSchema.safeParse({ description: 'Wall', amount: '-100' }).success).toBe(true);
    expect(changeOrderLineSchema.safeParse({ description: 'Wall', quantity: '4', rate: '1', amount: '4' }).success).toBe(false);
    expect(changeOrderLineSchema.safeParse({ description: 'Wall', quantity: '4' }).success).toBe(false);
    expect(changeOrderLineSchema.safeParse({ description: 'Wall' }).success).toBe(false);
    expect(changeOrderLineSchema.safeParse({ description: 'Wall', quantity: '0', rate: '1' }).success).toBe(false);
  });

  it('needs a reason from the list', () => {
    const base = { project_id: '00000000-0000-4000-8000-000000000000', title: 'Extra toilet' };
    expect(createChangeOrderSchema.safeParse({ ...base, reason: 'client_request' }).success).toBe(true);
    expect(createChangeOrderSchema.safeParse({ ...base, reason: 'whim' }).success).toBe(false);
  });
});

describe('the scope-creep catcher', () => {
  it('fires on a strong phrase and says what matched', () => {
    const hit = changeOrderScopeCreepMatch(
      'Plastering on 2nd floor done. Client asked for an extra window in the master bedroom. Curing ongoing.',
    );
    expect(hit?.excerpt).toBe('Client asked for an extra window in the master bedroom.');
    expect(hit?.matched).toContain('client asked');
  });

  it('fires on extra work and work not in the drawings', () => {
    expect(changeOrderScopeCreepMatch('Did additional work on the compound wall')).not.toBeNull();
    expect(changeOrderScopeCreepMatch('Parapet raised, this is not in the drawings')).not.toBeNull();
    expect(changeOrderScopeCreepMatch('Kitchen platform shifted as the owner wanted')).not.toBeNull();
  });

  it('treats a change word from the client as a request', () => {
    const text = 'Can you add a window in the study?';
    expect(changeOrderScopeCreepMatch(text)).toBeNull();
    expect(changeOrderScopeCreepMatch(text, { fromClient: true })?.matched).toEqual(['add']);
  });

  it('ignores deliveries, routine extras and negations', () => {
    expect(changeOrderScopeCreepMatch('Extra cement bags arrived. 20 workers on site.')).toBeNull();
    expect(changeOrderScopeCreepMatch('No extra work today, slab curing.')).toBeNull();
    expect(changeOrderScopeCreepMatch('')).toBeNull();
    expect(changeOrderScopeCreepMatch(null)).toBeNull();
  });

  it('trims a long sentence on a word', () => {
    const long = `${'word '.repeat(80)}end`;
    const excerpt = changeOrderExcerpt(long, 40);
    expect(excerpt.length).toBeLessThanOrEqual(41);
    expect(excerpt.endsWith('…')).toBe(true);
  });
});

describe('the register as CSV', () => {
  it('lists every change order and totals the approved ones', () => {
    const csv = changeOrderRegisterCsv(
      [
        {
          number: 1, revision: 0, site: 'Lake View', title: 'Extra toilet', reason: 'client_request',
          status: 'approved', raised_on: '2026-10-01', cost_impact: '100000', client_price: '115000',
          tax: '5750', client_total: '120750', time_impact_days: 5, decided_at: '2026-10-03',
        },
        {
          number: 2, revision: 1, site: 'Lake View', title: 'Rock, "hard"', reason: 'site_condition',
          status: 'sent', raised_on: '2026-10-02', cost_impact: '50000', client_price: '50000',
          tax: '0', client_total: '50000', time_impact_days: 2, decided_at: null,
        },
      ],
      2,
    );
    const rows = csv.trim().split('\r\n');
    expect(rows[1]).toContain('CO-001,Lake View,Extra toilet,Client request,approved,2026-10-01,1000.00,1150.00');
    expect(rows[2]).toContain('CO-002 rev 1,Lake View,"Rock, ""hard""",Site condition');
    expect(rows.at(-1)).toBe('Approved total,,1 change orders,,,,1000.00,1150.00,57.50,1207.50,5,');
  });
});
