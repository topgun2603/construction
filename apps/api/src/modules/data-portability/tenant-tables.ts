import { Prisma } from '@prisma/client';
import { dataExportIsSecretColumn } from '@sitebook/shared';
import type { TenantTx } from '../../common/prisma/tenant-db.service';

/** Anything that can run a raw query: a tenant transaction or the plain client. */
type RawClient = Pick<TenantTx, '$queryRaw' | '$queryRawUnsafe' | '$executeRawUnsafe'>;

/**
 * Tables that carry a `tenant_id` but are not the company's data, and so stay out of an export:
 *
 * - `platform_audit_log` — the console's own trail. It names operators, not the company's people,
 *   and it deliberately outlives the company (see PlatformService.deleteTenant).
 */
export const NOT_COMPANY_DATA = new Set(['platform_audit_log']);

/** One table a company has rows in, as an export reads it. */
export interface TenantTable {
  name: string;
  /** Columns exported, in table order. */
  columns: string[];
  /** Columns left out because their name marks them as a secret (see DATA_EXPORT_SECRET_COLUMN). */
  omitted: string[];
}

/**
 * Every table that holds company data, discovered from the database rather than listed by hand.
 *
 * Anything with a `tenant_id` column is the company's — the rule every RLS policy in the schema is
 * built on — plus `tenants` itself, keyed by `id`. Reading `information_schema` at run time means a
 * module added next month is in the next export without anybody remembering this file.
 */
export async function tenantTables(db: RawClient): Promise<TenantTable[]> {
  const rows = await db.$queryRaw<Array<{ table_name: string; column_name: string }>>`
    SELECT c.table_name::text AS table_name, c.column_name::text AS column_name
      FROM information_schema.columns c
      JOIN information_schema.tables t
        ON t.table_schema = c.table_schema AND t.table_name = c.table_name AND t.table_type = 'BASE TABLE'
     WHERE c.table_schema = 'public'
       AND (c.table_name = 'tenants' OR EXISTS (
             SELECT 1 FROM information_schema.columns k
              WHERE k.table_schema = 'public' AND k.table_name = c.table_name AND k.column_name = 'tenant_id'))
     ORDER BY c.table_name, c.ordinal_position`;

  const byTable = new Map<string, TenantTable>();
  for (const row of rows) {
    if (NOT_COMPANY_DATA.has(row.table_name)) continue;
    let table = byTable.get(row.table_name);
    if (!table) {
      table = { name: row.table_name, columns: [], omitted: [] };
      byTable.set(row.table_name, table);
    }
    if (dataExportIsSecretColumn(row.column_name)) table.omitted.push(row.column_name);
    else table.columns.push(row.column_name);
  }
  return [...byTable.values()];
}

/** `"name"`, with any quote in it doubled. Names come from the catalogue, never from a request. */
export function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

/** The uuid as a SQL literal, after proving it is one — for the one statement that cannot bind it. */
export function uuidLiteral(id: string): string {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    throw new Error('not a uuid');
  }
  return `'${id}'::uuid`;
}

/** The WHERE clause that picks one company's rows from a table. */
export function tenantFilter(table: string, tenantId: string): string {
  const column = table === 'tenants' ? 'id' : 'tenant_id';
  return `${quoteIdent(column)} = ${uuidLiteral(tenantId)}`;
}

/** The SELECT for one table's rows as JSON text, secret columns left out. */
export function rowsAsJsonSql(table: TenantTable, where: string): string {
  const columns = table.columns.map(quoteIdent).join(', ');
  return `SELECT row_to_json(r)::text AS j FROM (SELECT ${columns} FROM ${quoteIdent(table.name)} WHERE ${where}) r`;
}

/**
 * Reads a table's rows in batches through a server-side cursor, so an attendance table with a
 * million rows streams out a thousand at a time rather than arriving as one array. Must run inside
 * a transaction (a cursor lives only as long as its transaction).
 *
 * The cursor statement cannot take bind parameters, which is why the tenant id is inlined — as a
 * literal proven to be a uuid (`uuidLiteral`) — and the names are quoted catalogue names.
 */
export async function eachRowBatch(
  tx: RawClient,
  sql: string,
  onBatch: (rows: string[]) => Promise<void>,
  batchSize = 1000,
): Promise<number> {
  await tx.$executeRawUnsafe(`DECLARE data_export_cursor NO SCROLL CURSOR FOR ${sql}`);
  let total = 0;
  try {
    for (;;) {
      const rows = await tx.$queryRawUnsafe<Array<{ j: string }>>(
        `FETCH FORWARD ${Math.trunc(batchSize)} FROM data_export_cursor`,
      );
      if (rows.length === 0) break;
      total += rows.length;
      await onBatch(rows.map((row) => row.j));
    }
  } finally {
    // Swallowed: after a failed FETCH the transaction is aborted and CLOSE fails too, and that
    // second error must not replace the first. A cursor left open dies with its transaction.
    await tx.$executeRawUnsafe('CLOSE data_export_cursor').catch(() => undefined);
  }
  return total;
}

/** Rows per company table, for the manifest and the deletion certificate. Only tables with rows. */
export async function countTenantRows(
  tx: RawClient,
  tenantId: string,
  tables: TenantTable[],
): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (const table of tables) {
    const [row] = await tx.$queryRawUnsafe<Array<{ n: bigint }>>(
      `SELECT count(*) AS n FROM ${quoteIdent(table.name)} WHERE ${tenantFilter(table.name, tenantId)}`,
    );
    const n = Number(row?.n ?? 0);
    if (n > 0) counts[table.name] = n;
  }
  return counts;
}

/** The most recent migration applied — the schema version a reader of the export needs. */
export async function schemaVersion(db: RawClient): Promise<string | null> {
  try {
    const rows = await db.$queryRaw<Array<{ migration_name: string }>>(
      Prisma.sql`SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL ORDER BY migration_name DESC LIMIT 1`,
    );
    return rows[0]?.migration_name ?? null;
  } catch {
    // A database restored without Prisma's bookkeeping table still exports; it just cannot say which
    // migration it is at.
    return null;
  }
}
