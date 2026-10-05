import { describe, expect, it } from 'vitest';
import {
  CSV_BOM,
  STANDARD_WBS,
  compareCostCodes,
  costCodeForecast,
  costReportCsv,
  impliedParentCode,
  orderCostCodeTree,
  parseCostCodeCsv,
  rollUpCostCodes,
} from './cost-codes';

const figures = (budget: bigint, actual = 0n, committed = 0n, forecast = budget) => ({
  budget,
  actual,
  committed,
  forecast,
});

describe('cost code order', () => {
  it('reads numbers as numbers', () => {
    const codes = ['10', '2', '03.10', '03.2', '03', 'A1'];
    expect([...codes].sort(compareCostCodes)).toEqual(['2', '03', '03.2', '03.10', '10', 'A1']);
  });

  it('implies a parent from the shape of a code', () => {
    expect(impliedParentCode('03.20')).toBe('03');
    expect(impliedParentCode('A1-2-3')).toBe('A1-2');
    expect(impliedParentCode('03')).toBeNull();
  });

  it('ships a template whose every parent exists', () => {
    const codes = new Set(STANDARD_WBS.map((line) => line.code));
    expect(codes.size).toBe(STANDARD_WBS.length);
    for (const line of STANDARD_WBS) {
      if (line.parent_code) expect(codes.has(line.parent_code)).toBe(true);
    }
  });
});

describe('forecast for one line', () => {
  it('never forecasts an untouched line below its budget', () => {
    expect(costCodeForecast({ budget: 1000n, committed: 0n, actual: 0n, projected: 0n })).toBe(1000n);
  });

  it('counts money spent and promised once over budget', () => {
    expect(costCodeForecast({ budget: 1000n, committed: 400n, actual: 800n, projected: null })).toBe(
      1200n,
    );
  });

  it('takes the projection when it runs ahead of everything else', () => {
    expect(costCodeForecast({ budget: 1000n, committed: 0n, actual: 600n, projected: 1500n })).toBe(
      1500n,
    );
  });
});

describe('roll-up', () => {
  it('adds a parent’s own budget to its children’s', () => {
    const totals = rollUpCostCodes([
      { id: 'root', parentId: null, own: figures(100n) },
      { id: 'a', parentId: 'root', own: figures(200n, 50n) },
      { id: 'b', parentId: 'root', own: figures(300n, 0n, 20n) },
      { id: 'a1', parentId: 'a', own: figures(0n, 10n, 0n, 10n) },
    ]);
    expect(totals.get('root')).toEqual({ budget: 600n, actual: 60n, committed: 20n, forecast: 610n });
    expect(totals.get('a')).toEqual({ budget: 200n, actual: 60n, committed: 0n, forecast: 210n });
  });

  it('orders a tree parent-first', () => {
    const ordered = orderCostCodeTree([
      { id: '2', parentId: '1', code: '01.10' },
      { id: '3', parentId: null, code: '02' },
      { id: '1', parentId: null, code: '01' },
      { id: '4', parentId: '1', code: '01.2' },
    ]);
    expect(ordered.map((row) => [row.code, row.depth])).toEqual([
      ['01', 0],
      ['01.2', 1],
      ['01.10', 1],
      ['02', 0],
    ]);
  });
});

describe('CSV', () => {
  it('reads a sheet with a header, quotes and grouped amounts', () => {
    const text =
      CSV_BOM +
      'Code,Name,Parent code,Budget\r\n' +
      '03,Substructure,,\r\n' +
      '03.20,"Footings, foundations",03,"1,25,000.50"\r\n' +
      '03.30,Plinth,,₹ 4000\r\n';
    const { rows, errors } = parseCostCodeCsv(text, 2);
    expect(errors).toEqual([]);
    expect(rows).toEqual([
      { code: '03', name: 'Substructure', parent_code: null, unit: null, budget: null },
      { code: '03.20', name: 'Footings, foundations', parent_code: '03', unit: null, budget: '12500050' },
      { code: '03.30', name: 'Plinth', parent_code: null, unit: null, budget: '400000' },
    ]);
  });

  it('reads a headerless sheet positionally and names the bad lines', () => {
    const { rows, errors } = parseCostCodeCsv('01,Prelims,,100,ls\n01,Again\nbad code!,X\n02,,', 3);
    expect(rows).toEqual([
      { code: '01', name: 'Prelims', parent_code: null, unit: 'ls', budget: '100000' },
    ]);
    expect(errors.map((error) => error.line)).toEqual([2, 3, 4]);
  });

  it('writes the report with exact decimals', () => {
    const total = { budget: '12500050', committed: '0', actual: '-5', forecast: '1', variance: '0' };
    const csv = costReportCsv(
      [{ code: '03.20', name: 'Footings, foundations', depth: 1, unit: 'm3', total }],
      [{ label: 'Total', total }],
      2,
    );
    expect(csv.split('\r\n')).toEqual([
      'Code,Name,Level,Unit,Budget,Committed,Actual,Forecast,Variance',
      '03.20,"Footings, foundations",2,m3,125000.50,0.00,-0.05,0.01,0.00',
      ',Total,,,125000.50,0.00,-0.05,0.01,0.00',
    ]);
  });
});
