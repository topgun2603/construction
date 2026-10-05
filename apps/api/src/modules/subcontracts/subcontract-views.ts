import {
  lineAmount,
  retentionTranches,
  thousandthsToQuantity,
  utcDateToIsoDate,
  type SubcontractStatement,
} from '@sitebook/shared';
import {
  SETTLED,
  billableLines,
  paidAgainst,
  settledQuantities,
  statementOf,
  statementView,
  thousandths,
  type Ledger,
  type LedgerBill,
} from './subcontract-ledger';

/**
 * The API's shapes for subcontracts. Money is minor units as strings; quantities are decimal
 * strings. `null` money means the caller may measure work but not see what it is worth — a
 * supervisor holding `subcontracts.measure` without `subcontracts.view`.
 */

export type Names = ReadonlyMap<string, string>;
const person = (names: Names, id: string | null) =>
  id ? { id, name: names.get(id) ?? 'Former member' } : null;
const iso = (value: Date | null) => (value ? utcDateToIsoDate(value) : null);
const money = (show: boolean, value: bigint) => (show ? value.toString() : null);

export interface SubcontractSummaryView {
  id: string;
  number: string;
  title: string;
  status: string;
  project: { id: string; name: string };
  contractor: { id: string; name: string };
  start_date: string | null;
  end_date: string | null;
  current_value: string | null;
  certified: string | null;
  paid: string | null;
  balance_due: string | null;
  retention_held: string | null;
  /** A bill waiting on somebody: drafted, or submitted for certification. */
  open_bill: { id: string; number: number; status: string } | null;
}

export function summaryView(ledger: Ledger, showMoney: boolean): SubcontractSummaryView {
  const statement = statementOf(ledger);
  const open = ledger.bills.find((bill) => !SETTLED.has(bill.status)) ?? null;
  return {
    id: ledger.id,
    number: ledger.number,
    title: ledger.title,
    status: ledger.status,
    project: { id: ledger.project.id, name: ledger.project.name },
    contractor: { id: ledger.contractor.id, name: ledger.contractor.name },
    start_date: iso(ledger.startDate),
    end_date: iso(ledger.endDate),
    current_value: money(showMoney, statement.currentValue),
    certified: money(showMoney, statement.certifiedGross),
    paid: money(showMoney, statement.totalPaid),
    balance_due: money(showMoney, statement.balanceDue),
    retention_held: money(showMoney, statement.retentionBalance),
    open_bill: open ? { id: open.id, number: open.number, status: open.status } : null,
  };
}

function lineView(line: Ledger['lines'][number], showMoney: boolean, certifiedQuantity: bigint) {
  return {
    id: line.id,
    item_code: line.itemCode,
    description: line.description,
    unit: line.unit,
    quantity: thousandthsToQuantity(thousandths(line.quantity)),
    rate: money(showMoney, line.rate),
    amount: money(showMoney, line.amount),
    cost_code: line.costCode,
    variation_id: line.variationId,
    certified_quantity: thousandthsToQuantity(certifiedQuantity),
    certified_value: money(showMoney, lineAmount(certifiedQuantity, line.rate)),
  };
}

export function detailView(ledger: Ledger, names: Names, showMoney: boolean) {
  const { quantities } = settledQuantities(ledger);
  const statement: SubcontractStatement = statementOf(ledger);
  const contract = billableLines(ledger);
  const contractIds = new Set(contract.map((line) => line.id));
  const tranches = retentionTranches(statement.retentionHeld, ledger.retentionReleaseAtCompletionBp);
  const completedOn = iso(ledger.completedOn);

  return {
    ...summaryView(ledger, showMoney),
    scope: ledger.scope,
    completed_on: completedOn,
    contractor: {
      id: ledger.contractor.id,
      name: ledger.contractor.name,
      phone: ledger.contractor.phone,
      tax_id: ledger.contractor.taxId,
      address: ledger.contractor.address,
    },
    retention_bp: ledger.retentionBp,
    retention_release_at_completion_bp: ledger.retentionReleaseAtCompletionBp,
    defects_liability_months: ledger.defectsLiabilityMonths,
    /** When the defects period runs out and the rest of the retention falls due. */
    defects_liability_ends: completedOn ? addMonths(completedOn, ledger.defectsLiabilityMonths) : null,
    advance_amount: money(showMoney, ledger.advanceAmount),
    advance_recovery_bp: ledger.advanceRecoveryBp,
    tax_rate_bp: ledger.taxRateBp,
    payment_terms: ledger.paymentTerms,
    lines: contract.map((line) => lineView(line, showMoney, quantities.get(line.id) ?? 0n)),
    variations: ledger.variations.map((variation) => {
      const lines = ledger.lines.filter((line) => line.variationId === variation.id);
      return {
        id: variation.id,
        number: variation.number,
        title: variation.title,
        reason: variation.reason,
        status: variation.status,
        value: money(
          showMoney,
          lines.reduce((sum, line) => sum + line.amount, 0n),
        ),
        requested_by: person(names, variation.requestedBy),
        decided_by: person(names, variation.decidedBy),
        decided_at: variation.decidedAt?.toISOString() ?? null,
        decision_note: variation.decisionNote,
        created_at: variation.createdAt.toISOString(),
        lines: lines.map((line) =>
          lineView(line, showMoney, contractIds.has(line.id) ? (quantities.get(line.id) ?? 0n) : 0n),
        ),
      };
    }),
    bills: ledger.bills.map((bill) => billSummaryView(ledger, bill, names, showMoney)),
    retention_releases: showMoney
      ? ledger.releases.map((release) => {
          const paid = ledger.payments
            .filter((payment) => payment.retentionReleaseId === release.id)
            .reduce((sum, payment) => sum + payment.amount, 0n);
          return {
            id: release.id,
            amount: release.amount.toString(),
            released_on: utcDateToIsoDate(release.releasedOn),
            note: release.note,
            approved_by: person(names, release.approvedBy),
            paid: paid.toString(),
          };
        })
      : [],
    payments: showMoney ? ledger.payments.map((payment) => paymentView(ledger, payment, names)) : [],
    documents: ledger.documents
      .filter((link) => !link.document.deletedAt)
      .map((link) => ({
        id: link.document.id,
        title: link.document.title,
        category: link.document.category,
        version: link.document.version,
      })),
    statement: showMoney ? statementView(statement) : null,
    retention_tranches: showMoney
      ? {
          at_completion: tranches.atCompletion.toString(),
          after_defects: tranches.afterDefects.toString(),
        }
      : null,
  };
}

export function paymentView(ledger: Ledger, payment: Ledger['payments'][number], names: Names) {
  return {
    id: payment.id,
    kind: payment.kind,
    bill_id: payment.billId,
    bill_number: ledger.bills.find((bill) => bill.id === payment.billId)?.number ?? null,
    retention_release_id: payment.retentionReleaseId,
    amount: payment.amount.toString(),
    paid_on: utcDateToIsoDate(payment.paidOn),
    mode: payment.mode,
    reference: payment.reference,
    note: payment.note,
    recorded_by: person(names, payment.recordedBy),
  };
}

function figures(bill: LedgerBill, showMoney: boolean) {
  if (!showMoney) return null;
  return {
    gross_to_date: bill.grossToDate.toString(),
    previous_gross: bill.previousGross.toString(),
    gross: bill.gross.toString(),
    retention_to_date: bill.retentionToDate.toString(),
    retention: bill.retention.toString(),
    advance_recovered_to_date: bill.advanceRecoveredToDate.toString(),
    advance_recovery: bill.advanceRecovery.toString(),
    deductions: bill.deductions.toString(),
    tax_rate_bp: bill.taxRateBp,
    tax: bill.tax.toString(),
    net_payable: bill.netPayable.toString(),
  };
}

export function billSummaryView(ledger: Ledger, bill: LedgerBill, names: Names, showMoney: boolean) {
  const paid = paidAgainst(ledger, bill.id);
  return {
    id: bill.id,
    subcontract_id: ledger.id,
    number: bill.number,
    status: bill.status,
    period_from: iso(bill.periodFrom),
    period_to: utcDateToIsoDate(bill.periodTo),
    bill_date: utcDateToIsoDate(bill.billDate),
    note: bill.note,
    created_by: person(names, bill.createdBy),
    submitted_by: person(names, bill.submittedBy),
    submitted_at: bill.submittedAt?.toISOString() ?? null,
    certified_by: person(names, bill.certifiedBy),
    certified_at: bill.certifiedAt?.toISOString() ?? null,
    certification_note: bill.certificationNote,
    figures: figures(bill, showMoney),
    paid: money(showMoney, paid),
    balance: money(showMoney, SETTLED.has(bill.status) ? bill.netPayable - paid : 0n),
  };
}

/** One bill with its lines, deductions and payments: the editor and the printed certificate. */
export function billDetailView(ledger: Ledger, bill: LedgerBill, names: Names, showMoney: boolean) {
  const { quantities: previous } = settledQuantities(ledger, bill.number);
  const rows = new Map(bill.lines.map((row) => [row.lineId, row]));
  const settled = SETTLED.has(bill.status);
  // A settled bill shows the lines it was certified on; an open one, every line it can claim.
  const lines = settled
    ? ledger.lines.filter((line) => rows.has(line.id))
    : billableLines(ledger);

  return {
    ...billSummaryView(ledger, bill, names, showMoney),
    subcontract: {
      id: ledger.id,
      number: ledger.number,
      title: ledger.title,
      status: ledger.status,
      retention_bp: ledger.retentionBp,
      advance_recovery_bp: ledger.advanceRecoveryBp,
      tax_rate_bp: ledger.taxRateBp,
      payment_terms: ledger.paymentTerms,
      project: { id: ledger.project.id, name: ledger.project.name },
      contractor: {
        id: ledger.contractor.id,
        name: ledger.contractor.name,
        phone: ledger.contractor.phone,
        tax_id: ledger.contractor.taxId,
        address: ledger.contractor.address,
      },
    },
    lines: lines.map((line) => {
      const row = rows.get(line.id);
      const before = previous.get(line.id) ?? 0n;
      const claimed = row ? thousandths(row.claimedQuantity) : before;
      const certified = row?.certifiedQuantity ? thousandths(row.certifiedQuantity) : null;
      const toDate = certified ?? claimed;
      return {
        line_id: line.id,
        item_code: line.itemCode,
        description: line.description,
        unit: line.unit,
        cost_code: line.costCode,
        variation_id: line.variationId,
        contract_quantity: thousandthsToQuantity(thousandths(line.quantity)),
        previous_quantity: thousandthsToQuantity(before),
        claimed_quantity: thousandthsToQuantity(claimed),
        certified_quantity: certified === null ? null : thousandthsToQuantity(certified),
        rate: money(showMoney, line.rate),
        previous_value: money(showMoney, lineAmount(before, line.rate)),
        value_to_date: money(showMoney, lineAmount(toDate, line.rate)),
        this_bill: money(showMoney, lineAmount(toDate, line.rate) - lineAmount(before, line.rate)),
      };
    }),
    deductions: bill.deductionRows.map((row) => ({
      id: row.id,
      kind: row.kind,
      description: row.description,
      amount: row.amount.toString(),
      cost_code: row.costCode,
      expense_id: row.expenseId,
      stock_movement_id: row.stockMovementId,
    })),
    payments: showMoney
      ? ledger.payments
          .filter((payment) => payment.billId === bill.id)
          .map((payment) => paymentView(ledger, payment, names))
      : [],
  };
}

/** `2026-03-31` + 12 months → `2027-03-31`; a day that does not exist clamps to the month's last. */
function addMonths(isoDate: string, months: number): string {
  const [year, month, day] = isoDate.split('-').map(Number) as [number, number, number];
  const target = new Date(Date.UTC(year, month - 1 + months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(day, lastDay));
  return utcDateToIsoDate(target);
}
