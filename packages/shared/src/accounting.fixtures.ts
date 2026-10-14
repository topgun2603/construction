import {
  accountingBuildVouchers,
  accountingDefaultMap,
  accountingMasterAccounts,
  accountingPartiesOf,
  type AccountingMasters,
  type AccountingParty,
  type AccountingSource,
  type AccountingSystem,
  type AccountingVoucher,
} from './accounting';

/**
 * One month of a small Indian builder's books, used by every accounting formatter test: a supplier
 * invoice at two GST rates, a diesel bill from another state, a wage period, a subcontractor's
 * running bill with retention, advance recovery and back-charges, a BOQ bill to the client, and the
 * money that moved against them. Names carry the characters each format has to escape.
 */

export const SITE = { id: '0b5a1d2e-3f40-4a5b-8c6d-7e8f90a1b2c3', name: 'Lakeview Towers' };

export const STEEL: AccountingParty = {
  kind: 'vendor',
  code: 'V-11111111',
  name: 'Sri Murugan Steels & Co',
  taxId: '33AAAAA0000A1Z5',
  email: 'accounts@murugan.example',
  phone: '919800000001',
  address: '12, Anna Salai, Chennai',
};

export const MASON: AccountingParty = {
  kind: 'vendor',
  code: 'S-22222222',
  name: 'Ravi "Mason" Works',
  taxId: '33BBBBB1111B1Z6',
};

export const CLIENT: AccountingParty = {
  kind: 'customer',
  code: 'C-33333333',
  name: "Lakeview Residents' Association",
};

const id = (n: number) => `${String(n).padStart(8, '0')}-1111-4222-8333-444444444444`;

export const SOURCES: AccountingSource[] = [
  {
    type: 'purchase_invoice',
    id: id(1),
    date: '2026-04-05',
    dueDate: '2026-05-05',
    number: 'SMS/26/0042',
    orderNumber: 'PO-0007',
    site: SITE,
    vendor: STEEL,
    lines: [
      { costCode: null, description: 'TMT bars 12mm', amount: 1_000_000n, tax: 180_000n },
      { costCode: '03.20', description: 'River sand', amount: 500_000n, tax: 25_000n },
    ],
  },
  {
    type: 'expense',
    id: id(2),
    date: '2026-04-08',
    site: SITE,
    category: 'fuel',
    costCode: null,
    amount: 118_000n,
    tax: 18_000n,
    // Karnataka: an inter-state purchase, so IGST.
    supplierTaxId: '29CCCCC2222C1Z7',
    note: 'Diesel <JCB> & "urgent"',
    vendor: null,
    reference: null,
  },
  {
    type: 'wage_period',
    id: id(3),
    periodStart: '2026-04-01',
    periodEnd: '2026-04-15',
    contractorName: null,
    gross: 5_000_000n,
    advances: 500_000n,
  },
  {
    type: 'subcontract_bill',
    id: id(4),
    date: '2026-04-20',
    site: SITE,
    contractor: MASON,
    subcontractNumber: 'SC-007',
    billNumber: 2,
    gross: 10_000_000n,
    taxRateBp: 1800,
    tax: 1_800_000n,
    retention: 500_000n,
    advanceRecovery: 1_000_000n,
    deductions: 200_000n,
  },
  {
    type: 'payment_stage',
    id: id(5),
    date: '2026-04-25',
    dueDate: '2026-05-10',
    site: SITE,
    customer: CLIENT,
    label: 'Bill of quantities · RA-1 (to 2026-04-24)',
    amount: 17_000_000n,
    tax: 3_600_000n,
    taxRateBp: 1800,
    retention: 1_000_000n,
    advanceRecovery: 2_000_000n,
  },
  {
    type: 'client_payment',
    id: id(6),
    date: '2026-04-28',
    site: SITE,
    customer: CLIENT,
    amount: 5_000_000n,
    mode: 'bank',
    reference: 'NEFT 8812',
    stageExternalId: 'SI-000000051111',
  },
  {
    type: 'labour_payment',
    id: id(7),
    date: '2026-04-16',
    site: SITE,
    kind: 'wage',
    amount: 4_500_000n,
    mode: 'cash',
    payee: 'Muthu',
    reference: null,
  },
  {
    type: 'subcontract_payment',
    id: id(8),
    date: '2026-04-30',
    site: SITE,
    contractor: MASON,
    kind: 'bill',
    amount: 10_100_000n,
    mode: 'bank',
    reference: 'CHQ 000123',
    billReference: 'SC-007/RA-2',
  },
];

export const HOME_STATE = '33';

/** The fixture as vouchers for a system, with the suggested accounts saved as the mapping. */
export function fixtureVouchers(system: AccountingSystem, regime = 'gst_in'): AccountingVoucher[] {
  const { vouchers, missing } = accountingBuildVouchers(SOURCES, {
    system,
    regime,
    map: accountingDefaultMap(system, regime),
    homeStateCode: HOME_STATE,
  });
  if (missing.length > 0) throw new Error(`fixture is missing ${missing.map((item) => item.key).join(', ')}`);
  return vouchers;
}

export function fixtureMasters(system: AccountingSystem, vouchers: AccountingVoucher[], regime = 'gst_in'): AccountingMasters {
  return {
    parties: accountingPartiesOf(vouchers),
    accounts: accountingMasterAccounts(accountingDefaultMap(system, regime), regime),
    costCentres: [{ code: 'LAKEVIEW-TOWERS', name: SITE.name }],
  };
}

/** Parse a CSV the way an import would: quoted cells, doubled quotes, CRLF rows. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i]!;
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else if (char === '"') quoted = false;
      else cell += char;
    } else if (char === '"') quoted = true;
    else if (char === ',') {
      row.push(cell);
      cell = '';
    } else if (char === '\r') continue;
    else if (char === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += char;
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

/** Rows as objects keyed by the header row. */
export function csvRecords(text: string): Record<string, string>[] {
  const [header, ...rows] = parseCsv(text);
  return rows.map((row) => Object.fromEntries(header!.map((name, index) => [name, row[index] ?? ''])));
}

/** Decimal string → minor units, for summing a file's columns back up. */
export function minor(value: string): bigint {
  if (!value) return 0n;
  const negative = value.startsWith('-');
  const [whole, fraction = ''] = value.replace('-', '').split('.');
  const amount = BigInt(whole!) * 100n + BigInt(fraction.padEnd(2, '0').slice(0, 2) || '0');
  return negative ? -amount : amount;
}
