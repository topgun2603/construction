import {
  accountingCsv,
  accountingCsvText,
  accountingDmy,
  accountingDocumentLines,
  accountingTabText,
  type AccountingFormatOptions,
  type AccountingLine,
  type AccountingMasters,
  type AccountingNature,
  type AccountingParty,
  type AccountingVoucher,
} from './accounting';
import { minorToDecimal } from './money';

/**
 * QuickBooks: Online (CSV, Settings → Import data) and Desktop (IIF, File → Utilities → Import).
 *
 * QuickBooks Online imports bills, invoices and journal entries as separate CSV files, each a row per
 * line with the document's header repeated on every row — the import groups rows by document number.
 * Accounts are matched by name, and a bill's or invoice's tax by its tax code: QuickBooks works the
 * tax out itself, so a document's lines are written net of tax with the code beside them. Invoice
 * lines are products/services, not accounts, so each invoice line names a service item called after
 * the account it posts to ("Contract Revenue", "Retention Receivable") — create those items once.
 *
 * QuickBooks Desktop takes one IIF file: tab-delimited, `!TRNS / !SPL / !ENDTRNS` header rows, then a
 * `TRNS` row, its `SPL` rows and `ENDTRNS` per transaction. The `TRNS` row is the payables or
 * receivables line for a bill or invoice; amounts are signed (debit positive) and sum to zero. Desktop
 * posts tax as plain account lines here — exactly the tax ledgers in the mapping.
 *
 * Dates are DD/MM/YYYY, the form the Indian and Gulf editions read. A US-edition company file should
 * be switched to day-first dates in the import screen (Online) or Windows settings (Desktop).
 */

export type QuickBooksSiteDimension = 'class' | 'location';

function money(amount: bigint, digits: number): string {
  return minorToDecimal(amount, digits);
}

function siteColumns(line: AccountingLine, dimension: QuickBooksSiteDimension): [string, string] {
  const site = line.costCentre?.name ?? '';
  return dimension === 'class' ? [accountingCsvText(site), ''] : ['', accountingCsvText(site)];
}

/** QuickBooks Online journal entries: one row per line, grouped by `Journal No`. */
export function qboJournalsCsv(
  vouchers: readonly AccountingVoucher[],
  options: AccountingFormatOptions & { siteDimension: QuickBooksSiteDimension },
): string {
  const rows: string[][] = [
    ['Journal No', 'Journal Date', 'Currency', 'Memo', 'Account', 'Debits', 'Credits', 'Description', 'Name', 'Class', 'Location'],
  ];
  for (const voucher of vouchers) {
    for (const line of voucher.lines) {
      const [cls, location] = siteColumns(line, options.siteDimension);
      rows.push([
        accountingCsvText(voucher.externalId),
        accountingDmy(voucher.date),
        options.currency,
        accountingCsvText(voucher.narration),
        accountingCsvText(line.account.name),
        line.amount > 0n ? money(line.amount, options.digits) : '',
        line.amount < 0n ? money(-line.amount, options.digits) : '',
        accountingCsvText(line.description),
        // QuickBooks will not post to receivables or payables without the customer or supplier.
        accountingCsvText(line.party?.name ?? ''),
        cls,
        location,
      ]);
    }
  }
  return accountingCsv(rows);
}

/** QuickBooks Online bills: supplier invoices, hire invoices and subcontractors' running bills. */
export function qboBillsCsv(
  vouchers: readonly AccountingVoucher[],
  options: AccountingFormatOptions & { siteDimension: QuickBooksSiteDimension },
): string {
  const rows: string[][] = [
    ['Bill No', 'Supplier', 'Bill Date', 'Due Date', 'Memo', 'Account', 'Line Description', 'Line Amount', 'Line Tax Code', 'Line Tax Amount', 'Class', 'Location', 'Currency'],
  ];
  for (const voucher of vouchers) {
    for (const line of accountingDocumentLines(voucher)) {
      const [cls, location] = siteColumns(line, options.siteDimension);
      rows.push([
        accountingCsvText(voucher.reference),
        accountingCsvText(voucher.party?.name ?? ''),
        accountingDmy(voucher.date),
        accountingDmy(voucher.dueDate ?? voucher.date),
        accountingCsvText(voucher.narration),
        accountingCsvText(line.account.name),
        accountingCsvText(line.description),
        money(line.amount, options.digits),
        accountingCsvText((line.taxCode ?? voucher.noTaxCode)?.code ?? ''),
        money(line.taxAmount, options.digits),
        cls,
        location,
        options.currency,
      ]);
    }
  }
  return accountingCsv(rows);
}

/** QuickBooks Online invoices: instalments and BOQ running bills raised to clients. */
export function qboInvoicesCsv(
  vouchers: readonly AccountingVoucher[],
  options: AccountingFormatOptions & { siteDimension: QuickBooksSiteDimension },
): string {
  const rows: string[][] = [
    ['Invoice No', 'Customer', 'Invoice Date', 'Due Date', 'Memo', 'Item(Product/Service)', 'Item Description', 'Item Quantity', 'Item Rate', 'Item Amount', 'Item Tax Code', 'Item Tax Amount', 'Class', 'Location', 'Currency'],
  ];
  for (const voucher of vouchers) {
    for (const line of accountingDocumentLines(voucher)) {
      const [cls, location] = siteColumns(line, options.siteDimension);
      const amount = money(line.amount, options.digits);
      rows.push([
        accountingCsvText(voucher.reference),
        accountingCsvText(voucher.party?.name ?? ''),
        accountingDmy(voucher.date),
        accountingDmy(voucher.dueDate ?? voucher.date),
        accountingCsvText(voucher.narration),
        accountingCsvText(line.account.name),
        accountingCsvText(line.description),
        '1',
        amount,
        amount,
        accountingCsvText((line.taxCode ?? voucher.noTaxCode)?.code ?? ''),
        money(line.taxAmount, options.digits),
        cls,
        location,
        options.currency,
      ]);
    }
  }
  return accountingCsv(rows);
}

/** Suppliers or customers for QuickBooks Online's contact import. */
export function qboContactsCsv(parties: readonly AccountingParty[]): string {
  const rows: string[][] = [['Name', 'Company', 'Email', 'Phone', 'Street', 'Tax Registration No', 'Account No']];
  for (const party of parties) {
    rows.push([
      accountingCsvText(party.name),
      accountingCsvText(party.name),
      accountingCsvText(party.email ?? ''),
      accountingCsvText(party.phone ?? ''),
      accountingCsvText(party.address ?? ''),
      accountingCsvText(party.taxId ?? ''),
      accountingCsvText(party.code),
    ]);
  }
  return accountingCsv(rows);
}

// --- QuickBooks Desktop IIF -----------------------------------------------------------------------

const IIF_TYPES: Readonly<Record<AccountingVoucher['document'], string>> = {
  bill: 'BILL',
  invoice: 'INVOICE',
  journal: 'GENERAL JOURNAL',
};

/** QuickBooks Desktop account types, from what kind of account a key is. */
function iifAccountType(nature: AccountingNature, key: string): string | null {
  switch (nature) {
    case 'expense':
      return 'EXP';
    case 'income':
      return 'INC';
    case 'asset':
      return 'OCASSET';
    case 'liability':
      return 'OCLIAB';
    case 'bank':
    case 'cash':
      return 'BANK';
    case 'payable':
      return 'AP';
    case 'receivable':
      return 'AR';
    case 'tax':
      // Input tax is reclaimable (an asset); output tax is owed.
      return key.startsWith('input_') ? 'OCASSET' : 'OCLIAB';
    default:
      return null;
  }
}

function iifRow(cells: readonly string[]): string {
  return cells.map(accountingTabText).join('\t');
}

/**
 * One IIF file: the lists first when masters are included (accounts, suppliers, customers, classes),
 * then every transaction. QuickBooks Desktop matches lists by name and adds what is missing.
 */
export function qbdIif(
  vouchers: readonly AccountingVoucher[],
  masters: AccountingMasters | null,
  options: AccountingFormatOptions,
): string {
  const lines: string[] = [];
  if (masters) {
    lines.push(iifRow(['!ACCNT', 'NAME', 'ACCNTTYPE', 'ACCNUM', 'DESC']));
    for (const account of masters.accounts) {
      const type = iifAccountType(account.nature, account.key);
      if (!type) continue;
      lines.push(iifRow(['ACCNT', account.account.name, type, account.account.code, account.label]));
    }
    const vendors = masters.parties.filter((party) => party.kind === 'vendor');
    const customers = masters.parties.filter((party) => party.kind === 'customer');
    if (vendors.length > 0) {
      lines.push(iifRow(['!VEND', 'NAME', 'ADDR1', 'PHONE1', 'EMAIL', 'TAXID']));
      for (const vendor of vendors) {
        lines.push(iifRow(['VEND', vendor.name, vendor.address ?? '', vendor.phone ?? '', vendor.email ?? '', vendor.taxId ?? '']));
      }
    }
    if (customers.length > 0) {
      lines.push(iifRow(['!CUST', 'NAME', 'BADDR1', 'PHONE1', 'EMAIL']));
      for (const customer of customers) {
        lines.push(iifRow(['CUST', customer.name, customer.address ?? '', customer.phone ?? '', customer.email ?? '']));
      }
    }
    if (masters.costCentres.length > 0) {
      lines.push(iifRow(['!CLASS', 'NAME']));
      for (const centre of masters.costCentres) lines.push(iifRow(['CLASS', centre.name]));
    }
  }

  if (vouchers.length > 0) {
    lines.push(
      iifRow(['!TRNS', 'TRNSID', 'TRNSTYPE', 'DATE', 'ACCNT', 'NAME', 'CLASS', 'AMOUNT', 'DOCNUM', 'MEMO', 'DUEDATE']),
      iifRow(['!SPL', 'SPLID', 'TRNSTYPE', 'DATE', 'ACCNT', 'NAME', 'CLASS', 'AMOUNT', 'DOCNUM', 'MEMO']),
      iifRow(['!ENDTRNS']),
    );
  }
  for (const voucher of vouchers) {
    const type = IIF_TYPES[voucher.document];
    // A bill's or invoice's first row is the supplier's or client's line; a journal's is its first.
    const ordered = [...voucher.lines].sort((a, b) => Number(b.role === 'control') - Number(a.role === 'control'));
    const date = accountingDmy(voucher.date);
    const docNumber = voucher.document === 'journal' ? voucher.externalId : voucher.reference;
    ordered.forEach((line, index) => {
      const cells = [
        index === 0 ? 'TRNS' : 'SPL',
        '',
        type,
        date,
        line.account.name,
        line.party?.name ?? (index === 0 ? voucher.party?.name ?? '' : ''),
        line.costCentre?.name ?? '',
        money(line.amount, options.digits),
        docNumber,
        index === 0 ? `${voucher.narration}` : line.description,
      ];
      if (index === 0) cells.push(voucher.dueDate ? accountingDmy(voucher.dueDate) : '');
      lines.push(iifRow(cells));
    });
    lines.push(iifRow(['ENDTRNS']));
  }
  return lines.join('\r\n') + '\r\n';
}
