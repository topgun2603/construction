import { Prisma } from '@prisma/client';
import { utcDateToIsoDate } from '@sitebook/shared';
import type { RequestUser } from '../../common/auth/request-user';
import { ApiError } from '../../common/errors/api-error';
import type { TenantTx } from '../../common/prisma/tenant-db.service';
import type { UploadsService } from '../uploads/uploads.service';

/**
 * Small pieces every QA/QC service needs: decimals and dates on the wire, checking an uploaded key
 * is this company's and of the right kind, signing photo URLs, and the per-company numbers
 * (QI-12, QT-5, SN-34).
 */

/** `Decimal(12,3)` as the string the client sent: `40`, `40.5`, `-3`. */
export function dec(value: Prisma.Decimal | null | undefined): string | null {
  return value === null || value === undefined ? null : value.toString();
}

export function isoOrNull(value: Date | null | undefined): string | null {
  return value ? utcDateToIsoDate(value) : null;
}

/** Upload kinds a photo may come from: quality's own, or one already taken for a daily report. */
export const PHOTO_KINDS = ['quality_photo', 'dpr_photo', 'site_media'] as const;
/** A lab report is usually a PDF; a photograph of the paper report is just as common. */
export const REPORT_KINDS = ['quality_report', 'document', 'quality_photo'] as const;
export const VOICE_KINDS = ['dpr_voice'] as const;

/**
 * Refuses a key that is not this company's, or not something uploaded as one of `kinds`.
 *
 * The tenant prefix is what authorises a key everywhere in this product (see `UploadsService`);
 * the kind is checked as well so a worker's passport scan can never be attached to a snag the
 * client is shown, just because somebody pasted its key.
 */
export function assertOwnKeys(
  actor: RequestUser,
  keys: readonly string[],
  kinds: readonly string[],
): void {
  for (const key of keys) {
    const ok =
      !key.includes('..') && kinds.some((kind) => key.startsWith(`${actor.tenantId}/${kind}/`));
    if (!ok) throw ApiError.forbidden('That file does not belong to this account');
  }
}

/** Signs read URLs for a response, null where a key cannot be signed. */
export async function signPhotos(
  uploads: UploadsService,
  actor: RequestUser,
  keys: readonly string[],
): Promise<Array<{ s3_key: string; url: string | null }>> {
  return Promise.all(
    keys.map(async (key) => ({ s3_key: key, url: await uploads.signedViewUrl(actor, key) })),
  );
}

type NumberedModel = 'qualityInspection' | 'qualityTest' | 'snag';

/** The next number in a company's sequence. Gaps are fine; a clash is retried by the caller. */
export async function nextNumber(tx: TenantTx, model: NumberedModel): Promise<number> {
  const delegate = tx[model] as unknown as {
    aggregate(args: { _max: { number: true } }): Promise<{ _max: { number: number | null } }>;
  };
  const last = await delegate.aggregate({ _max: { number: true } });
  return (last._max.number ?? 0) + 1;
}

/**
 * Runs `fn` again when two people took the same number at once.
 *
 * The number is `max + 1` inside the transaction, so two inspections started in the same instant
 * can both pick 13; the unique index turns the second into an error, and running it again picks
 * 14. Three tries is generous for a site team.
 */
export async function retryOnNumberClash<T>(fn: () => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      const clash =
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002' &&
        String((error.meta as { target?: unknown } | undefined)?.target ?? '').includes('number');
      if (!clash || attempt >= 3) throw error;
    }
  }
}

/** A cost code must be one of this site's own. */
export async function assertSiteCostCode(
  tx: TenantTx,
  projectId: string,
  costCodeId: string | null | undefined,
): Promise<void> {
  if (!costCodeId) return;
  const code = await tx.costCode.findFirst({
    where: { id: costCodeId, projectId },
    select: { id: true },
  });
  if (!code) throw ApiError.validationFailed({ cost_code_id: costCodeId }, 'That cost code is not on this site');
}

/** Somebody in this company who can still sign in. */
export async function assertActiveUser(
  tx: TenantTx,
  userId: string | null | undefined,
  field: string,
): Promise<void> {
  if (!userId) return;
  const user = await tx.user.findFirst({
    where: { id: userId, deletedAt: null, status: { not: 'disabled' } },
    select: { id: true },
  });
  if (!user) throw ApiError.validationFailed({ [field]: userId }, 'That person is not in this team');
}

export function costCodeView(
  code: { id: string; code: string; name: string } | null | undefined,
): { id: string; code: string; name: string } | null {
  return code ? { id: code.id, code: code.code, name: code.name } : null;
}

export function person(user: { id: string; name: string } | null | undefined) {
  return user ? { id: user.id, name: user.name } : null;
}
