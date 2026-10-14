import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  DATA_EXPORT_COOLDOWN_HOURS,
  DATA_EXPORT_LINK_DAYS,
  dataExportNextAllowedAt,
} from '@sitebook/shared';
import type { RequestUser } from '../../common/auth/request-user';
import { ApiError } from '../../common/errors/api-error';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TenantDb } from '../../common/prisma/tenant-db.service';
import { env } from '../../config/env';
import { JobQueueService } from '../../jobs/job-queue.service';
import { NotificationsService } from '../notifications/notifications.service';
import { writeRegisters, type RegisterCounts } from './export-registers';
import { assertOwner } from './owner';
import { dataExportKey, dataExportPrefix, PortabilityStorage } from './portability-storage.service';
import {
  eachRowBatch,
  rowsAsJsonSql,
  schemaVersion,
  tenantFilter,
  tenantTables,
} from './tenant-tables';
import { ZipWriter } from './zip-writer';

/** How long a download link handed to the browser lasts. The export itself lasts seven days. */
const DOWNLOAD_URL_SECONDS = 10 * 60;

/** A table read in one transaction may take a while on a large company; the default is 5 s. */
const TABLE_TX = { timeout: 30 * 60_000, maxWait: 30_000 };

/** What the owner sees for one export. */
export interface DataExportView {
  id: string;
  status: string;
  requested_by_user_id: string;
  requested_by_name: string | null;
  size_bytes: number | null;
  error: string | null;
  created_at: string;
  finished_at: string | null;
  expires_at: string | null;
  tables: number | null;
  files: number | null;
}

/** The manifest written into every ZIP and kept on the row. */
export interface DataExportManifest {
  format: 'sitebook-company-export';
  format_version: 1;
  company: { id: string; name: string; country: string; currency: string; timezone: string };
  exported_at: string;
  requested_by_user_id: string;
  schema_version: string | null;
  tables: Record<string, number>;
  omitted_columns: Record<string, string[]>;
  registers: RegisterCounts;
  files: { count: number; bytes: number };
}

/**
 * Full company export (roadmap Phase 3, "data export per company").
 *
 * OWNER ONLY, like the Security page: `tenant.manage` at the route, an owner check here. An export is
 * the whole company leaving the building.
 *
 * Asking queues a job; the worker builds a ZIP — every company table as JSON Lines, a manifest, a
 * workbook of the main registers and every uploaded file — and streams it into the company's own
 * storage prefix, then tells the owner it is ready. The link lasts seven days. One export at a time
 * per company (a partial unique index makes that hold under a race), and one a day.
 *
 * The platform console's older "Export everything" (a JSON response of thirteen tables, for an
 * operator answering a support request) is left as it is; this is the complete, self-service one.
 */
@Injectable()
export class DataExportService {
  private readonly logger = new Logger(DataExportService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantDb: TenantDb,
    private readonly jobs: JobQueueService,
    private readonly storage: PortabilityStorage,
    private readonly notifications: NotificationsService,
  ) {}

  /** `GET /data-exports`: the company's exports, newest first, and whether another may be asked for. */
  async list(actor: RequestUser, now = new Date()) {
    assertOwner(actor, 'export the company’s data');
    const rows = await this.tenantDb.transaction(actor.tenantId, (tx) =>
      tx.dataExport.findMany({ orderBy: { createdAt: 'desc' }, take: 20 }),
    );
    const names = await this.namesOf(actor.tenantId, rows.map((row) => row.requestedByUserId));
    const block = this.blocker(rows, now);
    return {
      items: rows.map((row) => present(row, names, now)),
      can_request: block === null,
      blocked_reason: block?.reason ?? null,
      next_allowed_at: block?.nextAllowedAt?.toISOString() ?? null,
      link_days: DATA_EXPORT_LINK_DAYS,
      cooldown_hours: DATA_EXPORT_COOLDOWN_HOURS,
    };
  }

  /**
   * `POST /data-exports`. Refused while one is under way or within a day of the last one. The row is
   * written first and the job keyed on it, so a retried job builds the same export rather than a
   * second one.
   */
  async request(actor: RequestUser, now = new Date()) {
    assertOwner(actor, 'export the company’s data');
    const created = await this.tenantDb.transaction(actor.tenantId, async (tx) => {
      const recent = await tx.dataExport.findMany({ orderBy: { createdAt: 'desc' }, take: 5 });
      const block = this.blocker(recent, now);
      if (block?.reason === 'running') {
        throw ApiError.conflict('An export is already being prepared. You will be told when it is ready.');
      }
      if (block?.reason === 'cooldown') {
        throw ApiError.rateLimited(
          `One export a day. The next can be asked for after ${block.nextAllowedAt?.toISOString().slice(0, 16).replace('T', ' ')} UTC.`,
          { next_allowed_at: block.nextAllowedAt?.toISOString() },
        );
      }
      try {
        return await tx.dataExport.create({
          data: { tenantId: actor.tenantId, requestedByUserId: actor.userId, status: 'queued' },
        });
      } catch (error) {
        // The partial unique index: a second request racing the first.
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
          throw ApiError.conflict('An export is already being prepared. You will be told when it is ready.');
        }
        throw error;
      }
    });

    const queued = await this.jobs.dataExportRequested({ tenantId: actor.tenantId, exportId: created.id });
    // With no queue (a deployment without Redis) it runs in this process, in the background, so the
    // request still answers at once. Not under test: the suite builds exports by calling `run`.
    if (!queued && env().NODE_ENV !== 'test') {
      setImmediate(() => {
        this.run(actor.tenantId, created.id).catch((error: unknown) =>
          this.logger.error({ err: error, exportId: created.id }, 'In-process export failed'),
        );
      });
    }
    const names = await this.namesOf(actor.tenantId, [actor.userId]);
    return present(created, names, now);
  }

  /**
   * `GET /data-exports/:id/download`: a ten-minute link to the ZIP, fetched fresh on every press.
   * Audited — who took a copy of the company's data, and when, is exactly what the log is for.
   */
  async download(actor: RequestUser, exportId: string, now = new Date()) {
    assertOwner(actor, 'download the company’s data');
    const row = await this.tenantDb.transaction(actor.tenantId, (tx) =>
      tx.dataExport.findUnique({ where: { id: exportId } }),
    );
    if (!row) throw ApiError.notFound('Export');
    if (row.status !== 'ready' || !row.s3Key) throw ApiError.conflict('That export is not ready.');
    if (row.expiresAt && row.expiresAt <= now) throw ApiError.conflict('That export has expired. Ask for a new one.');

    const company = await this.tenantDb
      .clientFor(actor.tenantId)
      .tenant.findUnique({ where: { id: actor.tenantId }, select: { name: true } });
    const fileName = `${slug(company?.name ?? 'company')}-export-${row.createdAt.toISOString().slice(0, 10)}.zip`;
    const url = await this.storage.signedDownload(actor.tenantId, row.s3Key, fileName, DOWNLOAD_URL_SECONDS);

    await this.tenantDb.transaction(actor.tenantId, (tx) =>
      tx.auditLog.create({
        data: {
          tenantId: actor.tenantId,
          actorId: actor.userId,
          action: 'data_export.downloaded',
          entity: 'data_exports',
          entityId: row.id,
          after: { size_bytes: row.sizeBytes === null ? null : Number(row.sizeBytes) },
        },
      }),
    );
    return { url, expires_in: DOWNLOAD_URL_SECONDS, file_name: fileName };
  }

  /**
   * Builds the ZIP for one export. Called by the worker's `data-export` job (and directly by tests).
   *
   * Every company read runs in that company's RLS context — the worker never holds a connection that
   * can see another company — and every file comes from a listing of the company's own prefix.
   */
  async run(tenantId: string, exportId: string, now = new Date()): Promise<DataExportManifest | null> {
    const db = this.tenantDb.clientFor(tenantId);
    const row = await db.dataExport.findUnique({ where: { id: exportId } });
    if (!row || row.status === 'ready' || row.status === 'expired') return null;

    await db.dataExport.update({
      where: { id: exportId },
      data: { status: 'running', startedAt: new Date(), error: null },
    });

    const key = dataExportKey(tenantId, exportId);
    const zip = new ZipWriter();
    const upload = this.storage.write(tenantId, key, zip.output, 'application/zip');
    // Without a handler, a storage failure while entries are still being added would surface as an
    // unhandled rejection before `await upload` below gets to it.
    upload.catch(() => undefined);

    try {
      const manifest = await this.writeArchive(tenantId, row.requestedByUserId, zip, now);
      await zip.finish();
      const size = await upload;
      const expiresAt = new Date(now.getTime() + DATA_EXPORT_LINK_DAYS * 86_400_000);

      await db.dataExport.update({
        where: { id: exportId },
        data: {
          status: 'ready',
          s3Key: key,
          sizeBytes: BigInt(size),
          manifest: manifest as unknown as Prisma.InputJsonValue,
          finishedAt: new Date(),
          expiresAt,
        },
      });

      await this.notifications.notify({
        tenantId,
        userIds: [row.requestedByUserId],
        type: 'data_export.ready',
        title: 'Your company export is ready',
        body: `Download it from Settings → Company within ${DATA_EXPORT_LINK_DAYS} days.`,
        payload: { export_id: exportId, expires_at: expiresAt.toISOString() },
      }).catch((error: unknown) => this.logger.warn({ err: error }, 'Could not notify about the export'));
      return manifest;
    } catch (error) {
      zip.abort(error as Error);
      await upload.catch(() => undefined);
      const message = (error as Error).message?.slice(0, 500) ?? 'failed';
      this.logger.error({ err: error, exportId, tenantId }, 'Export failed');
      await db.dataExport.update({
        where: { id: exportId },
        data: { status: 'failed', error: message, finishedAt: new Date() },
      });
      throw error;
    }
  }

  /** Removes finished exports whose week is up. Part of the worker's hourly sweep. */
  async expire(tenantId: string, now = new Date()): Promise<number> {
    const db = this.tenantDb.clientFor(tenantId);
    const due = await db.dataExport.findMany({
      where: { status: 'ready', expiresAt: { lte: now } },
      select: { id: true, s3Key: true },
    });
    for (const row of due) {
      if (row.s3Key) await this.storage.remove(tenantId, [row.s3Key]);
      await db.dataExport.update({ where: { id: row.id }, data: { status: 'expired', s3Key: null } });
    }
    return due.length;
  }

  private async writeArchive(
    tenantId: string,
    requestedByUserId: string,
    zip: ZipWriter,
    now: Date,
  ): Promise<DataExportManifest> {
    const company = await this.tenantDb.clientFor(tenantId).tenant.findUniqueOrThrow({
      where: { id: tenantId },
      select: { id: true, name: true, country: true, currency: true, timezone: true },
    });
    const tables = await this.tenantDb.transaction(tenantId, (tx) => tenantTables(tx));
    const counts: Record<string, number> = {};
    const omitted: Record<string, string[]> = {};

    // 1. Every company table, one JSON object per line. Secret columns are not selected at all.
    for (const table of tables) {
      if (table.omitted.length > 0) omitted[table.name] = table.omitted;
      counts[table.name] = await this.tenantDb.transaction(
        tenantId,
        async (tx) => {
          let n = 0;
          await zip.addProduced(`tables/${table.name}.jsonl`, async (sink) => {
            n = await eachRowBatch(tx, rowsAsJsonSql(table, tenantFilter(table.name, tenantId)), async (rows) => {
              await sink.write(rows.join('\n') + '\n');
            });
          });
          return n;
        },
        TABLE_TX,
      );
    }

    // 2. The registers, as a workbook someone can open.
    let registers: RegisterCounts = {};
    await this.tenantDb.transaction(
      tenantId,
      async (tx) => {
        await zip.addProduced('registers.xlsx', async (sink) => {
          registers = await writeRegisters(tx, tenantId, company.currency, sink.stream);
        });
      },
      TABLE_TX,
    );

    // 3. Every uploaded file, under its own key. Earlier exports are left out — an export of
    // exports would double in size every day.
    let fileCount = 0;
    let fileBytes = 0;
    const skip = dataExportPrefix(tenantId);
    for await (const object of this.storage.list(tenantId)) {
      if (object.key.startsWith(skip)) continue;
      await zip.addStream(`files/${object.key}`, await this.storage.read(tenantId, object.key));
      fileCount += 1;
      fileBytes += object.size;
    }

    const manifest: DataExportManifest = {
      format: 'sitebook-company-export',
      format_version: 1,
      company,
      exported_at: now.toISOString(),
      requested_by_user_id: requestedByUserId,
      schema_version: await schemaVersion(this.prisma),
      tables: counts,
      omitted_columns: omitted,
      registers,
      files: { count: fileCount, bytes: fileBytes },
    };
    await zip.addBuffer('manifest.json', JSON.stringify(manifest, null, 2));
    await zip.addBuffer('README.txt', README);
    return manifest;
  }

  /** Why another export cannot be asked for now, if it cannot. */
  private blocker(
    rows: Array<{ status: string; createdAt: Date }>,
    now: Date,
  ): { reason: 'running' | 'cooldown'; nextAllowedAt: Date | null } | null {
    if (rows.some((row) => row.status === 'queued' || row.status === 'running')) {
      return { reason: 'running', nextAllowedAt: null };
    }
    // A failed export does not count against the day: the company did not get its data.
    const last = rows.find((row) => row.status !== 'failed');
    if (last) {
      const next = dataExportNextAllowedAt(last.createdAt);
      if (next > now) return { reason: 'cooldown', nextAllowedAt: next };
    }
    return null;
  }

  private async namesOf(tenantId: string, ids: string[]): Promise<Map<string, string>> {
    if (ids.length === 0) return new Map();
    const users = await this.tenantDb.clientFor(tenantId).user.findMany({
      where: { id: { in: [...new Set(ids)] } },
      select: { id: true, name: true },
    });
    return new Map(users.map((user) => [user.id, user.name]));
  }
}

function present(
  row: {
    id: string;
    status: string;
    requestedByUserId: string;
    sizeBytes: bigint | null;
    error: string | null;
    createdAt: Date;
    finishedAt: Date | null;
    expiresAt: Date | null;
    manifest?: Prisma.JsonValue | null;
  },
  names: Map<string, string>,
  now: Date,
): DataExportView {
  const manifest = (row.manifest ?? null) as Partial<DataExportManifest> | null;
  // A ready export past its date reads as expired even before the sweep has removed the file.
  const status = row.status === 'ready' && row.expiresAt && row.expiresAt <= now ? 'expired' : row.status;
  return {
    id: row.id,
    status,
    requested_by_user_id: row.requestedByUserId,
    requested_by_name: names.get(row.requestedByUserId) ?? null,
    size_bytes: row.sizeBytes === null ? null : Number(row.sizeBytes),
    error: row.error,
    created_at: row.createdAt.toISOString(),
    finished_at: row.finishedAt?.toISOString() ?? null,
    expires_at: row.expiresAt?.toISOString() ?? null,
    tables: manifest?.tables ? Object.keys(manifest.tables).length : null,
    files: manifest?.files?.count ?? null,
  };
}

function slug(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'company'
  );
}

const README = `This is a complete export of one company's data.

manifest.json     What is in this file: the company, when it was exported, the database schema
                  version, how many rows each table had, and which columns were left out.
tables/*.jsonl    Every table the company has rows in, one JSON object per line (JSON Lines).
                  Money is stored in the currency's minor unit (paise, fils, cents) as whole numbers.
                  Columns holding secrets — sign-in tokens, encrypted ID numbers, password and
                  one-time-code secrets — are left out; manifest.json lists them.
registers.xlsx    The main registers in a spreadsheet: sites, workers, attendance, wages, labour
                  payments, expenses, purchase orders, subcontracts and change orders.
files/            Every photograph, document and bill uploaded, under the storage key the tables
                  refer to (columns ending in s3_key).
`;
