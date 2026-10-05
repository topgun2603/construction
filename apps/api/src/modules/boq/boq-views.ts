import { boqProgress, lineAmount, taxRule, thousandthsToQuantity } from '@sitebook/shared';
import type { TenantTx } from '../../common/prisma/tenant-db.service';
import {
  abstractOf,
  billableItems,
  depths,
  paidOn,
  paymentStatus,
  settledQuantities,
  thousandths,
  treeOrder,
  usedQuantity,
  type BoqLedger,
  type BoqLedgerBill,
} from './boq-ledger';

/**
 * The wire shapes. Money is minor-unit strings and quantities decimal strings; every money field is
 * null for somebody who measures but cannot see what the job is priced at — the same rule as a
 * subcontract's rates.
 */

type Names = ReadonlyMap<string, string>;

const iso = (date: Date | null) => (date ? date.toISOString().slice(0, 10) : null);
const person = (names: Names, id: string | null) => (id ? { id, name: names.get(id) ?? 'Former user' } : null);

/** Display names for the bare user ids a BOQ stores. */
export async function namesFor(tx: TenantTx, ids: Iterable<string | null | undefined>): Promise<Map<string, string>> {
  const wanted = [...new Set([...ids].filter((id): id is string => Boolean(id)))];
  if (wanted.length === 0) return new Map();
  const users = await tx.user.findMany({ where: { id: { in: wanted } }, select: { id: true, name: true } });
  return new Map(users.map((user) => [user.id, user.name]));
}

export function emptyBoqView(project: { id: string; name: string }, taxRegime: string, showMoney: boolean) {
  return {
    id: null,
    project: { id: project.id, name: project.name },
    title: 'Bill of quantities',
    tax_name: taxRule(taxRegime).taxName,
    show_money: showMoney,
    terms: null,
    items: [],
    totals: null,
    bills: [],
    can_replace: true,
  };
}

export function boqView(ledger: BoqLedger, taxRegime: string, showMoney: boolean) {
  const money = (value: bigint | null | undefined) => (showMoney && value !== null && value !== undefined ? value.toString() : null);
  const abstract = abstractOf(ledger);
  const { quantities: billed } = settledQuantities(ledger);
  const depth = depths(ledger);
  const total = abstract.get('')!;

  const items = treeOrder(ledger).map((item) => {
    const figures = abstract.get(item.id)!;
    const isItem = item.kind === 'item';
    const contract = thousandths(item.quantity);
    const measured = ledger.measured.get(item.id) ?? 0n;
    const progress = isItem ? boqProgress(contract, measured) : null;
    return {
      id: item.id,
      parent_id: item.parentId,
      depth: depth.get(item.id) ?? 0,
      kind: item.kind,
      item_no: item.itemNo,
      description: item.description,
      unit: item.unit,
      quantity: isItem ? thousandthsToQuantity(contract) : null,
      rate: isItem ? money(item.rate) : null,
      /** An item's contract amount; a section's is the total of everything under it. */
      amount: money(figures.contract),
      cost_code: item.costCode,
      measured_quantity: isItem ? thousandthsToQuantity(measured) : null,
      billed_quantity: isItem ? thousandthsToQuantity(billed.get(item.id) ?? 0n) : null,
      measured_value: money(figures.measured),
      billed_value: money(figures.billed),
      balance: money(figures.balance),
      percent_bp: progress ? progress.percentBp : figures.percentBp,
      over: progress?.over ?? false,
      excess_quantity: progress ? thousandthsToQuantity(progress.excess) : null,
    };
  });

  return {
    id: ledger.id,
    project: { id: ledger.project.id, name: ledger.project.name },
    title: ledger.title,
    tax_name: taxRule(taxRegime).taxName,
    show_money: showMoney,
    terms: {
      retention_bp: ledger.retentionBp,
      advance_amount: money(ledger.advanceAmount),
      advance_recovery_bp: ledger.advanceRecoveryBp,
      tax_rate_bp: ledger.taxRateBp,
    },
    items,
    totals: showMoney
      ? {
          contract: total.contract.toString(),
          measured: total.measured.toString(),
          billed: total.billed.toString(),
          balance: total.balance.toString(),
          percent_bp: total.percentBp,
          items: billableItems(ledger).length,
          over_quantity: items.filter((item) => item.over).length,
        }
      : null,
    bills: showMoney ? ledger.bills.map((bill) => billSummary(bill)) : [],
    // A replacing import would orphan measurements and bills; it is offered only on a clean BOQ.
    can_replace: ledger.measured.size === 0 && ledger.bills.length === 0,
  };
}

export function billSummary(bill: BoqLedgerBill) {
  const paid = paidOn(bill);
  return {
    id: bill.id,
    number: bill.number,
    status: bill.status,
    payment_status: paymentStatus(bill),
    period_from: iso(bill.periodFrom),
    period_to: iso(bill.periodTo),
    bill_date: iso(bill.billDate),
    claimed_gross: bill.claimedGross.toString(),
    gross: bill.gross.toString(),
    tax: bill.tax.toString(),
    net_payable: bill.netPayable.toString(),
    paid: paid.toString(),
  };
}

/** One client bill, line by line, with everything the editor needs to work the totals out live. */
export function billDetailView(ledger: BoqLedger, bill: BoqLedgerBill, names: Names, taxRegime: string) {
  const { quantities: previous, last } = settledQuantities(ledger, bill.number);
  const rows = new Map(bill.lines.map((row) => [row.itemId, row]));
  const depth = depths(ledger);
  const order = treeOrder(ledger);
  const sectionOf = new Map(ledger.items.map((item) => [item.id, item]));

  const lines = order
    .filter((item) => item.kind === 'item')
    .map((item) => {
      const row = rows.get(item.id);
      const before = previous.get(item.id) ?? 0n;
      const rate = item.rate ?? 0n;
      const toDate = row ? usedQuantity(row) : before;
      const contract = thousandths(item.quantity);
      const parent = item.parentId ? sectionOf.get(item.parentId) : undefined;
      return {
        item_id: item.id,
        item_no: item.itemNo,
        description: item.description,
        section: parent ? `${parent.itemNo} ${parent.description}` : null,
        depth: depth.get(item.id) ?? 0,
        unit: item.unit,
        rate: rate.toString(),
        contract_quantity: thousandthsToQuantity(contract),
        measured_quantity: thousandthsToQuantity(ledger.measured.get(item.id) ?? 0n),
        previous_quantity: thousandthsToQuantity(before),
        claimed_quantity: thousandthsToQuantity(row ? thousandths(row.claimedQuantity) : before),
        certified_quantity: row?.certifiedQuantity ? thousandthsToQuantity(thousandths(row.certifiedQuantity)) : null,
        previous_value: lineAmount(before, rate).toString(),
        value_to_date: lineAmount(toDate, rate).toString(),
        this_bill: (lineAmount(toDate, rate) - lineAmount(before, rate)).toString(),
        over_contract: toDate > contract,
      };
    });

  const stage = bill.paymentStage;
  const paid = paidOn(bill);
  return {
    id: bill.id,
    number: bill.number,
    status: bill.status,
    payment_status: paymentStatus(bill),
    period_from: iso(bill.periodFrom),
    period_to: iso(bill.periodTo),
    bill_date: iso(bill.billDate),
    note: bill.note,
    certification_note: bill.certificationNote,
    boq: {
      id: ledger.id,
      title: ledger.title,
      retention_bp: ledger.retentionBp,
      advance_amount: ledger.advanceAmount.toString(),
      advance_recovery_bp: ledger.advanceRecoveryBp,
      tax_name: taxRule(taxRegime).taxName,
      project: {
        id: ledger.project.id,
        name: ledger.project.name,
        client_name: ledger.project.clientName,
        address: ledger.project.address,
      },
    },
    lines,
    /** The previous certified bill's cumulative figures, which this bill's increments start from. */
    previous: {
      retention_to_date: (last?.retentionToDate ?? 0n).toString(),
      advance_recovered_to_date: (last?.advanceRecoveredToDate ?? 0n).toString(),
    },
    figures: {
      claimed_gross: bill.claimedGross.toString(),
      gross_to_date: bill.grossToDate.toString(),
      previous_gross: bill.previousGross.toString(),
      gross: bill.gross.toString(),
      retention_to_date: bill.retentionToDate.toString(),
      retention: bill.retention.toString(),
      advance_recovered_to_date: bill.advanceRecoveredToDate.toString(),
      advance_recovery: bill.advanceRecovery.toString(),
      tax_rate_bp: bill.taxRateBp,
      tax: bill.tax.toString(),
      net_payable: bill.netPayable.toString(),
    },
    invoice: stage
      ? {
          payment_stage_id: stage.id,
          label: stage.label,
          amount: stage.amount.toString(),
          tax_amount: stage.taxAmount.toString(),
          due_date: iso(stage.dueDate),
          raised_at: stage.raisedAt?.toISOString() ?? null,
          paid: paid.toString(),
          outstanding: (stage.amount + stage.taxAmount > paid ? stage.amount + stage.taxAmount - paid : 0n).toString(),
        }
      : null,
    created_by: person(names, bill.createdBy),
    submitted_by: person(names, bill.submittedBy),
    submitted_at: bill.submittedAt?.toISOString() ?? null,
    certified_by: person(names, bill.certifiedBy),
    certified_at: bill.certifiedAt?.toISOString() ?? null,
    invoiced_by: person(names, bill.invoicedBy),
    invoiced_at: bill.invoicedAt?.toISOString() ?? null,
  };
}

export function billPeople(bill: BoqLedgerBill): Array<string | null> {
  return [bill.createdBy, bill.submittedBy, bill.certifiedBy, bill.invoicedBy];
}
