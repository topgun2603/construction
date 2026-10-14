import { describe, expect, it } from 'vitest';
import { accountingDefaultMap, accountingBuildVouchers } from './accounting';
import { xeroBillsCsv, xeroContactsCsv, xeroInvoicesCsv, xeroJournalsCsv } from './accounting-xero';
import { CLIENT, csvRecords, fixtureVouchers, minor, parseCsv, SITE, SOURCES, STEEL } from './accounting.fixtures';

const options = { digits: 2, currency: 'INR', trackingName: 'Site' };
const vouchers = fixtureVouchers('xero');

describe('Xero CSV imports', () => {
  it('fills the bills template column for column, with codes, tax types and tracking', () => {
    const text = xeroBillsCsv(vouchers.filter((voucher) => voucher.document === 'bill'), options);
    expect(parseCsv(text)[0]).toEqual([
      '*ContactName', 'EmailAddress', 'POAddressLine1', 'POAddressLine2', 'POAddressLine3', 'POAddressLine4', 'POCity', 'PORegion', 'POPostalCode', 'POCountry',
      '*InvoiceNumber', '*InvoiceDate', '*DueDate', 'Total', 'InventoryItemCode', 'Description', '*Quantity', '*UnitAmount', '*AccountCode', '*TaxType', 'TaxAmount',
      'TrackingName1', 'TrackingOption1', 'TrackingName2', 'TrackingOption2', 'Currency',
    ]);
    const rows = csvRecords(text);
    const first = rows[0]!;
    expect([first['*ContactName'], first['*InvoiceNumber'], first['*InvoiceDate'], first['*AccountCode'], first['*TaxType'], first['*UnitAmount'], first['TaxAmount']]).toEqual([
      STEEL.name, 'SMS/26/0042', '05/04/2026', '310', 'GST on Expenses 18%', '10000.00', '1800.00',
    ]);
    expect([first['TrackingName1'], first['TrackingOption1']]).toEqual(['Site', SITE.name]);
    expect(first['Description']).toContain(vouchers[0]!.externalId);
  });

  it('writes sales invoices with the external id as the number', () => {
    const invoices = vouchers.filter((voucher) => voucher.document === 'invoice');
    const rows = csvRecords(xeroInvoicesCsv(invoices, options));
    expect(rows.every((row) => row['*InvoiceNumber'] === invoices[0]!.externalId)).toBe(true);
    expect(rows.map((row) => [row['*AccountCode'], row['*UnitAmount'], row['*TaxType']])).toEqual([
      ['1150', '-10000.00', 'No GST'],
      ['2300', '-20000.00', 'No GST'],
      ['200', '200000.00', 'GST on Income 18%'],
    ]);
    expect(rows[0]!['*ContactName']).toBe(CLIENT.name);
    expect(rows[0]!['Reference']).toBe(SITE.name);
  });

  it('writes manual journals that balance, each with its own narration and the no-tax rate', () => {
    const journals = vouchers.filter((voucher) => voucher.document === 'journal');
    const rows = csvRecords(xeroJournalsCsv(journals, options));
    const byNarration = new Map<string, bigint>();
    for (const row of rows) byNarration.set(row['*Narration']!, (byNarration.get(row['*Narration']!) ?? 0n) + minor(row['*Amount']!));
    // Narrations are unique per journal, or Xero would merge two journals on the same day.
    expect(byNarration.size).toBe(journals.length);
    for (const total of byNarration.values()) expect(total).toBe(0n);
    expect(new Set(rows.map((row) => row['*TaxRate']))).toEqual(new Set(['No GST']));
    const wages = rows.filter((row) => row['*Narration']!.startsWith('Wages 2026-04-01'));
    expect(wages.map((row) => [row['*AccountCode'], row['*Amount']])).toEqual([
      ['477', '50000.00'],
      ['1200', '-5000.00'],
      ['814', '-45000.00'],
    ]);
  });

  it('refuses to export without a "no tax" rate for journals', () => {
    const map = accountingDefaultMap('xero', 'gst_in');
    delete map['tax_code:none'];
    const { missing } = accountingBuildVouchers(SOURCES.slice(2, 3), { system: 'xero', regime: 'gst_in', map });
    expect(missing.map((item) => item.key)).toEqual(['tax_code:none']);
  });

  it('lists contacts with the SiteBook code as account number', () => {
    const rows = csvRecords(xeroContactsCsv([STEEL, CLIENT]));
    expect(rows.map((row) => [row['*ContactName'], row['AccountNumber'], row['TaxNumber']])).toEqual([
      [STEEL.name, 'V-11111111', '33AAAAA0000A1Z5'],
      [CLIENT.name, 'C-33333333', ''],
    ]);
  });
});
