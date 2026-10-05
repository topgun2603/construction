import { describe, expect, it } from 'vitest';
import {
  compareQuotes,
  effectiveApprovalLimit,
  lineAmount,
  matchInvoice,
  orderTotals,
  outstandingCommitment,
  withinApprovalLimit,
  type MatchOrderLine,
} from './procurement';

describe('lineAmount', () => {
  it('multiplies in thousandths and rounds half up', () => {
    expect(lineAmount('2.5', 38550n)).toBe(96375n);
    expect(lineAmount('0.333', 499900n)).toBe(166467n);
    expect(lineAmount('1', 0n)).toBe(0n);
    expect(lineAmount('0.001', 500n)).toBe(1n);
    expect(lineAmount('0.001', 499n)).toBe(0n);
  });

  it('adds an order up from its lines', () => {
    expect(
      orderTotals([
        { quantity: '100', unit_rate: 40000n, tax_rate_bp: 1800 },
        { quantity: '2', unit_rate: 100000n, tax_rate_bp: 500 },
      ]),
    ).toEqual({ subtotal: 4_200_000n, tax: 730_000n, total: 4_930_000n });
  });
});

describe('compareQuotes', () => {
  const items = [
    { id: 'cement', quantity: '100' },
    { id: 'steel', quantity: '2' },
  ];

  it('finds the cheapest per item and the cheapest complete quote overall', () => {
    const result = compareQuotes(items, [
      {
        id: 'a',
        vendor_id: 'va',
        delivery_days: 3,
        lines: [
          { rfq_item_id: 'cement', unit_rate: 40000n, tax_rate_bp: 0 },
          { rfq_item_id: 'steel', unit_rate: 6_000_000n, tax_rate_bp: 0 },
        ],
      },
      {
        id: 'b',
        vendor_id: 'vb',
        delivery_days: 5,
        lines: [
          { rfq_item_id: 'cement', unit_rate: 41000n, tax_rate_bp: 0 },
          { rfq_item_id: 'steel', unit_rate: 5_500_000n, tax_rate_bp: 0 },
        ],
      },
      // Cheapest cement, but did not quote steel: cannot win overall.
      {
        id: 'c',
        vendor_id: 'vc',
        delivery_days: 1,
        lines: [{ rfq_item_id: 'cement', unit_rate: 30000n, tax_rate_bp: 0 }],
      },
    ]);
    expect(result.items.find((i) => i.rfq_item_id === 'cement')!.lowest_quote_id).toBe('c');
    expect(result.items.find((i) => i.rfq_item_id === 'steel')!.lowest_quote_id).toBe('b');
    // a = 4,000,000 + 12,000,000; b = 4,100,000 + 11,000,000.
    expect(result.lowest_quote_id).toBe('b');
    expect(result.quotes.find((q) => q.quote_id === 'c')!.complete).toBe(false);
    expect(result.best_split_total).toBe(3_000_000n + 11_000_000n);
  });

  it('compares the landed price, tax included, and breaks ties on delivery', () => {
    const result = compareQuotes(
      [{ id: 'x', quantity: '1' }],
      [
        {
          id: 'slow',
          vendor_id: '1',
          delivery_days: 9,
          lines: [{ rfq_item_id: 'x', unit_rate: 10500n, tax_rate_bp: 0 }],
        },
        {
          id: 'taxed',
          vendor_id: '2',
          delivery_days: 2,
          lines: [{ rfq_item_id: 'x', unit_rate: 10000n, tax_rate_bp: 1000 }],
        },
        {
          id: 'fast',
          vendor_id: '3',
          delivery_days: 1,
          lines: [{ rfq_item_id: 'x', unit_rate: 10500n, tax_rate_bp: 0 }],
        },
      ],
    );
    expect(result.lowest_quote_id).toBe('fast');
  });
});

describe('matchInvoice', () => {
  const line: MatchOrderLine = {
    id: 'l1',
    quantity: '100',
    unit_rate: 40000n,
    tax_rate_bp: 1800,
    received_quantity: '60',
    previously_billed_quantity: '0',
  };

  it('passes an invoice for what was received at the agreed price', () => {
    expect(
      matchInvoice(
        [line],
        [{ po_line_id: 'l1', quantity: '60', unit_rate: 40000n, tax_amount: 432000n }],
        200,
      ),
    ).toEqual([]);
  });

  it('flags billed but not received, over-billing, price and tax', () => {
    const flags = matchInvoice(
      [{ ...line, previously_billed_quantity: '50' }],
      [{ po_line_id: 'l1', quantity: '60', unit_rate: 42000n, tax_amount: 1n }],
      200,
    );
    expect(flags.map((flag) => flag.type).sort()).toEqual([
      'billed_not_received',
      'over_billed_qty',
      'price_variance',
      'tax_variance',
    ]);
  });

  it('lets differences inside the tolerance through', () => {
    expect(
      matchInvoice(
        [{ ...line, received_quantity: '100' }],
        [{ po_line_id: 'l1', quantity: '102', unit_rate: 40800n, tax_amount: 749088n }],
        200,
      ),
    ).toEqual([]);
    expect(
      matchInvoice(
        [{ ...line, received_quantity: '100' }],
        [{ po_line_id: 'l1', quantity: '102.1', unit_rate: 40000n, tax_amount: 735120n }],
        200,
      ).map((flag) => flag.type),
    ).toEqual(['over_billed_qty', 'billed_not_received']);
  });
});

describe('outstandingCommitment', () => {
  const base = { quantity: '10', received_quantity: '4', unit_rate: 10000n, tax_rate_bp: 500 };

  it('is the unbilled value of an approved order, never below zero', () => {
    expect(outstandingCommitment({ ...base, status: 'draft', billed_total: 0n })).toBe(0n);
    expect(outstandingCommitment({ ...base, status: 'approved', billed_total: 0n })).toBe(105000n);
    expect(outstandingCommitment({ ...base, status: 'sent', billed_total: 42000n })).toBe(63000n);
    expect(outstandingCommitment({ ...base, status: 'received', billed_total: 200000n })).toBe(0n);
    expect(outstandingCommitment({ ...base, status: 'cancelled', billed_total: 0n })).toBe(0n);
  });

  it('keeps only the received, unbilled part of a closed order', () => {
    expect(outstandingCommitment({ ...base, status: 'closed', billed_total: 0n })).toBe(42000n);
  });
});

describe('approval limits', () => {
  it('owner unlimited, person over role, otherwise nothing', () => {
    expect(effectiveApprovalLimit({ isOwner: true, userLimit: 5n, roleLimit: 5n })).toBeNull();
    expect(effectiveApprovalLimit({ isOwner: false, userLimit: 10n, roleLimit: 5n })).toBe(10n);
    expect(effectiveApprovalLimit({ isOwner: false, userLimit: null, roleLimit: 5n })).toBeNull();
    expect(effectiveApprovalLimit({ isOwner: false, userLimit: undefined, roleLimit: 5n })).toBe(5n);
    expect(
      effectiveApprovalLimit({ isOwner: false, userLimit: undefined, roleLimit: undefined }),
    ).toBe(0n);
    expect(withinApprovalLimit(5n, 5n)).toBe(true);
    expect(withinApprovalLimit(6n, 5n)).toBe(false);
    expect(withinApprovalLimit(6n, null)).toBe(true);
  });
});
