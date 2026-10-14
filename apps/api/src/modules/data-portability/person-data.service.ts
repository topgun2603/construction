import { Injectable, Logger } from '@nestjs/common';
import type { Response } from 'express';
import type { DataExportPersonKind } from '@sitebook/shared';
import type { RequestUser } from '../../common/auth/request-user';
import { ApiError } from '../../common/errors/api-error';
import { TenantDb, type TenantTx } from '../../common/prisma/tenant-db.service';
import { assertOwner } from './owner';
import { PortabilityStorage } from './portability-storage.service';
import {
  eachRowBatch,
  quoteIdent,
  rowsAsJsonSql,
  tenantFilter,
  tenantTables,
  uuidLiteral,
  type TenantTable,
} from './tenant-tables';
import { ZipWriter } from './zip-writer';

const PERSON_TX = { timeout: 10 * 60_000, maxWait: 30_000 };

/** A person's own activity in the audit log is theirs too; capped so one export stays one file. */
const AUDIT_ROWS_CAP = 20_000;

/** One row of the people picker. */
export interface PersonSearchRow {
  kind: DataExportPersonKind;
  id: string;
  name: string;
  phone: string | null;
  status: string;
  /** Left the company — the only people who may be anonymised. */
  former: boolean;
  /** Already anonymised. */
  anonymised: boolean;
}

const WORKER_PLACEHOLDER = 'Former worker';
const USER_PLACEHOLDER = 'Former user';

/**
 * One person's data (GDPR / Saudi PDPL style rights): everything the company holds about one worker
 * or one team member, as a ZIP; and anonymising somebody who has left.
 *
 * OWNER ONLY, like the rest of the module.
 *
 * THE RETENTION RULE. Anonymising replaces who the person was — name, phone, ID and bank numbers,
 * photograph, uploaded ID documents — and keeps what they were paid and what they did. Attendance,
 * wage lines, payments and every other financial record stay, attached to a placeholder name, because
 * labour and tax law make the employer keep wage records for years (India's wage codes, the UAE's
 * WPS, Saudi labour law) and a company's books must still add up. Only people who have left can be
 * anonymised: a worker marked inactive or removed, a team member disabled or removed.
 *
 * Earlier audit-log entries keep what they recorded at the time: the log is append-only by design
 * (see the full_audit_log migration) and is kept for its own retention period.
 */
@Injectable()
export class PersonDataService {
  private readonly logger = new Logger(PersonDataService.name);

  constructor(
    private readonly tenantDb: TenantDb,
    private readonly storage: PortabilityStorage,
  ) {}

  /** `GET /people-data/search?q=`: workers and team members by name or phone, for the picker. */
  async search(actor: RequestUser, q: string): Promise<{ items: PersonSearchRow[] }> {
    assertOwner(actor, 'manage people’s data');
    const term = q.trim();
    const contains = term ? { contains: term, mode: 'insensitive' as const } : undefined;
    return this.tenantDb.transaction(actor.tenantId, async (tx) => {
      const [workers, users] = await Promise.all([
        tx.worker.findMany({
          where: contains ? { OR: [{ name: contains }, { phone: contains }] } : {},
          select: { id: true, name: true, phone: true, status: true, deletedAt: true },
          orderBy: [{ status: 'desc' }, { name: 'asc' }],
          take: 25,
        }),
        tx.user.findMany({
          where: contains ? { OR: [{ name: contains }, { phone: contains }] } : {},
          select: { id: true, name: true, phone: true, status: true, deletedAt: true },
          orderBy: { name: 'asc' },
          take: 25,
        }),
      ]);
      return {
        items: [
          ...users.map((user): PersonSearchRow => ({
            kind: 'user',
            id: user.id,
            name: user.name,
            phone: user.phone.startsWith('anonymised-') ? null : user.phone,
            status: user.deletedAt ? 'removed' : user.status,
            former: user.deletedAt !== null || user.status === 'disabled',
            anonymised: user.name.startsWith(USER_PLACEHOLDER),
          })),
          ...workers.map((worker): PersonSearchRow => ({
            kind: 'worker',
            id: worker.id,
            name: worker.name,
            phone: worker.phone,
            status: worker.deletedAt ? 'removed' : worker.status,
            former: worker.deletedAt !== null || worker.status !== 'active',
            anonymised: worker.name.startsWith(WORKER_PLACEHOLDER),
          })),
        ],
      };
    });
  }

  /**
   * `GET /people-data/{workers|users}/:id/export`: a ZIP streamed straight to the browser.
   *
   * - `person.json`        their own row (secret columns left out, as in a company export);
   * - `related/*.json`     every row in any company table that points at them by foreign key —
   *                        attendance, wage lines, payments, documents, reports they filed, sites they
   *                        are on — found from the database's own foreign keys, so a new module's
   *                        tables are included without anybody listing them;
   * - `related/audit_logs.actor_id.json`  for a team member, what they did, from the audit log;
   * - `files/`             a worker's photograph, ID proof and uploaded ID documents.
   */
  async exportPerson(actor: RequestUser, kind: DataExportPersonKind, id: string, response: Response): Promise<void> {
    assertOwner(actor, 'export a person’s data');
    const person = await this.load(actor.tenantId, kind, id);

    const fileName = `${kind}-${id.slice(0, 8)}-data.zip`;
    response.set({
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${fileName}"`,
      'Cache-Control': 'no-store',
    });
    const zip = new ZipWriter();
    zip.output.pipe(response);

    const counts: Record<string, number> = {};
    const keys: string[] = [];
    try {
      await this.tenantDb.transaction(
        actor.tenantId,
        async (tx) => {
          const tables = new Map((await tenantTables(tx)).map((table) => [table.name, table]));
          const own = tables.get(kind === 'worker' ? 'workers' : 'users');
          if (!own) throw new Error('person table missing');
          const where = `${quoteIdent('id')} = ${uuidLiteral(id)} AND ${tenantFilter(own.name, actor.tenantId)}`;
          counts['person'] = await this.writeJson(zip, tx, 'person.json', own, where, true);

          for (const ref of await referencingColumns(tx, own.name)) {
            const table = tables.get(ref.table);
            if (!table) continue;
            const filter = `${quoteIdent(ref.column)} = ${uuidLiteral(id)} AND ${tenantFilter(table.name, actor.tenantId)}`;
            const name = `related/${ref.table}.${ref.column}.json`;
            const n = await this.writeJson(zip, tx, name, table, filter);
            if (n > 0) counts[`${ref.table}.${ref.column}`] = n;
          }

          if (kind === 'user') {
            const audit = tables.get('audit_logs');
            if (audit) {
              const filter = `${quoteIdent('actor_id')} = ${uuidLiteral(id)} AND ${tenantFilter('audit_logs', actor.tenantId)}`;
              const n = await this.writeJson(zip, tx, 'related/audit_logs.actor_id.json', audit, filter, false, AUDIT_ROWS_CAP);
              if (n > 0) counts['audit_logs.actor_id'] = n;
            }
          }

          if (kind === 'worker') {
            const docs = await tx.workerDocument.findMany({ where: { workerId: id }, select: { s3Key: true } });
            keys.push(...[person.photoS3Key, person.idProofS3Key, ...docs.map((doc) => doc.s3Key)].filter(isKey));
          }
        },
        PERSON_TX,
      );

      // Files after the transaction: storage reads should not hold a database connection open.
      let files = 0;
      for (const key of new Set(keys)) {
        if (!key.startsWith(`${actor.tenantId}/`)) continue;
        try {
          await zip.addStream(`files/${key}`, await this.storage.read(actor.tenantId, key));
          files += 1;
        } catch (error) {
          // A key the database still names but storage no longer has: leave it out and say so.
          this.logger.warn({ err: error, key }, 'Could not read a person’s file');
        }
      }
      await zip.addBuffer(
        'manifest.json',
        JSON.stringify(
          { kind, id, exported_at: new Date().toISOString(), rows: counts, files },
          null,
          2,
        ),
      );
      // Recorded before the last bytes go out, so the entry exists by the time the download
      // finishes — whoever reads the log straight afterwards sees it.
      await this.audit(actor, kind, id, 'person.exported', { rows: counts, files });
      await zip.finish();
    } catch (error) {
      zip.abort(error as Error);
      throw error;
    }
  }

  /**
   * `POST /people-data/{workers|users}/:id/anonymise`. See the class comment for what is replaced and
   * what is kept. Files are removed from storage after the rows commit, so a failure leaves a file
   * nothing points at rather than a row pointing at a file that is gone.
   */
  async anonymise(actor: RequestUser, kind: DataExportPersonKind, id: string) {
    assertOwner(actor, 'anonymise a person');
    const short = id.replace(/-/g, '').slice(0, 6).toUpperCase();

    const result = await this.tenantDb.transaction(actor.tenantId, async (tx) => {
      if (kind === 'worker') {
        const worker = await tx.worker.findFirst({ where: { id } });
        if (!worker) throw ApiError.notFound('Worker');
        if (worker.status === 'active' && worker.deletedAt === null) {
          throw ApiError.conflict('Only a former worker can be anonymised. Mark them inactive first.');
        }
        const documents = await tx.workerDocument.findMany({ where: { workerId: id }, select: { s3Key: true } });
        const keys = [worker.photoS3Key, worker.idProofS3Key, ...documents.map((doc) => doc.s3Key)].filter(isKey);
        const removed = await tx.workerDocument.deleteMany({ where: { workerId: id } });
        await tx.worker.update({
          where: { id },
          data: {
            name: `${WORKER_PLACEHOLDER} ${short}`,
            phone: null,
            idProofS3Key: null,
            photoS3Key: null,
            wpsPersonId: null,
            wpsAgentCode: null,
            wpsAccount: null,
          },
        });
        return { keys, documents: removed.count };
      }

      if (id === actor.userId) throw ApiError.conflict('You cannot anonymise yourself.');
      const user = await tx.user.findFirst({ where: { id } });
      if (!user) throw ApiError.notFound('User');
      if (user.deletedAt === null && user.status !== 'disabled') {
        throw ApiError.conflict('Only a former team member can be anonymised. Remove them from the team first.');
      }
      const now = new Date();
      // Out of every session first, and their second factor with them: an anonymised account must
      // not be one somebody can still sign in to.
      await tx.userSession.updateMany({
        where: { userId: id, revokedAt: null },
        data: { revokedAt: now, revokedReason: 'revoked_by_admin' },
      });
      await tx.refreshToken.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: now } });
      await tx.mfaRecoveryCode.deleteMany({ where: { userId: id } });
      await tx.mfaFactor.deleteMany({ where: { userId: id } });
      await tx.user.update({
        where: { id },
        data: {
          name: `${USER_PLACEHOLDER} ${short}`,
          // Unique per company and never a dialable number; the directory entry goes with
          // `deleted_at` (the users trigger removes it from auth_identities).
          phone: `anonymised-${id}`,
          email: null,
          fcmTokens: [],
          status: 'disabled',
          deletedAt: user.deletedAt ?? now,
        },
      });
      return { keys: [] as string[], documents: 0 };
    });

    let files = 0;
    const own = result.keys.filter((key) => key.startsWith(`${actor.tenantId}/`));
    if (own.length > 0) {
      try {
        files = await this.storage.remove(actor.tenantId, [...new Set(own)]);
      } catch (error) {
        this.logger.error({ err: error, id }, 'Anonymised, but some files could not be removed');
      }
    }
    await this.audit(actor, kind, id, 'person.anonymised', { documents_deleted: result.documents, files_deleted: files });
    return { anonymised: true, documents_deleted: result.documents, files_deleted: files };
  }

  private async load(tenantId: string, kind: DataExportPersonKind, id: string) {
    const db = this.tenantDb.clientFor(tenantId);
    if (kind === 'worker') {
      const worker = await db.worker.findFirst({
        where: { id },
        select: { id: true, photoS3Key: true, idProofS3Key: true },
      });
      if (!worker) throw ApiError.notFound('Worker');
      return worker;
    }
    const user = await db.user.findFirst({ where: { id }, select: { id: true } });
    if (!user) throw ApiError.notFound('User');
    return { id: user.id, photoS3Key: null, idProofS3Key: null };
  }

  /** One table's matching rows as a JSON array (or one object, for the person's own row). */
  private async writeJson(
    zip: ZipWriter,
    tx: TenantTx,
    name: string,
    table: TenantTable,
    where: string,
    single = false,
    cap?: number,
  ): Promise<number> {
    let n = 0;
    const sql = rowsAsJsonSql(table, where) + (cap ? ` LIMIT ${Math.trunc(cap)}` : '');
    await zip.addProduced(name, async (sink) => {
      if (!single) await sink.write('[\n');
      await eachRowBatch(tx, sql, async (rows) => {
        for (const row of rows) {
          await sink.write(`${n > 0 ? ',\n' : ''}${row}`);
          n += 1;
        }
      });
      await sink.write(single ? (n === 0 ? 'null\n' : '\n') : '\n]\n');
    });
    return n;
  }

  private async audit(actor: RequestUser, kind: DataExportPersonKind, id: string, action: string, after: object) {
    await this.tenantDb.transaction(actor.tenantId, (tx) =>
      tx.auditLog.create({
        data: {
          tenantId: actor.tenantId,
          actorId: actor.userId,
          action,
          entity: kind === 'worker' ? 'workers' : 'users',
          entityId: id,
          after: after as object,
        },
      }),
    );
  }
}

function isKey(key: string | null | undefined): key is string {
  return typeof key === 'string' && key.length > 0;
}

/**
 * Every single-column foreign key that points at `target(id)`: where a worker or a user appears.
 * Read from the catalogue so tables added later are found without a list to maintain.
 */
export async function referencingColumns(tx: TenantTx, target: string): Promise<Array<{ table: string; column: string }>> {
  return tx.$queryRawUnsafe<Array<{ table: string; column: string }>>(
    `SELECT cl.relname::text AS "table", a.attname::text AS "column"
       FROM pg_constraint c
       JOIN pg_class cl ON cl.oid = c.conrelid
       JOIN pg_namespace ns ON ns.oid = cl.relnamespace
       JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
      WHERE c.contype = 'f' AND ns.nspname = 'public' AND array_length(c.conkey, 1) = 1
        AND c.confrelid = ${`'public.${target.replace(/[^a-z_]/g, '')}'`}::regclass
      ORDER BY 1, 2`,
  );
}
