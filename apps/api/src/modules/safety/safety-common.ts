import { Prisma } from '@prisma/client';
import {
  safetyInstantToLocal,
  safetyLocalToInstant,
  todayIn,
  utcDateToIsoDate,
  type SafetyPhotoPurpose,
} from '@sitebook/shared';
import type { RequestUser } from '../../common/auth/request-user';
import { ApiError } from '../../common/errors/api-error';
import type { TenantTx } from '../../common/prisma/tenant-db.service';

/**
 * Pieces every safety service shares: the company clock, people's names, photos, and numbering.
 */

/** A wall-clock time the person typed, read on the company's clock. */
export function companyInstant(actor: RequestUser, local: string): Date {
  try {
    return safetyLocalToInstant(local, actor.timezone);
  } catch {
    throw ApiError.validationFailed({ time: local }, 'That is not a date and time');
  }
}

/** The calendar day an instant falls on, on the company's clock, as a `date` column value. */
export function companyDay(actor: RequestUser, instant: Date): Date {
  return new Date(`${todayIn(actor.timezone, instant)}T00:00:00.000Z`);
}

/** Today on the company's clock, `YYYY-MM-DD`. */
export function companyToday(actor: RequestUser): string {
  return todayIn(actor.timezone);
}

/** An instant as the wall-clock time the company would read it, for a form to edit. */
export function companyLocal(actor: RequestUser, instant: Date): string {
  return safetyInstantToLocal(instant, actor.timezone);
}

export function isoDay(value: Date | null | undefined): string | null {
  return value ? utcDateToIsoDate(value) : null;
}

export type Names = Map<string, string>;

/** Display names for the user ids a set of rows mentions. A removed user still has a name. */
export async function namesFor(tx: TenantTx, ids: ReadonlyArray<string | null | undefined>): Promise<Names> {
  const wanted = [...new Set(ids.filter((id): id is string => Boolean(id)))];
  if (wanted.length === 0) return new Map();
  const users = await tx.user.findMany({ where: { id: { in: wanted } }, select: { id: true, name: true } });
  return new Map(users.map((user) => [user.id, user.name]));
}

export function person(names: Names, id: string | null | undefined): { id: string; name: string } | null {
  if (!id) return null;
  return { id, name: names.get(id) ?? 'Former member' };
}

/**
 * The next number in a per-company series.
 *
 * Max plus one inside the caller's transaction. Two reports filed in the same second can still pick
 * the same number; the unique index refuses the second, and `withNumberRetry` tries again.
 */
export async function nextSafetyNumber(
  tx: TenantTx,
  table: 'incident' | 'permit' | 'observation',
): Promise<number> {
  const max =
    table === 'incident'
      ? (await tx.safetyIncident.aggregate({ _max: { number: true } }))._max.number
      : table === 'permit'
        ? (await tx.safetyPermit.aggregate({ _max: { number: true } }))._max.number
        : (await tx.safetyObservation.aggregate({ _max: { number: true } }))._max.number;
  return (max ?? 0) + 1;
}

/** Runs `fn` again when it lost a race for a number. */
export async function withNumberRetry<T>(fn: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      const raced =
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002' &&
        JSON.stringify(error.meta ?? {}).includes('number');
      if (!raced || attempt >= 3) throw error;
    }
  }
}

/** A photo key must be one this company uploaded as safety evidence, not any key in the bucket. */
export function assertSafetyPhotoKey(actor: RequestUser, s3Key: string): void {
  if (!s3Key.startsWith(`${actor.tenantId}/safety_photo/`) || s3Key.includes('..')) {
    throw ApiError.forbidden('That photo does not belong to this account');
  }
}

export async function addPhotos(
  tx: TenantTx,
  actor: RequestUser,
  projectId: string,
  parent:
    | { incidentId: string }
    | { observationId: string }
    | { permitId: string }
    | { toolboxTalkId: string },
  keys: readonly string[],
  purpose: SafetyPhotoPurpose = 'evidence',
  caption?: string,
): Promise<void> {
  if (keys.length === 0) return;
  for (const key of keys) assertSafetyPhotoKey(actor, key);
  await tx.safetyPhoto.createMany({
    data: keys.map((s3Key) => ({
      tenantId: actor.tenantId,
      projectId,
      ...parent,
      purpose,
      s3Key,
      caption: caption ?? null,
      uploadedBy: actor.userId,
    })),
  });
}

export interface PhotoRow {
  id: string;
  purpose: string;
  s3Key: string;
  caption: string | null;
  uploadedBy: string;
  createdAt: Date;
}

export function photoView(row: PhotoRow, names: Names) {
  return {
    id: row.id,
    purpose: row.purpose,
    s3_key: row.s3Key,
    caption: row.caption,
    uploaded_by: person(names, row.uploadedBy),
    created_at: row.createdAt.toISOString(),
  };
}

export const PHOTO_SELECT = {
  id: true,
  purpose: true,
  s3Key: true,
  caption: true,
  uploadedBy: true,
  createdAt: true,
} as const;

export interface ActionRow {
  id: string;
  projectId: string;
  incidentId: string | null;
  observationId: string | null;
  kind: string;
  description: string;
  assigneeId: string | null;
  dueOn: Date | null;
  status: string;
  raisedOn: Date;
  raisedBy: string;
  doneBy: string | null;
  doneAt: Date | null;
  note: string | null;
  createdAt: Date;
}

export function actionView(row: ActionRow, names: Names, today: string) {
  const due = isoDay(row.dueOn);
  return {
    id: row.id,
    project_id: row.projectId,
    incident_id: row.incidentId,
    observation_id: row.observationId,
    kind: row.kind,
    description: row.description,
    assignee: person(names, row.assigneeId),
    due_on: due,
    overdue: row.status === 'open' && due !== null && due < today,
    status: row.status,
    raised_on: utcDateToIsoDate(row.raisedOn),
    raised_by: person(names, row.raisedBy),
    done_by: person(names, row.doneBy),
    done_at: row.doneAt?.toISOString() ?? null,
    note: row.note,
    created_at: row.createdAt.toISOString(),
  };
}

/** Quote a CSV cell, and defuse a leading formula character — a description is not code to run. */
export function csvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '';
  const text = String(value);
  const safe = typeof value === 'string' && /^[=+\-@]/.test(text) ? `'${text}` : text;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function csv(rows: ReadonlyArray<ReadonlyArray<string | number | null | undefined>>): string {
  return rows.map((row) => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
}
