import { describe, expect, it } from 'vitest';
import { accountingDefaultMap, accountingExternalId } from './accounting';
import { tallyAmount, tallyEscape, tallyMastersXml, tallyParentGroup, tallyVouchersXml } from './accounting-tally';
import { fixtureMasters, fixtureVouchers, minor, SITE } from './accounting.fixtures';

const vouchers = fixtureVouchers('tally');
const xml = tallyVouchersXml(vouchers, { digits: 2, currency: 'INR', company: 'Lakeview Builders & Sons' });

/** Each `<VOUCHER …>…</VOUCHER>` block. */
function voucherBlocks(text: string): string[] {
  return [...text.matchAll(/<VOUCHER [\s\S]*?<\/VOUCHER>/g)].map((match) => match[0]);
}

/** The ledger entries of a voucher block as [ledger, deemed positive, amount]. */
function entries(block: string): [string, string, string][] {
  return [...block.matchAll(/<ALLLEDGERENTRIES\.LIST>\s*<LEDGERNAME>(.*?)<\/LEDGERNAME>\s*<ISDEEMEDPOSITIVE>(Yes|No)<\/ISDEEMEDPOSITIVE>\s*<ISPARTYLEDGER>(?:Yes|No)<\/ISPARTYLEDGER>\s*<AMOUNT>(.*?)<\/AMOUNT>/g)].map(
    (match) => [match[1]!, match[2]!, match[3]!],
  );
}

describe('Tally XML vouchers', () => {
  it('wraps the vouchers in an Import Data envelope for the named company', () => {
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>\r\n<ENVELOPE>')).toBe(true);
    expect(xml).toContain('<TALLYREQUEST>Import Data</TALLYREQUEST>');
    expect(xml).toContain('<REPORTNAME>Vouchers</REPORTNAME>');
    expect(xml).toContain('<SVCURRENTCOMPANY>Lakeview Builders &amp; Sons</SVCURRENTCOMPANY>');
    expect(xml).toContain('<TALLYMESSAGE xmlns:UDF="TallyUDF">');
    expect(xml.trimEnd().endsWith('</ENVELOPE>')).toBe(true);
  });

  it('writes one voucher per transaction, typed as Tally types them, keyed by remote id', () => {
    const blocks = voucherBlocks(xml);
    expect(blocks).toHaveLength(vouchers.length);
    expect(blocks.map((block) => /VCHTYPE="(\w+)"/.exec(block)![1])).toEqual([
      'Purchase', // supplier invoice
      'Payment', // diesel from site cash
      'Journal', // wage period
      'Purchase', // RA bill
      'Sales', // BOQ bill
      'Receipt',
      'Payment', // wages paid
      'Payment', // subcontractor paid
    ]);
    const id = accountingExternalId('purchase_invoice', vouchers[0]!.sourceId);
    expect(blocks[0]).toContain(`REMOTEID="${id}"`);
    expect(blocks[0]).toContain(`<GUID>${id}</GUID>`);
    expect(blocks[0]).toContain('<DATE>20260405</DATE>');
    expect(blocks[0]).toContain('<REFERENCE>SMS/26/0042</REFERENCE>');
  });

  it('signs debits negative with ISDEEMEDPOSITIVE Yes, and every voucher sums to zero', () => {
    for (const block of voucherBlocks(xml)) {
      const lines = entries(block);
      expect(lines.length).toBeGreaterThan(1);
      for (const [, positive, amount] of lines) expect(positive === 'Yes').toBe(amount.startsWith('-'));
      expect(lines.reduce((sum, [, , amount]) => sum + minor(amount), 0n)).toBe(0n);
    }
    expect(entries(voucherBlocks(xml)[0]!)).toEqual([
      ['Sri Murugan Steels &amp; Co', 'No', '17050.00'],
      ['Purchase @18%', 'Yes', '-10000.00'],
      ['Purchase @5%', 'Yes', '-5000.00'],
      ['Input CGST', 'Yes', '-900.00'],
      ['Input SGST', 'Yes', '-900.00'],
      ['Input CGST', 'Yes', '-125.00'],
      ['Input SGST', 'Yes', '-125.00'],
    ]);
  });

  it('raises the bill against the party bill-by-bill, and allocates cost to the site', () => {
    const purchase = voucherBlocks(xml)[0]!;
    expect(purchase).toContain('<PARTYLEDGERNAME>Sri Murugan Steels &amp; Co</PARTYLEDGERNAME>');
    expect(purchase).toMatch(
      /<BILLALLOCATIONS\.LIST>\s*<NAME>SMS\/26\/0042<\/NAME>\s*<BILLTYPE>New Ref<\/BILLTYPE>\s*<AMOUNT>17050\.00<\/AMOUNT>/,
    );
    expect(purchase).toMatch(
      /<COSTCENTREALLOCATIONS\.LIST>\s*<NAME>Lakeview Towers<\/NAME>\s*<AMOUNT>-10000\.00<\/AMOUNT>/,
    );
    const payment = voucherBlocks(xml)[7]!;
    expect(payment).toMatch(/<NAME>SC-007\/RA-2<\/NAME>\s*<BILLTYPE>Agst Ref<\/BILLTYPE>/);
  });

  it('carries an RA bill’s retention, advance and back-charges as their own ledgers', () => {
    expect(entries(voucherBlocks(xml)[3]!)).toEqual([
      ['Ravi &quot;Mason&quot; Works', 'No', '101000.00'],
      ['Sub-contract Charges', 'Yes', '-100000.00'],
      ['Input CGST', 'Yes', '-9000.00'],
      ['Input SGST', 'Yes', '-9000.00'],
      ['Retention Money Payable', 'No', '5000.00'],
      ['Mobilisation Advance to Sub-contractors', 'No', '10000.00'],
      ['Recoveries from Sub-contractors', 'No', '2000.00'],
    ]);
  });

  it('escapes XML and writes anything outside ASCII as a character reference', () => {
    expect(xml).toContain('Diesel &lt;JCB&gt; &amp; &quot;urgent&quot;');
    expect(xml).toContain('Lakeview Residents&apos; Association');
    expect(tallyEscape('சிமெண்ட் ₹ 500')).toBe('&#xB9A;&#xBBF;&#xBAE;&#xBC6;&#xBA3;&#xBCD;&#xB9F;&#xBCD; &#x20B9; 500');
    expect(tallyEscape('bell\u0007')).toBe('bell ');
    // Nothing in the file is outside printable ASCII.
    const printable = (code: number) => code === 9 || code === 10 || code === 13 || (code >= 0x20 && code <= 0x7e);
    expect([...xml].every((char) => printable(char.charCodeAt(0)))).toBe(true);
  });

  it('flips the sign Tally’s way and keeps three decimals for a three-decimal currency', () => {
    expect(tallyAmount(125_050n, 2)).toBe('-1250.50');
    expect(tallyAmount(-1_250_500n, 3)).toBe('1250.500');
  });
});

describe('Tally XML masters', () => {
  const map = accountingDefaultMap('tally', 'gst_in');
  const masters = fixtureMasters('tally', vouchers);
  const text = tallyMastersXml(masters, { payablesGroup: 'Sundry Creditors', receivablesGroup: 'Sundry Debtors', regime: 'gst_in' });

  it('creates parties under the payables and receivables groups, bill-by-bill, with their GSTIN', () => {
    expect(text).toContain('<REPORTNAME>All Masters</REPORTNAME>');
    expect(text).toMatch(
      /<LEDGER NAME="Sri Murugan Steels &amp; Co" ACTION="Create">\s*<NAME\.LIST><NAME>Sri Murugan Steels &amp; Co<\/NAME><\/NAME\.LIST>\s*<PARENT>Sundry Creditors<\/PARENT>\s*<ISBILLWISEON>Yes<\/ISBILLWISEON>/,
    );
    expect(text).toContain('<PARTYGSTIN>33AAAAA0000A1Z5</PARTYGSTIN>');
    expect(text).toMatch(/<LEDGER NAME="Lakeview Residents&apos; Association"[\s\S]*?<PARENT>Sundry Debtors<\/PARENT>/);
  });

  it('creates mapped ledgers under the right groups, GST ledgers with their duty head', () => {
    expect(text).toMatch(/<LEDGER NAME="Input CGST"[\s\S]*?<PARENT>Duties &amp; Taxes<\/PARENT>[\s\S]*?<GSTDUTYHEAD>Central Tax<\/GSTDUTYHEAD>/);
    expect(text).toMatch(/<LEDGER NAME="Purchase @18%"[\s\S]*?<PARENT>Purchase Accounts<\/PARENT>\s*<ISCOSTCENTRESON>Yes<\/ISCOSTCENTRESON>/);
    expect(text).toMatch(/<LEDGER NAME="Petty Cash"[\s\S]*?<PARENT>Cash-in-Hand<\/PARENT>/);
    // Sundry Creditors is a group in Tally, not a ledger to create.
    expect(text).not.toContain('<LEDGER NAME="Sundry Creditors"');
    expect(text).toContain(`<COSTCENTRE NAME="${SITE.name}" ACTION="Create">`);
    expect(tallyParentGroup({ key: 'subcontract_cost', nature: 'expense' })).toBe('Direct Expenses');
    expect(map['expense:materials@1800']!.name).toBe('Purchase @18%');
  });
});
