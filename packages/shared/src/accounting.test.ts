import { describe, expect, it } from 'vitest';
import {
  ACCOUNTING_SYSTEMS,
  accountingBuildVouchers,
  accountingCsvText,
  accountingDefaultMap,
  accountingEffectiveRate,
  accountingExternalId,
  accountingKeyCatalogue,
  accountingKeyLabel,
  accountingPartyCode,
  accountingSiteCode,
  accountingTaxSplit,
  accountingTotalsByAccount,
  accountingVoucherBalance,
  isAccountingKey,
  type AccountingVoucher,
} from './accounting';
import { accountingExportFiles } from './accounting-export';
import { accountingExportSchema, accountingMappingSchema } from './schemas/accounting';
import { HOME_STATE, SITE, SOURCES, fixtureMasters, fixtureVouchers } from './accounting.fixtures';

/** `{ 'Input CGST': 9000n, … }` — a voucher's lines by account name, debit positive. */
function byAccount(voucher: AccountingVoucher): Record<string, bigint> {
  const out: Record<string, bigint> = {};
  for (const line of voucher.lines) out[line.account.name] = (out[line.account.name] ?? 0n) + line.amount;
  return out;
}

function voucherFor(vouchers: AccountingVoucher[], type: string): AccountingVoucher {
  const found = vouchers.find((voucher) => voucher.sourceType === type);
  if (!found) throw new Error(`no ${type} voucher`);
  return found;
}

describe('accounting vouchers', () => {
  it('balances every voucher, for every system', () => {
    for (const system of ACCOUNTING_SYSTEMS) {
      const vouchers = fixtureVouchers(system);
      expect(vouchers).toHaveLength(SOURCES.length);
      for (const voucher of vouchers) expect(accountingVoucherBalance(voucher)).toBe(0n);
      const totals = accountingTotalsByAccount(vouchers);
      const debit = totals.reduce((sum, row) => sum + row.debit, 0n);
      const credit = totals.reduce((sum, row) => sum + row.credit, 0n);
      expect(debit).toBe(credit);
    }
  });

  it('books a supplier invoice to the purchase ledger of each GST rate, with CGST and SGST split', () => {
    const purchase = voucherFor(fixtureVouchers('tally'), 'purchase_invoice');
    expect(purchase.kind).toBe('purchase');
    expect(byAccount(purchase)).toEqual({
      'Purchase @18%': 1_000_000n,
      'Purchase @5%': 500_000n,
      'Input CGST': 102_500n,
      'Input SGST': 102_500n,
      // Tally posts the bill to the supplier's own ledger.
      'Sri Murugan Steels & Co': -1_705_000n,
    });
    const taxLines = purchase.lines.filter((line) => line.role === 'tax');
    expect(taxLines.map((line) => [line.taxHead, line.taxRateBp, line.amount])).toEqual([
      ['cgst', 900, 90_000n],
      ['sgst', 900, 90_000n],
      ['cgst', 250, 12_500n],
      ['sgst', 250, 12_500n],
    ]);
    const party = purchase.lines.find((line) => line.role === 'control')!;
    expect(party.billRef).toEqual({ name: 'SMS/26/0042', type: 'new' });
    expect(purchase.lines.find((line) => line.account.name === 'Purchase @18%')!.costCentre?.name).toBe(SITE.name);
  });

  it('posts an inter-state bill to IGST, and a cash expense against petty cash', () => {
    const expense = voucherFor(fixtureVouchers('tally'), 'expense');
    expect(expense.kind).toBe('payment');
    expect(expense.document).toBe('journal');
    expect(byAccount(expense)).toEqual({ 'Fuel Expenses': 100_000n, 'Input IGST': 18_000n, 'Petty Cash': -118_000n });
  });

  it('posts an RA bill gross to cost, with retention, advance recovery and back-charges credited', () => {
    const bill = voucherFor(fixtureVouchers('quickbooks_online'), 'subcontract_bill');
    expect(bill.reference).toBe('SC-007/RA-2');
    expect(bill.document).toBe('bill');
    expect(byAccount(bill)).toEqual({
      'Subcontract Costs': 10_000_000n,
      'Input CGST': 900_000n,
      'Input SGST': 900_000n,
      'Retention Payable': -500_000n,
      'Subcontractor Advances': -1_000_000n,
      'Subcontractor Recoveries': -200_000n,
      // gross + tax − retention − advance − deductions
      'Accounts Payable': -10_100_000n,
    });
    const control = bill.lines.find((line) => line.role === 'control')!;
    expect(control.party?.name).toBe('Ravi "Mason" Works');
  });

  it('raises a BOQ bill as revenue on the gross, with retention and advance receivable from the client', () => {
    const sale = voucherFor(fixtureVouchers('xero'), 'payment_stage');
    expect(sale.document).toBe('invoice');
    expect(byAccount(sale)).toEqual({
      'Accounts Receivable': 20_600_000n,
      'Retention Receivable': 1_000_000n,
      'Client Advances': 2_000_000n,
      Sales: -20_000_000n,
      // Xero keeps GST in one account, so CGST and SGST land together.
      GST: -3_600_000n,
    });
    const revenue = sale.lines.find((line) => line.key === 'sales_revenue')!;
    expect(revenue.taxCode?.code).toBe('GST on Income 18%');
  });

  it('turns a wage period into a labour journal: earned, advances recovered, net payable', () => {
    const wages = voucherFor(fixtureVouchers('netsuite'), 'wage_period');
    expect(wages.date).toBe('2026-04-15');
    expect(byAccount(wages)).toEqual({ 'Labour Wages': 5_000_000n, 'Labour Advances': -500_000n, 'Wages Payable': -4_500_000n });
  });

  it('settles payments against the bill they pay and receipts against the instalment', () => {
    const vouchers = fixtureVouchers('tally');
    const receipt = voucherFor(vouchers, 'client_payment');
    expect(receipt.kind).toBe('receipt');
    expect(receipt.lines.find((line) => line.role === 'control')!.billRef).toEqual({ name: 'SI-000000051111', type: 'against' });
    const payment = voucherFor(vouchers, 'subcontract_payment');
    expect(byAccount(payment)).toEqual({ 'Ravi "Mason" Works': 10_100_000n, 'Bank Account': -10_100_000n });
    const wage = voucherFor(vouchers, 'labour_payment');
    expect(byAccount(wage)).toEqual({ 'Wages Payable': 4_500_000n, Cash: -4_500_000n });
  });

  it('uses one VAT ledger in the Gulf', () => {
    const { vouchers, missing } = accountingBuildVouchers(
      [
        {
          type: 'expense',
          id: 'aaaaaaaa-1111-4222-8333-444444444444',
          date: '2026-04-08',
          site: SITE,
          category: 'materials',
          costCode: null,
          amount: 10_500n,
          tax: 500n,
          supplierTaxId: '100123456789012',
          note: null,
          vendor: null,
          reference: null,
        },
      ],
      { system: 'tally', regime: 'vat_ae', map: accountingDefaultMap('tally', 'vat_ae') },
    );
    expect(missing).toEqual([]);
    expect(byAccount(vouchers[0]!)).toEqual({ 'Purchase - Materials': 10_000n, 'Input VAT 5%': 500n, 'Petty Cash': -10_500n });
  });

  it('lists every unmapped account, and only those the vouchers need', () => {
    const { missing } = accountingBuildVouchers(SOURCES.slice(0, 1), { system: 'tally', regime: 'gst_in', map: {}, homeStateCode: HOME_STATE });
    expect(missing.map((item) => item.key)).toEqual(['accounts_payable', 'expense:materials', 'input_cgst', 'input_sgst']);
    expect(missing.find((item) => item.key === 'input_cgst')!.example).toBe('Sri Murugan Steels & Co invoice SMS/26/0042');

    // An RA bill with no retention does not ask for the retention account.
    const bill = { ...(SOURCES[3] as Extract<(typeof SOURCES)[number], { type: 'subcontract_bill' }>), retention: 0n, tax: 0n, taxRateBp: 0 };
    const map = accountingDefaultMap('tally', 'gst_in');
    delete map['retention_payable'];
    expect(accountingBuildVouchers([bill], { system: 'tally', regime: 'gst_in', map }).missing).toEqual([]);
  });

  it('asks for tax codes only where documents carry them', () => {
    const map = accountingDefaultMap('quickbooks_online', 'gst_in');
    delete map['tax_code:input@1800'];
    const { missing } = accountingBuildVouchers(SOURCES, { system: 'quickbooks_online', regime: 'gst_in', map, homeStateCode: HOME_STATE });
    expect(missing.map((item) => item.key)).toEqual(['tax_code:input@1800']);
  });

  it('prefers a cost code’s account to the category’s', () => {
    const map = { ...accountingDefaultMap('tally', 'gst_in'), 'cost_code:03.20': { code: '', name: 'Sand and Aggregates' } };
    const { vouchers } = accountingBuildVouchers(SOURCES.slice(0, 1), { system: 'tally', regime: 'gst_in', map, homeStateCode: HOME_STATE });
    expect(byAccount(vouchers[0]!)['Sand and Aggregates']).toBe(500_000n);
  });

  it('names a mapped site as its cost centre', () => {
    const { vouchers } = accountingBuildVouchers(SOURCES.slice(1, 2), {
      system: 'sap_b1',
      regime: 'gst_in',
      map: accountingDefaultMap('sap_b1', 'gst_in'),
      costCentres: { [SITE.id]: { code: 'LKV', name: 'Lakeview' } },
    });
    expect(vouchers[0]!.lines[0]!.costCentre).toEqual({ code: 'LKV', name: 'Lakeview' });
  });
});

describe('accounting helpers', () => {
  it('recognises the rate a bill was charged at', () => {
    expect(accountingEffectiveRate(100_000n, 18_000n, 'gst_in')).toBe(1800);
    expect(accountingEffectiveRate(99_999n, 18_000n, 'gst_in')).toBe(1800);
    expect(accountingEffectiveRate(100_000n, 5_000n, 'vat_ae')).toBe(500);
    expect(accountingEffectiveRate(100_000n, 7_000n, 'gst_in')).toBe(700);
    expect(accountingEffectiveRate(100_000n, 0n, 'gst_in')).toBe(0);
  });

  it('splits GST into halves that add back up, or IGST across states', () => {
    expect(accountingTaxSplit('gst_in', 1_001n, 1800, { homeStateCode: '33', counterpartyTaxId: '33AAAA' })).toEqual([
      { head: 'cgst', rateBp: 900, amount: 501n },
      { head: 'sgst', rateBp: 900, amount: 500n },
    ]);
    expect(accountingTaxSplit('gst_in', 1_000n, 1800, { homeStateCode: '33', counterpartyTaxId: '27AAAA' })).toEqual([
      { head: 'igst', rateBp: 1800, amount: 1_000n },
    ]);
    expect(accountingTaxSplit('vat_sa', 1_500n, 1500)).toEqual([{ head: 'tax', rateBp: 1500, amount: 1_500n }]);
    expect(accountingTaxSplit('gst_in', 0n, 1800)).toEqual([]);
  });

  it('gives stable external ids and party codes', () => {
    expect(accountingExternalId('purchase_invoice', '3f2a9c01-b7d4-4e5f-9a0b-1c2d3e4f5a6b')).toBe('PI-3F2A9C01B7D4');
    expect(accountingPartyCode('V', '3f2a9c01-b7d4-4e5f-9a0b-1c2d3e4f5a6b')).toBe('V-3F2A9C01');
    expect(accountingPartyCode('C', ' Lakeview RWA ')).toBe(accountingPartyCode('C', 'lakeview rwa'));
    expect(accountingSiteCode('Lakeview Towers — Phase 2 (North Block)')).toBe('LAKEVIEW-TOWERS-PHAS');
  });

  it('quotes CSV cells that need it and defuses formulas, but keeps amounts numeric', () => {
    expect(accountingCsvText('plain')).toBe('plain');
    expect(accountingCsvText('Steels, & Co')).toBe('"Steels, & Co"');
    expect(accountingCsvText('Ravi "Mason"')).toBe('"Ravi ""Mason"""');
    expect(accountingCsvText('line\nbreak')).toBe('"line\nbreak"');
    expect(accountingCsvText('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(accountingCsvText('-1250.50')).toBe('-1250.50');
  });

  it('knows its keys', () => {
    expect(isAccountingKey('expense:fuel')).toBe(true);
    expect(isAccountingKey('expense:materials@1800')).toBe(true);
    expect(isAccountingKey('expense:caviar')).toBe(false);
    expect(isAccountingKey('cost_code:03.20')).toBe(true);
    expect(isAccountingKey(`site:${SITE.id}`)).toBe(true);
    expect(isAccountingKey('tax_code:output@500')).toBe(true);
    expect(isAccountingKey('input_cgst@900')).toBe(true);
    expect(isAccountingKey('drop table')).toBe(false);
    expect(accountingKeyLabel('expense:materials@1800')).toBe('Materials at 18%');
    expect(accountingKeyLabel('input_tax', 'vat_ae')).toBe('Input VAT');
    // Only the tax-code systems are asked for tax codes.
    expect(accountingKeyCatalogue('tally', 'gst_in').some((key) => key.group === 'tax_codes')).toBe(false);
    expect(accountingKeyCatalogue('xero', 'vat_ae').filter((key) => key.group === 'tax_codes').map((key) => key.key)).toEqual([
      'tax_code:none',
      'tax_code:input@500',
      'tax_code:output@500',
    ]);
  });

  it('suggests a complete map for every system and regime', () => {
    for (const system of ACCOUNTING_SYSTEMS) {
      for (const regime of ['gst_in', 'vat_ae', 'vat_sa', 'none']) {
        const defaults = accountingDefaultMap(system, regime);
        for (const key of accountingKeyCatalogue(system, regime)) {
          expect(defaults[key.key]?.name, `${system} ${regime} ${key.key}`).toBeTruthy();
        }
      }
    }
    expect(accountingDefaultMap('tally', 'gst_in')['accounts_payable']!.name).toBe('Sundry Creditors');
    expect(accountingDefaultMap('tally', 'vat_ae')['input_tax']!.name).toBe('Input VAT 5%');
  });
});

const SAP_OBJECTS: Record<string, string> = { OPCH: 'ap', PCH1: 'ap', OINV: 'ar', INV1: 'ar', OJDT: 'je', JDT1: 'je' };

describe('accounting export files', () => {
  it('lays out every system’s files, each voucher in exactly one', () => {
    const names: Record<string, string[]> = {};
    for (const system of ACCOUNTING_SYSTEMS) {
      const vouchers = fixtureVouchers(system);
      const files = accountingExportFiles({
        system,
        regime: 'gst_in',
        currency: 'INR',
        digits: 2,
        vouchers,
        masters: fixtureMasters(system, vouchers),
        map: accountingDefaultMap(system, 'gst_in'),
        settings: { netsuiteSubsidiary: 'Lakeview Builders Pvt Ltd' },
      });
      names[system] = files.map((file) => file.name);
      for (const voucher of vouchers) {
        const carrying = files.filter((file) => file.content.includes(voucher.externalId) && !file.name.includes('mapping'));
        // One business object each: SAP's is a header file and its lines file, which pair up.
        const objects = new Set(carrying.map((file) => SAP_OBJECTS[file.name.slice(0, 4)] ?? file.name));
        expect(objects.size, `${system} ${voucher.externalId}`).toBe(1);
      }
    }
    expect(names).toEqual({
      tally: ['tally-masters.xml', 'tally-vouchers.xml', 'chart-of-accounts-mapping.csv'],
      quickbooks_online: [
        'quickbooks-online-suppliers.csv',
        'quickbooks-online-customers.csv',
        'quickbooks-online-bills.csv',
        'quickbooks-online-invoices.csv',
        'quickbooks-online-journal-entries.csv',
        'chart-of-accounts-mapping.csv',
      ],
      quickbooks_desktop: ['quickbooks-desktop.iif', 'chart-of-accounts-mapping.csv'],
      xero: ['xero-contacts.csv', 'xero-bills.csv', 'xero-sales-invoices.csv', 'xero-manual-journals.csv', 'chart-of-accounts-mapping.csv'],
      sap_b1: [
        'OCRD-business-partners.txt',
        'OPCH-ap-invoices.txt',
        'PCH1-ap-invoices-lines.txt',
        'OINV-ar-invoices.txt',
        'INV1-ar-invoices-lines.txt',
        'OJDT-journal-entries.txt',
        'JDT1-journal-entry-lines.txt',
        'chart-of-accounts-mapping.csv',
      ],
      netsuite: [
        'netsuite-vendors.csv',
        'netsuite-customers.csv',
        'netsuite-vendor-bills.csv',
        'netsuite-invoices.csv',
        'netsuite-journal-entries.csv',
        'chart-of-accounts-mapping.csv',
      ],
    });
  });
});

describe('accounting schemas', () => {
  it('refuses a backwards or year-plus range and an empty selection', () => {
    const base = { system: 'tally', from: '2026-04-01', to: '2026-04-30', include: ['purchases'] };
    expect(accountingExportSchema.safeParse(base).success).toBe(true);
    expect(accountingExportSchema.safeParse({ ...base, from: '2026-05-01' }).success).toBe(false);
    expect(accountingExportSchema.safeParse({ ...base, from: '2025-01-01' }).success).toBe(false);
    expect(accountingExportSchema.safeParse({ ...base, include: [] }).success).toBe(false);
    expect(accountingExportSchema.parse(base).include_exported).toBe(false);
  });

  it('accepts only keys the mapping knows', () => {
    expect(accountingMappingSchema.safeParse({ system: 'xero', rows: [{ key: 'bank', code: '090', name: 'Bank' }] }).success).toBe(true);
    expect(accountingMappingSchema.safeParse({ system: 'xero', rows: [{ key: 'nonsense', name: 'x' }] }).success).toBe(false);
  });
});
