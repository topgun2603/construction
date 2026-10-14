import {
  accountingCsv,
  accountingCsvText,
  ACCOUNTING_SYSTEM_LABELS,
  type AccountingAccount,
  type AccountingFile,
  type AccountingMasters,
  type AccountingSystem,
  type AccountingVoucher,
} from './accounting';
import { netsuiteEntitiesCsv, netsuiteInvoicesCsv, netsuiteJournalsCsv, netsuiteVendorBillsCsv } from './accounting-netsuite';
import { qbdIif, qboBillsCsv, qboContactsCsv, qboInvoicesCsv, qboJournalsCsv } from './accounting-quickbooks';
import { sapb1DocumentFiles, sapb1JournalFiles, sapb1PartnersFile } from './accounting-sapb1';
import { tallyMastersXml, tallyVouchersXml } from './accounting-tally';
import { xeroBillsCsv, xeroContactsCsv, xeroInvoicesCsv, xeroJournalsCsv } from './accounting-xero';

/**
 * One export, laid out for one system: which files, and which vouchers go in which.
 *
 * Every voucher lands in exactly one file. Tally takes everything as vouchers in one XML; QuickBooks
 * Desktop takes everything in one IIF; the others split by document — bills, invoices, and journals
 * for the rest — because that is how their import screens are organised, and a bill imported as a
 * bill is one the supplier's statement can be matched against.
 */

export interface AccountingExportSettings {
  /** Tally: the company to import into, when the file should name it. */
  tallyCompany?: string | null;
  /** QuickBooks Online: whether the site goes in as a class or a location. */
  qboSiteDimension?: 'class' | 'location';
  /** Xero: the tracking category sites are options of. */
  xeroTrackingName?: string | null;
  /** NetSuite: the subsidiary, and which segment the site goes in. */
  netsuiteSubsidiary?: string | null;
  netsuiteSiteDimension?: 'department' | 'class' | 'location';
}

export interface AccountingExportFilesInput {
  system: AccountingSystem;
  regime: string;
  currency: string;
  digits: number;
  vouchers: readonly AccountingVoucher[];
  /** Null when masters were not asked for. */
  masters: AccountingMasters | null;
  /** The saved map, for Tally's party groups. */
  map: Readonly<Record<string, AccountingAccount>>;
  settings: AccountingExportSettings;
}

const CSV = 'text/csv';

/** The account mapping as a list for the accountant: what each SiteBook key posts to. */
export function accountingMappingCsv(system: AccountingSystem, masters: AccountingMasters): string {
  const rows: string[][] = [['System', 'Used for', 'Key', 'Kind', 'Account code', 'Account name']];
  for (const account of masters.accounts) {
    rows.push([
      accountingCsvText(ACCOUNTING_SYSTEM_LABELS[system]),
      accountingCsvText(account.label),
      accountingCsvText(account.key),
      account.nature,
      accountingCsvText(account.account.code),
      accountingCsvText(account.account.name),
    ]);
  }
  return accountingCsv(rows);
}

export function accountingExportFiles(input: AccountingExportFilesInput): AccountingFile[] {
  const { system, vouchers, masters } = input;
  const format = { digits: input.digits, currency: input.currency };
  const bills = vouchers.filter((voucher) => voucher.document === 'bill');
  const invoices = vouchers.filter((voucher) => voucher.document === 'invoice');
  const journals = vouchers.filter((voucher) => voucher.document === 'journal');
  const vendors = masters?.parties.filter((party) => party.kind === 'vendor') ?? [];
  const customers = masters?.parties.filter((party) => party.kind === 'customer') ?? [];
  const files: AccountingFile[] = [];
  const add = (name: string, content: string, contentType = CSV, when = true) => {
    if (when) files.push({ name, contentType, content });
  };

  switch (system) {
    case 'tally': {
      if (masters) {
        add(
          'tally-masters.xml',
          tallyMastersXml(masters, {
            company: input.settings.tallyCompany,
            payablesGroup: input.map['accounts_payable']?.name || 'Sundry Creditors',
            receivablesGroup: input.map['accounts_receivable']?.name || 'Sundry Debtors',
            regime: input.regime,
          }),
          'application/xml',
        );
      }
      add('tally-vouchers.xml', tallyVouchersXml(vouchers, { ...format, company: input.settings.tallyCompany }), 'application/xml', vouchers.length > 0);
      break;
    }
    case 'quickbooks_online': {
      const options = { ...format, siteDimension: input.settings.qboSiteDimension ?? 'class' };
      add('quickbooks-online-suppliers.csv', qboContactsCsv(vendors), CSV, vendors.length > 0);
      add('quickbooks-online-customers.csv', qboContactsCsv(customers), CSV, customers.length > 0);
      add('quickbooks-online-bills.csv', qboBillsCsv(bills, options), CSV, bills.length > 0);
      add('quickbooks-online-invoices.csv', qboInvoicesCsv(invoices, options), CSV, invoices.length > 0);
      add('quickbooks-online-journal-entries.csv', qboJournalsCsv(journals, options), CSV, journals.length > 0);
      break;
    }
    case 'quickbooks_desktop':
      add('quickbooks-desktop.iif', qbdIif(vouchers, masters, format), 'text/plain', vouchers.length > 0 || masters !== null);
      break;
    case 'xero': {
      const options = { ...format, trackingName: input.settings.xeroTrackingName?.trim() || 'Site' };
      add('xero-contacts.csv', xeroContactsCsv([...vendors, ...customers]), CSV, vendors.length + customers.length > 0);
      add('xero-bills.csv', xeroBillsCsv(bills, options), CSV, bills.length > 0);
      add('xero-sales-invoices.csv', xeroInvoicesCsv(invoices, options), CSV, invoices.length > 0);
      add('xero-manual-journals.csv', xeroJournalsCsv(journals, options), CSV, journals.length > 0);
      break;
    }
    case 'sap_b1': {
      const options = { ...format, regime: input.regime };
      if (masters && masters.parties.length > 0) files.push(sapb1PartnersFile(masters.parties));
      if (bills.length > 0) files.push(...sapb1DocumentFiles(bills, 'purchase', options));
      if (invoices.length > 0) files.push(...sapb1DocumentFiles(invoices, 'sales', options));
      if (journals.length > 0) files.push(...sapb1JournalFiles(journals, options));
      break;
    }
    case 'netsuite': {
      const options = {
        ...format,
        subsidiary: input.settings.netsuiteSubsidiary?.trim() ?? '',
        siteDimension: input.settings.netsuiteSiteDimension ?? 'department',
      };
      add('netsuite-vendors.csv', netsuiteEntitiesCsv(vendors, options), CSV, vendors.length > 0);
      add('netsuite-customers.csv', netsuiteEntitiesCsv(customers, options), CSV, customers.length > 0);
      add('netsuite-vendor-bills.csv', netsuiteVendorBillsCsv(bills, options), CSV, bills.length > 0);
      add('netsuite-invoices.csv', netsuiteInvoicesCsv(invoices, options), CSV, invoices.length > 0);
      add('netsuite-journal-entries.csv', netsuiteJournalsCsv(journals, options), CSV, journals.length > 0);
      break;
    }
  }
  if (masters) add('chart-of-accounts-mapping.csv', accountingMappingCsv(system, masters));
  return files;
}
