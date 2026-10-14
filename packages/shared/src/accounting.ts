import { EXPENSE_CATEGORIES, expenseCategoryLabel } from './schemas/expenses';
import { taxOnTop, taxRule } from './tax';

/**
 * Accounting exports (roadmap Phase 3: "Accounting: Tally (India), QuickBooks and Xero (smaller Gulf
 * firms), SAP Business One and Oracle NetSuite (large firms). Start with export files, then live APIs").
 *
 * This file is the system-neutral half: what a company's transactions look like as double-entry
 * vouchers. Everything SiteBook knows about money — an approved expense, a supplier invoice, a
 * finalised wage period, a certified RA bill, a client instalment, a payment — is turned here into an
 * `AccountingVoucher`: dated, referenced, with every line on a named account and debits equal to
 * credits. The formatters beside it (`accounting-tally.ts`, `accounting-quickbooks.ts`, …) only lay
 * those vouchers out in each product's import format; none of them decides an account or an amount.
 *
 * Accounts come from the company's own mapping (Settings → Accounting), never from a guess at export
 * time: a key with no account is reported as missing and the export refused, because a file that
 * imports into the wrong ledger is worse than one that does not import at all. The defaults below are
 * offered on the settings screen for the accountant to accept or change — they are not used silently.
 *
 * All amounts are integer minor units (bigint), signed: positive is a debit, negative a credit.
 */

// --- systems and categories -----------------------------------------------------------------------

export const ACCOUNTING_SYSTEMS = [
  'tally',
  'quickbooks_online',
  'quickbooks_desktop',
  'xero',
  'sap_b1',
  'netsuite',
] as const;
export type AccountingSystem = (typeof ACCOUNTING_SYSTEMS)[number];

export const ACCOUNTING_SYSTEM_LABELS: Readonly<Record<AccountingSystem, string>> = {
  tally: 'Tally Prime / ERP 9',
  quickbooks_online: 'QuickBooks Online',
  quickbooks_desktop: 'QuickBooks Desktop',
  xero: 'Xero',
  sap_b1: 'SAP Business One',
  netsuite: 'Oracle NetSuite',
};

/** What an export can include. `masters` is the supplier, customer and account lists. */
export const ACCOUNTING_CATEGORIES = [
  'purchases',
  'payroll',
  'subcontract_bills',
  'sales',
  'payments',
  'masters',
] as const;
export type AccountingCategory = (typeof ACCOUNTING_CATEGORIES)[number];

export const ACCOUNTING_CATEGORY_LABELS: Readonly<Record<AccountingCategory, string>> = {
  purchases: 'Purchases and expenses',
  payroll: 'Payroll and wages',
  subcontract_bills: 'Subcontractor bills',
  sales: 'Client billing',
  payments: 'Payments and receipts',
  masters: 'Suppliers, customers and accounts',
};

/**
 * Which SiteBook rows an export reads. Stored in `accounting_export_items.source_type`, so a
 * transaction exported once is recognised the next time whatever system it went to.
 */
export const ACCOUNTING_SOURCE_TYPES = [
  'expense',
  'purchase_invoice',
  'wage_period',
  'labour_payment',
  'subcontract_bill',
  'subcontract_payment',
  'payment_stage',
  'client_payment',
] as const;
export type AccountingSourceType = (typeof ACCOUNTING_SOURCE_TYPES)[number];

/** Short prefix of each source's external id: `PI-3F2A…` is a supplier invoice. */
const SOURCE_PREFIX: Readonly<Record<AccountingSourceType, string>> = {
  expense: 'EX',
  purchase_invoice: 'PI',
  wage_period: 'WP',
  labour_payment: 'LP',
  subcontract_bill: 'RA',
  subcontract_payment: 'SP',
  payment_stage: 'SI',
  client_payment: 'CR',
};

/**
 * The id a voucher carries into the accounting system: `PI-3F2A9C01B7D4`. Derived from the row's
 * own id, so exporting the same row again — by mistake, or on purpose with "include previously
 * exported" — produces the same reference, which is what lets each product spot the duplicate
 * (Tally alters the voucher with that REMOTEID; Xero and NetSuite refuse or match the number).
 * Twelve hex digits keep it inside QuickBooks' 21-character document number.
 */
export function accountingExternalId(type: AccountingSourceType, id: string): string {
  return `${SOURCE_PREFIX[type]}-${id.replace(/-/g, '').slice(0, 12).toUpperCase()}`;
}

/** Systems that put tax on a bill or invoice line as a tax code, and work the tax out themselves. */
export function accountingUsesTaxCodes(system: AccountingSystem): boolean {
  return system === 'quickbooks_online' || system === 'xero' || system === 'sap_b1' || system === 'netsuite';
}

/** Systems that identify an account by its code (number) rather than its name. */
export function accountingNeedsAccountCode(system: AccountingSystem): boolean {
  return system === 'xero' || system === 'sap_b1';
}

/**
 * Tally posts a supplier's bill to the supplier's own ledger (under Sundry Creditors); every other
 * product posts it to one payables control account with the supplier named beside it.
 */
export function accountingPostsToPartyLedger(system: AccountingSystem): boolean {
  return system === 'tally';
}

// --- the account map ------------------------------------------------------------------------------

/** One account (or, for a `tax_code:` key, one tax code) in the company's accounting system. */
export interface AccountingAccount {
  /** Account number, or the tax code. Empty where the system goes by name (Tally, QuickBooks). */
  code: string;
  name: string;
}

export type AccountingKeyGroup =
  | 'expenses'
  | 'labour'
  | 'subcontracts'
  | 'sales'
  | 'control'
  | 'cash'
  | 'tax'
  | 'tax_codes';

export const ACCOUNTING_KEY_GROUP_LABELS: Readonly<Record<AccountingKeyGroup, string>> = {
  expenses: 'Expenses and purchases',
  labour: 'Labour',
  subcontracts: 'Subcontractors',
  sales: 'Client billing',
  control: 'Payables and receivables',
  cash: 'Cash and bank',
  tax: 'Tax ledgers',
  tax_codes: 'Tax codes on bills and invoices',
};

/** What kind of account a key is: decides the parent group in a Tally master, the type in QuickBooks. */
export type AccountingNature = 'expense' | 'income' | 'asset' | 'liability' | 'bank' | 'cash' | 'payable' | 'receivable' | 'tax' | 'tax_code';

export interface AccountingKeyInfo {
  key: string;
  label: string;
  group: AccountingKeyGroup;
  nature: AccountingNature;
}

const FIXED_KEYS: ReadonlyArray<Omit<AccountingKeyInfo, 'group'> & { group: AccountingKeyGroup }> = [
  { key: 'wages_expense', label: 'Wages (labour cost)', group: 'labour', nature: 'expense' },
  { key: 'wages_payable', label: 'Wages payable', group: 'labour', nature: 'liability' },
  { key: 'labour_advances', label: 'Advances to workers', group: 'labour', nature: 'asset' },
  { key: 'labour_deductions', label: 'Deductions recovered from wages', group: 'labour', nature: 'income' },
  { key: 'subcontract_cost', label: 'Subcontract work (cost)', group: 'subcontracts', nature: 'expense' },
  { key: 'retention_payable', label: 'Retention held from subcontractors', group: 'subcontracts', nature: 'liability' },
  { key: 'subcontract_advances', label: 'Mobilisation advances to subcontractors', group: 'subcontracts', nature: 'asset' },
  { key: 'subcontract_recoveries', label: 'Back-charges recovered from subcontractors', group: 'subcontracts', nature: 'expense' },
  { key: 'sales_revenue', label: 'Contract revenue', group: 'sales', nature: 'income' },
  { key: 'retention_receivable', label: 'Retention held by clients', group: 'sales', nature: 'asset' },
  { key: 'client_advances', label: 'Mobilisation advances from clients', group: 'sales', nature: 'liability' },
  { key: 'accounts_payable', label: 'Accounts payable (suppliers)', group: 'control', nature: 'payable' },
  { key: 'accounts_receivable', label: 'Accounts receivable (clients)', group: 'control', nature: 'receivable' },
  { key: 'petty_cash', label: 'Site petty cash (expenses paid on site)', group: 'cash', nature: 'cash' },
  { key: 'cash', label: 'Cash', group: 'cash', nature: 'cash' },
  { key: 'bank', label: 'Bank (UPI, transfers, wallets)', group: 'cash', nature: 'bank' },
];

/** The tax heads a regime posts to: CGST and SGST (or IGST) under GST, one VAT ledger otherwise. */
export type AccountingTaxHead = 'cgst' | 'sgst' | 'igst' | 'tax';

function taxHeads(regime: string): AccountingTaxHead[] {
  if (regime === 'gst_in') return ['cgst', 'sgst', 'igst'];
  if (regime === 'none') return [];
  return ['tax'];
}

function taxHeadLabel(head: AccountingTaxHead, regime: string): string {
  if (head === 'tax') return taxRule(regime).taxName ?? 'tax';
  return head.toUpperCase();
}

/** The rates a regime's tax codes are offered for up front. Others appear as missing when used. */
export function accountingStandardRates(regime: string): number[] {
  if (regime === 'gst_in') return [500, 1200, 1800, 2800];
  const standard = taxRule(regime).standardRateBp;
  return standard ? [standard] : [];
}

/**
 * Every key the settings screen offers for a system: the fixed list, the tax ledgers of the
 * company's regime, the expense categories, and — for systems that use them — the tax codes.
 * Cost codes, sites and per-rate accounts are optional extras (`accountingKeyLabel` names them).
 */
export function accountingKeyCatalogue(system: AccountingSystem, regime: string): AccountingKeyInfo[] {
  const keys: AccountingKeyInfo[] = EXPENSE_CATEGORIES.map((category) => ({
    key: `expense:${category}`,
    label: expenseCategoryLabel(category),
    group: 'expenses' as const,
    nature: 'expense' as const,
  }));
  keys.push(...FIXED_KEYS);
  for (const head of taxHeads(regime)) {
    const name = taxHeadLabel(head, regime);
    keys.push({ key: `input_${head}`, label: `Input ${name} (paid on purchases)`, group: 'tax', nature: 'tax' });
    keys.push({ key: `output_${head}`, label: `Output ${name} (charged to clients)`, group: 'tax', nature: 'tax' });
  }
  if (accountingUsesTaxCodes(system)) {
    keys.push({ key: 'tax_code:none', label: 'No tax', group: 'tax_codes', nature: 'tax_code' });
    for (const rate of accountingStandardRates(regime)) {
      keys.push({ key: `tax_code:input@${rate}`, label: `Purchases at ${percent(rate)}`, group: 'tax_codes', nature: 'tax_code' });
      keys.push({ key: `tax_code:output@${rate}`, label: `Sales at ${percent(rate)}`, group: 'tax_codes', nature: 'tax_code' });
    }
  }
  return keys;
}

/** `1800` → `18%`, `25` → `0.25%`. */
function percent(bp: number): string {
  const whole = Math.trunc(bp / 100);
  const fraction = (bp % 100).toString().padStart(2, '0').replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}%` : `${whole}%`;
}

/** A readable name for any key, including the optional ones the catalogue does not list. */
export function accountingKeyLabel(key: string, regime = 'gst_in'): string {
  const at = key.lastIndexOf('@');
  if (at > 0 && !key.startsWith('tax_code:')) {
    return `${accountingKeyLabel(key.slice(0, at), regime)} at ${percent(Number(key.slice(at + 1)))}`;
  }
  if (key.startsWith('cost_code:')) return `Cost code ${key.slice('cost_code:'.length)}`;
  if (key.startsWith('site:')) return 'Site (cost centre)';
  if (key.startsWith('expense:')) return expenseCategoryLabel(key.slice('expense:'.length));
  if (key === 'tax_code:none') return 'No tax';
  const taxCode = /^tax_code:(input|output)@(\d+)$/.exec(key);
  if (taxCode) return `${taxCode[1] === 'input' ? 'Purchases' : 'Sales'} at ${percent(Number(taxCode[2]))}`;
  const fixed = FIXED_KEYS.find((item) => item.key === key);
  if (fixed) return fixed.label;
  const tax = /^(input|output)_(cgst|sgst|igst|tax)$/.exec(key);
  if (tax) return `${tax[1] === 'input' ? 'Input' : 'Output'} ${taxHeadLabel(tax[2] as AccountingTaxHead, regime)}`;
  return key;
}

/** Whether a key is one the mapping can hold: a catalogue key, or one of the optional patterns. */
export function isAccountingKey(key: string): boolean {
  if (key.length > 200) return false;
  const base = key.replace(/@\d{1,5}$/, '');
  if (/^tax_code:(none|(input|output)@\d{1,5})$/.test(key)) return true;
  if (/^expense:[a-z_]+$/.test(base)) return (EXPENSE_CATEGORIES as readonly string[]).includes(base.slice(8));
  if (/^cost_code:.{1,40}$/.test(base)) return true;
  if (/^site:[0-9a-f-]{36}$/.test(key)) return true;
  if (/^(input|output)_(cgst|sgst|igst|tax)$/.test(base)) return true;
  return FIXED_KEYS.some((item) => item.key === base);
}

/** Nature of any key, for masters: an `@rate` or cost-code variant is the same kind as its base. */
export function accountingKeyNature(key: string): AccountingNature {
  const base = key.replace(/@\d+$/, '');
  if (base.startsWith('tax_code:')) return 'tax_code';
  if (base.startsWith('expense:') || base.startsWith('cost_code:')) return 'expense';
  if (/^(input|output)_/.test(base)) return 'tax';
  return FIXED_KEYS.find((item) => item.key === base)?.nature ?? 'expense';
}

// --- defaults -------------------------------------------------------------------------------------

const TALLY_EXPENSE_LEDGERS: Readonly<Record<string, string>> = {
  materials: 'Purchase - Materials',
  transport: 'Transport Charges',
  fuel: 'Fuel Expenses',
  equipment_hire: 'Equipment Hire Charges',
  tools: 'Tools and Consumables',
  site_office: 'Site Office Expenses',
  utilities: 'Electricity and Water',
  food: 'Staff Welfare',
  permits: 'Permits and Fees',
  repairs: 'Repairs and Maintenance',
  safety: 'Safety Expenses',
  other: 'Miscellaneous Expenses',
};

const TALLY_FIXED: Readonly<Record<string, string>> = {
  wages_expense: 'Labour Wages',
  wages_payable: 'Wages Payable',
  labour_advances: 'Labour Advances',
  labour_deductions: 'Labour Deductions Recovered',
  subcontract_cost: 'Sub-contract Charges',
  retention_payable: 'Retention Money Payable',
  subcontract_advances: 'Mobilisation Advance to Sub-contractors',
  subcontract_recoveries: 'Recoveries from Sub-contractors',
  sales_revenue: 'Contract Revenue',
  retention_receivable: 'Retention Money Receivable',
  client_advances: 'Mobilisation Advance from Clients',
  // In Tally these are the groups party ledgers sit under, not ledgers posted to: a bill goes to the
  // supplier's own ledger. The masters file creates each party under the group named here.
  accounts_payable: 'Sundry Creditors',
  accounts_receivable: 'Sundry Debtors',
  petty_cash: 'Petty Cash',
  cash: 'Cash',
  bank: 'Bank Account',
};

/** A plain numbered chart for systems that go by account code. Xero's own system accounts where it has them. */
const CODED_EXPENSES: Readonly<Record<string, AccountingAccount>> = {
  materials: { code: '5000', name: 'Materials' },
  transport: { code: '5010', name: 'Transport' },
  fuel: { code: '5020', name: 'Fuel' },
  equipment_hire: { code: '5030', name: 'Equipment Hire' },
  tools: { code: '5040', name: 'Tools and Consumables' },
  site_office: { code: '5050', name: 'Site Office' },
  utilities: { code: '5060', name: 'Utilities' },
  food: { code: '5070', name: 'Staff Welfare' },
  permits: { code: '5080', name: 'Permits and Fees' },
  repairs: { code: '5090', name: 'Repairs and Maintenance' },
  safety: { code: '5095', name: 'Safety' },
  other: { code: '5099', name: 'Other Site Expenses' },
};

const CODED_FIXED: Readonly<Record<string, AccountingAccount>> = {
  wages_expense: { code: '5100', name: 'Labour Wages' },
  wages_payable: { code: '2100', name: 'Wages Payable' },
  labour_advances: { code: '1200', name: 'Labour Advances' },
  labour_deductions: { code: '5105', name: 'Labour Deductions Recovered' },
  subcontract_cost: { code: '5200', name: 'Subcontract Costs' },
  retention_payable: { code: '2150', name: 'Retention Payable' },
  subcontract_advances: { code: '1210', name: 'Subcontractor Advances' },
  subcontract_recoveries: { code: '5210', name: 'Subcontractor Recoveries' },
  sales_revenue: { code: '4000', name: 'Contract Revenue' },
  retention_receivable: { code: '1150', name: 'Retention Receivable' },
  client_advances: { code: '2300', name: 'Client Advances' },
  accounts_payable: { code: '2000', name: 'Accounts Payable' },
  accounts_receivable: { code: '1100', name: 'Accounts Receivable' },
  petty_cash: { code: '1010', name: 'Petty Cash' },
  cash: { code: '1000', name: 'Cash' },
  bank: { code: '1020', name: 'Bank' },
};

/** Xero's demo chart: its own receivables, payables, sales, wages and tax accounts keep their codes. */
const XERO_OVERRIDES: Readonly<Record<string, AccountingAccount>> = {
  accounts_receivable: { code: '610', name: 'Accounts Receivable' },
  accounts_payable: { code: '800', name: 'Accounts Payable' },
  sales_revenue: { code: '200', name: 'Sales' },
  wages_expense: { code: '477', name: 'Wages and Salaries' },
  wages_payable: { code: '814', name: 'Wages Payable - Payroll' },
  'expense:materials': { code: '310', name: 'Cost of Goods Sold' },
};

function taxCodeDefault(system: AccountingSystem, regime: string, side: 'input' | 'output' | 'none', rate = 0): string {
  const name = taxRule(regime).taxName ?? 'Tax';
  const pct = percent(rate);
  switch (system) {
    case 'xero':
      if (side === 'none') return `No ${name}`;
      return side === 'input' ? `${name} on Expenses ${pct}` : `${name} on Income ${pct}`;
    case 'sap_b1':
      if (side === 'none') return 'X0';
      return `${side === 'input' ? 'I' : 'O'}${Math.round(rate / 100)}`;
    case 'netsuite':
      if (side === 'none') return 'Exempt';
      return `${name} ${pct}`;
    default:
      if (side === 'none') return 'Out of Scope';
      return `${name} ${pct}`;
  }
}

/**
 * Suggested accounts for a system and a tax regime — Tally ledger names an Indian accountant will
 * recognise ("Purchase @18%", "Input CGST", "Sundry Creditors"), a numbered chart elsewhere, Gulf VAT
 * ledgers named with their rate ("Input VAT 5%"). Offered on the settings screen; nothing is posted
 * to them until the company saves them.
 */
export function accountingDefaultMap(system: AccountingSystem, regime: string): Record<string, AccountingAccount> {
  const map: Record<string, AccountingAccount> = {};
  const taxName = taxRule(regime).taxName ?? 'Tax';
  const standard = taxRule(regime).standardRateBp;
  if (system === 'tally') {
    for (const category of EXPENSE_CATEGORIES) {
      map[`expense:${category}`] = { code: '', name: TALLY_EXPENSE_LEDGERS[category] ?? expenseCategoryLabel(category) };
    }
    for (const [key, name] of Object.entries(TALLY_FIXED)) map[key] = { code: '', name };
    if (regime === 'gst_in') {
      // Indian practice: a purchase ledger per GST rate, so the GSTR-2 rate-wise summary falls out.
      for (const rate of accountingStandardRates(regime)) {
        map[`expense:materials@${rate}`] = { code: '', name: `Purchase @${percent(rate)}` };
      }
    }
    for (const head of taxHeads(regime)) {
      const label = head === 'tax' ? `${taxName}${standard ? ` ${percent(standard)}` : ''}` : head.toUpperCase();
      map[`input_${head}`] = { code: '', name: `Input ${label}` };
      map[`output_${head}`] = { code: '', name: `Output ${label}` };
    }
    return map;
  }

  for (const category of EXPENSE_CATEGORIES) map[`expense:${category}`] = { ...CODED_EXPENSES[category]! };
  for (const [key, account] of Object.entries(CODED_FIXED)) map[key] = { ...account };
  const heads = taxHeads(regime);
  heads.forEach((head, index) => {
    const label = head === 'tax' ? `${taxName}${standard ? ` ${percent(standard)}` : ''}` : head.toUpperCase();
    map[`input_${head}`] = { code: String(1300 + index * 10), name: `Input ${label}` };
    map[`output_${head}`] = { code: String(2200 + index * 10), name: `Output ${label}` };
  });
  if (system === 'xero') {
    Object.assign(map, structuredCloneMap(XERO_OVERRIDES));
    // Xero keeps all GST/VAT in one system account (820) and splits it by tax rate, not by ledger.
    for (const head of heads) {
      map[`input_${head}`] = { code: '820', name: `${taxName}` };
      map[`output_${head}`] = { code: '820', name: `${taxName}` };
    }
  }
  if (accountingUsesTaxCodes(system)) {
    map['tax_code:none'] = { code: taxCodeDefault(system, regime, 'none'), name: `No ${taxName}` };
    for (const rate of accountingStandardRates(regime)) {
      map[`tax_code:input@${rate}`] = { code: taxCodeDefault(system, regime, 'input', rate), name: `${taxName} ${percent(rate)} on purchases` };
      map[`tax_code:output@${rate}`] = { code: taxCodeDefault(system, regime, 'output', rate), name: `${taxName} ${percent(rate)} on sales` };
    }
  }
  return map;
}

function structuredCloneMap(map: Readonly<Record<string, AccountingAccount>>): Record<string, AccountingAccount> {
  return Object.fromEntries(Object.entries(map).map(([key, value]) => [key, { ...value }]));
}

// --- rates and tax splits -------------------------------------------------------------------------

/** Rates a bill is likely to have been charged at, to recognise one from its amounts. */
function knownRates(regime: string): number[] {
  if (regime === 'gst_in') return [25, 300, 500, 1200, 1800, 2800, 4000];
  if (regime === 'vat_ae') return [500];
  if (regime === 'vat_sa') return [1500];
  return [];
}

/**
 * The rate a bill was charged at, from its net amount and its tax — SiteBook stores the tax a bill
 * showed, not the rate. Snaps to a known slab when the amounts round to it (₹1,000 with ₹180 is 18%,
 * and so is ₹999.99 with ₹180.00), otherwise the nearest basis point. Zero for a bill with no tax.
 */
export function accountingEffectiveRate(net: bigint, tax: bigint, regime: string): number {
  if (tax <= 0n || net <= 0n) return 0;
  for (const slab of knownRates(regime)) {
    const expected = taxOnTop(net, slab);
    const diff = expected > tax ? expected - tax : tax - expected;
    // A few minor units either way: line-by-line rounding on the supplier's invoice.
    if (diff <= 2n || diff * 1000n <= tax) return slab;
  }
  return Number((tax * 20_000n + net) / (net * 2n));
}

export interface AccountingTaxPart {
  head: AccountingTaxHead;
  /** The head's own rate: CGST at 9% for 18% GST. */
  rateBp: number;
  amount: bigint;
}

/**
 * GST's first two digits are the state code. An Indian supply between two states is IGST; within
 * one, half CGST and half SGST. Without the company's state or the other side's GSTIN the supply is
 * treated as within the state — most site purchases are local, and the accountant sees the split.
 */
export function accountingTaxSplit(
  regime: string,
  tax: bigint,
  rateBp: number,
  options: { homeStateCode?: string | null; counterpartyTaxId?: string | null } = {},
): AccountingTaxPart[] {
  if (tax === 0n) return [];
  if (regime !== 'gst_in') return [{ head: 'tax', rateBp, amount: tax }];
  const theirs = options.counterpartyTaxId?.slice(0, 2) ?? '';
  const home = options.homeStateCode ?? '';
  if (/^\d{2}$/.test(theirs) && /^\d{2}$/.test(home) && theirs !== home) {
    return [{ head: 'igst', rateBp, amount: tax }];
  }
  // An odd paisa goes to CGST, so the two halves always add back to the bill's tax.
  const sgst = tax / 2n;
  return [
    { head: 'cgst', rateBp: Math.round(rateBp / 2), amount: tax - sgst },
    { head: 'sgst', rateBp: Math.round(rateBp / 2), amount: sgst },
  ];
}

// --- sources: what the API reads ------------------------------------------------------------------

export interface AccountingSite {
  id: string;
  name: string;
}

/** A supplier, subcontractor or client, as it is created in the accounting system's masters. */
export interface AccountingParty {
  kind: 'vendor' | 'customer';
  /** Stable short code: SAP's CardCode, Xero's account number. */
  code: string;
  name: string;
  taxId?: string | null;
  email?: string | null;
  phone?: string | null;
  address?: string | null;
}

export type AccountingPaymentMode = string;

export type AccountingSource =
  | {
      type: 'purchase_invoice';
      id: string;
      date: string;
      dueDate: string | null;
      /** The supplier's own invoice number. */
      number: string;
      orderNumber: string | null;
      site: AccountingSite;
      vendor: AccountingParty;
      lines: { costCode: string | null; description: string; amount: bigint; tax: bigint }[];
    }
  | {
      type: 'expense';
      id: string;
      date: string;
      site: AccountingSite;
      category: string;
      costCode: string | null;
      /** What was paid, tax included. */
      amount: bigint;
      tax: bigint;
      supplierTaxId: string | null;
      note: string | null;
      /** A machine-hire invoice: owed to the hire vendor rather than paid out of site cash. */
      vendor: AccountingParty | null;
      reference: string | null;
    }
  | {
      type: 'wage_period';
      id: string;
      periodStart: string;
      periodEnd: string;
      /** The labour contractor's gang, or null for direct labour. */
      contractorName: string | null;
      gross: bigint;
      advances: bigint;
    }
  | {
      type: 'labour_payment';
      id: string;
      date: string;
      site: AccountingSite | null;
      kind: 'wage' | 'advance' | 'bonus' | 'deduction';
      amount: bigint;
      mode: AccountingPaymentMode;
      payee: string;
      reference: string | null;
    }
  | {
      type: 'subcontract_bill';
      id: string;
      date: string;
      site: AccountingSite;
      contractor: AccountingParty;
      subcontractNumber: string;
      billNumber: number;
      gross: bigint;
      taxRateBp: number;
      tax: bigint;
      retention: bigint;
      advanceRecovery: bigint;
      deductions: bigint;
    }
  | {
      type: 'subcontract_payment';
      id: string;
      date: string;
      site: AccountingSite;
      contractor: AccountingParty;
      kind: 'advance' | 'bill' | 'retention';
      amount: bigint;
      mode: AccountingPaymentMode;
      reference: string | null;
      /** `SC-007/RA-2` when the payment settles a bill. */
      billReference: string | null;
    }
  | {
      type: 'payment_stage';
      id: string;
      date: string;
      dueDate: string | null;
      site: AccountingSite;
      customer: AccountingParty;
      label: string;
      /** What the instalment asks for before tax: for a BOQ bill, the work less retention and advance. */
      amount: bigint;
      tax: bigint;
      /** The BOQ bill's rate, when the instalment is one. */
      taxRateBp: number | null;
      retention: bigint;
      advanceRecovery: bigint;
    }
  | {
      type: 'client_payment';
      id: string;
      date: string;
      site: AccountingSite;
      customer: AccountingParty;
      amount: bigint;
      mode: AccountingPaymentMode;
      reference: string | null;
      /** The instalment's external id when the receipt was recorded against one. */
      stageExternalId: string | null;
    };

// --- vouchers: what the formatters write ----------------------------------------------------------

/** How a voucher is entered: Tally's voucher type, and the document the other systems import it as. */
export type AccountingVoucherKind = 'purchase' | 'payment' | 'receipt' | 'journal' | 'sales';

export type AccountingLineRole = 'gl' | 'tax' | 'control' | 'bank';

export interface AccountingLine {
  key: string;
  account: AccountingAccount;
  /** Positive debit, negative credit, minor units. */
  amount: bigint;
  role: AccountingLineRole;
  description: string;
  /** The site, for a cost centre / class / tracking category. Only on gl lines. */
  costCentre: AccountingAccount | null;
  /** The supplier or client a payables/receivables line belongs to. */
  party: AccountingParty | null;
  /** Bill-wise reference on a party line: `new` raises it, `against` settles it. */
  billRef: { name: string; type: 'new' | 'against' | 'advance' | 'on_account' } | null;
  /** gl: the rate charged on this line; tax: the head's rate. */
  taxRateBp: number;
  /** gl lines: the tax charged on this line (already posted separately on the tax lines). */
  taxAmount: bigint;
  /** gl lines, for systems that take a tax code on documents and journals. */
  taxCode: AccountingAccount | null;
  taxHead: AccountingTaxHead | null;
}

export interface AccountingVoucher {
  externalId: string;
  sourceType: AccountingSourceType;
  sourceId: string;
  category: Exclude<AccountingCategory, 'masters'>;
  kind: AccountingVoucherKind;
  /** How the document-based systems take it: as a bill, an invoice, or a journal. */
  document: 'bill' | 'invoice' | 'journal';
  date: string;
  dueDate: string | null;
  /** The number shown in the accounting system: the supplier's invoice number, or the external id. */
  reference: string;
  party: AccountingParty | null;
  narration: string;
  siteName: string | null;
  lines: AccountingLine[];
  /**
   * The system's "no tax" code, where it needs one: on every Xero journal line, and on the untaxed
   * lines of a bill or invoice in the tax-code systems. Null otherwise.
   */
  noTaxCode: AccountingAccount | null;
}

export interface AccountingContext {
  system: AccountingSystem;
  regime: string;
  /** The company's saved mapping: key → account. Defaults are not consulted here. */
  map: Readonly<Record<string, AccountingAccount>>;
  /** GST state code of the company's own registration, for the IGST decision. */
  homeStateCode?: string | null;
  /** Site id → cost centre name, where the mapping renames a site. */
  costCentres?: Readonly<Record<string, AccountingAccount>>;
}

export interface AccountingMissingKey {
  key: string;
  label: string;
  /** A voucher that needed it, so the error can say where. */
  example: string;
}

export interface AccountingBuildResult {
  vouchers: AccountingVoucher[];
  missing: AccountingMissingKey[];
}

/** Thrown when a builder produces an unbalanced voucher — a bug, never a data problem. */
export class AccountingUnbalancedError extends Error {}

/**
 * Turn SiteBook's records into balanced vouchers, resolving every account through the company's map.
 *
 * A record whose accounts are not all mapped still produces its voucher (with an empty account) so
 * the caller can show the whole preview, but its keys are listed in `missing`; an export with
 * anything missing must be refused.
 */
export function accountingBuildVouchers(sources: readonly AccountingSource[], ctx: AccountingContext): AccountingBuildResult {
  const missing = new Map<string, AccountingMissingKey>();
  const builder = new VoucherFactory(ctx, missing);
  const vouchers: AccountingVoucher[] = [];
  for (const source of sources) {
    const voucher = builder.build(source);
    if (voucher) vouchers.push(voucher);
  }
  return { vouchers, missing: [...missing.values()].sort((a, b) => a.key.localeCompare(b.key)) };
}

/** Debits less credits: zero for every voucher this file produces. */
export function accountingVoucherBalance(voucher: AccountingVoucher): bigint {
  return voucher.lines.reduce((sum, line) => sum + line.amount, 0n);
}

class VoucherFactory {
  constructor(
    private readonly ctx: AccountingContext,
    private readonly missing: Map<string, AccountingMissingKey>,
  ) {}

  private resolve(candidates: string[], required: string, example: string): AccountingAccount {
    for (const key of candidates) {
      const account = this.ctx.map[key];
      if (account && account.name.trim()) return account;
    }
    if (!this.missing.has(required)) {
      this.missing.set(required, { key: required, label: accountingKeyLabel(required, this.ctx.regime), example });
    }
    return { code: '', name: '' };
  }

  /** The first candidate that is mapped, reported as `required` when none is. */
  private pick(candidates: string[], required: string, example: string): { key: string; account: AccountingAccount } {
    const found = candidates.find((candidate) => this.ctx.map[candidate]?.name.trim());
    return { key: found ?? required, account: this.resolve(candidates, required, example) };
  }

  /** `key@rate` first, then `key`. */
  private account(key: string, rateBp: number, example: string): { key: string; account: AccountingAccount } {
    return this.pick(rateBp > 0 ? [`${key}@${rateBp}`, key] : [key], key, example);
  }

  /** An expense line's account: its cost code's, else its category's — each at the line's rate first. */
  private expenseAccount(costCode: string | null, category: string, rateBp: number, example: string) {
    const at = (key: string) => (rateBp > 0 ? [`${key}@${rateBp}`, key] : [key]);
    const candidates = [...(costCode ? at(`cost_code:${costCode}`) : []), ...at(`expense:${category}`)];
    return this.pick(candidates, `expense:${category}`, example);
  }

  /**
   * The tax code on a bill or invoice line, for systems that work the tax out from it. Null on a
   * journal — there the tax is already its own line, and a code would make the system add it again —
   * and on an untaxed line, which takes the voucher's "no tax" code (`finish`).
   */
  private docTaxCode(document: AccountingVoucher['document'], side: 'input' | 'output', rateBp: number, example: string) {
    if (!accountingUsesTaxCodes(this.ctx.system) || document === 'journal' || rateBp <= 0) return null;
    const key = `tax_code:${side}@${rateBp}`;
    return this.resolve([key], key, example);
  }

  private costCentre(site: AccountingSite | null): AccountingAccount | null {
    if (!site) return null;
    const mapped = this.ctx.costCentres?.[site.id];
    const name = mapped?.name.trim() || site.name;
    return { code: mapped?.code.trim() || accountingSiteCode(name), name };
  }

  /** The payables or receivables line: the party's own ledger in Tally, the control account elsewhere. */
  private control(side: 'payable' | 'receivable', party: AccountingParty, example: string): { key: string; account: AccountingAccount } {
    const key = side === 'payable' ? 'accounts_payable' : 'accounts_receivable';
    if (accountingPostsToPartyLedger(this.ctx.system)) {
      // The group still has to be mapped: the masters file creates the party ledger under it.
      this.resolve([key], key, example);
      return { key, account: { code: '', name: party.name } };
    }
    return { key, account: this.resolve([key], key, example) };
  }

  private bank(mode: string, example: string): { key: string; account: AccountingAccount } {
    const key = mode === 'cash' ? 'cash' : 'bank';
    return { key, account: this.resolve([key], key, example) };
  }

  private line(partial: Partial<AccountingLine> & Pick<AccountingLine, 'key' | 'account' | 'amount' | 'role'>): AccountingLine {
    return {
      description: '',
      costCentre: null,
      party: null,
      billRef: null,
      taxRateBp: 0,
      taxAmount: 0n,
      taxCode: null,
      taxHead: null,
      ...partial,
    };
  }

  /**
   * A line only when there is an amount: a bill with no retention must not demand that the
   * retention account be mapped. The account is looked up inside `make`, so it is never asked for.
   */
  private posting(amount: bigint, make: () => AccountingLine): AccountingLine[] {
    return amount === 0n ? [] : [make()];
  }

  private taxLines(side: 'input' | 'output', parts: AccountingTaxPart[], sign: 1n | -1n, example: string): AccountingLine[] {
    // One line per head and rate: a bill with lines at 5% and 18% posts CGST at 2.5% and at 9%.
    const merged = new Map<string, AccountingTaxPart>();
    for (const part of parts) {
      const id = `${part.head}@${part.rateBp}`;
      const current = merged.get(id);
      if (current) current.amount += part.amount;
      else merged.set(id, { ...part });
    }
    return [...merged.values()]
      .filter((part) => part.amount !== 0n)
      .map((part) =>
        this.line({
          ...this.account(`${side}_${part.head}`, part.rateBp, example),
          amount: sign * part.amount,
          role: 'tax',
          description: `${side === 'input' ? 'Input' : 'Output'} ${taxHeadLabel(part.head, this.ctx.regime)} ${percent(part.rateBp)}`,
          taxRateBp: part.rateBp,
          taxHead: part.head,
        }),
      );
  }

  build(source: AccountingSource): AccountingVoucher | null {
    switch (source.type) {
      case 'purchase_invoice':
        return this.purchaseInvoice(source);
      case 'expense':
        return this.expense(source);
      case 'wage_period':
        return this.wagePeriod(source);
      case 'labour_payment':
        return this.labourPayment(source);
      case 'subcontract_bill':
        return this.subcontractBill(source);
      case 'subcontract_payment':
        return this.subcontractPayment(source);
      case 'payment_stage':
        return this.paymentStage(source);
      case 'client_payment':
        return this.clientPayment(source);
    }
  }

  /**
   * Drop empty lines, check the balance, and settle the "no tax" code: Xero wants a tax rate on every
   * journal line, and every tax-code system wants one on an untaxed document line.
   */
  private finish(voucher: Omit<AccountingVoucher, 'externalId' | 'noTaxCode'>, example: string): AccountingVoucher | null {
    const lines = voucher.lines.filter((line) => line.amount !== 0n);
    if (lines.length === 0) return null;
    const needsNoTax =
      accountingUsesTaxCodes(this.ctx.system) &&
      (voucher.document === 'journal'
        ? this.ctx.system === 'xero'
        : lines.some((line) => line.role === 'gl' && !line.taxCode));
    const result: AccountingVoucher = {
      ...voucher,
      externalId: accountingExternalId(voucher.sourceType, voucher.sourceId),
      noTaxCode: needsNoTax ? this.resolve(['tax_code:none'], 'tax_code:none', example) : null,
      lines,
    };
    if (accountingVoucherBalance(result) !== 0n) {
      throw new AccountingUnbalancedError(`${result.externalId} does not balance`);
    }
    return result;
  }

  private purchaseInvoice(source: Extract<AccountingSource, { type: 'purchase_invoice' }>): AccountingVoucher | null {
    const externalId = accountingExternalId('purchase_invoice', source.id);
    const example = `${source.vendor.name} invoice ${source.number}`;
    const costCentre = this.costCentre(source.site);
    // Lines on the same account at the same rate are one line in the books.
    const groups = new Map<string, AccountingLine>();
    const taxParts: AccountingTaxPart[] = [];
    let total = 0n;
    for (const item of source.lines) {
      const rate = accountingEffectiveRate(item.amount, item.tax, this.ctx.regime);
      const { key, account } = this.expenseAccount(item.costCode, 'materials', rate, example);
      const id = `${account.code}|${account.name}|${rate}`;
      const existing = groups.get(id);
      if (existing) {
        existing.amount += item.amount;
        existing.taxAmount += item.tax;
      } else {
        groups.set(
          id,
          this.line({
            key,
            account,
            amount: item.amount,
            role: 'gl',
            description: item.description,
            costCentre,
            taxRateBp: rate,
            taxAmount: item.tax,
            taxCode: this.docTaxCode('bill', 'input', rate, example),
          }),
        );
      }
      taxParts.push(
        ...accountingTaxSplit(this.ctx.regime, item.tax, rate, {
          homeStateCode: this.ctx.homeStateCode,
          counterpartyTaxId: source.vendor.taxId,
        }),
      );
      total += item.amount + item.tax;
    }
    return this.finish(
      {
        sourceType: 'purchase_invoice',
        sourceId: source.id,
        category: 'purchases',
        kind: 'purchase',
        document: 'bill',
        date: source.date,
        dueDate: source.dueDate,
        reference: source.number,
        party: source.vendor,
        narration: `${source.vendor.name} invoice ${source.number}${source.orderNumber ? ` against ${source.orderNumber}` : ''} · ${source.site.name} · ${externalId}`,
        siteName: source.site.name,
        lines: [
          ...groups.values(),
          ...this.taxLines('input', taxParts, 1n, example),
          this.line({
            ...this.control('payable', source.vendor, example),
            amount: -total,
            role: 'control',
            description: `Invoice ${source.number}`,
            party: source.vendor,
            billRef: { name: source.number, type: 'new' },
          }),
        ],
      },
      example,
    );
  }

  private expense(source: Extract<AccountingSource, { type: 'expense' }>): AccountingVoucher | null {
    const externalId = accountingExternalId('expense', source.id);
    const label = expenseCategoryLabel(source.category);
    const example = `${label} expense on ${source.date} at ${source.site.name}`;
    const net = source.amount - source.tax;
    const rate = accountingEffectiveRate(net, source.tax, this.ctx.regime);
    const description = source.note?.trim() || label;
    // A hire invoice is owed to the vendor: a purchase bill, not money out of the site's cash box.
    const document = source.vendor ? 'bill' : 'journal';
    const taxParts = accountingTaxSplit(this.ctx.regime, source.tax, rate, {
      homeStateCode: this.ctx.homeStateCode,
      counterpartyTaxId: source.supplierTaxId ?? source.vendor?.taxId ?? null,
    });
    const gl = this.line({
      ...this.expenseAccount(source.costCode, source.category, rate, example),
      amount: net,
      role: 'gl',
      description,
      costCentre: this.costCentre(source.site),
      taxRateBp: rate,
      taxAmount: source.tax,
      taxCode: this.docTaxCode(document, 'input', rate, example),
    });
    const common = {
      sourceType: 'expense' as const,
      sourceId: source.id,
      category: 'purchases' as const,
      document,
      date: source.date,
      dueDate: null,
      siteName: source.site.name,
    } satisfies Partial<AccountingVoucher>;

    if (source.vendor) {
      const reference = source.reference?.trim() || externalId;
      return this.finish(
        {
          ...common,
          kind: 'purchase',
          reference,
          party: source.vendor,
          narration: `${source.vendor.name} · ${description} · ${source.site.name} · ${externalId}`,
          lines: [
            gl,
            ...this.taxLines('input', taxParts, 1n, example),
            this.line({
              ...this.control('payable', source.vendor, example),
              amount: -source.amount,
              role: 'control',
              description: `Invoice ${reference}`,
              party: source.vendor,
              billRef: { name: reference, type: 'new' },
            }),
          ],
        },
        example,
      );
    }

    return this.finish(
      {
        ...common,
        kind: 'payment',
        reference: externalId,
        party: null,
        narration: `${label}: ${description} · ${source.site.name} · ${externalId}`,
        lines: [
          gl,
          ...this.taxLines('input', taxParts, 1n, example),
          this.line({
            ...this.pick(['petty_cash'], 'petty_cash', example),
            amount: -source.amount,
            role: 'bank',
            description: 'Paid from site cash',
          }),
        ],
      },
      example,
    );
  }

  private wagePeriod(source: Extract<AccountingSource, { type: 'wage_period' }>): AccountingVoucher | null {
    if (source.gross === 0n) return null;
    const externalId = accountingExternalId('wage_period', source.id);
    const who = source.contractorName ?? 'Direct labour';
    const example = `Wages ${source.periodStart} to ${source.periodEnd} (${who})`;
    // Advances recovered can never exceed what was earned, so the payable is never negative.
    const advances = source.advances > source.gross ? source.gross : source.advances;
    return this.finish(
      {
        sourceType: 'wage_period',
        sourceId: source.id,
        category: 'payroll',
        kind: 'journal',
        document: 'journal',
        date: source.periodEnd,
        dueDate: null,
        reference: externalId,
        party: null,
        narration: `Wages ${source.periodStart} to ${source.periodEnd} · ${who} · ${externalId}`,
        siteName: null,
        lines: [
          this.line({ ...this.account('wages_expense', 0, example), amount: source.gross, role: 'gl', description: `Wages earned · ${who}` }),
          ...this.posting(advances, () =>
            this.line({ ...this.account('labour_advances', 0, example), amount: -advances, role: 'gl', description: 'Advances recovered' }),
          ),
          ...this.posting(source.gross - advances, () =>
            this.line({ ...this.account('wages_payable', 0, example), amount: -(source.gross - advances), role: 'gl', description: `Net wages payable · ${who}` }),
          ),
        ],
      },
      example,
    );
  }

  private labourPayment(source: Extract<AccountingSource, { type: 'labour_payment' }>): AccountingVoucher | null {
    if (source.amount === 0n) return null;
    const externalId = accountingExternalId('labour_payment', source.id);
    const example = `${source.kind} for ${source.payee} on ${source.date}`;
    const costCentre = this.costCentre(source.site);
    const where = source.site ? ` · ${source.site.name}` : '';
    const common = {
      sourceType: 'labour_payment' as const,
      sourceId: source.id,
      document: 'journal' as const,
      date: source.date,
      dueDate: null,
      reference: source.reference?.trim() || externalId,
      party: null,
      siteName: source.site?.name ?? null,
    } satisfies Partial<AccountingVoucher>;

    if (source.kind === 'bonus' || source.kind === 'deduction') {
      // Not money moving: a bonus adds to what is owed, a deduction takes from it.
      const bonus = source.kind === 'bonus';
      const what = `${bonus ? 'Bonus' : 'Deduction'} · ${source.payee}`;
      return this.finish(
        {
          ...common,
          category: 'payroll',
          kind: 'journal',
          narration: `${what}${where} · ${externalId}`,
          lines: bonus
            ? [
                this.line({ ...this.account('wages_expense', 0, example), amount: source.amount, role: 'gl', description: what, costCentre }),
                this.line({ ...this.account('wages_payable', 0, example), amount: -source.amount, role: 'gl', description: what }),
              ]
            : [
                this.line({ ...this.account('wages_payable', 0, example), amount: source.amount, role: 'gl', description: what }),
                this.line({ ...this.account('labour_deductions', 0, example), amount: -source.amount, role: 'gl', description: what, costCentre }),
              ],
        },
        example,
      );
    }

    const wage = source.kind === 'wage';
    return this.finish(
      {
        ...common,
        category: 'payments',
        kind: 'payment',
        narration: `${wage ? 'Wages paid' : 'Advance paid'} · ${source.payee}${where} · ${source.mode} · ${externalId}`,
        lines: [
          this.line({
            ...this.account(wage ? 'wages_payable' : 'labour_advances', 0, example),
            amount: source.amount,
            role: 'gl',
            description: `${wage ? 'Wages' : 'Advance'} · ${source.payee}`,
          }),
          this.line({ ...this.bank(source.mode, example), amount: -source.amount, role: 'bank', description: `Paid by ${source.mode}` }),
        ],
      },
      example,
    );
  }

  private subcontractBill(source: Extract<AccountingSource, { type: 'subcontract_bill' }>): AccountingVoucher | null {
    const externalId = accountingExternalId('subcontract_bill', source.id);
    const reference = `${source.subcontractNumber}/RA-${source.billNumber}`;
    const example = `${source.contractor.name} ${reference}`;
    const costCentre = this.costCentre(source.site);
    // Worked out from the parts rather than read from the bill: it is what makes the voucher balance.
    const net = source.gross + source.tax - source.retention - source.advanceRecovery - source.deductions;
    // A bill that nets to nothing or to a credit cannot be a bill; it goes in as a journal.
    const document = net > 0n ? 'bill' : 'journal';
    const rate = source.tax > 0n ? source.taxRateBp : 0;
    const taxParts = accountingTaxSplit(this.ctx.regime, source.tax, rate, {
      homeStateCode: this.ctx.homeStateCode,
      counterpartyTaxId: source.contractor.taxId,
    });
    return this.finish(
      {
        sourceType: 'subcontract_bill',
        sourceId: source.id,
        category: 'subcontract_bills',
        kind: 'purchase',
        document,
        date: source.date,
        dueDate: null,
        reference,
        party: source.contractor,
        narration: `${source.contractor.name} running bill ${reference} · ${source.site.name} · ${externalId}`,
        siteName: source.site.name,
        lines: [
          ...this.posting(source.gross, () =>
            this.line({
              ...this.account('subcontract_cost', rate, example),
              amount: source.gross,
              role: 'gl',
              description: `Work certified on ${reference}`,
              costCentre,
              taxRateBp: rate,
              taxAmount: source.tax,
              taxCode: this.docTaxCode(document, 'input', rate, example),
            }),
          ),
          ...this.taxLines('input', taxParts, 1n, example),
          ...this.posting(source.retention, () =>
            this.line({ ...this.account('retention_payable', 0, example), amount: -source.retention, role: 'gl', description: `Retention held on ${reference}` }),
          ),
          ...this.posting(source.advanceRecovery, () =>
            this.line({ ...this.account('subcontract_advances', 0, example), amount: -source.advanceRecovery, role: 'gl', description: `Advance recovered on ${reference}` }),
          ),
          ...this.posting(source.deductions, () =>
            this.line({ ...this.account('subcontract_recoveries', 0, example), amount: -source.deductions, role: 'gl', description: `Back-charges on ${reference}`, costCentre }),
          ),
          ...this.posting(net, () =>
            this.line({
              ...this.control('payable', source.contractor, example),
              amount: -net,
              role: 'control',
              description: `Net payable on ${reference}`,
              party: source.contractor,
              billRef: { name: reference, type: 'new' },
            }),
          ),
        ],
      },
      example,
    );
  }

  private subcontractPayment(source: Extract<AccountingSource, { type: 'subcontract_payment' }>): AccountingVoucher | null {
    if (source.amount === 0n) return null;
    const externalId = accountingExternalId('subcontract_payment', source.id);
    const example = `${source.kind} payment to ${source.contractor.name} on ${source.date}`;
    const debit =
      source.kind === 'bill'
        ? this.line({
            ...this.control('payable', source.contractor, example),
            amount: source.amount,
            role: 'control',
            description: `Paid against ${source.billReference ?? 'running bill'}`,
            party: source.contractor,
            billRef: source.billReference
              ? { name: source.billReference, type: 'against' }
              : { name: externalId, type: 'on_account' },
          })
        : this.line({
            ...this.account(source.kind === 'advance' ? 'subcontract_advances' : 'retention_payable', 0, example),
            amount: source.amount,
            role: 'gl',
            description: source.kind === 'advance' ? 'Mobilisation advance paid' : 'Retention released and paid',
            party: source.contractor,
          });
    return this.finish(
      {
        sourceType: 'subcontract_payment',
        sourceId: source.id,
        category: 'payments',
        kind: 'payment',
        document: 'journal',
        date: source.date,
        dueDate: null,
        reference: source.reference?.trim() || externalId,
        party: source.contractor,
        narration: `Payment to ${source.contractor.name} (${source.kind}) · ${source.site.name} · ${externalId}`,
        siteName: source.site.name,
        lines: [
          debit,
          this.line({ ...this.bank(source.mode, example), amount: -source.amount, role: 'bank', description: `Paid by ${source.mode}` }),
        ],
      },
      example,
    );
  }

  private paymentStage(source: Extract<AccountingSource, { type: 'payment_stage' }>): AccountingVoucher | null {
    const externalId = accountingExternalId('payment_stage', source.id);
    const example = `${source.customer.name}: ${source.label}`;
    // The work billed is the instalment plus what the client kept back from it.
    const gross = source.amount + source.retention + source.advanceRecovery;
    const rate = source.tax > 0n ? (source.taxRateBp ?? accountingEffectiveRate(gross, source.tax, this.ctx.regime)) : 0;
    const taxParts = accountingTaxSplit(this.ctx.regime, source.tax, rate, {
      homeStateCode: this.ctx.homeStateCode,
      counterpartyTaxId: source.customer.taxId,
    });
    const receivable = source.amount + source.tax;
    const document = receivable > 0n ? 'invoice' : 'journal';
    return this.finish(
      {
        sourceType: 'payment_stage',
        sourceId: source.id,
        category: 'sales',
        kind: 'sales',
        document,
        date: source.date,
        dueDate: source.dueDate,
        reference: externalId,
        party: source.customer,
        narration: `${source.label} · ${source.site.name} · ${externalId}`,
        siteName: source.site.name,
        lines: [
          ...this.posting(receivable, () =>
            this.line({
              ...this.control('receivable', source.customer, example),
              amount: receivable,
              role: 'control',
              description: source.label,
              party: source.customer,
              billRef: { name: externalId, type: 'new' },
            }),
          ),
          ...this.posting(source.retention, () =>
            this.line({ ...this.account('retention_receivable', 0, example), amount: source.retention, role: 'gl', description: 'Retention held by the client' }),
          ),
          ...this.posting(source.advanceRecovery, () =>
            this.line({ ...this.account('client_advances', 0, example), amount: source.advanceRecovery, role: 'gl', description: 'Mobilisation advance recovered' }),
          ),
          ...this.posting(gross, () =>
            this.line({
              ...this.account('sales_revenue', rate, example),
              amount: -gross,
              role: 'gl',
              description: source.label,
              costCentre: this.costCentre(source.site),
              taxRateBp: rate,
              taxAmount: source.tax,
              taxCode: this.docTaxCode(document, 'output', rate, example),
            }),
          ),
          ...this.taxLines('output', taxParts, -1n, example),
        ],
      },
      example,
    );
  }

  private clientPayment(source: Extract<AccountingSource, { type: 'client_payment' }>): AccountingVoucher | null {
    if (source.amount === 0n) return null;
    const externalId = accountingExternalId('client_payment', source.id);
    const example = `Receipt from ${source.customer.name} on ${source.date}`;
    return this.finish(
      {
        sourceType: 'client_payment',
        sourceId: source.id,
        category: 'payments',
        kind: 'receipt',
        document: 'journal',
        date: source.date,
        dueDate: null,
        reference: source.reference?.trim() || externalId,
        party: source.customer,
        narration: `Receipt from ${source.customer.name} · ${source.site.name} · ${source.mode} · ${externalId}`,
        siteName: source.site.name,
        lines: [
          this.line({ ...this.bank(source.mode, example), amount: source.amount, role: 'bank', description: `Received by ${source.mode}` }),
          this.line({
            ...this.control('receivable', source.customer, example),
            amount: -source.amount,
            role: 'control',
            description: `Receipt from ${source.customer.name}`,
            party: source.customer,
            billRef: source.stageExternalId
              ? { name: source.stageExternalId, type: 'against' }
              : { name: externalId, type: 'on_account' },
          }),
        ],
      },
      example,
    );
  }
}

// --- summaries ------------------------------------------------------------------------------------

export interface AccountingAccountTotal {
  key: string;
  code: string;
  name: string;
  debit: bigint;
  credit: bigint;
}

/** Debits and credits per account across vouchers: the export page's preview. Sorted by name. */
export function accountingTotalsByAccount(vouchers: readonly AccountingVoucher[]): AccountingAccountTotal[] {
  const totals = new Map<string, AccountingAccountTotal>();
  for (const voucher of vouchers) {
    for (const line of voucher.lines) {
      const id = `${line.account.code}|${line.account.name}`;
      const total = totals.get(id) ?? { key: line.key, code: line.account.code, name: line.account.name, debit: 0n, credit: 0n };
      if (line.amount > 0n) total.debit += line.amount;
      else total.credit -= line.amount;
      totals.set(id, total);
    }
  }
  return [...totals.values()].sort((a, b) => a.name.localeCompare(b.name) || a.code.localeCompare(b.code));
}

/** Every party the vouchers name, once each, by code. For the masters file. */
export function accountingPartiesOf(vouchers: readonly AccountingVoucher[]): AccountingParty[] {
  const parties = new Map<string, AccountingParty>();
  for (const voucher of vouchers) {
    if (voucher.party) parties.set(`${voucher.party.kind}:${voucher.party.code}`, voucher.party);
    for (const line of voucher.lines) {
      if (line.party) parties.set(`${line.party.kind}:${line.party.code}`, line.party);
    }
  }
  return [...parties.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * A stable short code for a party: `V-1A2B3C4D` for a supplier, `S-…` for a subcontractor, `C-…`
 * for a client. Clients are names on a site rather than rows, so theirs is a hash of the name — the
 * same client on two sites is one customer.
 */
export function accountingPartyCode(prefix: 'V' | 'S' | 'C', idOrName: string): string {
  if (/^[0-9a-f-]{36}$/i.test(idOrName)) return `${prefix}-${idOrName.replace(/-/g, '').slice(0, 8).toUpperCase()}`;
  // FNV-1a over the trimmed, lower-cased name: no crypto needed, only stability.
  let hash = 0x811c9dc5;
  for (const char of idOrName.trim().toLowerCase()) {
    hash ^= char.codePointAt(0)!;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `${prefix}-${hash.toString(16).toUpperCase().padStart(8, '0')}`;
}

/**
 * A site's code where a system wants one rather than a name — SAP Business One's project code, at
 * most 20 characters. From the name unless the mapping gives one: `Lakeview Towers` → `LAKEVIEW-TOWERS`.
 */
export function accountingSiteCode(name: string): string {
  const code = name.toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return (code || 'SITE').slice(0, 20).replace(/-+$/, '');
}

// --- masters --------------------------------------------------------------------------------------

export interface AccountingMasterAccount {
  key: string;
  label: string;
  nature: AccountingNature;
  account: AccountingAccount;
}

/** What a masters file lists: the parties, the mapped accounts and the sites' cost centres. */
export interface AccountingMasters {
  parties: AccountingParty[];
  accounts: AccountingMasterAccount[];
  costCentres: AccountingAccount[];
}

/** The saved map as master accounts: one per distinct account, tax codes left out. */
export function accountingMasterAccounts(map: Readonly<Record<string, AccountingAccount>>, regime: string): AccountingMasterAccount[] {
  const seen = new Set<string>();
  const out: AccountingMasterAccount[] = [];
  for (const key of Object.keys(map).sort()) {
    const account = map[key]!;
    if (!account.name.trim() || key.startsWith('tax_code:') || key.startsWith('site:')) continue;
    const id = `${account.code}|${account.name}`;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({ key, label: accountingKeyLabel(key, regime), nature: accountingKeyNature(key), account });
  }
  return out;
}

// --- shared formatting helpers --------------------------------------------------------------------

/** One file of an export. Every format is text. */
export interface AccountingFile {
  name: string;
  contentType: string;
  content: string;
}

export interface AccountingFormatOptions {
  /** The company currency's minor digits: 2 for INR and AED, 3 for KWD. */
  digits: number;
  currency: string;
}

/** `2026-04-15` → `15/04/2026`: the day-first form the Indian and Gulf editions import. */
export function accountingDmy(iso: string): string {
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
}

/** `2026-04-15` → `20260415`: Tally and SAP's form. */
export function accountingCompactDate(iso: string): string {
  return iso.replace(/-/g, '');
}

/**
 * A CSV cell. Quoted when it holds a comma, quote or line break; a cell that a spreadsheet would
 * run as a formula (`=`, `+`, `@`, a tab) gets a leading apostrophe. Amounts are written through
 * `accountingCsvAmount`, which never needs either, so a negative amount stays a number.
 */
export function accountingCsvText(value: string | null | undefined): string {
  let text = (value ?? '').replace(/\r\n?/g, '\n');
  if (/^[=+@\t]/.test(text) || /^-[^0-9]/.test(text)) text = `'${text}`;
  return /[",\n]/.test(text) || /^\s|\s$/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function accountingCsv(rows: readonly (readonly string[])[]): string {
  return rows.map((row) => row.join(',')).join('\r\n') + '\r\n';
}

/** Tab-delimited and IIF cells: no tabs or line breaks may survive inside a value. */
export function accountingTabText(value: string | null | undefined): string {
  return (value ?? '').replace(/[\t\r\n]+/g, ' ').trim();
}

export function accountingTruncate(value: string, max: number): string {
  return value.length <= max ? value : value.slice(0, max);
}

/** The lines a bill or invoice document carries: its gl lines, signed as the document shows them. */
export function accountingDocumentLines(voucher: AccountingVoucher): AccountingLine[] {
  const sign = voucher.document === 'invoice' ? -1n : 1n;
  return voucher.lines.filter((line) => line.role === 'gl').map((line) => ({ ...line, amount: sign * line.amount, taxAmount: line.taxAmount }));
}

/** The document's total — what the supplier is owed, or the client owes. */
export function accountingDocumentTotal(voucher: AccountingVoucher): bigint {
  const control = voucher.lines.find((line) => line.role === 'control');
  if (!control) return 0n;
  return control.amount < 0n ? -control.amount : control.amount;
}
