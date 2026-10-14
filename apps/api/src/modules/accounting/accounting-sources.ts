import {
  accountingExternalId,
  accountingPartyCode,
  addDays,
  isoDateToUtcDate,
  todayIn,
  utcDateToIsoDate,
  type AccountingCategory,
  type AccountingParty,
  type AccountingSite,
  type AccountingSource,
} from '@sitebook/shared';
import type { TenantTx } from '../../common/prisma/tenant-db.service';

/**
 * Reading SiteBook's records as accounting sources, inside one tenant transaction.
 *
 * What counts, and on which day — the rules an accountant would ask about:
 *
 *   Purchases   approved expenses, on the day spent; approved supplier invoices, on the invoice
 *               date. An approved supplier invoice also books expenses (one per cost code) so the
 *               cost report sees it — those expenses are left out here, or the bill would be in the
 *               books twice. A machine-hire expense is owed to its hire vendor, so it carries one.
 *   Payroll     finalised (or paid) wage periods, on the period's last day; bonuses and deductions,
 *               on the day recorded. Wage periods belong to the company, not a site, so they go
 *               only with an export of every site.
 *   Subcontract certified (or paid) running bills, on the bill date.
 *   Sales       instalments raised to the client — BOQ bills among them — on the day raised, in the
 *               company's time zone.
 *   Payments    wages and advances paid, client receipts, payments to subcontractors, on the day paid.
 *
 * Deleted rows are never read. Amounts stay bigint minor units throughout.
 */

export interface SourceScope {
  from: string;
  to: string;
  /**
   * Sites to read, or null for every site. Company-wide records — wage periods, labour payments not
   * tied to a site — go only with null: they cannot be split by a site filter.
   */
  projectIds: string[] | null;
  include: ReadonlySet<AccountingCategory>;
  timezone: string;
}

const site = (project: { id: string; name: string }): AccountingSite => ({ id: project.id, name: project.name });

export function vendorParty(vendor: {
  id: string;
  name: string;
  taxId: string | null;
  email?: string | null;
  phone?: string | null;
  address?: string | null;
}): AccountingParty {
  return {
    kind: 'vendor',
    code: accountingPartyCode('V', vendor.id),
    name: vendor.name,
    taxId: vendor.taxId,
    email: vendor.email ?? null,
    phone: vendor.phone ?? null,
    address: vendor.address ?? null,
  };
}

/** A subcontractor is a supplier in the books, coded apart from material vendors. */
export function contractorParty(contractor: {
  id: string;
  name: string;
  taxId: string | null;
  phone?: string | null;
  address?: string | null;
}): AccountingParty {
  return {
    kind: 'vendor',
    code: accountingPartyCode('S', contractor.id),
    name: contractor.name,
    taxId: contractor.taxId,
    phone: contractor.phone ?? null,
    address: contractor.address ?? null,
  };
}

/**
 * A site's client. Clients are a name on the site, not a row, so the same name on two sites is one
 * customer; a site with no client name is billed to "<site> (client)" rather than to nobody.
 */
export function customerParty(project: { name: string; clientName: string | null }): AccountingParty {
  const name = project.clientName?.trim() || `${project.name} (client)`;
  return { kind: 'customer', code: accountingPartyCode('C', name), name, taxId: null };
}

const iso = (date: Date) => utcDateToIsoDate(date);

export async function loadAccountingSources(tx: TenantTx, scope: SourceScope): Promise<AccountingSource[]> {
  const from = isoDateToUtcDate(scope.from);
  const to = isoDateToUtcDate(scope.to);
  const dateRange = { gte: from, lte: to };
  const projectWhere = scope.projectIds ? { in: scope.projectIds } : undefined;
  const sources: AccountingSource[] = [];
  const wants = (category: AccountingCategory) => scope.include.has(category);

  if (wants('purchases')) {
    const [expenses, invoices] = await Promise.all([
      tx.expense.findMany({
        where: {
          status: 'approved',
          deletedAt: null,
          spentOn: dateRange,
          ...(projectWhere ? { projectId: projectWhere } : {}),
          // Booked by an approved supplier invoice, which is exported as the bill itself.
          purchaseInvoiceLines: { none: {} },
        },
        select: {
          id: true,
          amount: true,
          taxAmount: true,
          category: true,
          spentOn: true,
          supplierTaxId: true,
          note: true,
          project: { select: { id: true, name: true } },
          costCode: { select: { code: true } },
          equipmentHireBookings: {
            select: { invoiceRef: true, vendor: { select: { id: true, name: true, taxId: true, email: true, phone: true, address: true } } },
            take: 1,
          },
        },
        orderBy: [{ spentOn: 'asc' }, { createdAt: 'asc' }],
      }),
      tx.purchaseInvoice.findMany({
        where: { status: 'approved', invoiceDate: dateRange, ...(projectWhere ? { projectId: projectWhere } : {}) },
        select: {
          id: true,
          invoiceNumber: true,
          invoiceDate: true,
          dueDate: true,
          project: { select: { id: true, name: true } },
          vendor: { select: { id: true, name: true, taxId: true, email: true, phone: true, address: true } },
          order: { select: { number: true } },
          lines: {
            select: {
              amount: true,
              taxAmount: true,
              orderLine: { select: { description: true, costCode: { select: { code: true } } } },
            },
          },
        },
        orderBy: [{ invoiceDate: 'asc' }, { createdAt: 'asc' }],
      }),
    ]);
    for (const invoice of invoices) {
      sources.push({
        type: 'purchase_invoice',
        id: invoice.id,
        date: iso(invoice.invoiceDate),
        dueDate: invoice.dueDate ? iso(invoice.dueDate) : null,
        number: invoice.invoiceNumber,
        orderNumber: invoice.order.number,
        site: site(invoice.project),
        vendor: vendorParty(invoice.vendor),
        lines: invoice.lines.map((line) => ({
          costCode: line.orderLine.costCode?.code ?? null,
          description: line.orderLine.description,
          amount: line.amount,
          tax: line.taxAmount,
        })),
      });
    }
    for (const expense of expenses) {
      const hire = expense.equipmentHireBookings[0];
      sources.push({
        type: 'expense',
        id: expense.id,
        date: iso(expense.spentOn),
        site: site(expense.project),
        category: expense.category,
        costCode: expense.costCode?.code ?? null,
        amount: expense.amount,
        tax: expense.taxAmount,
        supplierTaxId: expense.supplierTaxId,
        note: expense.note,
        vendor: hire ? vendorParty(hire.vendor) : null,
        reference: hire?.invoiceRef ?? null,
      });
    }
  }

  if (wants('payroll') && scope.projectIds === null) {
    const periods = await tx.wagePeriod.findMany({
      where: { status: { in: ['finalised', 'paid'] }, periodEnd: dateRange },
      select: {
        id: true,
        periodStart: true,
        periodEnd: true,
        contractor: { select: { name: true } },
        lines: { select: { grossAmount: true, advancesDeducted: true } },
      },
      orderBy: [{ periodEnd: 'asc' }, { createdAt: 'asc' }],
    });
    for (const period of periods) {
      sources.push({
        type: 'wage_period',
        id: period.id,
        periodStart: iso(period.periodStart),
        periodEnd: iso(period.periodEnd),
        contractorName: period.contractor?.name ?? null,
        gross: period.lines.reduce((sum, line) => sum + line.grossAmount, 0n),
        advances: period.lines.reduce((sum, line) => sum + line.advancesDeducted, 0n),
      });
    }
  }

  // Labour payments: bonuses and deductions are payroll, wages and advances paid are payments.
  const labourTypes = [
    ...(wants('payroll') ? (['bonus', 'deduction'] as const) : []),
    ...(wants('payments') ? (['wage', 'advance'] as const) : []),
  ];
  if (labourTypes.length > 0) {
    const payments = await tx.labourPayment.findMany({
      where: {
        type: { in: [...labourTypes] },
        deletedAt: null,
        paidOn: dateRange,
        // A payment with no site is the company's; it goes only with an export of every site, and a
        // site filter (`in`) leaves it out by itself.
        ...(projectWhere ? { projectId: projectWhere } : {}),
      },
      select: {
        id: true,
        type: true,
        amount: true,
        paidOn: true,
        mode: true,
        reference: true,
        project: { select: { id: true, name: true } },
        worker: { select: { name: true } },
        contractor: { select: { name: true } },
      },
      orderBy: [{ paidOn: 'asc' }, { createdAt: 'asc' }],
    });
    for (const payment of payments) {
      sources.push({
        type: 'labour_payment',
        id: payment.id,
        date: iso(payment.paidOn),
        site: payment.project ? site(payment.project) : null,
        kind: payment.type,
        amount: payment.amount,
        mode: payment.mode,
        payee: payment.worker?.name ?? payment.contractor?.name ?? 'Labour',
        reference: payment.reference,
      });
    }
  }

  if (wants('subcontract_bills')) {
    const bills = await tx.subcontractBill.findMany({
      where: {
        status: { in: ['certified', 'paid'] },
        billDate: dateRange,
        ...(projectWhere ? { subcontract: { projectId: projectWhere } } : {}),
      },
      select: {
        id: true,
        number: true,
        billDate: true,
        gross: true,
        taxRateBp: true,
        tax: true,
        retention: true,
        advanceRecovery: true,
        deductions: true,
        subcontract: {
          select: {
            number: true,
            project: { select: { id: true, name: true } },
            contractor: { select: { id: true, name: true, taxId: true, phone: true, address: true } },
          },
        },
      },
      orderBy: [{ billDate: 'asc' }, { createdAt: 'asc' }],
    });
    for (const bill of bills) {
      sources.push({
        type: 'subcontract_bill',
        id: bill.id,
        date: iso(bill.billDate),
        site: site(bill.subcontract.project),
        contractor: contractorParty(bill.subcontract.contractor),
        subcontractNumber: bill.subcontract.number,
        billNumber: bill.number,
        gross: bill.gross,
        taxRateBp: bill.taxRateBp,
        tax: bill.tax,
        retention: bill.retention,
        advanceRecovery: bill.advanceRecovery,
        deductions: bill.deductions,
      });
    }
  }

  if (wants('sales')) {
    // `raisedAt` is a moment; the day it counts on is the company's. A day either side is read and
    // trimmed below, which covers every zone from UTC−12 to UTC+14.
    const stages = await tx.paymentStage.findMany({
      where: {
        deletedAt: null,
        raisedAt: { gte: isoDateToUtcDate(addDays(scope.from, -1)), lt: isoDateToUtcDate(addDays(scope.to, 2)) },
        ...(projectWhere ? { projectId: projectWhere } : {}),
      },
      select: {
        id: true,
        label: true,
        amount: true,
        taxAmount: true,
        dueDate: true,
        raisedAt: true,
        project: { select: { id: true, name: true, clientName: true } },
        boqBill: { select: { retention: true, advanceRecovery: true, taxRateBp: true } },
      },
      orderBy: [{ raisedAt: 'asc' }, { createdAt: 'asc' }],
    });
    for (const stage of stages) {
      const raisedOn = todayIn(scope.timezone, stage.raisedAt!);
      if (raisedOn < scope.from || raisedOn > scope.to) continue;
      sources.push({
        type: 'payment_stage',
        id: stage.id,
        date: raisedOn,
        dueDate: stage.dueDate ? iso(stage.dueDate) : null,
        site: site(stage.project),
        customer: customerParty(stage.project),
        label: stage.label,
        amount: stage.amount,
        tax: stage.taxAmount,
        taxRateBp: stage.boqBill && stage.taxAmount > 0n ? stage.boqBill.taxRateBp : null,
        retention: stage.boqBill?.retention ?? 0n,
        advanceRecovery: stage.boqBill?.advanceRecovery ?? 0n,
      });
    }
  }

  if (wants('payments')) {
    const [receipts, subcontractPayments] = await Promise.all([
      tx.clientPayment.findMany({
        where: { deletedAt: null, receivedOn: dateRange, ...(projectWhere ? { projectId: projectWhere } : {}) },
        select: {
          id: true,
          amount: true,
          receivedOn: true,
          mode: true,
          reference: true,
          stageId: true,
          project: { select: { id: true, name: true, clientName: true } },
        },
        orderBy: [{ receivedOn: 'asc' }, { createdAt: 'asc' }],
      }),
      tx.subcontractPayment.findMany({
        where: { paidOn: dateRange, ...(projectWhere ? { subcontract: { projectId: projectWhere } } : {}) },
        select: {
          id: true,
          kind: true,
          amount: true,
          paidOn: true,
          mode: true,
          reference: true,
          bill: { select: { number: true } },
          subcontract: {
            select: {
              number: true,
              project: { select: { id: true, name: true } },
              contractor: { select: { id: true, name: true, taxId: true, phone: true, address: true } },
            },
          },
        },
        orderBy: [{ paidOn: 'asc' }, { createdAt: 'asc' }],
      }),
    ]);
    for (const receipt of receipts) {
      sources.push({
        type: 'client_payment',
        id: receipt.id,
        date: iso(receipt.receivedOn),
        site: site(receipt.project),
        customer: customerParty(receipt.project),
        amount: receipt.amount,
        mode: receipt.mode,
        reference: receipt.reference,
        stageExternalId: receipt.stageId ? accountingExternalId('payment_stage', receipt.stageId) : null,
      });
    }
    for (const payment of subcontractPayments) {
      sources.push({
        type: 'subcontract_payment',
        id: payment.id,
        date: iso(payment.paidOn),
        site: site(payment.subcontract.project),
        contractor: contractorParty(payment.subcontract.contractor),
        kind: payment.kind,
        amount: payment.amount,
        mode: payment.mode,
        reference: payment.reference,
        billReference: payment.bill ? `${payment.subcontract.number}/RA-${payment.bill.number}` : null,
      });
    }
  }

  // Oldest first, as an accountant enters them; ties keep the order of the categories above.
  return sources
    .map((source, index) => ({ source, index }))
    .sort((a, b) => sourceDate(a.source).localeCompare(sourceDate(b.source)) || a.index - b.index)
    .map(({ source }) => source);
}

export function sourceDate(source: AccountingSource): string {
  return source.type === 'wage_period' ? source.periodEnd : source.date;
}
