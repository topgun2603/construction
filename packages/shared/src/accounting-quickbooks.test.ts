import { describe, expect, it } from 'vitest';
import { qbdIif, qboBillsCsv, qboContactsCsv, qboInvoicesCsv, qboJournalsCsv } from './accounting-quickbooks';
import { CLIENT, csvRecords, fixtureMasters, fixtureVouchers, minor, parseCsv, STEEL } from './accounting.fixtures';

const options = { digits: 2, currency: 'INR', siteDimension: 'class' as const };

describe('QuickBooks Online CSV', () => {
  const vouchers = fixtureVouchers('quickbooks_online');
  const bills = vouchers.filter((voucher) => voucher.document === 'bill');
  const invoices = vouchers.filter((voucher) => voucher.document === 'invoice');
  const journals = vouchers.filter((voucher) => voucher.document === 'journal');

  it('writes journal entries a row per line, debits equal to credits in each', () => {
    const text = qboJournalsCsv(journals, options);
    expect(parseCsv(text)[0]).toEqual(['Journal No', 'Journal Date', 'Currency', 'Memo', 'Account', 'Debits', 'Credits', 'Description', 'Name', 'Class', 'Location']);
    const rows = csvRecords(text);
    const byJournal = new Map<string, bigint>();
    for (const row of rows) {
      byJournal.set(row['Journal No']!, (byJournal.get(row['Journal No']!) ?? 0n) + minor(row['Debits']!) - minor(row['Credits']!));
    }
    expect(byJournal.size).toBe(journals.length);
    for (const balance of byJournal.values()) expect(balance).toBe(0n);
    // The diesel bill: expense, IGST and petty cash, dated day-first, the site as the class.
    const diesel = rows.filter((row) => row['Journal No'] === journals[0]!.externalId);
    expect(diesel.map((row) => [row['Account'], row['Debits'], row['Credits'], row['Class']])).toEqual([
      ['Fuel', '1000.00', '', 'Lakeview Towers'],
      ['Input IGST', '180.00', '', ''],
      ['Petty Cash', '', '1180.00', ''],
    ]);
    expect(diesel[0]!['Journal Date']).toBe('08/04/2026');
    expect(diesel[0]!['Description']).toBe('Diesel <JCB> & "urgent"');
    // A receivables line names the customer, or QuickBooks refuses it.
    const receipt = rows.find((row) => row['Account'] === 'Accounts Receivable');
    expect(receipt?.['Name']).toBe(CLIENT.name);
  });

  it('writes bills net of tax, with the tax code and amount on each line', () => {
    const rows = csvRecords(qboBillsCsv(bills, options));
    const invoice = rows.filter((row) => row['Bill No'] === 'SMS/26/0042');
    expect(invoice.map((row) => [row['Supplier'], row['Account'], row['Line Amount'], row['Line Tax Code'], row['Line Tax Amount']])).toEqual([
      [STEEL.name, 'Materials', '10000.00', 'GST 18%', '1800.00'],
      [STEEL.name, 'Materials', '5000.00', 'GST 5%', '250.00'],
    ]);
    expect(invoice[0]!['Due Date']).toBe('05/05/2026');
    const ra = rows.filter((row) => row['Bill No'] === 'SC-007/RA-2');
    expect(ra.map((row) => [row['Account'], row['Line Amount'], row['Line Tax Code']])).toEqual([
      ['Subcontract Costs', '100000.00', 'GST 18%'],
      ['Retention Payable', '-5000.00', 'Out of Scope'],
      ['Subcontractor Advances', '-10000.00', 'Out of Scope'],
      ['Subcontractor Recoveries', '-2000.00', 'Out of Scope'],
    ]);
    // Lines plus tax come to what the subcontractor is owed.
    const total = ra.reduce((sum, row) => sum + minor(row['Line Amount']!) + minor(row['Line Tax Amount']!), 0n);
    expect(total).toBe(10_100_000n);
  });

  it('writes invoices with retention and advance as negative lines, adding up to what the client owes', () => {
    const rows = csvRecords(qboInvoicesCsv(invoices, options));
    expect(rows.map((row) => [row['Item(Product/Service)'], row['Item Amount'], row['Item Tax Code']])).toEqual([
      ['Retention Receivable', '-10000.00', 'Out of Scope'],
      ['Client Advances', '-20000.00', 'Out of Scope'],
      ['Contract Revenue', '200000.00', 'GST 18%'],
    ]);
    const total = rows.reduce((sum, row) => sum + minor(row['Item Amount']!) + minor(row['Item Tax Amount']!), 0n);
    expect(total).toBe(20_600_000n);
    expect(rows[0]!['Customer']).toBe(CLIENT.name);
  });

  it('puts the site in Location when the company tracks jobs that way', () => {
    const rows = csvRecords(qboBillsCsv(bills, { ...options, siteDimension: 'location' }));
    expect(rows[0]!['Class']).toBe('');
    expect(rows[0]!['Location']).toBe('Lakeview Towers');
  });

  it('lists contacts with quoting where a name needs it', () => {
    const text = qboContactsCsv([STEEL]);
    expect(text.split('\r\n')[1]).toBe(
      'Sri Murugan Steels & Co,Sri Murugan Steels & Co,accounts@murugan.example,919800000001,"12, Anna Salai, Chennai",33AAAAA0000A1Z5,V-11111111',
    );
  });
});

describe('QuickBooks Desktop IIF', () => {
  const vouchers = fixtureVouchers('quickbooks_desktop');
  const text = qbdIif(vouchers, fixtureMasters('quickbooks_desktop', vouchers), { digits: 2, currency: 'INR' });
  const rows = text.trimEnd().split('\r\n').map((line) => line.split('\t'));

  it('declares the lists and the transaction layout in header rows', () => {
    const headers = rows.filter((row) => row[0]!.startsWith('!')).map((row) => row[0]);
    expect(headers).toEqual(['!ACCNT', '!VEND', '!CUST', '!CLASS', '!TRNS', '!SPL', '!ENDTRNS']);
    expect(rows.find((row) => row[0] === 'ACCNT' && row[1] === 'Petty Cash')?.[2]).toBe('BANK');
    expect(rows.find((row) => row[0] === 'ACCNT' && row[1] === 'Input CGST')?.[2]).toBe('OCASSET');
    expect(rows.find((row) => row[0] === 'ACCNT' && row[1] === 'Accounts Payable')?.[2]).toBe('AP');
  });

  it('writes each transaction as TRNS, SPL… and ENDTRNS, summing to zero', () => {
    const transactions: string[][][] = [];
    let current: string[][] = [];
    for (const row of rows) {
      if (row[0] === 'TRNS' || row[0] === 'SPL') current.push(row);
      if (row[0] === 'ENDTRNS') {
        transactions.push(current);
        current = [];
      }
    }
    expect(transactions).toHaveLength(vouchers.length);
    for (const transaction of transactions) {
      expect(transaction[0]![0]).toBe('TRNS');
      expect(transaction.slice(1).every((row) => row[0] === 'SPL')).toBe(true);
      expect(transaction.reduce((sum, row) => sum + minor(row[7]!), 0n)).toBe(0n);
    }
    // A bill opens on the supplier's payables line, as QuickBooks expects.
    expect(transactions[0]![0]!.slice(2, 9)).toEqual(['BILL', '05/04/2026', 'Accounts Payable', STEEL.name, '', '-17050.00', 'SMS/26/0042']);
    expect(transactions[4]![0]![2]).toBe('INVOICE');
    expect(transactions[2]![0]![2]).toBe('GENERAL JOURNAL');
  });

  it('never lets a tab or line break into a cell', () => {
    for (const row of rows) for (const cell of row) expect(cell).not.toMatch(/[\r\n]/);
  });
});
