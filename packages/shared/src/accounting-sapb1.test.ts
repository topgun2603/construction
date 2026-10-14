import { describe, expect, it } from 'vitest';
import { sapb1DocumentFiles, sapb1JournalFiles, sapb1PartnersFile } from './accounting-sapb1';
import { CLIENT, fixtureVouchers, minor, STEEL } from './accounting.fixtures';

const vouchers = fixtureVouchers('sap_b1');
const options = { digits: 2, currency: 'INR', regime: 'gst_in' };

function table(content: string): string[][] {
  return content.trimEnd().split('\r\n').map((line) => line.split('\t'));
}

describe('SAP Business One DTW templates', () => {
  it('writes journal entries as OJDT and JDT1 with both header rows', () => {
    const journals = vouchers.filter((voucher) => voucher.document === 'journal');
    const [header, lines] = sapb1JournalFiles(journals, options);
    const head = table(header!.content);
    expect(head[0]).toEqual(['RecordKey', 'ReferenceDate', 'TaxDate', 'DueDate', 'Memo', 'Reference', 'Reference2', 'ProjectCode']);
    expect(head[1]).toEqual(['JdtNum', 'RefDate', 'TaxDate', 'DueDate', 'Memo', 'Ref1', 'Ref2', 'Project']);
    expect(head).toHaveLength(2 + journals.length);
    expect(head[2]!.slice(0, 2)).toEqual(['1', '20260408']);
    // SAP's journal memo is 50 characters.
    for (const row of head.slice(2)) expect(row[4]!.length).toBeLessThanOrEqual(50);

    const body = table(lines!.content);
    expect(body[0]).toEqual(['ParentKey', 'LineNum', 'AccountCode', 'ShortName', 'Debit', 'Credit', 'LineMemo', 'ProjectCode', 'Reference1']);
    expect(body[1]![0]).toBe('JdtNum');
    const balance = new Map<string, bigint>();
    for (const row of body.slice(2)) balance.set(row[0]!, (balance.get(row[0]!) ?? 0n) + minor(row[4]!) - minor(row[5]!));
    expect(balance.size).toBe(journals.length);
    for (const total of balance.values()) expect(total).toBe(0n);
    // Line numbers start at 0 within each entry.
    expect(body.slice(2).filter((row) => row[0] === '1').map((row) => row[1])).toEqual(['0', '1', '2']);
    // A receipt's client line is posted to the business partner, through the receivables account.
    const receiptKey = String(journals.findIndex((voucher) => voucher.sourceType === 'client_payment') + 1);
    const clientLine = body.find((row) => row[0] === receiptKey && row[3] === CLIENT.code)!;
    expect(clientLine.slice(2, 6)).toEqual(['1100', CLIENT.code, '', '50000.00']);
    expect(clientLine[7]).toBe('');
  });

  it('writes A/P invoices as service documents, net, with the GST tax code and the site as project', () => {
    const [header, lines] = sapb1DocumentFiles(vouchers.filter((voucher) => voucher.document === 'bill'), 'purchase', options);
    expect(header!.name).toBe('OPCH-ap-invoices.txt');
    const head = table(header!.content);
    expect(head[2]).toEqual([
      '1', STEEL.code, '20260405', '20260505', '20260405', 'SMS/26/0042', 'dDocument_Service',
      vouchers[0]!.narration, vouchers[0]!.externalId, 'LAKEVIEW-TOWERS',
    ]);
    const body = table(lines!.content);
    expect(body[0]).toEqual(['ParentKey', 'LineNum', 'AccountCode', 'ItemDescription', 'LineTotal', 'TaxCode', 'ProjectCode']);
    expect(body[1]).toEqual(['DocNum', 'LineNum', 'AcctCode', 'Dscription', 'LineTotal', 'TaxCode', 'Project']);
    expect(body.slice(2).filter((row) => row[0] === '1').map((row) => [row[2], row[4], row[5]])).toEqual([
      ['5000', '10000.00', 'I18'],
      ['5000', '5000.00', 'I5'],
    ]);
  });

  it('keys tax by VAT group under VAT, and writes A/R invoices as OINV and INV1', () => {
    const files = sapb1DocumentFiles(vouchers.filter((voucher) => voucher.document === 'invoice'), 'sales', { ...options, regime: 'vat_ae' });
    expect(files.map((file) => file.name)).toEqual(['OINV-ar-invoices.txt', 'INV1-ar-invoices-lines.txt']);
    expect(table(files[1]!.content)[0]![5]).toBe('VatGroup');
  });

  it('lists business partners as suppliers and customers', () => {
    const rows = table(sapb1PartnersFile([STEEL, CLIENT]).content);
    expect(rows[1]).toEqual(['CardCode', 'CardName', 'CardType', 'LicTradNum', 'Phone1', 'E_Mail']);
    expect(rows.slice(2).map((row) => row.slice(0, 3))).toEqual([
      [STEEL.code, STEEL.name, 'cSupplier'],
      [CLIENT.code, CLIENT.name, 'cCustomer'],
    ]);
  });

  it('keeps every row tab-delimited with no stray tabs or line breaks', () => {
    const partner = sapb1PartnersFile([{ ...STEEL, name: 'Tabbed\tName\nCo' }]);
    expect(table(partner.content)[2]![1]).toBe('Tabbed Name Co');
  });
});
