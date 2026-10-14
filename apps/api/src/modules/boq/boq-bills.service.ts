import { Injectable } from '@nestjs/common';
import {
  boqComputeBill,
  boqInvoiceSplit,
  boqQuantityProblems,
  isoDateToUtcDate,
  quantityToThousandths,
  taxRule,
  todayIn,
  type BoqBillFigures,
  type BoqBillLineInput,
  type BoqQuantityProblem,
  type CertifyBoqBillInput,
  type CreateBoqBillInput,
  type InvoiceBoqBillInput,
  type ReturnBoqBillInput,
  type UpdateBoqBillInput,
} from '@sitebook/shared';
import type { RequestUser } from '../../common/auth/request-user';
import { ApiError } from '../../common/errors/api-error';
import { TenantDb, type TenantTx } from '../../common/prisma/tenant-db.service';
import {
  BOQ_SETTLED,
  billableItems,
  boqById,
  boqForSite,
  decimal,
  loadBoq,
  settledQuantities,
  thousandths,
  usedQuantity,
  type BoqLedger,
  type BoqLedgerBill,
} from './boq-ledger';
import { billDetailView, billPeople, namesFor } from './boq-views';

const PROBLEM_TEXT: Record<BoqQuantityProblem['problem'], string> = {
  below_previous: 'is below what the client certified on the last bill',
  above_measured: 'is more than has been measured; record the measurement first',
  above_claimed: 'is more than was claimed',
};

/**
 * Running-account bills to the client against the BOQ (roadmap Phase 2, module 5):
 * draft → submitted to the client → certified by the client (perhaps for less) → invoiced.
 *
 * Invoicing is where this meets the existing client billing rather than duplicating it: the bill
 * becomes an instalment in the site's payment schedule, so the client sees it on the same screen as
 * every other amount they owe, receipts are recorded against it the same way, and "paid" is worked
 * out from those receipts exactly as it is for any instalment.
 *
 * One bill is open (draft or submitted) at a time: each bill's "previous" is the last certified one,
 * so two open bills would each claim the same increment.
 */
@Injectable()
export class BoqBillsService {
  constructor(private readonly tenantDb: TenantDb) {}

  async get(actor: RequestUser, billId: string) {
    return this.tenantDb.transaction(actor.tenantId, async (tx) => {
      const { ledger, bill } = await billFor(tx, actor, billId);
      return billDetailView(ledger, bill, await namesFor(tx, billPeople(bill)), actor.taxRegime);
    });
  }

  async create(actor: RequestUser, projectId: string, input: CreateBoqBillInput) {
    const billId = await this.tenantDb.transaction(actor.tenantId, async (tx) => {
      const ledger = await boqForSite(tx, actor, projectId);
      if (!ledger || billableItems(ledger).length === 0) {
        throw ApiError.conflict('This site has no BOQ items to bill against yet');
      }
      assertTaxRateSet(actor, ledger);
      const open = ledger.bills.find((bill) => !BOQ_SETTLED.has(bill.status));
      if (open) {
        throw ApiError.conflict(`RA-${open.number} is still ${open.status}. Finish that one first.`, { bill_id: open.id });
      }
      const { quantities: previous } = settledQuantities(ledger);
      const claimed = claimsFrom(ledger, input.lines, previous);

      const bill = await tx.boqBill.create({
        data: {
          tenantId: actor.tenantId,
          boqId: ledger.id,
          number: (ledger.bills.at(-1)?.number ?? 0) + 1,
          periodFrom: input.period_from ? isoDateToUtcDate(input.period_from) : null,
          periodTo: isoDateToUtcDate(input.period_to),
          billDate: isoDateToUtcDate(input.bill_date ?? todayIn(actor.timezone)),
          note: input.note ?? null,
          createdBy: actor.userId,
          taxRateBp: ledger.taxRateBp,
        },
        select: { id: true },
      });
      // Every item gets a row. One not mentioned is claimed at what is measured: the measurement
      // book is the claim unless somebody holds part of it back.
      await tx.boqBillLine.createMany({
        data: billableItems(ledger).map((item) => ({
          tenantId: actor.tenantId,
          billId: bill.id,
          itemId: item.id,
          claimedQuantity: decimal(claimed.get(item.id) ?? defaultClaim(ledger, item.id, previous)),
        })),
      });
      await refreshFigures(tx, ledger.id, bill.id);
      return bill.id;
    });
    return this.get(actor, billId);
  }

  async update(actor: RequestUser, billId: string, input: UpdateBoqBillInput) {
    await this.tenantDb.transaction(actor.tenantId, async (tx) => {
      const { ledger, bill } = await billFor(tx, actor, billId);
      if (bill.status !== 'draft') {
        throw ApiError.conflict(`RA-${bill.number} is ${bill.status}; only a draft can be edited`);
      }
      const periodFrom =
        input.period_from === undefined ? bill.periodFrom : input.period_from && isoDateToUtcDate(input.period_from);
      const periodTo = input.period_to ? isoDateToUtcDate(input.period_to) : bill.periodTo;
      if (periodFrom && periodFrom > periodTo) {
        throw ApiError.validationFailed({ period_to: input.period_to }, 'The period cannot end before it starts');
      }
      await tx.boqBill.update({
        where: { id: billId },
        data: {
          periodFrom,
          periodTo,
          ...(input.bill_date ? { billDate: isoDateToUtcDate(input.bill_date) } : {}),
          ...(input.note === undefined ? {} : { note: input.note }),
        },
      });
      if (input.lines) {
        const { quantities: previous } = settledQuantities(ledger, bill.number);
        for (const [itemId, quantity] of claimsFrom(ledger, input.lines, previous)) {
          await tx.boqBillLine.upsert({
            where: { billId_itemId: { billId, itemId } },
            create: { tenantId: actor.tenantId, billId, itemId, claimedQuantity: decimal(quantity) },
            update: { claimedQuantity: decimal(quantity) },
          });
        }
      }
      await refreshFigures(tx, ledger.id, billId);
    });
    return this.get(actor, billId);
  }

  async remove(actor: RequestUser, billId: string): Promise<void> {
    await this.tenantDb.transaction(actor.tenantId, async (tx) => {
      const { bill } = await billFor(tx, actor, billId);
      if (bill.status !== 'draft') {
        throw ApiError.conflict(`RA-${bill.number} is ${bill.status}; only a draft can be deleted`);
      }
      await tx.boqBill.delete({ where: { id: billId } });
    });
  }

  /** Sent to the client. What is claimed now is kept, so a certificate for less shows as less. */
  async submit(actor: RequestUser, billId: string) {
    await this.tenantDb.transaction(actor.tenantId, async (tx) => {
      const { ledger, bill } = await billFor(tx, actor, billId);
      if (bill.status !== 'draft') throw ApiError.conflict(`RA-${bill.number} is already ${bill.status}`);
      const figures = await refreshFigures(tx, ledger.id, billId);
      if (figures.gross <= 0n) throw ApiError.conflict('Nothing more is claimed on this bill than on the last one');
      await tx.boqBill.update({
        where: { id: billId },
        data: {
          status: 'submitted',
          claimedGross: figures.gross,
          submittedBy: actor.userId,
          submittedAt: new Date(),
          certificationNote: null,
        },
      });
    });
    return this.get(actor, billId);
  }

  /** The client sent it back, or it went out wrong: back to draft, with the reason. */
  async returnToDraft(actor: RequestUser, billId: string, input: ReturnBoqBillInput) {
    await this.tenantDb.transaction(actor.tenantId, async (tx) => {
      const { bill } = await billFor(tx, actor, billId);
      if (bill.status !== 'submitted') {
        throw ApiError.conflict(`RA-${bill.number} is ${bill.status}; only a submitted bill can be returned`);
      }
      await tx.boqBill.update({
        where: { id: billId },
        data: { status: 'draft', submittedBy: null, submittedAt: null, certificationNote: input.note },
      });
      await tx.auditLog.create({
        data: {
          tenantId: actor.tenantId,
          actorId: actor.userId,
          action: 'boq_bill.returned',
          entity: 'boq_bills',
          entityId: billId,
          before: { status: 'submitted' },
          after: { status: 'draft', note: input.note },
        },
      });
    });
    return this.get(actor, billId);
  }

  /**
   * Record the client's certificate: the quantities they agree were done — often less than claimed —
   * item by item. The figures freeze here; the bill now says what the client accepts it owes.
   */
  async certify(actor: RequestUser, billId: string, input: CertifyBoqBillInput) {
    await this.tenantDb.transaction(actor.tenantId, async (tx) => {
      const { ledger, bill } = await billFor(tx, actor, billId);
      if (bill.status !== 'submitted') {
        throw ApiError.conflict(
          bill.status === 'draft'
            ? `Submit RA-${bill.number} to the client before recording their certificate`
            : `RA-${bill.number} is already ${bill.status}`,
        );
      }
      const { quantities: previous } = settledQuantities(ledger, bill.number);
      const items = new Map(billableItems(ledger).map((item) => [item.id, item]));
      const rows = new Map(bill.lines.map((row) => [row.itemId, row]));
      const given = new Map<string, bigint>();
      for (const entry of input.lines) {
        if (!items.has(entry.item_id)) {
          throw ApiError.validationFailed({ item_id: entry.item_id }, 'That item is not in this BOQ');
        }
        given.set(entry.item_id, quantityToThousandths(entry.certified_quantity_to_date));
      }
      const checks: BoqBillLineInput[] = [...items.values()].map((item) => {
        const before = previous.get(item.id) ?? 0n;
        const row = rows.get(item.id);
        const claimed = row ? thousandths(row.claimedQuantity) : before;
        return {
          id: item.id,
          rate: item.rate ?? 0n,
          contractQuantity: thousandths(item.quantity),
          previousQuantity: before,
          quantityToDate: given.get(item.id) ?? claimed,
          claimedQuantity: claimed,
        };
      });
      assertQuantities(ledger, checks);
      for (const check of checks) {
        await tx.boqBillLine.upsert({
          where: { billId_itemId: { billId, itemId: check.id } },
          create: {
            tenantId: actor.tenantId,
            billId,
            itemId: check.id,
            claimedQuantity: decimal(check.claimedQuantity!),
            certifiedQuantity: decimal(check.quantityToDate),
          },
          update: { certifiedQuantity: decimal(check.quantityToDate) },
        });
      }
      const figures = await refreshFigures(tx, ledger.id, billId);
      if (figures.netPayable < 0n) {
        throw ApiError.conflict('What the client keeps back is more than this bill is worth', {
          net_payable: figures.netPayable.toString(),
        });
      }
      await tx.boqBill.update({
        where: { id: billId },
        data: {
          status: 'certified',
          certifiedBy: actor.userId,
          certifiedAt: new Date(),
          certificationNote: input.note ?? null,
        },
      });
      await tx.auditLog.create({
        data: {
          tenantId: actor.tenantId,
          actorId: actor.userId,
          action: 'boq_bill.certified',
          entity: 'boq_bills',
          entityId: billId,
          before: { status: 'submitted', claimed_gross: bill.claimedGross.toString() },
          after: {
            status: 'certified',
            gross: figures.gross.toString(),
            net_payable: figures.netPayable.toString(),
          },
        },
      });
    });
    return this.get(actor, billId);
  }

  /**
   * Raise the certified bill with the client: it becomes an instalment in the site's payment
   * schedule — the work less what the client keeps back, with the tax beside it — marked as asked
   * for today. From here it is the payment schedule's: receipts are recorded against it there.
   */
  async invoice(actor: RequestUser, billId: string, input: InvoiceBoqBillInput) {
    await this.tenantDb.transaction(actor.tenantId, async (tx) => {
      const { ledger, bill } = await billFor(tx, actor, billId);
      if (bill.status !== 'certified') {
        throw ApiError.conflict(
          bill.status === 'invoiced'
            ? `RA-${bill.number} has already been invoiced`
            : `RA-${bill.number} has to be certified by the client before it is invoiced`,
        );
      }
      const split = boqInvoiceSplit(bill);
      if (split.amount < 0n || split.amount + split.taxAmount <= 0n) {
        throw ApiError.conflict('There is nothing to invoice on this bill');
      }
      const last = await tx.paymentStage.aggregate({
        where: { projectId: ledger.projectId, deletedAt: null },
        _max: { sortOrder: true },
      });
      const stage = await tx.paymentStage.create({
        data: {
          tenantId: actor.tenantId,
          projectId: ledger.projectId,
          label: `${ledger.title} · RA-${bill.number} (to ${bill.periodTo.toISOString().slice(0, 10)})`,
          amount: split.amount,
          taxAmount: split.taxAmount,
          dueDate: input.due_date ? isoDateToUtcDate(input.due_date) : null,
          sortOrder: (last._max.sortOrder ?? -1) + 1,
          raisedAt: new Date(),
        },
        select: { id: true },
      });
      await tx.boqBill.update({
        where: { id: billId },
        data: { status: 'invoiced', invoicedBy: actor.userId, invoicedAt: new Date(), paymentStageId: stage.id },
      });
      await tx.auditLog.create({
        data: {
          tenantId: actor.tenantId,
          actorId: actor.userId,
          action: 'boq_bill.invoiced',
          entity: 'boq_bills',
          entityId: billId,
          before: { status: 'certified' },
          after: {
            status: 'invoiced',
            payment_stage_id: stage.id,
            amount: split.amount.toString(),
            tax_amount: split.taxAmount.toString(),
          },
        },
      });
    });
    return this.get(actor, billId);
  }
}

// --- free functions, all inside a tenant transaction ---------------------------------------------

async function billFor(tx: TenantTx, actor: RequestUser, billId: string) {
  const found = await tx.boqBill.findUnique({ where: { id: billId }, select: { boqId: true } });
  if (!found) throw ApiError.notFound('BOQ bill');
  const ledger = await boqById(tx, actor, found.boqId);
  return { ledger, bill: ledger.bills.find((bill) => bill.id === billId)! };
}

/**
 * India's GST on works contracts depends on the work and the client, so it is never guessed: a GST
 * company sets the rate on the BOQ before its first bill. (A regime with a standard rate — UAE VAT —
 * got it when the BOQ was made.)
 */
function assertTaxRateSet(actor: RequestUser, ledger: BoqLedger): void {
  const rule = taxRule(actor.taxRegime);
  if (rule.taxName && rule.standardRateBp === null && ledger.taxRateBp === 0) {
    throw ApiError.conflict(`Set the ${rule.taxName} rate in the BOQ's billing terms before billing the client`);
  }
}

/** Measured to date, but never below what the client already certified. */
function defaultClaim(ledger: BoqLedger, itemId: string, previous: ReadonlyMap<string, bigint>): bigint {
  const measured = ledger.measured.get(itemId) ?? 0n;
  const before = previous.get(itemId) ?? 0n;
  return measured > before ? measured : before;
}

function claimsFrom(
  ledger: BoqLedger,
  entries: ReadonlyArray<{ item_id: string; quantity_to_date: string }>,
  previous: ReadonlyMap<string, bigint>,
): Map<string, bigint> {
  const items = new Map(billableItems(ledger).map((item) => [item.id, item]));
  const claimed = new Map<string, bigint>();
  for (const entry of entries) {
    if (!items.has(entry.item_id)) {
      throw ApiError.validationFailed({ item_id: entry.item_id }, 'That item is not in this BOQ');
    }
    claimed.set(entry.item_id, quantityToThousandths(entry.quantity_to_date));
  }
  assertQuantities(
    ledger,
    [...claimed].map(([id, quantityToDate]) => {
      const item = items.get(id)!;
      return {
        id,
        rate: item.rate ?? 0n,
        contractQuantity: thousandths(item.quantity),
        previousQuantity: previous.get(id) ?? 0n,
        quantityToDate,
        measuredQuantity: ledger.measured.get(id) ?? 0n,
      };
    }),
  );
  return claimed;
}

function assertQuantities(ledger: BoqLedger, lines: readonly BoqBillLineInput[]): void {
  const { errors } = boqQuantityProblems(lines);
  if (errors.length === 0) return;
  const describe = (problem: BoqQuantityProblem) => {
    const item = ledger.items.find((row) => row.id === problem.itemId);
    return `${item?.itemNo ?? 'An item'} ${PROBLEM_TEXT[problem.problem]}`;
  };
  throw ApiError.validationFailed(
    { lines: errors.map((problem) => ({ item_id: problem.itemId, problem: problem.problem })) },
    describe(errors[0]!),
  );
}

/**
 * Work out an open bill's figures from what is stored now and write them on it. Reloads, because the
 * caller has usually just changed its lines. The tax rate follows the BOQ's terms until the client
 * certifies; after that the bill keeps the rate it was certified at.
 */
async function refreshFigures(tx: TenantTx, boqId: string, billId: string): Promise<BoqBillFigures> {
  const ledger = await loadBoq(tx, boqId);
  const bill: BoqLedgerBill = ledger.bills.find((row) => row.id === billId)!;
  const { quantities: previous, last } = settledQuantities(ledger, bill.number);
  const rows = new Map(bill.lines.map((row) => [row.itemId, row]));
  const figures = boqComputeBill({
    lines: billableItems(ledger).map((item) => {
      const before = previous.get(item.id) ?? 0n;
      const row = rows.get(item.id);
      return {
        id: item.id,
        rate: item.rate ?? 0n,
        contractQuantity: thousandths(item.quantity),
        previousQuantity: before,
        quantityToDate: row ? usedQuantity(row) : before,
      };
    }),
    previous: {
      retentionToDate: last?.retentionToDate ?? 0n,
      advanceRecoveredToDate: last?.advanceRecoveredToDate ?? 0n,
    },
    retentionBp: ledger.retentionBp,
    advanceRecoveryBp: ledger.advanceRecoveryBp,
    advanceAmount: ledger.advanceAmount,
    taxRateBp: ledger.taxRateBp,
  });
  await tx.boqBill.update({
    where: { id: billId },
    data: {
      grossToDate: figures.grossToDate,
      previousGross: figures.previousGross,
      gross: figures.gross,
      retentionToDate: figures.retentionToDate,
      retention: figures.retention,
      advanceRecoveredToDate: figures.advanceRecoveredToDate,
      advanceRecovery: figures.advanceRecovery,
      taxRateBp: ledger.taxRateBp,
      tax: figures.tax,
      netPayable: figures.netPayable,
    },
  });
  return figures;
}
