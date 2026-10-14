import {
  accountingCsv,
  accountingCsvText,
  accountingDmy,
  accountingDocumentLines,
  type AccountingFormatOptions,
  type AccountingLine,
  type AccountingParty,
  type AccountingVoucher,
} from './accounting';
import { minorToDecimal } from './money';

/**
 * Oracle NetSuite CSV imports (Setup → Import/Export → Import CSV Records): Journal Entries, Vendor
 * Bills and Invoices, each a single CSV with one row per line, grouped into one record
 * by `External ID`. NetSuite keys records on External ID, so importing the same file again in
 * "Add or Update" mode updates rather than duplicates — and "Add" refuses the repeat.
 *
 * Every row carries Subsidiary (OneWorld accounts need it), Currency, and the site in whichever of
 * Department, Class or Location the company uses for jobs. Accounts are given by name and number:
 * map whichever your account preference uses. Invoice lines are items, named after the account they
 * post to — create a non-inventory/service item of that name once. Dates are DD/MM/YYYY: set the
 * import's date format to match.
 */

export type NetSuiteSiteDimension = 'department' | 'class' | 'location';

export interface NetSuiteOptions extends AccountingFormatOptions {
  subsidiary: string;
  siteDimension: NetSuiteSiteDimension;
}

function money(amount: bigint, digits: number): string {
  return minorToDecimal(amount, digits);
}

function dimensions(line: AccountingLine, options: NetSuiteOptions): string[] {
  const site = accountingCsvText(line.costCentre?.name ?? '');
  return [
    options.siteDimension === 'department' ? site : '',
    options.siteDimension === 'class' ? site : '',
    options.siteDimension === 'location' ? site : '',
  ];
}

export function netsuiteJournalsCsv(vouchers: readonly AccountingVoucher[], options: NetSuiteOptions): string {
  const rows: string[][] = [
    ['External ID', 'Date', 'Subsidiary', 'Currency', 'Memo', 'Account', 'Account Number', 'Debit', 'Credit', 'Line Memo', 'Name', 'Department', 'Class', 'Location'],
  ];
  for (const voucher of vouchers) {
    for (const line of voucher.lines) {
      rows.push([
        accountingCsvText(voucher.externalId),
        accountingDmy(voucher.date),
        accountingCsvText(options.subsidiary),
        options.currency,
        accountingCsvText(voucher.narration),
        accountingCsvText(line.account.name),
        accountingCsvText(line.account.code),
        line.amount > 0n ? money(line.amount, options.digits) : '',
        line.amount < 0n ? money(-line.amount, options.digits) : '',
        accountingCsvText(line.description),
        // Receivables and payables lines need the customer or vendor in Name.
        accountingCsvText(line.party?.name ?? ''),
        ...dimensions(line, options),
      ]);
    }
  }
  return accountingCsv(rows);
}

export function netsuiteVendorBillsCsv(vouchers: readonly AccountingVoucher[], options: NetSuiteOptions): string {
  const rows: string[][] = [
    ['External ID', 'Vendor', 'Date', 'Due Date', 'Reference No.', 'Memo', 'Subsidiary', 'Currency', 'Expense Account', 'Expense Account Number', 'Amount', 'Tax Code', 'Tax Amount', 'Line Memo', 'Department', 'Class', 'Location'],
  ];
  for (const voucher of vouchers) {
    for (const line of accountingDocumentLines(voucher)) {
      rows.push([
        accountingCsvText(voucher.externalId),
        accountingCsvText(voucher.party?.name ?? ''),
        accountingDmy(voucher.date),
        accountingDmy(voucher.dueDate ?? voucher.date),
        accountingCsvText(voucher.reference),
        accountingCsvText(voucher.narration),
        accountingCsvText(options.subsidiary),
        options.currency,
        accountingCsvText(line.account.name),
        accountingCsvText(line.account.code),
        money(line.amount, options.digits),
        accountingCsvText((line.taxCode ?? voucher.noTaxCode)?.code ?? ''),
        money(line.taxAmount, options.digits),
        accountingCsvText(line.description),
        ...dimensions(line, options),
      ]);
    }
  }
  return accountingCsv(rows);
}

export function netsuiteInvoicesCsv(vouchers: readonly AccountingVoucher[], options: NetSuiteOptions): string {
  const rows: string[][] = [
    ['External ID', 'Customer', 'Date', 'Due Date', 'Memo', 'Subsidiary', 'Currency', 'Item', 'Description', 'Quantity', 'Rate', 'Amount', 'Tax Code', 'Tax Amount', 'Department', 'Class', 'Location'],
  ];
  for (const voucher of vouchers) {
    for (const line of accountingDocumentLines(voucher)) {
      const amount = money(line.amount, options.digits);
      rows.push([
        accountingCsvText(voucher.externalId),
        accountingCsvText(voucher.party?.name ?? ''),
        accountingDmy(voucher.date),
        accountingDmy(voucher.dueDate ?? voucher.date),
        accountingCsvText(voucher.narration),
        accountingCsvText(options.subsidiary),
        options.currency,
        accountingCsvText(line.account.name),
        accountingCsvText(line.description),
        '1',
        amount,
        amount,
        accountingCsvText((line.taxCode ?? voucher.noTaxCode)?.code ?? ''),
        money(line.taxAmount, options.digits),
        ...dimensions(line, options),
      ]);
    }
  }
  return accountingCsv(rows);
}

/** Vendors or customers, with SiteBook's code as their external id. */
export function netsuiteEntitiesCsv(parties: readonly AccountingParty[], options: Pick<NetSuiteOptions, 'subsidiary'>): string {
  const rows: string[][] = [['External ID', 'Company Name', 'Tax Reg. Number', 'Email', 'Phone', 'Address', 'Subsidiary']];
  for (const party of parties) {
    rows.push([
      accountingCsvText(party.code),
      accountingCsvText(party.name),
      accountingCsvText(party.taxId ?? ''),
      accountingCsvText(party.email ?? ''),
      accountingCsvText(party.phone ?? ''),
      accountingCsvText(party.address ?? ''),
      accountingCsvText(options.subsidiary),
    ]);
  }
  return accountingCsv(rows);
}
