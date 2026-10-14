import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  SUBCONTRACT_TRANSITIONS,
  isoDateToUtcDate,
  lineAmount,
  quantityToThousandths,
  taxRule,
  todayIn,
  type CreateSubcontractInput,
  type CreateVariationInput,
  type DecideVariationInput,
  type ListSubcontractsQuery,
  type ReleaseRetentionInput,
  type SubcontractLineInput,
  type SubcontractPaymentInput,
  type SubcontractStatus,
  type SubcontractStatusInput,
  type UpdateSubcontractInput,
  type UpdateSubcontractLineInput,
} from '@sitebook/shared';
import { can, type RequestUser } from '../../common/auth/request-user';
import { ProjectAccess } from '../../common/auth/project-access.service';
import { ApiError } from '../../common/errors/api-error';
import { TenantDb, type TenantTx } from '../../common/prisma/tenant-db.service';
import {
  LEDGER_INCLUDE,
  SETTLED,
  advancePaid,
  loadLedger,
  statementOf,
  type Ledger,
} from './subcontract-ledger';
import { detailView, summaryView, type Names } from './subcontract-views';

/** Terms that are the price of the contract. Fixed once it is let; changes go through variations. */
const COMMERCIAL_FIELDS = [
  'contractor_id',
  'retention_bp',
  'advance_amount',
  'advance_recovery_bp',
  'tax_rate_bp',
] as const;

/**
 * Subcontracts: the contract, its schedule of rates, variations, retention and the payments that are
 * not against a bill (roadmap Phase 2, module 3). RA bills are `RaBillsService`; how all of it reaches
 * the cost report is `SubcontractCostsService`.
 */
@Injectable()
export class SubcontractsService {
  constructor(
    private readonly tenantDb: TenantDb,
    private readonly access: ProjectAccess,
  ) {}

  // --- reading -----------------------------------------------------------------------------------

  async list(actor: RequestUser, query: ListSubcontractsQuery) {
    if (query.project_id) await this.access.assertAccess(actor, query.project_id);
    const rows = await this.tenantDb.clientFor(actor.tenantId).subcontract.findMany({
      where: {
        ...(query.project_id ? { projectId: query.project_id } : {}),
        ...(query.contractor_id ? { contractorId: query.contractor_id } : {}),
        ...(query.status ? { status: query.status } : {}),
        // Somebody who sees only their own sites gets only their own sites' subcontracts.
        ...(query.project_id ? {} : this.access.scopeFilterByProjectId(actor)),
        project: { deletedAt: null },
      },
      include: LEDGER_INCLUDE,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
    const showMoney = can(actor, 'subcontracts.view');
    return { items: rows.map((row) => summaryView(row, showMoney)) };
  }

  async get(actor: RequestUser, id: string) {
    return this.tenantDb.transaction(actor.tenantId, async (tx) => {
      const ledger = await this.ledgerFor(tx, actor, id);
      return detailView(ledger, await namesFor(tx, ledger), can(actor, 'subcontracts.view'));
    });
  }

  // --- the contract ------------------------------------------------------------------------------

  async create(actor: RequestUser, input: CreateSubcontractInput) {
    await this.access.assertAccess(actor, input.project_id);
    const id = await this.tenantDb.transaction(actor.tenantId, async (tx) => {
      await assertContractor(tx, input.contractor_id);
      const number = input.number ?? (await nextNumber(tx));
      await assertNumberFree(tx, number);
      const made = await tx.subcontract.create({
        data: {
          tenantId: actor.tenantId,
          projectId: input.project_id,
          contractorId: input.contractor_id,
          number,
          title: input.title,
          scope: input.scope ?? null,
          startDate: input.start_date ? isoDateToUtcDate(input.start_date) : null,
          endDate: input.end_date ? isoDateToUtcDate(input.end_date) : null,
          retentionBp: input.retention_bp ?? 0,
          retentionReleaseAtCompletionBp: input.retention_release_at_completion_bp ?? 5000,
          defectsLiabilityMonths: input.defects_liability_months ?? 12,
          advanceAmount: input.advance_amount ?? 0n,
          advanceRecoveryBp: input.advance_recovery_bp ?? 0,
          taxRateBp: input.tax_rate_bp ?? defaultTaxRate(actor.taxRegime),
          paymentTerms: input.payment_terms ?? null,
        },
        select: { id: true },
      });
      if (input.lines?.length) {
        await addLines(tx, actor.tenantId, made.id, input.project_id, input.lines, null);
      }
      return made.id;
    });
    return this.get(actor, id);
  }

  async update(actor: RequestUser, id: string, input: UpdateSubcontractInput) {
    await this.tenantDb.transaction(actor.tenantId, async (tx) => {
      const ledger = await this.ledgerFor(tx, actor, id);
      if (ledger.status === 'closed' || ledger.status === 'terminated') {
        throw ApiError.conflict(`This subcontract is ${ledger.status}; it can no longer change`);
      }
      const commercial = COMMERCIAL_FIELDS.filter((field) => input[field] !== undefined);
      if (commercial.length > 0 && ledger.status !== 'draft') {
        throw ApiError.conflict(
          'The price terms are fixed once a subcontract is let. Record a variation instead.',
          { fields: commercial },
        );
      }
      if (input.contractor_id) await assertContractor(tx, input.contractor_id);
      if (input.number && input.number !== ledger.number) await assertNumberFree(tx, input.number);

      const start = input.start_date === undefined ? ledger.startDate : input.start_date;
      const end = input.end_date === undefined ? ledger.endDate : input.end_date;
      if (start && end && toIso(start) > toIso(end)) {
        throw ApiError.validationFailed({ end_date: end }, 'The end date cannot be before the start');
      }

      await tx.subcontract.update({
        where: { id },
        data: {
          ...(input.contractor_id === undefined ? {} : { contractorId: input.contractor_id }),
          ...(input.number === undefined ? {} : { number: input.number }),
          ...(input.title === undefined ? {} : { title: input.title }),
          ...(input.scope === undefined ? {} : { scope: input.scope }),
          ...(input.start_date === undefined
            ? {}
            : { startDate: input.start_date ? isoDateToUtcDate(input.start_date) : null }),
          ...(input.end_date === undefined
            ? {}
            : { endDate: input.end_date ? isoDateToUtcDate(input.end_date) : null }),
          ...(input.retention_bp === undefined ? {} : { retentionBp: input.retention_bp }),
          ...(input.retention_release_at_completion_bp === undefined
            ? {}
            : { retentionReleaseAtCompletionBp: input.retention_release_at_completion_bp }),
          ...(input.defects_liability_months === undefined
            ? {}
            : { defectsLiabilityMonths: input.defects_liability_months }),
          ...(input.advance_amount === undefined ? {} : { advanceAmount: input.advance_amount }),
          ...(input.advance_recovery_bp === undefined
            ? {}
            : { advanceRecoveryBp: input.advance_recovery_bp }),
          ...(input.tax_rate_bp === undefined ? {} : { taxRateBp: input.tax_rate_bp }),
          ...(input.payment_terms === undefined ? {} : { paymentTerms: input.payment_terms }),
        },
      });
    });
    return this.get(actor, id);
  }

  /** Only a draft: a let subcontract has a history somebody will one day need. */
  async remove(actor: RequestUser, id: string): Promise<void> {
    await this.tenantDb.transaction(actor.tenantId, async (tx) => {
      const ledger = await this.ledgerFor(tx, actor, id);
      if (ledger.status !== 'draft') {
        throw ApiError.conflict('Only a draft subcontract can be deleted. Terminate this one instead.');
      }
      await tx.subcontract.delete({ where: { id } });
    });
  }

  /**
   * draft → active → completed → closed, or terminated from active or completed.
   *
   * Closing is the account settled: no bill waiting, nothing owed, no retention still held. A
   * contract closed with money outstanding is a statement that says "settled" and is not.
   */
  async setStatus(actor: RequestUser, id: string, input: SubcontractStatusInput) {
    await this.tenantDb.transaction(actor.tenantId, async (tx) => {
      const ledger = await this.ledgerFor(tx, actor, id);
      const from = ledger.status as SubcontractStatus;
      if (!SUBCONTRACT_TRANSITIONS[from].includes(input.status)) {
        throw ApiError.conflict(`A ${from} subcontract cannot be made ${input.status}`, {
          from,
          to: input.status,
        });
      }
      const open = ledger.bills.filter((bill) => !SETTLED.has(bill.status));
      if (input.status === 'active' && ledger.lines.length === 0) {
        throw ApiError.conflict('Add the schedule of rates before letting the subcontract');
      }
      if ((input.status === 'closed' || input.status === 'terminated') && open.length > 0) {
        throw ApiError.conflict(
          `RA-${open[0]!.number} is still ${open[0]!.status}. Certify or delete it first.`,
        );
      }
      if (input.status === 'closed') {
        const statement = statementOf(ledger);
        if (statement.retentionBalance > 0n || statement.balanceDue > 0n) {
          throw ApiError.conflict('Release and pay everything owed before closing the account', {
            retention_held: statement.retentionBalance.toString(),
            balance_due: statement.balanceDue.toString(),
          });
        }
      }
      await tx.subcontract.update({
        where: { id },
        data: {
          status: input.status,
          ...(input.status === 'completed'
            ? { completedOn: isoDateToUtcDate(input.completed_on ?? todayIn(actor.timezone)) }
            : {}),
        },
      });
      await tx.auditLog.create({
        data: {
          tenantId: actor.tenantId,
          actorId: actor.userId,
          action: `subcontract.${input.status}`,
          entity: 'subcontracts',
          entityId: id,
          before: { status: from },
          after: { status: input.status },
        },
      });
    });
    return this.get(actor, id);
  }

  // --- the schedule of rates ---------------------------------------------------------------------

  async addLine(actor: RequestUser, id: string, input: SubcontractLineInput) {
    await this.tenantDb.transaction(actor.tenantId, async (tx) => {
      const ledger = await this.draftFor(tx, actor, id);
      await addLines(tx, actor.tenantId, id, ledger.projectId, [input], null);
    });
    return this.get(actor, id);
  }

  async updateLine(actor: RequestUser, id: string, lineId: string, input: UpdateSubcontractLineInput) {
    await this.tenantDb.transaction(actor.tenantId, async (tx) => {
      const ledger = await this.draftFor(tx, actor, id);
      const line = ledger.lines.find((row) => row.id === lineId);
      if (!line) throw ApiError.notFound('Line');
      if (input.cost_code_id) await assertCostCode(tx, ledger.projectId, input.cost_code_id);
      const quantity =
        input.quantity === undefined
          ? quantityToThousandths(line.quantity.toString())
          : quantityToThousandths(input.quantity);
      const rate = input.rate ?? line.rate;
      await tx.subcontractLine.update({
        where: { id: lineId },
        data: {
          ...(input.cost_code_id === undefined ? {} : { costCodeId: input.cost_code_id }),
          ...(input.item_code === undefined ? {} : { itemCode: input.item_code }),
          ...(input.description === undefined ? {} : { description: input.description }),
          ...(input.unit === undefined ? {} : { unit: input.unit }),
          ...(input.quantity === undefined ? {} : { quantity: input.quantity }),
          rate,
          amount: lineAmount(quantity, rate),
        },
      });
    });
    return this.get(actor, id);
  }

  async removeLine(actor: RequestUser, id: string, lineId: string) {
    await this.tenantDb.transaction(actor.tenantId, async (tx) => {
      const ledger = await this.draftFor(tx, actor, id);
      if (!ledger.lines.some((row) => row.id === lineId)) throw ApiError.notFound('Line');
      await tx.subcontractLine.delete({ where: { id: lineId } });
    });
    return this.get(actor, id);
  }

  // --- variations --------------------------------------------------------------------------------

  /** More work on a running contract. Pending until somebody with `subcontracts.certify` decides. */
  async createVariation(actor: RequestUser, id: string, input: CreateVariationInput) {
    await this.tenantDb.transaction(actor.tenantId, async (tx) => {
      const ledger = await this.ledgerFor(tx, actor, id);
      if (ledger.status !== 'active') {
        throw ApiError.conflict(
          ledger.status === 'draft'
            ? 'A draft subcontract is changed directly; variations are for one that is let'
            : `This subcontract is ${ledger.status}; it takes no more variations`,
        );
      }
      const number = (ledger.variations.at(-1)?.number ?? 0) + 1;
      const variation = await tx.subcontractVariation.create({
        data: {
          tenantId: actor.tenantId,
          subcontractId: id,
          number,
          title: input.title,
          reason: input.reason ?? null,
          requestedBy: actor.userId,
        },
        select: { id: true },
      });
      await addLines(tx, actor.tenantId, id, ledger.projectId, input.lines, variation.id);
    });
    return this.get(actor, id);
  }

  async decideVariation(
    actor: RequestUser,
    id: string,
    variationId: string,
    input: DecideVariationInput,
  ) {
    await this.tenantDb.transaction(actor.tenantId, async (tx) => {
      const ledger = await this.ledgerFor(tx, actor, id);
      const variation = ledger.variations.find((row) => row.id === variationId);
      if (!variation) throw ApiError.notFound('Variation');
      if (variation.status !== 'pending') {
        throw ApiError.conflict(`Variation ${variation.number} was already ${variation.status}`);
      }
      if (ledger.status !== 'active' && input.status === 'approved') {
        throw ApiError.conflict(`This subcontract is ${ledger.status}; it takes no more work`);
      }
      await tx.subcontractVariation.update({
        where: { id: variationId },
        data: {
          status: input.status,
          decidedBy: actor.userId,
          decidedAt: new Date(),
          decisionNote: input.note ?? null,
        },
      });
      const value = ledger.lines
        .filter((line) => line.variationId === variationId)
        .reduce((sum, line) => sum + line.amount, 0n);
      await tx.auditLog.create({
        data: {
          tenantId: actor.tenantId,
          actorId: actor.userId,
          action: `subcontract_variation.${input.status}`,
          entity: 'subcontract_variations',
          entityId: variationId,
          before: { status: 'pending' },
          after: { status: input.status, value: value.toString() },
        },
      });
    });
    return this.get(actor, id);
  }

  // --- retention and payments --------------------------------------------------------------------

  /**
   * Hand back retention — at completion, after the defects period, or early by agreement. Never
   * more than is held; once released it is owed, and paid with a `retention` payment.
   */
  async releaseRetention(actor: RequestUser, id: string, input: ReleaseRetentionInput) {
    await this.tenantDb.transaction(actor.tenantId, async (tx) => {
      const ledger = await this.ledgerFor(tx, actor, id);
      if (ledger.status === 'draft' || ledger.status === 'closed') {
        throw ApiError.conflict(`This subcontract is ${ledger.status}`);
      }
      const held = statementOf(ledger).retentionBalance;
      if (input.amount > held) {
        throw ApiError.validationFailed(
          { amount: input.amount.toString(), held: held.toString() },
          'That is more retention than is held',
        );
      }
      const release = await tx.subcontractRetentionRelease.create({
        data: {
          tenantId: actor.tenantId,
          subcontractId: id,
          amount: input.amount,
          releasedOn: isoDateToUtcDate(input.released_on),
          note: input.note ?? null,
          approvedBy: actor.userId,
        },
        select: { id: true },
      });
      await tx.auditLog.create({
        data: {
          tenantId: actor.tenantId,
          actorId: actor.userId,
          action: 'subcontract_retention.released',
          entity: 'subcontract_retention_releases',
          entityId: release.id,
          after: { amount: input.amount.toString(), held_before: held.toString() },
        },
      });
    });
    return this.get(actor, id);
  }

  /** The advance, or retention that has been released. Bills are paid on the bill. */
  async recordPayment(actor: RequestUser, id: string, input: SubcontractPaymentInput) {
    await this.tenantDb.transaction(actor.tenantId, async (tx) => {
      const ledger = await this.ledgerFor(tx, actor, id);
      if (input.client_id && ledger.payments.some((row) => row.clientId === input.client_id)) {
        return;
      }
      if (ledger.status === 'draft') {
        throw ApiError.conflict('Let the subcontract before paying anything on it');
      }
      if (input.kind === 'advance') {
        const left = ledger.advanceAmount - advancePaid(ledger);
        if (input.amount > left) {
          throw ApiError.validationFailed(
            { amount: input.amount.toString(), advance_left: left.toString() },
            'That is more than the advance agreed',
          );
        }
      } else {
        const release = ledger.releases.find((row) => row.id === input.retention_release_id);
        if (!release) throw ApiError.notFound('Retention release');
        const paid = ledger.payments
          .filter((row) => row.retentionReleaseId === release.id)
          .reduce((sum, row) => sum + row.amount, 0n);
        if (input.amount > release.amount - paid) {
          throw ApiError.validationFailed(
            { amount: input.amount.toString(), owed: (release.amount - paid).toString() },
            'That is more than this release still owes',
          );
        }
      }
      await tx.subcontractPayment.create({
        data: {
          tenantId: actor.tenantId,
          subcontractId: id,
          kind: input.kind,
          retentionReleaseId: input.kind === 'retention' ? input.retention_release_id! : null,
          amount: input.amount,
          paidOn: isoDateToUtcDate(input.paid_on),
          mode: input.mode,
          reference: input.reference ?? null,
          note: input.note ?? null,
          recordedBy: actor.userId,
          clientId: input.client_id ?? null,
        },
      });
    });
    return this.get(actor, id);
  }

  // --- documents ---------------------------------------------------------------------------------

  /** Link a document already in the library — the signed contract, insurance, drawings. */
  async attachDocument(actor: RequestUser, id: string, documentId: string) {
    await this.tenantDb.transaction(actor.tenantId, async (tx) => {
      const ledger = await this.ledgerFor(tx, actor, id);
      const document = await tx.document.findFirst({
        where: { id: documentId, deletedAt: null },
        select: { projectId: true },
      });
      if (!document) throw ApiError.notFound('Document');
      // A company-wide document (no site) may be linked anywhere; another site's may not.
      if (document.projectId && document.projectId !== ledger.projectId) {
        throw ApiError.validationFailed(
          { document_id: documentId },
          'That document belongs to another site',
        );
      }
      await tx.subcontractDocument.upsert({
        where: { subcontractId_documentId: { subcontractId: id, documentId } },
        create: { tenantId: actor.tenantId, subcontractId: id, documentId },
        update: {},
      });
    });
    return this.get(actor, id);
  }

  async detachDocument(actor: RequestUser, id: string, documentId: string) {
    await this.tenantDb.transaction(actor.tenantId, async (tx) => {
      await this.ledgerFor(tx, actor, id);
      await tx.subcontractDocument.deleteMany({ where: { subcontractId: id, documentId } });
    });
    return this.get(actor, id);
  }

  // --- helpers -----------------------------------------------------------------------------------

  /** The subcontract, after checking the caller may see its site. */
  async ledgerFor(tx: TenantTx, actor: RequestUser, id: string): Promise<Ledger> {
    return ledgerFor(tx, actor, id);
  }

  private async draftFor(tx: TenantTx, actor: RequestUser, id: string): Promise<Ledger> {
    const ledger = await this.ledgerFor(tx, actor, id);
    if (ledger.status !== 'draft') {
      throw ApiError.conflict(
        'The schedule of rates is fixed once a subcontract is let. Record a variation instead.',
      );
    }
    return ledger;
  }
}

// --- free functions, all inside a tenant transaction ---------------------------------------------

/**
 * The subcontract, after checking the caller may see its site — `ProjectAccess.assertAccess`, done
 * inside the caller's transaction rather than on a second connection. A site that is archived, or
 * one the caller is not on, answers the same as a subcontract that does not exist.
 */
export async function ledgerFor(tx: TenantTx, actor: RequestUser, id: string): Promise<Ledger> {
  const ledger = await loadLedger(tx, id);
  if (ledger.project.deletedAt) throw ApiError.notFound('Subcontract');
  if (!actor.seesAllProjects && !actor.projectIds.includes(ledger.projectId)) {
    throw ApiError.projectNotAssigned(ledger.projectId);
  }
  return ledger;
}

/**
 * The regime's standard rate where it has one (5% VAT in the UAE), none where there is no tax. India's
 * GST on works contracts depends on the work and the client, so it is never guessed.
 */
function defaultTaxRate(regime: string): number {
  const rule = taxRule(regime);
  if (rule.standardRateBp !== null) return rule.standardRateBp;
  if (rule.taxName === null) return 0;
  throw ApiError.validationFailed(
    { tax_rate_bp: null },
    `Enter the ${rule.taxName} rate the subcontractor charges`,
  );
}

async function assertContractor(tx: TenantTx, id: string): Promise<void> {
  const found = await tx.contractor.findFirst({ where: { id, deletedAt: null }, select: { id: true } });
  if (!found) throw ApiError.notFound('Contractor');
}

export async function assertCostCode(tx: TenantTx, projectId: string, id: string): Promise<void> {
  const found = await tx.costCode.findFirst({ where: { id, projectId }, select: { id: true } });
  if (!found) {
    throw ApiError.validationFailed({ cost_code_id: id }, 'That cost code is not on this site');
  }
}

async function assertNumberFree(tx: TenantTx, number: string): Promise<void> {
  const taken = await tx.subcontract.findFirst({ where: { number }, select: { id: true } });
  if (taken) throw ApiError.conflict(`There is already a subcontract ${number}`, { number });
}

/** `SC-001`, `SC-002`, … — the next free one, skipping any typed by hand. */
async function nextNumber(tx: TenantTx): Promise<string> {
  const count = await tx.subcontract.count();
  for (let n = count + 1; ; n += 1) {
    const candidate = `SC-${String(n).padStart(3, '0')}`;
    const taken = await tx.subcontract.findFirst({ where: { number: candidate }, select: { id: true } });
    if (!taken) return candidate;
  }
}

async function addLines(
  tx: TenantTx,
  tenantId: string,
  subcontractId: string,
  projectId: string,
  lines: readonly SubcontractLineInput[],
  variationId: string | null,
): Promise<void> {
  const codes = [...new Set(lines.map((line) => line.cost_code_id).filter(Boolean))] as string[];
  for (const code of codes) await assertCostCode(tx, projectId, code);
  const last = await tx.subcontractLine.aggregate({
    where: { subcontractId },
    _max: { sortOrder: true },
  });
  let order = (last._max.sortOrder ?? 0) + 1;
  await tx.subcontractLine.createMany({
    data: lines.map((line) => ({
      tenantId,
      subcontractId,
      variationId,
      costCodeId: line.cost_code_id ?? null,
      sortOrder: order++,
      itemCode: line.item_code ?? null,
      description: line.description,
      unit: line.unit,
      quantity: new Prisma.Decimal(line.quantity),
      rate: line.rate,
      amount: lineAmount(quantityToThousandths(line.quantity), line.rate),
    })),
  });
}

/** Names for every person a subcontract mentions, in one query. */
export async function namesFor(tx: TenantTx, ledger: Ledger): Promise<Names> {
  const ids = new Set<string>();
  for (const variation of ledger.variations) {
    ids.add(variation.requestedBy);
    if (variation.decidedBy) ids.add(variation.decidedBy);
  }
  for (const bill of ledger.bills) {
    ids.add(bill.createdBy);
    if (bill.submittedBy) ids.add(bill.submittedBy);
    if (bill.certifiedBy) ids.add(bill.certifiedBy);
  }
  for (const release of ledger.releases) ids.add(release.approvedBy);
  for (const payment of ledger.payments) ids.add(payment.recordedBy);
  if (ids.size === 0) return new Map();
  const users = await tx.user.findMany({
    where: { id: { in: [...ids] } },
    select: { id: true, name: true },
  });
  return new Map(users.map((user) => [user.id, user.name]));
}

function toIso(value: Date | string): string {
  return typeof value === 'string' ? value : value.toISOString().slice(0, 10);
}
