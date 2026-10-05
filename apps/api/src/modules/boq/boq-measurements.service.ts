import { Injectable } from '@nestjs/common';
import {
  boqMeasuredQuantity,
  boqProgress,
  isoDateToUtcDate,
  quantityToThousandths,
  thousandthsToQuantity,
  type BoqMeasurementInput,
} from '@sitebook/shared';
import { can, type RequestUser } from '../../common/auth/request-user';
import { ApiError } from '../../common/errors/api-error';
import { TenantDb } from '../../common/prisma/tenant-db.service';
import { boqItemById, decimal, settledQuantities, thousandths, type BoqLedger } from './boq-ledger';
import { namesFor } from './boq-views';

const MEASUREMENT_SELECT = {
  id: true,
  itemId: true,
  measuredOn: true,
  location: true,
  count: true,
  length: true,
  breadth: true,
  height: true,
  quantity: true,
  note: true,
  photoKeys: true,
  measuredBy: true,
  createdAt: true,
} as const;

type MeasurementRow = {
  id: string;
  itemId: string;
  measuredOn: Date;
  location: string | null;
  count: unknown;
  length: unknown;
  breadth: unknown;
  height: unknown;
  quantity: unknown;
  note: string | null;
  photoKeys: string[];
  measuredBy: string;
  createdAt: Date;
};

const dimension = (value: unknown) =>
  value === null || value === undefined ? null : thousandthsToQuantity(thousandths(value as { toString(): string }));

/**
 * The measurement book (roadmap Phase 2, module 5): what was measured on site against each BOQ item,
 * entry by entry — the evidence every claim to the client rests on. Quantities only; the rates are
 * not the measurer's to see.
 */
@Injectable()
export class BoqMeasurementsService {
  constructor(private readonly tenantDb: TenantDb) {}

  async list(actor: RequestUser, itemId: string) {
    return this.tenantDb.transaction(actor.tenantId, async (tx) => {
      const { ledger, item } = await boqItemById(tx, actor, itemId);
      const rows = await tx.boqMeasurement.findMany({
        where: { itemId },
        select: MEASUREMENT_SELECT,
        orderBy: [{ measuredOn: 'desc' }, { createdAt: 'desc' }],
      });
      const names = await namesFor(tx, rows.map((row) => row.measuredBy));
      return { item: itemSummary(ledger, item.id), items: rows.map((row) => measurementView(row, names)) };
    });
  }

  async create(actor: RequestUser, itemId: string, input: BoqMeasurementInput) {
    return this.tenantDb.transaction(actor.tenantId, async (tx) => {
      const { ledger, item } = await boqItemById(tx, actor, itemId);
      if (input.client_id) {
        const existing = await tx.boqMeasurement.findFirst({ where: { clientId: input.client_id }, select: MEASUREMENT_SELECT });
        if (existing) {
          const names = await namesFor(tx, [existing.measuredBy]);
          return { measurement: measurementView(existing, names), item: itemSummary(ledger, item.id) };
        }
      }
      if (item.kind !== 'item') {
        throw ApiError.validationFailed({ item_id: itemId }, 'A section is not measured; measure the items under it');
      }
      // A key from another company's storage would be a way to show somebody else's photograph here.
      const foreign = input.photo_keys.find((key) => !key.startsWith(`${actor.tenantId}/`));
      if (foreign) throw ApiError.validationFailed({ photo_keys: foreign }, 'That photo was not uploaded by this company');

      const dims = {
        count: input.count ? quantityToThousandths(input.count) : null,
        length: input.length ? quantityToThousandths(input.length) : null,
        breadth: input.breadth ? quantityToThousandths(input.breadth) : null,
        height: input.height ? quantityToThousandths(input.height) : null,
      };
      const quantity = boqMeasuredQuantity(dims, input.deduction);
      if (quantity === null || quantity === 0n) {
        throw ApiError.validationFailed({ count: input.count ?? null }, 'That measures to nothing');
      }
      // A deduction may not take the book below what has already been claimed from it.
      if (quantity < 0n) assertNotBelowBilled(ledger, itemId, (ledger.measured.get(itemId) ?? 0n) + quantity);

      const row = await tx.boqMeasurement.create({
        data: {
          tenantId: actor.tenantId,
          itemId,
          measuredOn: isoDateToUtcDate(input.measured_on),
          location: input.location ?? null,
          count: dims.count === null ? null : decimal(dims.count),
          length: dims.length === null ? null : decimal(dims.length),
          breadth: dims.breadth === null ? null : decimal(dims.breadth),
          height: dims.height === null ? null : decimal(dims.height),
          quantity: decimal(quantity),
          note: input.note ?? null,
          photoKeys: input.photo_keys,
          measuredBy: actor.userId,
          clientId: input.client_id ?? null,
        },
        select: MEASUREMENT_SELECT,
      });
      ledger.measured.set(itemId, (ledger.measured.get(itemId) ?? 0n) + quantity);
      const names = await namesFor(tx, [actor.userId]);
      return { measurement: measurementView(row, names), item: itemSummary(ledger, itemId) };
    });
  }

  /**
   * Remove an entry measured in error. Whoever recorded it may, and so may whoever manages the BOQ;
   * never so far that the book drops below what a bill has already claimed from it.
   */
  async remove(actor: RequestUser, measurementId: string): Promise<void> {
    await this.tenantDb.transaction(actor.tenantId, async (tx) => {
      const row = await tx.boqMeasurement.findUnique({
        where: { id: measurementId },
        select: { id: true, itemId: true, quantity: true, measuredBy: true },
      });
      if (!row) throw ApiError.notFound('Measurement');
      const { ledger } = await boqItemById(tx, actor, row.itemId);
      if (row.measuredBy !== actor.userId && !can(actor, 'boq.manage')) {
        throw ApiError.forbidden('Only whoever recorded a measurement, or somebody who manages the BOQ, can remove it');
      }
      assertNotBelowBilled(ledger, row.itemId, (ledger.measured.get(row.itemId) ?? 0n) - thousandths(row.quantity));
      await tx.boqMeasurement.delete({ where: { id: measurementId } });
    });
  }
}

/** The most any bill has taken from an item: certified to date, or claimed on the open bill. */
function billedFrom(ledger: BoqLedger, itemId: string): bigint {
  let most = settledQuantities(ledger).quantities.get(itemId) ?? 0n;
  for (const bill of ledger.bills) {
    if (bill.status !== 'draft' && bill.status !== 'submitted') continue;
    const line = bill.lines.find((row) => row.itemId === itemId);
    if (line && thousandths(line.claimedQuantity) > most) most = thousandths(line.claimedQuantity);
  }
  return most;
}

function assertNotBelowBilled(ledger: BoqLedger, itemId: string, after: bigint): void {
  const billed = billedFrom(ledger, itemId);
  if (after < billed) {
    throw ApiError.conflict(
      `That would leave ${thousandthsToQuantity(after)} measured, less than the ${thousandthsToQuantity(billed)} already billed`,
      { measured_after: thousandthsToQuantity(after), billed: thousandthsToQuantity(billed) },
    );
  }
}

/** An item's progress after a change, so a screen can update its bar without reloading the BOQ. */
function itemSummary(ledger: BoqLedger, itemId: string) {
  const item = ledger.items.find((row) => row.id === itemId)!;
  const contract = thousandths(item.quantity);
  const measured = ledger.measured.get(itemId) ?? 0n;
  const progress = boqProgress(contract, measured);
  return {
    id: item.id,
    item_no: item.itemNo,
    description: item.description,
    unit: item.unit,
    quantity: item.kind === 'item' ? thousandthsToQuantity(contract) : null,
    measured_quantity: thousandthsToQuantity(measured),
    percent_bp: progress.percentBp,
    over: progress.over,
    excess_quantity: thousandthsToQuantity(progress.excess),
  };
}

function measurementView(row: MeasurementRow, names: ReadonlyMap<string, string>) {
  return {
    id: row.id,
    item_id: row.itemId,
    measured_on: row.measuredOn.toISOString().slice(0, 10),
    location: row.location,
    count: dimension(row.count),
    length: dimension(row.length),
    breadth: dimension(row.breadth),
    height: dimension(row.height),
    quantity: dimension(row.quantity)!,
    deduction: thousandths(row.quantity as { toString(): string }) < 0n,
    note: row.note,
    photo_keys: row.photoKeys,
    measured_by: { id: row.measuredBy, name: names.get(row.measuredBy) ?? 'Former user' },
    created_at: row.createdAt.toISOString(),
  };
}
