import { Prisma } from '@prisma/client';
import {
  boqAbstract,
  quantityToThousandths,
  thousandthsToQuantity,
  type BoqAbstractFigures,
} from '@sitebook/shared';
import type { RequestUser } from '../../common/auth/request-user';
import { ApiError } from '../../common/errors/api-error';
import type { TenantTx } from '../../common/prisma/tenant-db.service';

/**
 * Everything one BOQ's figures are made from, loaded once and worked out in one place — so the tree,
 * the abstract, a bill and the export cannot each count it a slightly different way.
 */
export const BOQ_INCLUDE = {
  project: { select: { id: true, name: true, clientName: true, address: true, deletedAt: true } },
  items: {
    orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    include: { costCode: { select: { id: true, code: true, name: true } } },
  },
  bills: {
    orderBy: { number: 'asc' },
    include: {
      lines: true,
      paymentStage: {
        select: {
          id: true,
          label: true,
          amount: true,
          taxAmount: true,
          dueDate: true,
          raisedAt: true,
          deletedAt: true,
          receipts: { where: { deletedAt: null }, select: { amount: true } },
        },
      },
    },
  },
} satisfies Prisma.BoqInclude;

export type BoqLedger = Prisma.BoqGetPayload<{ include: typeof BOQ_INCLUDE }> & {
  /** Measured to date per item, thousandths — the measurement book summed. */
  measured: Map<string, bigint>;
};
export type BoqLedgerItem = BoqLedger['items'][number];
export type BoqLedgerBill = BoqLedger['bills'][number];

/** Bills whose figures the client has agreed: certified, and certified-then-invoiced. */
export const BOQ_SETTLED: ReadonlySet<string> = new Set(['certified', 'invoiced']);

export const thousandths = (value: { toString(): string } | null | undefined): bigint =>
  value === null || value === undefined ? 0n : quantityToThousandths(value.toString());

export const decimal = (value: bigint) => new Prisma.Decimal(thousandthsToQuantity(value));

/** The site, checked: in this company, not archived, and one the caller is assigned to. */
export async function assertSite(tx: TenantTx, actor: RequestUser, projectId: string) {
  const project = await tx.project.findFirst({
    where: { id: projectId, deletedAt: null },
    select: { id: true, name: true },
  });
  if (!project) throw ApiError.notFound('Project');
  if (!actor.seesAllProjects && !actor.projectIds.includes(projectId)) {
    throw ApiError.projectNotAssigned(projectId);
  }
  return project;
}

export async function loadBoq(tx: TenantTx, boqId: string): Promise<BoqLedger> {
  const row = await tx.boq.findUnique({ where: { id: boqId }, include: BOQ_INCLUDE });
  if (!row) throw ApiError.notFound('Bill of quantities');
  const sums = await tx.boqMeasurement.groupBy({
    by: ['itemId'],
    where: { item: { boqId } },
    _sum: { quantity: true },
  });
  return { ...row, measured: new Map(sums.map((sum) => [sum.itemId, thousandths(sum._sum.quantity)])) };
}

/** The site's BOQ, or null when nobody has started one. */
export async function boqForSite(tx: TenantTx, actor: RequestUser, projectId: string): Promise<BoqLedger | null> {
  await assertSite(tx, actor, projectId);
  const found = await tx.boq.findUnique({ where: { projectId }, select: { id: true } });
  return found ? loadBoq(tx, found.id) : null;
}

/** A BOQ by id, with the same site checks. */
export async function boqById(tx: TenantTx, actor: RequestUser, boqId: string): Promise<BoqLedger> {
  const ledger = await loadBoq(tx, boqId);
  if (ledger.project.deletedAt) throw ApiError.notFound('Bill of quantities');
  if (!actor.seesAllProjects && !actor.projectIds.includes(ledger.projectId)) {
    throw ApiError.projectNotAssigned(ledger.projectId);
  }
  return ledger;
}

/** An item and its BOQ, with the site checks. */
export async function boqItemById(tx: TenantTx, actor: RequestUser, itemId: string) {
  const found = await tx.boqItem.findUnique({ where: { id: itemId }, select: { boqId: true } });
  if (!found) throw ApiError.notFound('BOQ item');
  const ledger = await boqById(tx, actor, found.boqId);
  return { ledger, item: ledger.items.find((item) => item.id === itemId)! };
}

/** The priced items, in BOQ order. Sections carry no quantity and are never billed. */
export function billableItems(ledger: BoqLedger): BoqLedgerItem[] {
  return ledger.items.filter((item) => item.kind === 'item');
}

/** The quantity a bill line counts at: certified once it is, claimed until then. */
export function usedQuantity(row: { claimedQuantity: unknown; certifiedQuantity: unknown }): bigint {
  return thousandths((row.certifiedQuantity ?? row.claimedQuantity) as { toString(): string });
}

/**
 * Certified to date per item after every settled bill before `beforeNumber`, and the last such bill
 * — whose cumulative retention and advance figures the next bill continues from.
 */
export function settledQuantities(ledger: BoqLedger, beforeNumber = Infinity) {
  const quantities = new Map<string, bigint>();
  let last: BoqLedgerBill | null = null;
  for (const bill of ledger.bills) {
    if (bill.number >= beforeNumber || !BOQ_SETTLED.has(bill.status)) continue;
    for (const row of bill.lines) quantities.set(row.itemId, usedQuantity(row));
    last = bill;
  }
  return { quantities, last };
}

/** Depth of each item in the tree, for indenting. */
export function depths(ledger: BoqLedger): Map<string, number> {
  const parents = new Map(ledger.items.map((item) => [item.id, item.parentId]));
  const out = new Map<string, number>();
  for (const item of ledger.items) {
    let depth = 0;
    const seen = new Set<string>([item.id]);
    for (let up = parents.get(item.id) ?? null; up && !seen.has(up); up = parents.get(up) ?? null) {
      seen.add(up);
      depth += 1;
    }
    out.set(item.id, depth);
  }
  return out;
}

/**
 * The items in tree order — each section followed by everything under it — which is the order a
 * BOQ is read and printed in. `sortOrder` is import order, and a sheet can list a child before a
 * sibling's children; this puts them back where a reader expects them.
 */
export function treeOrder(ledger: BoqLedger): BoqLedgerItem[] {
  const children = new Map<string | null, BoqLedgerItem[]>();
  const ids = new Set(ledger.items.map((item) => item.id));
  for (const item of ledger.items) {
    const key = item.parentId && ids.has(item.parentId) ? item.parentId : null;
    children.set(key, [...(children.get(key) ?? []), item]);
  }
  const out: BoqLedgerItem[] = [];
  const seen = new Set<string>();
  const walk = (parent: string | null) => {
    for (const item of children.get(parent) ?? []) {
      if (seen.has(item.id)) continue;
      seen.add(item.id);
      out.push(item);
      walk(item.id);
    }
  };
  walk(null);
  return out;
}

/** Contract, measured and billed value per item and section, and the whole BOQ under `''`. */
export function abstractOf(ledger: BoqLedger): Map<string, BoqAbstractFigures> {
  const { quantities } = settledQuantities(ledger);
  return boqAbstract(
    ledger.items.map((item) => ({
      id: item.id,
      parentId: item.parentId,
      kind: item.kind,
      amount: item.amount ?? 0n,
      rate: item.rate ?? 0n,
      measuredQuantity: ledger.measured.get(item.id) ?? 0n,
      billedQuantity: quantities.get(item.id) ?? 0n,
    })),
  );
}

/** What the client has paid against an invoiced bill's instalment. */
export function paidOn(bill: BoqLedgerBill): bigint {
  return bill.paymentStage?.receipts.reduce((sum, receipt) => sum + receipt.amount, 0n) ?? 0n;
}

/**
 * Where an invoiced bill stands with the client, derived from the receipts against its instalment —
 * never stored, for the same reason the payment schedule stores no status.
 */
export function paymentStatus(bill: BoqLedgerBill): 'not_invoiced' | 'unpaid' | 'part_paid' | 'paid' {
  if (bill.status !== 'invoiced' || !bill.paymentStage) return 'not_invoiced';
  const due = bill.paymentStage.amount + bill.paymentStage.taxAmount;
  const paid = paidOn(bill);
  if (paid >= due) return 'paid';
  return paid > 0n ? 'part_paid' : 'unpaid';
}
