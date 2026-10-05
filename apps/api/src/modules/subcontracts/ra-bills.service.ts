import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  computeRaBill,
  isoDateToUtcDate,
  permissionsForSystemRole,
  quantityToThousandths,
  raQuantityProblems,
  systemRoleSeesAllProjects,
  thousandthsToQuantity,
  todayIn,
  type CertifyRaBillInput,
  type CreateRaBillInput,
  type PayRaBillInput,
  type RaBillFigures,
  type RaDeductionInput,
  type RaQuantityProblem,
  type ReturnRaBillInput,
  type UpdateRaBillInput,
} from '@sitebook/shared';
import { can, type RequestUser } from '../../common/auth/request-user';
import { ApiError } from '../../common/errors/api-error';
import { TenantDb, type TenantTx } from '../../common/prisma/tenant-db.service';
import { NotificationsService } from '../notifications/notifications.service';
import {
  SETTLED,
  advancePaid,
  billableLines,
  loadLedger,
  paidAgainst,
  settledQuantities,
  thousandths,
  usedQuantity,
  type Ledger,
  type LedgerBill,
} from './subcontract-ledger';
import { assertCostCode, ledgerFor, namesFor } from './subcontracts.service';
import { billDetailView } from './subcontract-views';

/** Said once, for every refusal over quantities, so the editor can mark the lines. */
const PROBLEM_TEXT: Record<RaQuantityProblem['problem'], string> = {
  below_previous: 'is below what the last bill certified',
  above_contract: 'is more than the contract quantity; record a variation first',
  above_claimed: 'is more than was claimed',
};

/**
 * Running-account (RA) bills: a draft measured on site, submitted for certification, certified —
 * perhaps for less than was claimed — and paid (roadmap Phase 2, module 3).
 *
 * One bill at a time per subcontract is open (draft or submitted). Each bill's "previous" is the
 * last certified one, so two open bills would each claim the same increment.
 *
 * The bill's money columns are `computeRaBill`'s figures: recomputed on every change while open,
 * frozen at certification. Payments made after that never move a certified bill's figures.
 */
@Injectable()
export class RaBillsService {
  private readonly logger = new Logger(RaBillsService.name);

  constructor(
    private readonly tenantDb: TenantDb,
    private readonly notifications: NotificationsService,
  ) {}

  async get(actor: RequestUser, billId: string) {
    return this.tenantDb.transaction(actor.tenantId, async (tx) => {
      const { ledger, bill } = await this.billFor(tx, actor, billId);
      return billDetailView(ledger, bill, await namesFor(tx, ledger), can(actor, 'subcontracts.view'));
    });
  }

  async create(actor: RequestUser, subcontractId: string, input: CreateRaBillInput) {
    const billId = await this.tenantDb.transaction(actor.tenantId, async (tx) => {
      const ledger = await ledgerFor(tx, actor, subcontractId);
      if (ledger.status !== 'active' && ledger.status !== 'completed') {
        throw ApiError.conflict(
          ledger.status === 'draft'
            ? 'Let the subcontract before billing against it'
            : `This subcontract is ${ledger.status}; it takes no more bills`,
        );
      }
      const open = ledger.bills.find((bill) => !SETTLED.has(bill.status));
      if (open) {
        throw ApiError.conflict(`RA-${open.number} is still ${open.status}. Finish that one first.`, {
          bill_id: open.id,
        });
      }
      const { quantities: previous } = settledQuantities(ledger);
      const claimed = claimsFrom(ledger, input.lines, previous);

      const bill = await tx.subcontractBill.create({
        data: {
          tenantId: actor.tenantId,
          subcontractId,
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
      // A row for every line the contract has now, so the bill states a quantity for each.
      await tx.subcontractBillLine.createMany({
        data: billableLines(ledger).map((line) => ({
          tenantId: actor.tenantId,
          billId: bill.id,
          lineId: line.id,
          claimedQuantity: decimal(claimed.get(line.id) ?? previous.get(line.id) ?? 0n),
        })),
      });
      await writeDeductions(tx, actor.tenantId, bill.id, ledger.projectId, input.deductions);
      await refreshFigures(tx, subcontractId, bill.id);
      return bill.id;
    });
    return this.get(actor, billId);
  }

  async update(actor: RequestUser, billId: string, input: UpdateRaBillInput) {
    await this.tenantDb.transaction(actor.tenantId, async (tx) => {
      const { ledger, bill } = await this.billFor(tx, actor, billId);
      if (bill.status !== 'draft') {
        throw ApiError.conflict(`RA-${bill.number} is ${bill.status}; only a draft can be edited`);
      }
      const periodFrom =
        input.period_from === undefined ? bill.periodFrom : input.period_from && isoDateToUtcDate(input.period_from);
      const periodTo = input.period_to ? isoDateToUtcDate(input.period_to) : bill.periodTo;
      if (periodFrom && periodFrom > periodTo) {
        throw ApiError.validationFailed({ period_to: input.period_to }, 'The period cannot end before it starts');
      }
      await tx.subcontractBill.update({
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
        const claimed = claimsFrom(ledger, input.lines, previous);
        for (const [lineId, quantity] of claimed) {
          await tx.subcontractBillLine.upsert({
            where: { billId_lineId: { billId, lineId } },
            create: { tenantId: actor.tenantId, billId, lineId, claimedQuantity: decimal(quantity) },
            update: { claimedQuantity: decimal(quantity) },
          });
        }
      }
      if (input.deductions) {
        await tx.subcontractDeduction.deleteMany({ where: { billId } });
        await writeDeductions(tx, actor.tenantId, billId, ledger.projectId, input.deductions);
      }
      await refreshFigures(tx, ledger.id, billId);
    });
    return this.get(actor, billId);
  }

  async remove(actor: RequestUser, billId: string): Promise<void> {
    await this.tenantDb.transaction(actor.tenantId, async (tx) => {
      const { bill } = await this.billFor(tx, actor, billId);
      if (bill.status !== 'draft') {
        throw ApiError.conflict(`RA-${bill.number} is ${bill.status}; only a draft can be deleted`);
      }
      await tx.subcontractBill.delete({ where: { id: billId } });
    });
  }

  /** Measured and ready: hand it to whoever certifies, and tell them. */
  async submit(actor: RequestUser, billId: string) {
    const notice = await this.tenantDb.transaction(actor.tenantId, async (tx) => {
      const { ledger, bill } = await this.billFor(tx, actor, billId);
      if (bill.status !== 'draft') {
        throw ApiError.conflict(`RA-${bill.number} is already ${bill.status}`);
      }
      const figures = await refreshFigures(tx, ledger.id, billId);
      if (figures.gross === 0n && figures.deductions === 0n) {
        throw ApiError.conflict('Nothing is claimed on this bill yet');
      }
      await tx.subcontractBill.update({
        where: { id: billId },
        data: { status: 'submitted', submittedBy: actor.userId, submittedAt: new Date() },
      });
      return {
        recipients: await certifiersOf(tx, ledger.projectId, actor.userId),
        projectId: ledger.projectId,
        subcontractId: ledger.id,
        title: `RA-${bill.number} from ${ledger.contractor.name} is waiting for certification`,
        body: `${ledger.number} · ${ledger.title} · ${ledger.project.name}`,
      };
    });

    // After the commit, and never the reason a submission fails: the bill is submitted either way,
    // and it is on the subcontract's page for anybody who looks.
    if (notice.recipients.length > 0) {
      await this.notifications
        .notify({
          tenantId: actor.tenantId,
          userIds: notice.recipients,
          projectId: notice.projectId,
          type: 'subcontract_bill_submitted',
          title: notice.title,
          body: notice.body,
          payload: { bill_id: billId, subcontract_id: notice.subcontractId, project_id: notice.projectId },
          exceptUserId: actor.userId,
        })
        .catch((error: unknown) =>
          this.logger.warn({ err: error, billId }, 'Could not send the certification notice'),
        );
    }
    return this.get(actor, billId);
  }

  /** Back to the site to re-measure, with the reason. */
  async returnToDraft(actor: RequestUser, billId: string, input: ReturnRaBillInput) {
    await this.tenantDb.transaction(actor.tenantId, async (tx) => {
      const { bill } = await this.billFor(tx, actor, billId);
      if (bill.status !== 'submitted') {
        throw ApiError.conflict(`RA-${bill.number} is ${bill.status}; only a submitted bill can be returned`);
      }
      await tx.subcontractBill.update({
        where: { id: billId },
        data: { status: 'draft', submittedBy: null, submittedAt: null, certificationNote: input.note },
      });
      await tx.auditLog.create({
        data: {
          tenantId: actor.tenantId,
          actorId: actor.userId,
          action: 'subcontract_bill.returned',
          entity: 'subcontract_bills',
          entityId: billId,
          before: { status: 'submitted' },
          after: { status: 'draft', note: input.note },
        },
      });
    });
    return this.get(actor, billId);
  }

  /**
   * Certify: the quantities the company agrees were done, which may be less than claimed, and the
   * back-charges it is making. The figures freeze here; what they say is owed becomes cost on the
   * site's lines and stops being merely committed.
   */
  async certify(actor: RequestUser, billId: string, input: CertifyRaBillInput) {
    await this.tenantDb.transaction(actor.tenantId, async (tx) => {
      const { ledger, bill } = await this.billFor(tx, actor, billId);
      if (bill.status !== 'submitted') {
        throw ApiError.conflict(
          bill.status === 'draft'
            ? `Submit RA-${bill.number} before certifying it`
            : `RA-${bill.number} is already ${bill.status}`,
        );
      }
      const { quantities: previous } = settledQuantities(ledger, bill.number);
      const rows = new Map(bill.lines.map((row) => [row.lineId, row]));
      const given = new Map<string, bigint>();
      const contract = new Map(billableLines(ledger).map((line) => [line.id, line]));
      for (const entry of input.lines) {
        if (!contract.has(entry.line_id)) {
          throw ApiError.validationFailed({ line_id: entry.line_id }, 'That line is not on this subcontract');
        }
        given.set(entry.line_id, quantityToThousandths(entry.certified_quantity_to_date));
      }

      const checks = [...contract.values()].map((line) => {
        const row = rows.get(line.id);
        const before = previous.get(line.id) ?? 0n;
        const claimed = row ? thousandths(row.claimedQuantity) : before;
        return {
          id: line.id,
          rate: line.rate,
          contractQuantity: thousandths(line.quantity),
          previousQuantity: before,
          quantityToDate: given.get(line.id) ?? claimed,
          claimedQuantity: claimed,
        };
      });
      assertQuantities(ledger, checks);

      for (const check of checks) {
        await tx.subcontractBillLine.upsert({
          where: { billId_lineId: { billId, lineId: check.id } },
          create: {
            tenantId: actor.tenantId,
            billId,
            lineId: check.id,
            claimedQuantity: decimal(check.claimedQuantity),
            certifiedQuantity: decimal(check.quantityToDate),
          },
          update: { certifiedQuantity: decimal(check.quantityToDate) },
        });
      }
      if (input.deductions) {
        await tx.subcontractDeduction.deleteMany({ where: { billId } });
        await writeDeductions(tx, actor.tenantId, billId, ledger.projectId, input.deductions);
      }
      const figures = await refreshFigures(tx, ledger.id, billId);
      if (figures.netPayable < 0n) {
        throw ApiError.conflict(
          'The back-charges are more than this bill is worth. Carry some to the next bill.',
          { net_payable: figures.netPayable.toString() },
        );
      }
      await tx.subcontractBill.update({
        where: { id: billId },
        data: {
          // Nothing to pay is as good as paid: a bill wholly taken by back-charges is settled.
          status: figures.netPayable === 0n ? 'paid' : 'certified',
          certifiedBy: actor.userId,
          certifiedAt: new Date(),
          certificationNote: input.note ?? null,
        },
      });
      await tx.auditLog.create({
        data: {
          tenantId: actor.tenantId,
          actorId: actor.userId,
          action: 'subcontract_bill.certified',
          entity: 'subcontract_bills',
          entityId: billId,
          before: { status: 'submitted', claimed: bill.gross.toString() },
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

  async pay(actor: RequestUser, billId: string, input: PayRaBillInput) {
    await this.tenantDb.transaction(actor.tenantId, async (tx) => {
      const { ledger, bill } = await this.billFor(tx, actor, billId);
      if (input.client_id && ledger.payments.some((row) => row.clientId === input.client_id)) return;
      if (bill.status !== 'certified') {
        throw ApiError.conflict(
          bill.status === 'paid'
            ? `RA-${bill.number} is already paid in full`
            : `RA-${bill.number} has to be certified before it is paid`,
        );
      }
      const owed = bill.netPayable - paidAgainst(ledger, billId);
      if (input.amount > owed) {
        throw ApiError.validationFailed(
          { amount: input.amount.toString(), owed: owed.toString() },
          'That is more than this bill still owes',
        );
      }
      await tx.subcontractPayment.create({
        data: {
          tenantId: actor.tenantId,
          subcontractId: ledger.id,
          kind: 'bill',
          billId,
          amount: input.amount,
          paidOn: isoDateToUtcDate(input.paid_on),
          mode: input.mode,
          reference: input.reference ?? null,
          note: input.note ?? null,
          recordedBy: actor.userId,
          clientId: input.client_id ?? null,
        },
      });
      if (input.amount === owed) {
        await tx.subcontractBill.update({ where: { id: billId }, data: { status: 'paid' } });
      }
    });
    return this.get(actor, billId);
  }

  private async billFor(
    tx: TenantTx,
    actor: RequestUser,
    billId: string,
  ): Promise<{ ledger: Ledger; bill: LedgerBill }> {
    const found = await tx.subcontractBill.findUnique({
      where: { id: billId },
      select: { subcontractId: true },
    });
    if (!found) throw ApiError.notFound('RA bill');
    const ledger = await ledgerFor(tx, actor, found.subcontractId);
    return { ledger, bill: ledger.bills.find((bill) => bill.id === billId)! };
  }
}

// --- free functions, all inside a tenant transaction ---------------------------------------------

const decimal = (thousandthsValue: bigint) => new Prisma.Decimal(thousandthsToQuantity(thousandthsValue));

/** Claimed quantities from the request, checked against the contract and the previous bill. */
function claimsFrom(
  ledger: Ledger,
  entries: ReadonlyArray<{ line_id: string; quantity_to_date: string }>,
  previous: ReadonlyMap<string, bigint>,
): Map<string, bigint> {
  const contract = new Map(billableLines(ledger).map((line) => [line.id, line]));
  const claimed = new Map<string, bigint>();
  for (const entry of entries) {
    if (!contract.has(entry.line_id)) {
      throw ApiError.validationFailed({ line_id: entry.line_id }, 'That line is not on this subcontract');
    }
    claimed.set(entry.line_id, quantityToThousandths(entry.quantity_to_date));
  }
  assertQuantities(
    ledger,
    [...claimed].map(([id, quantityToDate]) => {
      const line = contract.get(id)!;
      return {
        id,
        rate: line.rate,
        contractQuantity: thousandths(line.quantity),
        previousQuantity: previous.get(id) ?? 0n,
        quantityToDate,
      };
    }),
  );
  return claimed;
}

function assertQuantities(ledger: Ledger, lines: Parameters<typeof raQuantityProblems>[0]): void {
  const problems = raQuantityProblems(lines);
  if (problems.length === 0) return;
  const describe = (problem: RaQuantityProblem) => {
    const line = ledger.lines.find((row) => row.id === problem.lineId);
    return `${line?.itemCode ?? line?.description ?? 'A line'} ${PROBLEM_TEXT[problem.problem]}`;
  };
  throw ApiError.validationFailed(
    { lines: problems.map((problem) => ({ line_id: problem.lineId, problem: problem.problem })) },
    describe(problems[0]!),
  );
}

async function writeDeductions(
  tx: TenantTx,
  tenantId: string,
  billId: string,
  projectId: string,
  deductions: readonly RaDeductionInput[],
): Promise<void> {
  for (const deduction of deductions) {
    let costCodeId = deduction.cost_code_id ?? null;
    if (costCodeId) await assertCostCode(tx, projectId, costCodeId);
    if (deduction.expense_id) {
      const expense = await tx.expense.findFirst({
        where: { id: deduction.expense_id, projectId, deletedAt: null },
        select: { costCodeId: true },
      });
      if (!expense) {
        throw ApiError.validationFailed({ expense_id: deduction.expense_id }, 'That expense is not on this site');
      }
      // The recovery goes back to the line that bore the cost, unless somebody says otherwise.
      costCodeId ??= expense.costCodeId;
    }
    if (deduction.stock_movement_id) {
      const movement = await tx.stockMovement.findFirst({
        where: { id: deduction.stock_movement_id, projectId },
        select: { id: true },
      });
      if (!movement) {
        throw ApiError.validationFailed(
          { stock_movement_id: deduction.stock_movement_id },
          'That stock entry is not on this site',
        );
      }
    }
    await tx.subcontractDeduction.create({
      data: {
        tenantId,
        billId,
        kind: deduction.kind,
        description: deduction.description,
        amount: deduction.amount,
        costCodeId,
        expenseId: deduction.expense_id ?? null,
        stockMovementId: deduction.stock_movement_id ?? null,
      },
    });
  }
}

/**
 * Work out an open bill's figures from what is stored now and write them on it. Reloads, because the
 * caller has usually just changed its lines.
 */
async function refreshFigures(tx: TenantTx, subcontractId: string, billId: string): Promise<RaBillFigures> {
  const ledger = await loadLedger(tx, subcontractId);
  const bill = ledger.bills.find((row) => row.id === billId)!;
  const { quantities: previous, last } = settledQuantities(ledger, bill.number);
  const rows = new Map(bill.lines.map((row) => [row.lineId, row]));
  const figures = computeRaBill({
    lines: billableLines(ledger).map((line) => {
      const before = previous.get(line.id) ?? 0n;
      const row = rows.get(line.id);
      return {
        id: line.id,
        rate: line.rate,
        contractQuantity: thousandths(line.quantity),
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
    advancePaid: advancePaid(ledger),
    taxRateBp: ledger.taxRateBp,
    deductions: bill.deductionRows.reduce((sum, row) => sum + row.amount, 0n),
  });
  await tx.subcontractBill.update({
    where: { id: billId },
    data: {
      grossToDate: figures.grossToDate,
      previousGross: figures.previousGross,
      gross: figures.gross,
      retentionToDate: figures.retentionToDate,
      retention: figures.retention,
      advanceRecoveredToDate: figures.advanceRecoveredToDate,
      advanceRecovery: figures.advanceRecovery,
      deductions: figures.deductions,
      taxRateBp: ledger.taxRateBp,
      tax: figures.tax,
      netPayable: figures.netPayable,
    },
  });
  return figures;
}

/**
 * Everybody who could certify this bill: holds `subcontracts.certify` and can see the site. Worked
 * out from the role the same way a request is authorised — a built-in role from its preset in code,
 * a custom one from its row — so a custom "QS" role with the permission is told, and a project
 * manager on another site is not.
 */
async function certifiersOf(tx: TenantTx, projectId: string, exceptUserId: string): Promise<string[]> {
  const users = await tx.user.findMany({
    where: { status: 'active', deletedAt: null, id: { not: exceptUserId } },
    select: {
      id: true,
      role: true,
      roleRef: { select: { isSystem: true, baseRole: true, permissions: true, seesAllProjects: true } },
      projectMemberships: { where: { projectId }, select: { id: true } },
    },
  });
  return users
    .filter((user) => {
      const role = user.roleRef;
      const permissions: readonly string[] =
        !role || role.isSystem ? permissionsForSystemRole(role?.baseRole ?? user.role) : role.permissions;
      const seesAll =
        !role || role.isSystem ? systemRoleSeesAllProjects(role?.baseRole ?? user.role) : role.seesAllProjects;
      return (
        permissions.includes('subcontracts.certify') &&
        (seesAll || user.projectMemberships.length > 0)
      );
    })
    .map((user) => user.id);
}
