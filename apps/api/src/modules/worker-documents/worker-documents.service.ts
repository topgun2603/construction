import { Injectable, Logger } from '@nestjs/common';
import {
  addDays,
  DOCUMENT_EXPIRY_WARNING_DAYS,
  INDIA_LOCALE,
  isoDateToUtcDate,
  todayIn,
  utcDateToIsoDate,
  WORKER_DOCUMENT_LABELS,
  type CreateWorkerDocumentInput,
  type UpdateWorkerDocumentInput,
  type WorkerDocumentKind,
} from '@sitebook/shared';
import type { RequestUser } from '../../common/auth/request-user';
import { FieldCipher, hintOf } from '../../common/crypto/field-cipher';
import { ApiError } from '../../common/errors/api-error';
import { TenantDb, type TenantTx } from '../../common/prisma/tenant-db.service';
import { env } from '../../config/env';
import { NotificationsService } from '../notifications/notifications.service';
import { UploadsService } from '../uploads/uploads.service';

export interface WorkerDocumentView {
  id: string;
  worker_id: string;
  worker_name?: string;
  kind: string;
  /** Last four characters only. The full number needs `reveal`. */
  number_hint: string;
  issued_on: string | null;
  expires_on: string | null;
  /** Worked out against the company's own today. */
  standing: 'valid' | 'expiring' | 'expired' | 'no_expiry';
  has_scan: boolean;
}

const SELECT = {
  id: true,
  workerId: true,
  kind: true,
  numberHint: true,
  issuedOn: true,
  expiresOn: true,
  s3Key: true,
} as const;

/**
 * Workers' identity and work-permit papers (roadmap Phase 1, item 3).
 *
 * The number never reaches the database in the clear: it is encrypted here before the write and
 * decrypted only by `reveal`, which writes an audit entry naming who looked. Lists carry the last
 * four characters, which is enough to tell two papers apart and useless to anyone who copies it.
 */
@Injectable()
export class WorkerDocumentsService {
  private readonly logger = new Logger(WorkerDocumentsService.name);
  private readonly config = env();
  private cipherInstance: FieldCipher | null = null;

  constructor(
    private readonly tenantDb: TenantDb,
    private readonly uploads: UploadsService,
    private readonly notifications: NotificationsService,
  ) {}

  /**
   * A worker's papers, and whether this deployment can store new ones — without an encryption
   * key it cannot, and the screen should say so rather than offer a form that will be refused.
   */
  async list(
    actor: RequestUser,
    workerId: string,
  ): Promise<{ configured: boolean; items: WorkerDocumentView[] }> {
    const db = this.tenantDb.clientFor(actor.tenantId);
    await this.assertWorker(actor, workerId);
    const rows = await db.workerDocument.findMany({
      where: { workerId, deletedAt: null },
      orderBy: [{ expiresOn: { sort: 'asc', nulls: 'last' } }],
      select: SELECT,
    });
    const today = todayIn(actor.timezone);
    return {
      configured: Boolean(this.config.DOCUMENT_ENCRYPTION_KEY),
      items: rows.map((row) => toView(row, today)),
    };
  }

  async create(
    actor: RequestUser,
    workerId: string,
    input: CreateWorkerDocumentInput,
  ): Promise<WorkerDocumentView> {
    const cipher = this.cipher();
    await this.assertWorker(actor, workerId);
    this.assertOwnScan(actor, input.s3_key);

    const row = await this.tenantDb.clientFor(actor.tenantId).workerDocument.create({
      data: {
        tenantId: actor.tenantId,
        workerId,
        kind: input.kind,
        numberCipher: cipher.encrypt(input.number),
        numberHint: hintOf(input.number),
        issuedOn: input.issued_on ? isoDateToUtcDate(input.issued_on) : null,
        expiresOn: input.expires_on ? isoDateToUtcDate(input.expires_on) : null,
        s3Key: input.s3_key ?? null,
        createdBy: actor.userId,
      },
      select: SELECT,
    });
    return toView(row, todayIn(actor.timezone));
  }

  async update(
    actor: RequestUser,
    id: string,
    input: UpdateWorkerDocumentInput,
  ): Promise<WorkerDocumentView> {
    const db = this.tenantDb.clientFor(actor.tenantId);
    await this.find(actor, id);
    if (input.s3_key) this.assertOwnScan(actor, input.s3_key);
    const cipher = input.number !== undefined ? this.cipher() : null;

    const row = await db.workerDocument.update({
      where: { id },
      data: {
        ...(input.number !== undefined && cipher
          ? { numberCipher: cipher.encrypt(input.number), numberHint: hintOf(input.number) }
          : {}),
        ...(input.issued_on !== undefined
          ? { issuedOn: input.issued_on ? isoDateToUtcDate(input.issued_on) : null }
          : {}),
        // A renewed paper is a new expiry, and its owners should hear about that one too.
        ...(input.expires_on !== undefined
          ? {
              expiresOn: input.expires_on ? isoDateToUtcDate(input.expires_on) : null,
              remindedAt: null,
            }
          : {}),
        ...(input.s3_key !== undefined ? { s3Key: input.s3_key } : {}),
      },
      select: SELECT,
    });
    return toView(row, todayIn(actor.timezone));
  }

  async remove(actor: RequestUser, id: string): Promise<void> {
    await this.find(actor, id);
    await this.tenantDb
      .clientFor(actor.tenantId)
      .workerDocument.update({ where: { id }, data: { deletedAt: new Date() } });
  }

  /** The full number, for the person filling a government form. Every look is written down. */
  async reveal(actor: RequestUser, id: string): Promise<{ number: string }> {
    const cipher = this.cipher();
    const row = await this.find(actor, id);
    await this.tenantDb.transaction(actor.tenantId, (tx) =>
      tx.auditLog.create({
        data: {
          tenantId: actor.tenantId,
          actorId: actor.userId,
          action: 'worker_document.reveal',
          // The table's name, like every trigger-written entry, so the log filters them together.
          entity: 'worker_documents',
          entityId: id,
        },
      }),
    );
    return { number: cipher.decrypt(row.numberCipher) };
  }

  /** A short-lived link to the scan, when there is one. */
  async scanUrl(actor: RequestUser, id: string): Promise<{ url: string | null }> {
    const row = await this.find(actor, id);
    return { url: row.s3Key ? await this.uploads.signedViewUrl(actor, row.s3Key) : null };
  }

  /** Papers lapsing within the warning window, or already lapsed, for active workers. */
  async expiring(actor: RequestUser): Promise<WorkerDocumentView[]> {
    const today = todayIn(actor.timezone);
    const rows = await this.tenantDb.clientFor(actor.tenantId).workerDocument.findMany({
      where: {
        deletedAt: null,
        expiresOn: { lte: isoDateToUtcDate(addDays(today, DOCUMENT_EXPIRY_WARNING_DAYS)) },
        worker: { deletedAt: null, status: 'active' },
      },
      orderBy: { expiresOn: 'asc' },
      select: { ...SELECT, worker: { select: { name: true } } },
    });
    return rows.map((row) => ({ ...toView(row, today), worker_name: row.worker.name }));
  }

  /**
   * The morning job: tell the owners and accounts, once per paper, what is about to lapse.
   * Returns how many papers were reported.
   */
  async remindTenant(tenantId: string): Promise<{ reminded: number }> {
    const due = await this.tenantDb.transaction(tenantId, async (tx) => {
      const tenant = await tx.tenant.findUnique({
        where: { id: tenantId },
        select: { timezone: true },
      });
      const today = todayIn(tenant?.timezone ?? INDIA_LOCALE.timezone);
      const rows = await tx.workerDocument.findMany({
        where: {
          deletedAt: null,
          remindedAt: null,
          expiresOn: { lte: isoDateToUtcDate(addDays(today, DOCUMENT_EXPIRY_WARNING_DAYS)) },
          worker: { deletedAt: null, status: 'active' },
        },
        orderBy: { expiresOn: 'asc' },
        select: { id: true, kind: true, expiresOn: true, worker: { select: { name: true } } },
      });
      if (rows.length > 0) {
        await tx.workerDocument.updateMany({
          where: { id: { in: rows.map((row) => row.id) } },
          data: { remindedAt: new Date() },
        });
      }
      return rows;
    });
    if (due.length === 0) return { reminded: 0 };

    const lines = due
      .slice(0, 5)
      .map(
        (row) =>
          `${row.worker.name}: ${WORKER_DOCUMENT_LABELS[row.kind as WorkerDocumentKind] ?? row.kind}, ${utcDateToIsoDate(row.expiresOn!)}`,
      );
    await this.notifications.notify({
      tenantId,
      roles: ['owner', 'accounts'],
      type: 'worker_documents_expiring',
      title:
        due.length === 1
          ? 'A worker’s papers are about to lapse'
          : `${due.length} workers’ papers are about to lapse`,
      body: lines.join('\n') + (due.length > 5 ? `\n…and ${due.length - 5} more` : ''),
      payload: { document_ids: due.map((row) => row.id) },
    });
    this.logger.log({ tenantId, reminded: due.length }, 'Document expiry reminders sent');
    return { reminded: due.length };
  }

  // --- helpers ------------------------------------------------------------------------------

  /**
   * The identity number on each worker's paper of one of `kinds`, in the clear, for a government
   * payroll file (the Saudi Mudad file reads the Iqama or national ID).
   *
   * Per worker, the paper that is still valid and runs longest wins — a renewed Iqama keeps its
   * number, but a replaced card should not lose to the one it replaced. Workers with none are
   * simply absent from the map. Null when this deployment has no encryption key, so the caller
   * can say why rather than report every worker as missing their papers.
   *
   * Runs inside the caller's transaction so the read is tenant-scoped; the caller writes the audit
   * entry, because it knows what the numbers were for.
   */
  async identityNumbers(
    tx: TenantTx,
    workerIds: string[],
    kinds: WorkerDocumentKind[],
  ): Promise<Map<string, string> | null> {
    if (!this.config.DOCUMENT_ENCRYPTION_KEY) return null;
    const cipher = this.cipher();
    const rows = await tx.workerDocument.findMany({
      where: { workerId: { in: workerIds }, kind: { in: kinds }, deletedAt: null },
      orderBy: [{ expiresOn: { sort: 'desc', nulls: 'first' } }, { createdAt: 'desc' }],
      select: { workerId: true, numberCipher: true, expiresOn: true },
    });
    // The ordering puts a paper with no expiry first, then the one running longest, so the first
    // row per worker is the one to use. An expired paper is still the person's number when it is
    // all there is — the file is about paying them; the overview's paper alerts chase the renewal.
    const numbers = new Map<string, string>();
    for (const row of rows) {
      if (numbers.has(row.workerId)) continue;
      numbers.set(row.workerId, cipher.decrypt(row.numberCipher).replace(/[\s-]/g, ''));
    }
    return numbers;
  }

  private cipher(): FieldCipher {
    if (!this.config.DOCUMENT_ENCRYPTION_KEY) {
      // Refuse rather than store a passport number in the clear.
      throw ApiError.conflict('Worker documents are not configured on this deployment');
    }
    this.cipherInstance ??= new FieldCipher(this.config.DOCUMENT_ENCRYPTION_KEY);
    return this.cipherInstance;
  }

  private async assertWorker(actor: RequestUser, workerId: string): Promise<void> {
    const worker = await this.tenantDb
      .clientFor(actor.tenantId)
      .worker.findFirst({ where: { id: workerId, deletedAt: null }, select: { id: true } });
    if (!worker) throw ApiError.notFound('Worker');
  }

  private async find(actor: RequestUser, id: string) {
    const row = await this.tenantDb
      .clientFor(actor.tenantId)
      .workerDocument.findFirst({ where: { id, deletedAt: null } });
    if (!row) throw ApiError.notFound('Document');
    return row;
  }

  /** A scan must be one this company uploaded as a worker document, not any key in the bucket. */
  private assertOwnScan(actor: RequestUser, s3Key: string | null | undefined): void {
    if (s3Key && !s3Key.startsWith(`${actor.tenantId}/worker_document/`)) {
      throw ApiError.forbidden('That file does not belong to this account');
    }
  }
}

function toView(
  row: {
    id: string;
    workerId: string;
    kind: string;
    numberHint: string;
    issuedOn: Date | null;
    expiresOn: Date | null;
    s3Key: string | null;
  },
  today: string,
): WorkerDocumentView {
  const expires = row.expiresOn ? utcDateToIsoDate(row.expiresOn) : null;
  const standing: WorkerDocumentView['standing'] =
    expires === null
      ? 'no_expiry'
      : expires < today
        ? 'expired'
        : expires <= addDays(today, DOCUMENT_EXPIRY_WARNING_DAYS)
          ? 'expiring'
          : 'valid';
  return {
    id: row.id,
    worker_id: row.workerId,
    kind: row.kind,
    number_hint: row.numberHint,
    issued_on: row.issuedOn ? utcDateToIsoDate(row.issuedOn) : null,
    expires_on: expires,
    standing,
    has_scan: row.s3Key !== null,
  };
}
