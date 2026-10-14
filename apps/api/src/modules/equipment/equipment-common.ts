import type { Prisma } from '@prisma/client';
import {
  equipmentLitresToHundredths,
  equipmentToTenths,
  isoDateToUtcDate,
  utcDateToIsoDate,
  type EquipmentChargeBasis,
  type EquipmentCostMachine,
  type EquipmentHireBasis,
  type EquipmentOwnership,
  type IsoDate,
} from '@sitebook/shared';
import { can, type RequestUser } from '../../common/auth/request-user';
import { ApiError } from '../../common/errors/api-error';
import type { TenantTx } from '../../common/prisma/tenant-db.service';

/**
 * Pieces every equipment service shares: units off the database, the allocation that says where a
 * machine was on a day, the money a person may or may not see, and CSV.
 */

type DecimalLike = { toString(): string } | null | undefined;

/** A `numeric(…,1)` column in tenths. */
export function tenthsOf(value: DecimalLike): number | null {
  if (value === null || value === undefined) return null;
  return equipmentToTenths(Number(value.toString()).toFixed(1));
}

/** A `numeric(…,2)` litres column in hundredths. */
export function hundredthsOf(value: DecimalLike): number {
  if (value === null || value === undefined) return 0;
  return equipmentLitresToHundredths(Number(value.toString()).toFixed(2));
}

/** One-decimal string for the wire: `"7.5"`, `"8.0"` → `"8"`. */
export function oneDecimalText(value: DecimalLike): string | null {
  if (value === null || value === undefined) return null;
  const fixed = Number(value.toString()).toFixed(1);
  return fixed.endsWith('.0') ? fixed.slice(0, -2) : fixed;
}

export function litresText(value: DecimalLike): string {
  if (value === null || value === undefined) return '0';
  return Number(Number(value.toString()).toFixed(2)).toString();
}

export function isoDay(value: Date | null | undefined): IsoDate | null {
  return value ? utcDateToIsoDate(value) : null;
}

/** Whether this person sees what machines cost. A supervisor who only logs hours does not. */
export function seesMoney(actor: RequestUser): boolean {
  return can(actor, 'equipment.view');
}

/** A money figure for the wire, or null for somebody who may not see it. */
export function money(actor: RequestUser, amount: bigint | null | undefined): string | null {
  if (!seesMoney(actor)) return null;
  return amount === null || amount === undefined ? null : amount.toString();
}

export const MACHINE_COST_SELECT = {
  id: true,
  code: true,
  ownership: true,
  hireBasis: true,
  hireRate: true,
  minHours: true,
  operatorIncluded: true,
  operatorRate: true,
  mobilisationCharge: true,
  chargeOutBasis: true,
  chargeOutRate: true,
} as const;

export function costMachine(row: Prisma.EquipmentGetPayload<{ select: typeof MACHINE_COST_SELECT }>): EquipmentCostMachine {
  return {
    id: row.id,
    code: row.code,
    ownership: row.ownership as EquipmentOwnership,
    hireBasis: (row.hireBasis as EquipmentHireBasis | null) ?? null,
    hireRate: row.hireRate,
    minHoursTenths: tenthsOf(row.minHours),
    operatorIncluded: row.operatorIncluded,
    operatorRatePerDay: row.operatorRate,
    mobilisation: row.mobilisationCharge,
    chargeOutBasis: (row.chargeOutBasis as EquipmentChargeBasis | null) ?? null,
    chargeOutRate: row.chargeOutRate,
  };
}

/** The allocation covering one day, if any. */
export async function allocationOn(tx: TenantTx, equipmentId: string, date: IsoDate) {
  const day = isoDateToUtcDate(date);
  return tx.equipmentAllocation.findFirst({
    where: {
      equipmentId,
      fromDate: { lte: day },
      OR: [{ toDate: null }, { toDate: { gte: day } }],
    },
    include: { project: { select: { id: true, name: true, deletedAt: true } } },
  });
}

/**
 * The site a record for this machine on this day belongs to. A machine is on one site at a time, so
 * the allocation decides; a site given that disagrees with it is refused rather than trusted, or
 * the cost would land on the wrong job.
 */
export async function siteFor(
  tx: TenantTx,
  equipmentId: string,
  date: IsoDate,
  given: string | undefined,
): Promise<{ projectId: string; costCodeId: string | null }> {
  const allocation = await allocationOn(tx, equipmentId, date);
  if (!allocation) {
    throw ApiError.validationFailed(
      { log_date: 'not on a site that day' },
      'This machine was not on any site that day. Allocate it to the site first.',
    );
  }
  if (given && given !== allocation.projectId) {
    throw ApiError.validationFailed(
      { project_id: 'machine was on another site' },
      `This machine was at ${allocation.project.name} that day, not on the site chosen.`,
    );
  }
  return { projectId: allocation.projectId, costCodeId: allocation.costCodeId };
}

/** A cost code must be one of this site's own. */
export async function costCodeOnSite(
  tx: TenantTx,
  projectId: string,
  costCodeId: string | null | undefined,
): Promise<string | null> {
  if (!costCodeId) return null;
  const code = await tx.costCode.findFirst({ where: { id: costCodeId, projectId }, select: { id: true } });
  if (!code) throw ApiError.validationFailed({ cost_code_id: 'not on this site' }, 'That cost code is not on this site');
  return code.id;
}

/** A photo key must be one this company uploaded for equipment, not any key in the bucket. */
export function assertEquipmentKey(actor: RequestUser, key: string | null | undefined): void {
  if (!key) return;
  const own =
    key.startsWith(`${actor.tenantId}/equipment_photo/`) || key.startsWith(`${actor.tenantId}/bill/`);
  if (!own || key.includes('..')) throw ApiError.forbidden('That file does not belong to this account');
}

export async function namesFor(tx: TenantTx, ids: ReadonlyArray<string | null | undefined>) {
  const wanted = [...new Set(ids.filter((id): id is string => Boolean(id)))];
  if (wanted.length === 0) return new Map<string, string>();
  const users = await tx.user.findMany({ where: { id: { in: wanted } }, select: { id: true, name: true } });
  return new Map(users.map((user) => [user.id, user.name]));
}

/** Quote a CSV cell, and defuse a leading formula character — a note is not code to run. */
function csvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '';
  const text = String(value);
  const safe = typeof value === 'string' && /^[=+\-@]/.test(text) ? `'${text}` : text;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function csv(rows: ReadonlyArray<ReadonlyArray<string | number | null | undefined>>): string {
  return rows.map((row) => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

/** Minor units as a plain decimal for a spreadsheet: 123450 → `1234.50`. */
export function csvMoney(amount: bigint, digits: number): string {
  const negative = amount < 0n;
  const abs = negative ? -amount : amount;
  const scale = 10n ** BigInt(digits);
  const text = digits > 0 ? `${abs / scale}.${(abs % scale).toString().padStart(digits, '0')}` : `${abs}`;
  return negative ? `-${text}` : text;
}
