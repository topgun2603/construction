import {
  accountingCompactDate,
  type AccountingFormatOptions,
  type AccountingLine,
  type AccountingMasterAccount,
  type AccountingMasters,
  type AccountingNature,
  type AccountingVoucher,
} from './accounting';
import { minorToDecimal } from './money';

/**
 * Tally Prime / Tally.ERP 9 XML import (Gateway of Tally → Import → Transactions / Masters).
 *
 * The envelope is Tally's own request format: `ENVELOPE / HEADER / TALLYREQUEST = Import Data`, then
 * `BODY / IMPORTDATA` with a `REQUESTDESC` naming the report ("Vouchers" or "All Masters") and the
 * company, and the objects inside `REQUESTDATA / TALLYMESSAGE`.
 *
 * Tally's sign convention is the opposite of the books': a debit is a NEGATIVE amount with
 * `ISDEEMEDPOSITIVE = Yes`, a credit a positive one with `No`. Every voucher's amounts sum to zero.
 *
 * Each voucher carries `REMOTEID` (and `GUID`) set to its external id. Tally keys a voucher on its
 * remote id, so importing the same file twice alters the voucher rather than adding a second one.
 *
 * Non-ASCII characters are written as numeric references (`&#x0B9A;`), so the file is plain ASCII
 * and reads the same in ERP 9, which does not take a UTF-8 byte-order-free file reliably.
 */

const VOUCHER_TYPES: Readonly<Record<AccountingVoucher['kind'], string>> = {
  purchase: 'Purchase',
  payment: 'Payment',
  receipt: 'Receipt',
  journal: 'Journal',
  sales: 'Sales',
};

const BILL_TYPES = {
  new: 'New Ref',
  against: 'Agst Ref',
  advance: 'Advance',
  on_account: 'On Account',
} as const;

/** XML text and attribute escaping, with anything outside printable ASCII as a character reference. */
export function tallyEscape(value: string | null | undefined): string {
  let out = '';
  for (const char of value ?? '') {
    const code = char.codePointAt(0)!;
    if (char === '&') out += '&amp;';
    else if (char === '<') out += '&lt;';
    else if (char === '>') out += '&gt;';
    else if (char === '"') out += '&quot;';
    else if (char === "'") out += '&apos;';
    // Control characters other than tab and line breaks are not allowed in XML 1.0 at all.
    else if (code < 0x20 && code !== 0x09 && code !== 0x0a && code !== 0x0d) out += ' ';
    else if (code > 0x7e) out += `&#x${code.toString(16).toUpperCase()};`;
    else out += char;
  }
  return out;
}

/** Tally's amount: the books' sign flipped — a debit is negative. */
export function tallyAmount(amount: bigint, digits: number): string {
  return minorToDecimal(-amount, digits);
}

function tag(name: string, value: string | null | undefined): string {
  return `<${name}>${tallyEscape(value)}</${name}>`;
}

function envelope(report: 'Vouchers' | 'All Masters', company: string | null | undefined, body: string[]): string {
  const statics = company?.trim()
    ? `<STATICVARIABLES>${tag('SVCURRENTCOMPANY', company.trim())}</STATICVARIABLES>`
    : '';
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<ENVELOPE>',
    ' <HEADER>',
    '  <TALLYREQUEST>Import Data</TALLYREQUEST>',
    ' </HEADER>',
    ' <BODY>',
    '  <IMPORTDATA>',
    '   <REQUESTDESC>',
    `    <REPORTNAME>${report}</REPORTNAME>`,
    statics ? `    ${statics}` : null,
    '   </REQUESTDESC>',
    '   <REQUESTDATA>',
    ...body,
    '   </REQUESTDATA>',
    '  </IMPORTDATA>',
    ' </BODY>',
    '</ENVELOPE>',
    '',
  ]
    .filter((line): line is string => line !== null)
    .join('\r\n');
}

function ledgerEntry(line: AccountingLine, digits: number): string[] {
  const amount = tallyAmount(line.amount, digits);
  const debit = line.amount > 0n;
  const out = [
    '      <ALLLEDGERENTRIES.LIST>',
    `       ${tag('LEDGERNAME', line.account.name)}`,
    `       ${tag('ISDEEMEDPOSITIVE', debit ? 'Yes' : 'No')}`,
    `       ${tag('ISPARTYLEDGER', line.role === 'control' ? 'Yes' : 'No')}`,
    `       ${tag('AMOUNT', amount)}`,
  ];
  if (line.billRef) {
    out.push(
      '       <BILLALLOCATIONS.LIST>',
      `        ${tag('NAME', line.billRef.name)}`,
      `        ${tag('BILLTYPE', BILL_TYPES[line.billRef.type])}`,
      `        ${tag('AMOUNT', amount)}`,
      '       </BILLALLOCATIONS.LIST>',
    );
  }
  if (line.costCentre) {
    out.push(
      '       <CATEGORYALLOCATIONS.LIST>',
      `        ${tag('CATEGORY', 'Primary Cost Category')}`,
      `        ${tag('ISDEEMEDPOSITIVE', debit ? 'Yes' : 'No')}`,
      '        <COSTCENTREALLOCATIONS.LIST>',
      `         ${tag('NAME', line.costCentre.name)}`,
      `         ${tag('AMOUNT', amount)}`,
      '        </COSTCENTREALLOCATIONS.LIST>',
      '       </CATEGORYALLOCATIONS.LIST>',
    );
  }
  out.push('      </ALLLEDGERENTRIES.LIST>');
  return out;
}

/**
 * The party Tally shows on the voucher: the supplier or client, or — on a cash expense or a wage
 * payment — the cash or bank ledger the money came out of.
 */
function partyLedger(voucher: AccountingVoucher): string | null {
  const control = voucher.lines.find((line) => line.role === 'control');
  if (control) return control.account.name;
  return voucher.lines.find((line) => line.role === 'bank')?.account.name ?? null;
}

/** Every voucher as one Tally import file. */
export function tallyVouchersXml(
  vouchers: readonly AccountingVoucher[],
  options: AccountingFormatOptions & { company?: string | null },
): string {
  const body: string[] = ['    <TALLYMESSAGE xmlns:UDF="TallyUDF">'];
  for (const voucher of vouchers) {
    const type = VOUCHER_TYPES[voucher.kind];
    const date = accountingCompactDate(voucher.date);
    const party = partyLedger(voucher);
    body.push(
      `     <VOUCHER REMOTEID="${tallyEscape(voucher.externalId)}" VCHTYPE="${type}" ACTION="Create" OBJVIEW="Accounting Voucher View">`,
      `      ${tag('GUID', voucher.externalId)}`,
      `      ${tag('DATE', date)}`,
      `      ${tag('EFFECTIVEDATE', date)}`,
      `      ${tag('VOUCHERTYPENAME', type)}`,
      `      ${tag('VOUCHERNUMBER', voucher.externalId)}`,
      `      ${tag('REFERENCE', voucher.reference)}`,
      `      ${tag('REFERENCEDATE', date)}`,
      party ? `      ${tag('PARTYLEDGERNAME', party)}` : '',
      `      ${tag('NARRATION', voucher.narration)}`,
      `      ${tag('PERSISTEDVIEW', 'Accounting Voucher View')}`,
      // Party first, as Tally lays a voucher out; then the debits and credits as they come.
      ...[...voucher.lines]
        .sort((a, b) => Number(b.role === 'control') - Number(a.role === 'control'))
        .flatMap((line) => ledgerEntry(line, options.digits)),
      '     </VOUCHER>',
    );
  }
  body.push('    </TALLYMESSAGE>');
  return envelope('Vouchers', options.company, body.filter((line) => line !== ''));
}

/** The Tally group a mapped ledger is created under, from what kind of account it is. */
export function tallyParentGroup(account: Pick<AccountingMasterAccount, 'key' | 'nature'>): string | null {
  const key = account.key;
  if (key.startsWith('expense:materials')) return 'Purchase Accounts';
  if (key.startsWith('wages_expense') || key.startsWith('subcontract_cost') || key.startsWith('subcontract_recoveries')) {
    return 'Direct Expenses';
  }
  if (key.startsWith('sales_revenue')) return 'Sales Accounts';
  const byNature: Partial<Record<AccountingNature, string>> = {
    expense: 'Indirect Expenses',
    income: 'Indirect Incomes',
    asset: 'Loans & Advances (Asset)',
    liability: 'Current Liabilities',
    bank: 'Bank Accounts',
    cash: 'Cash-in-Hand',
    tax: 'Duties & Taxes',
  };
  // Payables and receivables are groups in Tally, not ledgers: nothing to create.
  return byNature[account.nature] ?? null;
}

const GST_DUTY_HEADS: Readonly<Record<string, string>> = {
  cgst: 'Central Tax',
  sgst: 'State Tax',
  igst: 'Integrated Tax',
};

/**
 * Masters: a ledger per mapped account (under the group its kind belongs to, cost centres on for
 * income and expense), a ledger per supplier and client (under the groups the mapping names for
 * payables and receivables, bill-by-bill on, with the GSTIN or TRN), and a cost centre per site.
 * Import this before the vouchers: Tally refuses a voucher whose ledger does not exist yet.
 */
export function tallyMastersXml(
  masters: AccountingMasters,
  options: { company?: string | null; payablesGroup: string; receivablesGroup: string; regime: string },
): string {
  const body: string[] = ['    <TALLYMESSAGE xmlns:UDF="TallyUDF">'];
  for (const centre of masters.costCentres) {
    body.push(
      `     <COSTCENTRE NAME="${tallyEscape(centre.name)}" ACTION="Create">`,
      `      <NAME.LIST>${tag('NAME', centre.name)}</NAME.LIST>`,
      `      ${tag('CATEGORY', 'Primary Cost Category')}`,
      '     </COSTCENTRE>',
    );
  }
  for (const account of masters.accounts) {
    const parent = tallyParentGroup(account);
    if (!parent) continue;
    const head = /^(?:input|output)_(cgst|sgst|igst|tax)/.exec(account.key)?.[1];
    const costCentres = account.nature === 'expense' || account.nature === 'income';
    body.push(
      `     <LEDGER NAME="${tallyEscape(account.account.name)}" ACTION="Create">`,
      `      <NAME.LIST>${tag('NAME', account.account.name)}</NAME.LIST>`,
      `      ${tag('PARENT', parent)}`,
      `      ${tag('ISCOSTCENTRESON', costCentres ? 'Yes' : 'No')}`,
      head
        ? options.regime === 'gst_in' && GST_DUTY_HEADS[head]
          ? `      ${tag('TAXTYPE', 'GST')}\r\n      ${tag('GSTDUTYHEAD', GST_DUTY_HEADS[head])}`
          : `      ${tag('TAXTYPE', 'VAT')}`
        : '',
      '     </LEDGER>',
    );
  }
  for (const party of masters.parties) {
    const parent = party.kind === 'vendor' ? options.payablesGroup : options.receivablesGroup;
    body.push(
      `     <LEDGER NAME="${tallyEscape(party.name)}" ACTION="Create">`,
      `      <NAME.LIST>${tag('NAME', party.name)}</NAME.LIST>`,
      `      ${tag('PARENT', parent)}`,
      `      ${tag('ISBILLWISEON', 'Yes')}`,
      party.address ? `      <ADDRESS.LIST TYPE="String">${tag('ADDRESS', party.address)}</ADDRESS.LIST>` : '',
      party.taxId ? `      ${tag(options.regime === 'gst_in' ? 'PARTYGSTIN' : 'VATTINNUMBER', party.taxId)}` : '',
      party.phone ? `      ${tag('LEDGERPHONE', party.phone)}` : '',
      party.email ? `      ${tag('EMAIL', party.email)}` : '',
      '     </LEDGER>',
    );
  }
  body.push('    </TALLYMESSAGE>');
  return envelope('All Masters', options.company, body.filter((line) => line !== ''));
}
