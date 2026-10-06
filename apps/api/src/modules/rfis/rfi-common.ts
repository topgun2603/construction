import { Prisma } from '@prisma/client';
import { RFI_DEFAULT_SETTINGS, todayIn, utcDateToIsoDate, type RfiFileInput } from '@sitebook/shared';
import type { RequestUser } from '../../common/auth/request-user';
import { ApiError } from '../../common/errors/api-error';
import type { TenantTx } from '../../common/prisma/tenant-db.service';
import { env } from '../../config/env';

/**
 * Pieces the RFI, submittal, link and reminder services share: the company defaults, people's
 * names, files, links and CSV.
 */

export interface RfiCompanySettings {
  rfi_due_days: number;
  submittal_review_days: number;
  reminder_days_before: number;
}

/** The company's defaults, or the product's when nobody has changed them (no row yet). */
export async function rfiSettingsFor(tx: TenantTx): Promise<RfiCompanySettings> {
  const row = await tx.rfiSettings.findFirst({
    select: { rfiDueDays: true, submittalReviewDays: true, reminderDaysBefore: true },
  });
  return {
    rfi_due_days: row?.rfiDueDays ?? RFI_DEFAULT_SETTINGS.rfiDueDays,
    submittal_review_days: row?.submittalReviewDays ?? RFI_DEFAULT_SETTINGS.submittalReviewDays,
    reminder_days_before: row?.reminderDaysBefore ?? RFI_DEFAULT_SETTINGS.reminderDaysBefore,
  };
}

/** Today on the company's clock, `YYYY-MM-DD`. Overdue is judged against this, never the server's. */
export function companyToday(actor: Pick<RequestUser, 'timezone'>): string {
  return todayIn(actor.timezone);
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

/** Runs `fn` again when it lost a race for a per-site number (the unique index refused it). */
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

/** A team member named on a record must be somebody in this company. */
export async function assertMember(tx: TenantTx, userId: string | null | undefined, field: string): Promise<void> {
  if (!userId) return;
  const user = await tx.user.findFirst({ where: { id: userId, deletedAt: null }, select: { id: true } });
  if (!user) throw ApiError.validationFailed({ [field]: userId }, 'That person is not in this company');
}

// --- files -----------------------------------------------------------------------------------------

/** Where an outside responder's uploads land: under the tenant and the one record their link names. */
export function externalUploadPrefix(tenantId: string, kind: 'rfi' | 'submittal', recordId: string): string {
  return `${tenantId}/rfi_external/${kind}/${recordId}/`;
}

export interface ResolvedFile {
  documentId: string | null;
  s3Key: string | null;
  contentType: string | null;
  filename: string | null;
}

/**
 * Checks each file a team member attached: a library document must exist, be live and belong to
 * this site (or to the company as a whole); an upload key must be in this company's storage. A key is
 * a string somebody could have made up, so knowing one is not enough to attach it.
 */
export async function resolveFiles(
  tx: TenantTx,
  actor: RequestUser,
  projectId: string,
  files: readonly RfiFileInput[] | undefined,
): Promise<ResolvedFile[]> {
  if (!files || files.length === 0) return [];
  const documentIds = files.map((file) => file.document_id).filter((id): id is string => Boolean(id));
  const documents = documentIds.length
    ? await tx.document.findMany({
        where: { id: { in: documentIds }, deletedAt: null },
        select: { id: true, projectId: true, contentType: true, title: true },
      })
    : [];
  const byId = new Map(documents.map((document) => [document.id, document]));
  return files.map((file) => {
    if (file.document_id) {
      const document = byId.get(file.document_id);
      if (!document) throw ApiError.notFound('Document');
      if (document.projectId && document.projectId !== projectId) {
        throw ApiError.validationFailed({ document_id: file.document_id }, 'That document belongs to another site');
      }
      return { documentId: document.id, s3Key: null, contentType: document.contentType, filename: null };
    }
    const key = file.s3_key!;
    if (!key.startsWith(`${actor.tenantId}/`) || key.includes('..')) {
      throw ApiError.forbidden('That file does not belong to this account');
    }
    return {
      documentId: null,
      s3Key: key,
      contentType: file.content_type ?? null,
      filename: file.filename ?? null,
    };
  });
}

/** Drawings an RFI is about: live documents on this site or company-wide. */
export async function assertDocuments(tx: TenantTx, projectId: string, ids: readonly string[]): Promise<string[]> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return [];
  const found = await tx.document.findMany({
    where: { id: { in: unique }, deletedAt: null, OR: [{ projectId }, { projectId: null }] },
    select: { id: true },
  });
  if (found.length !== unique.length) {
    throw ApiError.validationFailed({ document_ids: unique }, 'One of those drawings is not on this site');
  }
  return unique;
}

export interface FileRow {
  id: string;
  documentId: string | null;
  s3Key: string | null;
  contentType: string | null;
  filename: string | null;
  createdAt: Date;
  document?: { id: string; title: string; version: number; s3Key: string; contentType: string } | null;
}

export const FILE_SELECT = {
  id: true,
  documentId: true,
  s3Key: true,
  contentType: true,
  filename: true,
  createdAt: true,
  document: { select: { id: true, title: true, version: true, s3Key: true, contentType: true } },
} as const;

/** A file as the screens show it, with a short-lived URL signed by the caller's own signer. */
export async function fileView(row: FileRow, sign: (key: string) => Promise<string | null>) {
  const key = row.document?.s3Key ?? row.s3Key;
  return {
    id: row.id,
    document: row.document ? { id: row.document.id, title: row.document.title, version: row.document.version } : null,
    filename: row.document ? `${row.document.title} (v${row.document.version})` : (row.filename ?? 'Attachment'),
    content_type: row.document?.contentType ?? row.contentType,
    url: key ? await sign(key) : null,
    created_at: row.createdAt.toISOString(),
  };
}

// --- links -----------------------------------------------------------------------------------------

/**
 * The responder's page. `WEB_BASE_URL` unset returns the path alone, which the web turns into a full
 * link against wherever it is served from — the same rule as the worker's self-service link.
 */
export function responderLink(token: string): { url: string; path: string } {
  const base = env().WEB_BASE_URL?.replace(/\/$/, '') ?? '';
  const path = `/respond/${token}`;
  return { url: `${base}${path}`, path };
}

/** A stored phone as WhatsApp wants it (digits only), or null when it cannot be dialled. */
export function dialable(phone: string | null | undefined): string | null {
  const digits = (phone ?? '').replace(/\D/g, '');
  return digits.length >= 10 && digits.length <= 15 ? digits : null;
}

// --- CSV -------------------------------------------------------------------------------------------

/** Quote a CSV cell, and defuse a leading formula character — a subject is not code to run. */
export function csvCell(value: string | number | boolean | null | undefined): string {
  if (value === null || value === undefined) return '';
  const text = String(value);
  const safe = typeof value === 'string' && /^[=+\-@]/.test(text) ? `'${text}` : text;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function csv(rows: ReadonlyArray<ReadonlyArray<string | number | boolean | null | undefined>>): string {
  return rows.map((row) => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

/** Project managers on a site, for the notifications a site's RFIs and submittals send. */
export async function siteManagers(tx: TenantTx, projectId: string): Promise<string[]> {
  const users = await tx.user.findMany({
    where: {
      status: 'active',
      deletedAt: null,
      role: 'project_manager',
      projectMemberships: { some: { projectId } },
    },
    select: { id: true },
  });
  return users.map((user) => user.id);
}
