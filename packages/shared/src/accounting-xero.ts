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
 * Xero's CSV import templates, column for column (Business → Bills to pay → Import; Business →
 * Invoices → Import; Accounting → Manual journals → Import; Contacts → Import). Required columns keep
 * Xero's leading asterisk.
 *
 * Bills and sales invoices are written TAX EXCLUSIVE — choose "Tax exclusive" on Xero's import screen —
 * with the tax type on every line and the tax amount beside it, so Xero's own figure can be checked
 * against SiteBook's. Accounts are Xero account codes, so the mapping must give a code for each.
 *
 * Xero builds one manual journal from consecutive rows with the same narration and date, so the
 * narration ends with the voucher's external id — two journals on one day never merge. Journal lines
 * already carry their tax as separate lines, so every one is written with the "no tax" rate.
 *
 * The site goes in as a tracking category (default name "Site"); its options must exist in Xero.
 * Dates are DD/MM/YYYY.
 */

export interface XeroOptions extends AccountingFormatOptions {
  /** The tracking category the site is an option of. */
  trackingName: string;
}

function money(amount: bigint, digits: number): string {
  return minorToDecimal(amount, digits);
}

function tracking(line: AccountingLine, options: XeroOptions): string[] {
  const site = line.costCentre?.name;
  return site ? [accountingCsvText(options.trackingName), accountingCsvText(site)] : ['', ''];
}

const ADDRESS_BLANKS = ['', '', '', '', '', '', '', ''];

/** Bills (Purchases) import template. */
export function xeroBillsCsv(vouchers: readonly AccountingVoucher[], options: XeroOptions): string {
  const rows: string[][] = [
    [
      '*ContactName', 'EmailAddress', 'POAddressLine1', 'POAddressLine2', 'POAddressLine3', 'POAddressLine4', 'POCity', 'PORegion', 'POPostalCode', 'POCountry',
      '*InvoiceNumber', '*InvoiceDate', '*DueDate', 'Total', 'InventoryItemCode', 'Description', '*Quantity', '*UnitAmount', '*AccountCode', '*TaxType', 'TaxAmount',
      'TrackingName1', 'TrackingOption1', 'TrackingName2', 'TrackingOption2', 'Currency',
    ],
  ];
  for (const voucher of vouchers) {
    for (const line of accountingDocumentLines(voucher)) {
      rows.push([
        accountingCsvText(voucher.party?.name ?? ''),
        accountingCsvText(voucher.party?.email ?? ''),
        ...ADDRESS_BLANKS,
        accountingCsvText(voucher.reference),
        accountingDmy(voucher.date),
        accountingDmy(voucher.dueDate ?? voucher.date),
        '',
        '',
        // The external id rides on the line, so the bill in Xero can be traced back to SiteBook.
        accountingCsvText(`${line.description} (${voucher.externalId})`),
        '1',
        money(line.amount, options.digits),
        accountingCsvText(line.account.code),
        accountingCsvText((line.taxCode ?? voucher.noTaxCode)?.code ?? ''),
        money(line.taxAmount, options.digits),
        ...tracking(line, options),
        '',
        '',
        options.currency,
      ]);
    }
  }
  return accountingCsv(rows);
}

/** Sales invoice import template. The invoice number is SiteBook's external id. */
export function xeroInvoicesCsv(vouchers: readonly AccountingVoucher[], options: XeroOptions): string {
  const rows: string[][] = [
    [
      '*ContactName', 'EmailAddress', 'POAddressLine1', 'POAddressLine2', 'POAddressLine3', 'POAddressLine4', 'POCity', 'PORegion', 'POPostalCode', 'POCountry',
      '*InvoiceNumber', 'Reference', '*InvoiceDate', '*DueDate', 'Total', 'InventoryItemCode', '*Description', '*Quantity', '*UnitAmount', 'Discount', '*AccountCode', '*TaxType', 'TaxAmount',
      'TrackingName1', 'TrackingOption1', 'TrackingName2', 'TrackingOption2', 'Currency', 'BrandingTheme',
    ],
  ];
  for (const voucher of vouchers) {
    for (const line of accountingDocumentLines(voucher)) {
      rows.push([
        accountingCsvText(voucher.party?.name ?? ''),
        accountingCsvText(voucher.party?.email ?? ''),
        ...ADDRESS_BLANKS,
        accountingCsvText(voucher.reference),
        accountingCsvText(voucher.siteName ?? ''),
        accountingDmy(voucher.date),
        accountingDmy(voucher.dueDate ?? voucher.date),
        '',
        '',
        accountingCsvText(line.description || voucher.narration),
        '1',
        money(line.amount, options.digits),
        '',
        accountingCsvText(line.account.code),
        accountingCsvText((line.taxCode ?? voucher.noTaxCode)?.code ?? ''),
        money(line.taxAmount, options.digits),
        ...tracking(line, options),
        '',
        '',
        options.currency,
        '',
      ]);
    }
  }
  return accountingCsv(rows);
}

/** Manual journal import template: debit positive, credit negative. */
export function xeroJournalsCsv(vouchers: readonly AccountingVoucher[], options: XeroOptions): string {
  const rows: string[][] = [
    ['*Narration', '*Date', 'Description', '*AccountCode', '*TaxRate', '*Amount', 'TrackingName1', 'TrackingOption1', 'TrackingName2', 'TrackingOption2'],
  ];
  for (const voucher of vouchers) {
    for (const line of voucher.lines) {
      const who = line.party ? ` · ${line.party.name}` : '';
      rows.push([
        accountingCsvText(voucher.narration),
        accountingDmy(voucher.date),
        accountingCsvText(`${line.description}${who}`),
        accountingCsvText(line.account.code),
        accountingCsvText(voucher.noTaxCode?.code ?? ''),
        money(line.amount, options.digits),
        ...tracking(line, options),
        '',
        '',
      ]);
    }
  }
  return accountingCsv(rows);
}

/** Contacts import: suppliers, subcontractors and clients, with the SiteBook code as account number. */
export function xeroContactsCsv(parties: readonly AccountingParty[]): string {
  const rows: string[][] = [['*ContactName', 'AccountNumber', 'EmailAddress', 'POAddressLine1', 'PhoneNumber', 'TaxNumber']];
  for (const party of parties) {
    rows.push([
      accountingCsvText(party.name),
      accountingCsvText(party.code),
      accountingCsvText(party.email ?? ''),
      accountingCsvText(party.address ?? ''),
      accountingCsvText(party.phone ?? ''),
      accountingCsvText(party.taxId ?? ''),
    ]);
  }
  return accountingCsv(rows);
}
