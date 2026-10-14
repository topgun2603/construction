import {
  accountingCompactDate,
  accountingDocumentLines,
  accountingTabText,
  accountingTruncate,
  type AccountingFile,
  type AccountingFormatOptions,
  type AccountingParty,
  type AccountingVoucher,
} from './accounting';
import { minorToDecimal } from './money';

/**
 * SAP Business One Data Transfer Workbench (DTW) templates.
 *
 * Each business object is a header file and a lines file, tab-delimited, each starting with TWO
 * header rows: DTW's field names, then the database column names — exactly as the templates DTW
 * ships with (`Templates\…\oJournalEntries\JournalEntries.txt` and `JournalEntries_Lines.txt`).
 * `RecordKey` ties a header to its lines (`ParentKey`); line numbers start at 0. Dates are YYYYMMDD.
 *
 *   OJDT / JDT1  journal entries — debit and credit columns; a supplier's or client's line names
 *                the business partner in ShortName and the control account in AccountCode.
 *   OPCH / PCH1  A/P service invoices (supplier invoices, subcontractors' running bills).
 *   OINV / INV1  A/R service invoices (client instalments and BOQ bills).
 *   OCRD         business partners, when masters are included.
 *
 * Documents are service-type (`dDocument_Service`), a line per G/L account, written net of tax with
 * the tax code beside it: `TaxCode` under GST (India localisation), `VatGroup` under VAT. SAP works
 * the tax out from the code. The site goes in as the project code, which must exist in SAP.
 * Field lengths are SAP's: journal memo 50, reference 100, comments 254.
 */

export interface SapB1Options extends AccountingFormatOptions {
  regime: string;
}

function money(amount: bigint, digits: number): string {
  return minorToDecimal(amount, digits);
}

function table(fieldNames: string[], columnNames: string[], rows: string[][]): string {
  return [fieldNames, columnNames, ...rows].map((row) => row.map(accountingTabText).join('\t')).join('\r\n') + '\r\n';
}

/** The project a voucher belongs to: its first line with a site. */
function projectOf(voucher: AccountingVoucher): string {
  return voucher.lines.find((line) => line.costCentre)?.costCentre?.code ?? '';
}

/** Journal entries: OJDT header and JDT1 lines. */
export function sapb1JournalFiles(vouchers: readonly AccountingVoucher[], options: SapB1Options): AccountingFile[] {
  const headers: string[][] = [];
  const lines: string[][] = [];
  vouchers.forEach((voucher, index) => {
    const key = String(index + 1);
    const date = accountingCompactDate(voucher.date);
    headers.push([
      key,
      date,
      date,
      date,
      accountingTruncate(voucher.narration, 50),
      accountingTruncate(voucher.externalId, 100),
      accountingTruncate(voucher.reference, 100),
      projectOf(voucher),
    ]);
    voucher.lines.forEach((line, lineIndex) => {
      lines.push([
        key,
        String(lineIndex),
        line.account.code,
        // A business partner's line is posted to the partner; any other line to the account itself.
        line.role === 'control' && line.party ? line.party.code : line.account.code,
        line.amount > 0n ? money(line.amount, options.digits) : '',
        line.amount < 0n ? money(-line.amount, options.digits) : '',
        accountingTruncate(line.description, 50),
        line.costCentre?.code ?? '',
        accountingTruncate(voucher.externalId, 100),
      ]);
    });
  });
  return [
    {
      name: 'OJDT-journal-entries.txt',
      contentType: 'text/tab-separated-values',
      content: table(
        ['RecordKey', 'ReferenceDate', 'TaxDate', 'DueDate', 'Memo', 'Reference', 'Reference2', 'ProjectCode'],
        ['JdtNum', 'RefDate', 'TaxDate', 'DueDate', 'Memo', 'Ref1', 'Ref2', 'Project'],
        headers,
      ),
    },
    {
      name: 'JDT1-journal-entry-lines.txt',
      contentType: 'text/tab-separated-values',
      content: table(
        ['ParentKey', 'LineNum', 'AccountCode', 'ShortName', 'Debit', 'Credit', 'LineMemo', 'ProjectCode', 'Reference1'],
        ['JdtNum', 'LineNum', 'Account', 'ShortName', 'Debit', 'Credit', 'LineMemo', 'Project', 'Ref1'],
        lines,
      ),
    },
  ];
}

/** A/P (`OPCH`/`PCH1`) or A/R (`OINV`/`INV1`) service invoices. */
export function sapb1DocumentFiles(
  vouchers: readonly AccountingVoucher[],
  kind: 'purchase' | 'sales',
  options: SapB1Options,
): AccountingFile[] {
  const headers: string[][] = [];
  const lines: string[][] = [];
  // India's localisation keys tax by tax code; the VAT localisations by VAT group.
  const taxField = options.regime === 'gst_in' ? 'TaxCode' : 'VatGroup';
  vouchers.forEach((voucher, index) => {
    const key = String(index + 1);
    const date = accountingCompactDate(voucher.date);
    headers.push([
      key,
      voucher.party?.code ?? '',
      date,
      accountingCompactDate(voucher.dueDate ?? voucher.date),
      date,
      // The supplier's own invoice number on a purchase; SiteBook's id on a sale.
      accountingTruncate(voucher.reference, 100),
      'dDocument_Service',
      accountingTruncate(voucher.narration, 254),
      accountingTruncate(voucher.externalId, 50),
      projectOf(voucher),
    ]);
    accountingDocumentLines(voucher).forEach((line, lineIndex) => {
      lines.push([
        key,
        String(lineIndex),
        line.account.code,
        accountingTruncate(line.description, 100),
        money(line.amount, options.digits),
        (line.taxCode ?? voucher.noTaxCode)?.code ?? '',
        line.costCentre?.code ?? '',
      ]);
    });
  });
  const [head, body, label] = kind === 'purchase' ? ['OPCH', 'PCH1', 'ap-invoices'] : ['OINV', 'INV1', 'ar-invoices'];
  return [
    {
      name: `${head}-${label}.txt`,
      contentType: 'text/tab-separated-values',
      content: table(
        ['RecordKey', 'CardCode', 'DocDate', 'DocDueDate', 'TaxDate', 'NumAtCard', 'DocType', 'Comments', 'JournalMemo', 'Project'],
        ['DocNum', 'CardCode', 'DocDate', 'DocDueDate', 'TaxDate', 'NumAtCard', 'DocType', 'Comments', 'JrnlMemo', 'Project'],
        headers,
      ),
    },
    {
      name: `${body}-${label}-lines.txt`,
      contentType: 'text/tab-separated-values',
      content: table(
        ['ParentKey', 'LineNum', 'AccountCode', 'ItemDescription', 'LineTotal', taxField, 'ProjectCode'],
        ['DocNum', 'LineNum', 'AcctCode', 'Dscription', 'LineTotal', taxField, 'Project'],
        lines,
      ),
    },
  ];
}

/** Business partners (`OCRD`): suppliers and subcontractors as `cSupplier`, clients as `cCustomer`. */
export function sapb1PartnersFile(parties: readonly AccountingParty[]): AccountingFile {
  const rows = parties.map((party) => [
    party.code,
    accountingTruncate(party.name, 100),
    party.kind === 'vendor' ? 'cSupplier' : 'cCustomer',
    party.taxId ?? '',
    party.phone ?? '',
    party.email ?? '',
  ]);
  return {
    name: 'OCRD-business-partners.txt',
    contentType: 'text/tab-separated-values',
    content: table(
      ['CardCode', 'CardName', 'CardType', 'FederalTaxID', 'Phone1', 'EmailAddress'],
      ['CardCode', 'CardName', 'CardType', 'LicTradNum', 'Phone1', 'E_Mail'],
      rows,
    ),
  };
}
