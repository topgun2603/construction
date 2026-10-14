import { describe, expect, it } from 'vitest';
import {
  boqAbstract,
  boqAmountTolerance,
  boqAutoMapCostCodes,
  boqComputeBill,
  boqFindHeaderRow,
  boqInvoiceSplit,
  boqItemKey,
  boqItemsCsv,
  boqMeasuredQuantity,
  boqNumberCellText,
  boqParentItemNo,
  boqParseNumber,
  boqParseSheet,
  boqProgress,
  boqQuantityProblems,
  boqSuggestMapping,
  BOQ_DEFAULT_MAPPING,
} from './boq';
import { taxOnTop } from './tax';

describe('boqParseNumber', () => {
  it('reads numbers the way people type them in a BOQ', () => {
    expect(boqParseNumber('1,25,000.50', 2)).toBe(12_500_050n);
    expect(boqParseNumber('₹ 4,500', 2)).toBe(450_000n);
    expect(boqParseNumber('AED 1 250.5', 2)).toBe(125_050n);
    expect(boqParseNumber('100/-', 2)).toBe(10_000n);
    expect(boqParseNumber('.5', 3)).toBe(500n);
    expect(boqParseNumber('12.5', 3)).toBe(12_500n);
  });

  it('rounds extra decimals half up rather than refusing them', () => {
    expect(boqParseNumber('12.345', 2)).toBe(1235n);
    expect(boqParseNumber('12.344', 2)).toBe(1234n);
    expect(boqParseNumber('0.0005', 3)).toBe(1n);
  });

  it('refuses what is not a number', () => {
    expect(boqParseNumber('twelve', 2)).toBeNull();
    expect(boqParseNumber('12.5 m3', 3)).toBeNull();
    expect(boqParseNumber('', 2)).toBeNull();
    expect(boqParseNumber('.', 2)).toBeNull();
    expect(boqParseNumber('1.2.3', 2)).toBeNull();
  });
});

describe('boqNumberCellText', () => {
  it('removes float noise a spreadsheet formula leaves behind', () => {
    expect(boqNumberCellText(0.1 + 0.2)).toBe('0.3');
    expect(boqNumberCellText(12.300000000000001)).toBe('12.3');
    expect(boqNumberCellText(1e-7)).toBe('0.0000001');
    expect(boqNumberCellText(4500)).toBe('4500');
  });
});

describe('column mapping', () => {
  it('finds the header row under a title block and maps the columns', () => {
    const grid = [
      ['Lake View Residences — Bill of Quantities'],
      ['Contract no. LV/2026/01'],
      ['S.No', 'Description of work', 'Unit', 'Qty', 'Rate (Rs)', 'Amount (Rs)'],
    ];
    expect(boqFindHeaderRow(grid)).toBe(2);
    expect(boqSuggestMapping(grid[2]!)).toEqual({
      item_no: 0,
      description: 1,
      unit: 2,
      quantity: 3,
      rate: 4,
      amount: 5,
    });
  });

  it('prefers an exact heading and uses no column twice', () => {
    expect(boqSuggestMapping(['Item', 'Rate in AED', 'Rate', 'Description', 'Total'])).toEqual({
      item_no: 0,
      rate: 2,
      description: 3,
      amount: 4,
    });
  });

  it('has no header row when nothing looks like one', () => {
    expect(boqFindHeaderRow([['1', 'Excavation', 'm3', '10', '100', '1000']])).toBe(-1);
  });
});

describe('item numbers', () => {
  it('compares item numbers whatever the separator', () => {
    expect(boqItemKey(' 2-1 ')).toBe('2.1');
    expect(boqItemKey('b/12')).toBe('B.12');
  });

  it('finds the nearest known parent', () => {
    const known = new Set(['2', '2.1']);
    expect(boqParentItemNo('2.1.3', known)).toBe('2.1');
    expect(boqParentItemNo('2.4', known)).toBe('2');
    expect(boqParentItemNo('3.1', known)).toBeNull();
  });
});

describe('boqParseSheet', () => {
  const sheet = [
    ['Item', 'Description', 'Unit', 'Qty', 'Rate', 'Amount'],
    ['1', 'Earthwork', '', '', '', ''],
    ['1.1', 'Excavation in ordinary soil', 'm3', '120', '350', '42,000.00'],
    ['1.2', 'Backfilling', 'm3', '80.5', '120.50', '9700.25'],
    ['', 'Total carried to summary', '', '', '', '51,700.25'],
    ['2', 'Concrete', '', '', '', ''],
    ['2.1', 'PCC 1:4:8', 'm3', '15', '', '75000'],
  ];
  const parse = (grid: string[][]) =>
    boqParseSheet(grid, { mapping: BOQ_DEFAULT_MAPPING, headerRow: 0, currencyDigits: 2 });

  it('reads sections, items and nesting, and skips sub-totals', () => {
    const result = parse(sheet);
    expect(result.errors).toEqual([]);
    expect(result.rows.map((row) => [row.item_no, row.kind, row.parent_item_no])).toEqual([
      ['1', 'section', null],
      ['1.1', 'item', '1'],
      ['1.2', 'item', '1'],
      ['2', 'section', null],
      ['2.1', 'item', '2'],
    ]);
    expect(result.rows[1]).toMatchObject({ quantity: '120000', rate: '35000', amount: '4200000', line: 3 });
    // 80.5 × 120.50 = 9700.25
    expect(result.rows[2]!.amount).toBe('970025');
    // Rate worked out from the amount when only that is given: 75000 / 15.
    expect(result.rows[4]).toMatchObject({ rate: '500000', amount: '7500000' });
    expect(result.skipped).toEqual([
      { line: 5, field: 'item_no', message: '"Total carried to summary" has no item number' },
    ]);
    expect(result.total).toBe(String(4_200_000 + 970_025 + 7_500_000));
  });

  it('lists every problem with its line', () => {
    const result = parse([
      ['Item', 'Description', 'Unit', 'Qty', 'Rate', 'Amount'],
      ['1', 'Excavation', 'm3', 'ten', '350', ''],
      ['2', 'Backfill', 'm3', '10', '120', '1500'],
      ['3', 'Steel', 'kg', '10', '60', ''],
      ['3', 'Steel again', 'kg', '10', '60', ''],
      ['4', '', 'kg', '10', '60', ''],
      ['5', 'Nothing', 'nos', '0', '10', ''],
      ['6', 'Free', 'nos', '1', '', ''],
      ['7', 'Sand', '', '1', '10', ''],
    ]);
    expect(result.rows.map((row) => row.item_no)).toEqual(['3']);
    expect(result.errors).toEqual([
      { line: 2, field: 'quantity', message: '1: "ten" is not a quantity' },
      { line: 3, field: 'amount', message: '2: the amount 1500.00 is not quantity × rate (1200.00)' },
      { line: 5, field: 'item_no', message: '3: appears twice' },
      { line: 6, field: 'description', message: '4: has no description' },
      { line: 7, field: 'quantity', message: '5: the quantity must be more than zero' },
      { line: 8, field: 'rate', message: '6: has no rate' },
      { line: 9, field: 'unit', message: '7: has no unit' },
    ]);
  });

  it('accepts an amount within rounding of quantity × rate', () => {
    // A rate of 33.333 is stored as 33.33; 300 × 33.333 = 9999.90, 300 × 33.33 = 9999.00.
    expect(boqAmountTolerance(300_000n)).toBe(151n);
    const result = parse([
      ['Item', 'Description', 'Unit', 'Qty', 'Rate', 'Amount'],
      ['1', 'Paint', 'm2', '300', '33.333', '9999.90'],
    ]);
    expect(result.errors).toEqual([]);
    expect(result.rows[0]).toMatchObject({ rate: '3333', amount: '999900' });
  });

  it('puts an item with no numbered parent under the last section', () => {
    const result = parse([
      ['Item', 'Description', 'Unit', 'Qty', 'Rate', 'Amount'],
      ['A', 'Bill No. 1 — Substructure', '', '', '', ''],
      ['1', 'Excavation', 'm3', '10', '100', ''],
      ['B', 'Bill No. 2 — Superstructure', '', '', '', ''],
      ['B.1', 'Columns', 'm3', '5', '8000', ''],
    ]);
    expect(result.rows.map((row) => row.parent_item_no)).toEqual([null, 'A', null, 'B']);
  });
});

describe('measurement', () => {
  it('multiplies whatever dimensions were given, rounding once', () => {
    // 2 nos × 3.5 × 0.23 × 3.1 = 4.991
    expect(boqMeasuredQuantity({ count: 2000n, length: 3500n, breadth: 230n, height: 3100n })).toBe(4991n);
    expect(boqMeasuredQuantity({ length: 12_500n })).toBe(12_500n);
    expect(boqMeasuredQuantity({ count: 4000n })).toBe(4000n);
    // 0.333 × 0.333 = 0.110889 → 0.111
    expect(boqMeasuredQuantity({ length: 333n, breadth: 333n })).toBe(111n);
  });

  it('takes a deduction off and refuses a measurement of nothing', () => {
    expect(boqMeasuredQuantity({ length: 1000n, height: 2100n }, true)).toBe(-2100n);
    expect(boqMeasuredQuantity({})).toBeNull();
  });

  it('flags measuring past the contract quantity', () => {
    expect(boqProgress(100_000n, 50_000n)).toEqual({ percentBp: 5000, over: false, excess: 0n });
    expect(boqProgress(100_000n, 112_500n)).toEqual({ percentBp: 11_250, over: true, excess: 12_500n });
    expect(boqProgress(0n, 0n).percentBp).toBe(0);
  });
});

describe('client bills', () => {
  const items = (toDate: [bigint, bigint], previous: [bigint, bigint] = [0n, 0n]) => [
    { id: 'a', rate: 35_000n, contractQuantity: 120_000n, previousQuantity: previous[0], quantityToDate: toDate[0] },
    { id: 'b', rate: 12_050n, contractQuantity: 80_500n, previousQuantity: previous[1], quantityToDate: toDate[1] },
  ];
  const terms = { retentionBp: 500, advanceRecoveryBp: 1000, advanceAmount: 1_000_000n, taxRateBp: 1800 };

  it('bills the increment, holds retention, recovers the advance and adds tax', () => {
    const first = boqComputeBill({
      lines: items([60_000n, 40_000n]),
      previous: { retentionToDate: 0n, advanceRecoveredToDate: 0n },
      ...terms,
    });
    // 60 × 350 = 21,000.00; 40 × 120.50 = 4,820.00
    expect(first.gross).toBe(2_582_000n);
    expect(first.retention).toBe(129_100n);
    expect(first.advanceRecovery).toBe(258_200n);
    expect(first.tax).toBe(taxOnTop(2_582_000n, 1800));
    expect(first.tax).toBe(464_760n);
    expect(first.netPayable).toBe(2_582_000n + 464_760n - 129_100n - 258_200n);

    const second = boqComputeBill({
      lines: items([120_000n, 80_500n], [60_000n, 40_000n]),
      previous: { retentionToDate: first.retentionToDate, advanceRecoveredToDate: first.advanceRecoveredToDate },
      ...terms,
    });
    expect(second.grossToDate).toBe(4_200_000n + 970_025n);
    expect(second.gross).toBe(second.grossToDate - first.grossToDate);
    // Retention over both bills is exactly 5% of the total, whatever each bill rounded.
    expect(first.retention + second.retention).toBe(258_501n);
    // Recovery stops at the advance.
    expect(first.advanceRecovery + second.advanceRecovery).toBeLessThanOrEqual(1_000_000n);
    expect(second.advanceRecoveredToDate).toBe(517_003n);
  });

  it('splits a bill into the instalment and its tax, adding back to the net', () => {
    const figures = boqComputeBill({
      lines: items([60_000n, 40_000n]),
      previous: { retentionToDate: 0n, advanceRecoveredToDate: 0n },
      ...terms,
    });
    const split = boqInvoiceSplit(figures);
    expect(split.amount + split.taxAmount).toBe(figures.netPayable);
    expect(split.taxAmount).toBe(figures.tax);
  });

  it('refuses claims beyond the measurement book and flags work beyond the contract', () => {
    const { errors, overContract } = boqQuantityProblems([
      { id: 'a', rate: 1n, contractQuantity: 100n, previousQuantity: 50n, quantityToDate: 40n },
      { id: 'b', rate: 1n, contractQuantity: 100n, previousQuantity: 0n, quantityToDate: 90n, measuredQuantity: 80n },
      { id: 'c', rate: 1n, contractQuantity: 100n, previousQuantity: 0n, quantityToDate: 120n, measuredQuantity: 130n },
      { id: 'd', rate: 1n, contractQuantity: 100n, previousQuantity: 0n, quantityToDate: 60n, claimedQuantity: 50n },
    ]);
    expect(errors).toEqual([
      { itemId: 'a', problem: 'below_previous' },
      { itemId: 'b', problem: 'above_measured' },
      { itemId: 'd', problem: 'above_claimed' },
    ]);
    expect(overContract).toEqual(['c']);
  });
});

describe('boqAbstract', () => {
  it('rolls contract, measured and billed value up through the sections', () => {
    const abstract = boqAbstract([
      { id: 's1', parentId: null, kind: 'section', amount: 0n, rate: 0n, measuredQuantity: 0n, billedQuantity: 0n },
      { id: 's1a', parentId: 's1', kind: 'section', amount: 0n, rate: 0n, measuredQuantity: 0n, billedQuantity: 0n },
      { id: 'i1', parentId: 's1a', kind: 'item', amount: 100_000n, rate: 1000n, measuredQuantity: 50_000n, billedQuantity: 25_000n },
      { id: 'i2', parentId: 's1', kind: 'item', amount: 50_000n, rate: 500n, measuredQuantity: 100_000n, billedQuantity: 0n },
      { id: 'i3', parentId: null, kind: 'item', amount: 10_000n, rate: 100n, measuredQuantity: 0n, billedQuantity: 0n },
    ]);
    expect(abstract.get('s1a')).toEqual({ contract: 100_000n, measured: 50_000n, billed: 25_000n, balance: 75_000n, percentBp: 5000 });
    expect(abstract.get('s1')).toEqual({ contract: 150_000n, measured: 100_000n, billed: 25_000n, balance: 125_000n, percentBp: 6667 });
    expect(abstract.get('')).toMatchObject({ contract: 160_000n, measured: 100_000n, billed: 25_000n });
  });
});

describe('boqAutoMapCostCodes', () => {
  const codes = [
    { id: 'earth', code: '01', name: 'Earthwork' },
    { id: 'rcc', code: '02.10', name: 'RCC' },
    { id: 'pcc', code: '02.20', name: 'PCC' },
    { id: 'paint', code: '05', name: 'Painting' },
  ];

  it('maps by code, then name, then words in the description, then the section', () => {
    const mapped = boqAutoMapCostCodes(
      [
        { id: 'a', parentId: null, itemNo: '01', description: 'Site preparation' },
        { id: 'b', parentId: 'a', itemNo: '01.1', description: 'Excavation in hard rock' },
        { id: 'c', parentId: null, itemNo: '7', description: 'RCC M25 in columns' },
        { id: 'd', parentId: null, itemNo: '8', description: 'painting' },
        { id: 'e', parentId: null, itemNo: '9', description: 'Waterproofing' },
      ],
      codes,
    );
    expect(Object.fromEntries(mapped)).toEqual({ a: 'earth', b: 'earth', c: 'rcc', d: 'paint' });
  });
});

describe('export', () => {
  it('writes the import template’s columns first, so an export imports again', () => {
    const csv = boqItemsCsv(
      [
        {
          depth: 0,
          kind: 'item',
          item_no: '1.1',
          description: 'Excavation, "ordinary" soil',
          unit: 'm3',
          quantity: '120',
          rate: '35000',
          amount: '4200000',
          cost_code: '01',
          measured_quantity: '60',
          billed_quantity: '30',
          measured_value: '2100000',
          billed_value: '1050000',
          percent_bp: 5000,
        },
      ],
      2,
    );
    const [head, row] = csv.trim().split('\r\n');
    expect(head!.startsWith('Item no.,Description,Unit,Quantity,Rate,Amount')).toBe(true);
    expect(row).toBe('1.1,"Excavation, ""ordinary"" soil",m3,120,350.00,42000.00,01,60,30,21000.00,10500.00,50.00');
  });
});
