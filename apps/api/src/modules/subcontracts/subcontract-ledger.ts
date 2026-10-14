import type { Prisma } from '@prisma/client';
import {
  lineAmount,
  quantityToThousandths,
  subcontractStatement,
  type SubcontractStatement,
} from '@sitebook/shared';
import { ApiError } from '../../common/errors/api-error';
import type { TenantTx } from '../../common/prisma/tenant-db.service';

/**
 * Everything one subcontract's figures are made from, loaded once and worked out in one place, so
 * the detail page, the RA bill, the statement, the commitment and the actual cost cannot each count
 * it a slightly different way.
 */
export const LEDGER_INCLUDE = {
  project: { select: { id: true, name: true, deletedAt: true } },
  contractor: {
    select: { id: true, name: true, phone: true, taxId: true, address: true, deletedAt: true },
  },
  lines: {
    orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    include: { costCode: { select: { id: true, code: true, name: true } } },
  },
  variations: { orderBy: { number: 'asc' } },
  bills: {
    orderBy: { number: 'asc' },
    include: {
      lines: true,
      deductionRows: {
        orderBy: { createdAt: 'asc' },
        include: { costCode: { select: { id: true, code: true, name: true } } },
      },
    },
  },
  releases: { orderBy: [{ releasedOn: 'asc' }, { createdAt: 'asc' }] },
  payments: { orderBy: [{ paidOn: 'asc' }, { createdAt: 'asc' }] },
  documents: {
    include: {
      document: {
        select: { id: true, title: true, category: true, version: true, deletedAt: true },
      },
    },
  },
} satisfies Prisma.SubcontractInclude;

export type Ledger = Prisma.SubcontractGetPayload<{ include: typeof LEDGER_INCLUDE }>;
export type LedgerLine = Ledger['lines'][number];
export type LedgerBill = Ledger['bills'][number];

/** Bills whose figures are settled: what the company has said it owes. */
export const SETTLED: ReadonlySet<string> = new Set(['certified', 'paid']);

export async function loadLedger(tx: TenantTx, id: string): Promise<Ledger> {
  const row = await tx.subcontract.findUnique({ where: { id }, include: LEDGER_INCLUDE });
  if (!row) throw ApiError.notFound('Subcontract');
  return row;
}

export const thousandths = (value: { toString(): string }): bigint =>
  quantityToThousandths(value.toString());

/**
 * Lines that are part of the contract: the original schedule, and lines of approved variations.
 * A pending variation's lines are a proposal — not billable, not committed.
 */
export function billableLines(ledger: Ledger): LedgerLine[] {
  const approved = new Set(
    ledger.variations.filter((variation) => variation.status === 'approved').map((v) => v.id),
  );
  return ledger.lines.filter((line) => !line.variationId || approved.has(line.variationId));
}

/** The quantity a bill line counts at: certified once it is, claimed until then. */
export function usedQuantity(row: { claimedQuantity: unknown; certifiedQuantity: unknown }): bigint {
  return thousandths((row.certifiedQuantity ?? row.claimedQuantity) as { toString(): string });
}

/**
 * Certified quantity to date per line after each settled bill, in bill order. A line a bill does
 * not mention keeps the quantity it had — a variation approved after a bill was drafted is simply
 * not on that bill.
 */
export function settledQuantities(ledger: Ledger, beforeNumber = Infinity) {
  const quantities = new Map<string, bigint>();
  let last: LedgerBill | null = null;
  for (const bill of ledger.bills) {
    if (bill.number >= beforeNumber || !SETTLED.has(bill.status)) continue;
    for (const row of bill.lines) quantities.set(row.lineId, usedQuantity(row));
    last = bill;
  }
  return { quantities, last };
}

export function paidAgainst(ledger: Ledger, billId: string): bigint {
  return ledger.payments
    .filter((payment) => payment.billId === billId)
    .reduce((sum, payment) => sum + payment.amount, 0n);
}

export function advancePaid(ledger: Ledger): bigint {
  return ledger.payments
    .filter((payment) => payment.kind === 'advance')
    .reduce((sum, payment) => sum + payment.amount, 0n);
}

export function contractValues(ledger: Ledger): { original: bigint; variations: bigint } {
  let original = 0n;
  let variations = 0n;
  for (const line of billableLines(ledger)) {
    if (line.variationId) variations += line.amount;
    else original += line.amount;
  }
  return { original, variations };
}

export function statementOf(ledger: Ledger): SubcontractStatement {
  const { original, variations } = contractValues(ledger);
  return subcontractStatement({
    originalValue: original,
    variationsValue: variations,
    bills: ledger.bills
      .filter((bill) => SETTLED.has(bill.status))
      .map((bill) => ({
        gross: bill.gross,
        tax: bill.tax,
        retention: bill.retention,
        advanceRecovery: bill.advanceRecovery,
        deductions: bill.deductions,
        netPayable: bill.netPayable,
        paid: paidAgainst(ledger, bill.id),
      })),
    advancePaid: advancePaid(ledger),
    retentionReleased: ledger.releases.reduce((sum, release) => sum + release.amount, 0n),
    retentionPaid: ledger.payments
      .filter((payment) => payment.kind === 'retention')
      .reduce((sum, payment) => sum + payment.amount, 0n),
  });
}

/** Certified value to date on each billable line: the contract value no longer merely promised. */
export function certifiedValueByLine(ledger: Ledger): Map<string, bigint> {
  const { quantities } = settledQuantities(ledger);
  const values = new Map<string, bigint>();
  for (const line of billableLines(ledger)) {
    values.set(line.id, lineAmount(quantities.get(line.id) ?? 0n, line.rate));
  }
  return values;
}

/** `{ statement fields }` as minor-unit strings, the way money crosses the wire. */
export function statementView(statement: SubcontractStatement): Record<keyof SubcontractStatement, string> {
  return Object.fromEntries(
    Object.entries(statement).map(([key, value]) => [key, (value as bigint).toString()]),
  ) as Record<keyof SubcontractStatement, string>;
}
