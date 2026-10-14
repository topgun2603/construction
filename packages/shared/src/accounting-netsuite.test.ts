import { describe, expect, it } from 'vitest';
import { netsuiteEntitiesCsv, netsuiteInvoicesCsv, netsuiteJournalsCsv, netsuiteVendorBillsCsv } from './accounting-netsuite';
import { CLIENT, csvRecords, fixtureVouchers, minor, SITE, STEEL } from './accounting.fixtures';

const vouchers = fixtureVouchers('netsuite');
const options = { digits: 2, currency: 'INR', subsidiary: 'Lakeview Builders Pvt Ltd', siteDimension: 'department' as const };

describe('NetSuite CSV imports', () => {
  it('groups journal lines by external id, debits equal to credits', () => {
    const journals = vouchers.filter((voucher) => voucher.document === 'journal');
    const rows = csvRecords(netsuiteJournalsCsv(journals, options));
    const balance = new Map<string, bigint>();
    for (const row of rows) balance.set(row['External ID']!, (balance.get(row['External ID']!) ?? 0n) + minor(row['Debit']!) - minor(row['Credit']!));
    expect([...balance.keys()]).toEqual(journals.map((voucher) => voucher.externalId));
    for (const total of balance.values()) expect(total).toBe(0n);
    expect(new Set(rows.map((row) => row['Subsidiary']))).toEqual(new Set([options.subsidiary]));
    const fuel = rows.find((row) => row['Account'] === 'Fuel')!;
    expect([fuel['Account Number'], fuel['Debit'], fuel['Department'], fuel['Class'], fuel['Date']]).toEqual(['5020', '1000.00', SITE.name, '', '08/04/2026']);
  });

  it('writes vendor bills with the supplier’s number as the reference', () => {
    const rows = csvRecords(netsuiteVendorBillsCsv(vouchers.filter((voucher) => voucher.document === 'bill'), options));
    const steel = rows.filter((row) => row['Vendor'] === STEEL.name);
    expect(steel.map((row) => [row['External ID'], row['Reference No.'], row['Amount'], row['Tax Code'], row['Tax Amount']])).toEqual([
      [vouchers[0]!.externalId, 'SMS/26/0042', '10000.00', 'GST 18%', '1800.00'],
      [vouchers[0]!.externalId, 'SMS/26/0042', '5000.00', 'GST 5%', '250.00'],
    ]);
  });

  it('writes invoices that add up to what the client owes, the site in the chosen segment', () => {
    const rows = csvRecords(netsuiteInvoicesCsv(vouchers.filter((voucher) => voucher.document === 'invoice'), { ...options, siteDimension: 'location' }));
    const total = rows.reduce((sum, row) => sum + minor(row['Amount']!) + minor(row['Tax Amount']!), 0n);
    expect(total).toBe(20_600_000n);
    expect(rows[0]!['Customer']).toBe(CLIENT.name);
    const revenue = rows.find((row) => row['Item'] === 'Contract Revenue')!;
    expect([revenue['Location'], revenue['Department']]).toEqual([SITE.name, '']);
  });

  it('lists vendors and customers with SiteBook’s code as external id', () => {
    const rows = csvRecords(netsuiteEntitiesCsv([STEEL], options));
    expect(rows[0]).toMatchObject({ 'External ID': 'V-11111111', 'Company Name': STEEL.name, Address: '12, Anna Salai, Chennai' });
  });
});
