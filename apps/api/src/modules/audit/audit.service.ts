import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  AUDIT_ROW_ACTIONS,
  type AuditActorType,
  type AuditEntry,
  type AuditQuery,
  type Page,
} from '@sitebook/shared';
import type { RequestUser } from '../../common/auth/request-user';
import { TenantDb } from '../../common/prisma/tenant-db.service';

interface AuditRow {
  id: string;
  created_at: Date;
  action: string;
  entity: string;
  entity_id: string | null;
  entity_label: string | null;
  actor_type: string;
  actor_id: string | null;
  actor_name: string | null;
  changed_fields: string[] | null;
  before: unknown;
  after: unknown;
  request_id: string | null;
  ip: string | null;
  user_agent: string | null;
}

/**
 * An export is for handing to an auditor, not for backing up the database. Past this many rows
 * the answer is a narrower date range, and the cap keeps one click from holding a connection
 * and a few hundred megabytes of memory for minutes.
 */
export const AUDIT_EXPORT_MAX_ROWS = 50_000;
const EXPORT_BATCH = 1_000;
const BOM = String.fromCharCode(0xfeff);

/**
 * Reads the audit log (roadmap Phase 3). Writing it is the database's job — see migration
 * 20261007000200_full_audit_log — so this service only filters, pages and formats.
 */
@Injectable()
export class AuditService {
  constructor(private readonly tenantDb: TenantDb) {}

  async list(actor: RequestUser, query: AuditQuery): Promise<Page<AuditEntry>> {
    const rows = await this.fetch(actor, query, query.cursor, query.limit + 1);
    const hasMore = rows.length > query.limit;
    const items = hasMore ? rows.slice(0, query.limit) : rows;
    return {
      items: items.map(toEntry),
      next_cursor: hasMore ? (items.at(-1)?.id ?? null) : null,
    };
  }

  /** The filtered log as CSV, newest first — the same rows the screen shows, without paging. */
  async exportCsv(actor: RequestUser, query: AuditQuery): Promise<string> {
    const stamp = new Intl.DateTimeFormat('sv-SE', {
      timeZone: actor.timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    });

    const lines = [
      csvRow([
        `time (${actor.timezone})`,
        'who',
        'actor_type',
        'action',
        'entity',
        'entity_id',
        'entity_name',
        'changed_fields',
        'before',
        'after',
        'request_id',
        'ip',
        'user_agent',
      ]),
    ];

    let cursor: string | undefined;
    let total = 0;
    while (total < AUDIT_EXPORT_MAX_ROWS) {
      const batch = await this.fetch(
        actor,
        query,
        cursor,
        Math.min(EXPORT_BATCH, AUDIT_EXPORT_MAX_ROWS - total),
      );
      for (const row of batch) {
        lines.push(
          csvRow([
            stamp.format(row.created_at),
            row.actor_name ?? (row.actor_type === 'user' ? row.actor_id : row.actor_type),
            row.actor_type,
            row.action,
            row.entity,
            row.entity_id,
            row.entity_label,
            (row.changed_fields ?? []).join(' '),
            row.before == null ? '' : JSON.stringify(row.before),
            row.after == null ? '' : JSON.stringify(row.after),
            row.request_id,
            row.ip,
            row.user_agent,
          ]),
        );
      }
      total += batch.length;
      if (batch.length < EXPORT_BATCH) break;
      cursor = batch.at(-1)?.id;
    }

    // Taking a copy of the whole history out of the building is itself worth a line in it.
    const { cursor: _cursor, limit: _limit, ...filters } = query;
    await this.tenantDb.transaction(actor.tenantId, (tx) =>
      tx.auditLog.create({
        data: {
          tenantId: actor.tenantId,
          actorId: actor.userId,
          action: 'audit.exported',
          entity: 'audit_logs',
          after: { rows: total, filters },
        },
      }),
    );

    // A BOM so Excel — what an auditor opens this in — reads Arabic and Tamil names as UTF-8.
    return `${BOM}${lines.join('\r\n')}\r\n`;
  }

  private async fetch(
    actor: RequestUser,
    query: AuditQuery,
    cursor: string | undefined,
    take: number,
  ): Promise<AuditRow[]> {
    const where: Prisma.Sql[] = [Prisma.sql`TRUE`];
    // Days are the company's days: "the 3rd" in Dubai starts four hours before it does in UTC.
    if (query.from) {
      where.push(
        Prisma.sql`a.created_at >= (${query.from}::date)::timestamp AT TIME ZONE ${actor.timezone}`,
      );
    }
    if (query.to) {
      where.push(
        Prisma.sql`a.created_at < (${query.to}::date + 1)::timestamp AT TIME ZONE ${actor.timezone}`,
      );
    }
    if (query.actor_id) where.push(Prisma.sql`a.actor_id = ${query.actor_id}::uuid`);
    if (query.entity) where.push(Prisma.sql`a.entity = ${query.entity}`);
    if (query.entity_id) where.push(Prisma.sql`a.entity_id = ${query.entity_id}::uuid`);
    if (query.action === 'event') {
      // Every named business event: approvals, payments, reveals — what was hand-written before.
      where.push(Prisma.sql`a.action <> ALL(${[...AUDIT_ROW_ACTIONS]}::text[])`);
    } else if (query.action) {
      where.push(Prisma.sql`a.action = ${query.action}`);
    }
    if (cursor) {
      // Keyset on (created_at, id), the order the index serves. A cursor from another tenant
      // matches no row under RLS, so the comparison is against NULL and returns nothing.
      where.push(
        Prisma.sql`(a.created_at, a.id) < (SELECT c.created_at, c.id FROM audit_logs c WHERE c.id = ${cursor}::uuid)`,
      );
    }

    /*
     * `$queryRaw` inside `transaction`, not on `clientFor`: the per-tenant client sets
     * `app.tenant_id` by intercepting model operations, and a raw query is not one — it would
     * run with no tenant and RLS would return nothing.
     */
    return this.tenantDb.transaction(actor.tenantId, (tx) =>
      tx.$queryRaw<AuditRow[]>(Prisma.sql`
        SELECT a.id, a.created_at, a.action, a.entity, a.entity_id, a.entity_label,
               a.actor_type, a.actor_id, u.name AS actor_name, a.changed_fields,
               a.before, a.after, a.request_id, a.ip, a.user_agent
          FROM audit_logs a
          LEFT JOIN users u ON u.id = a.actor_id
         WHERE ${Prisma.join(where, ' AND ')}
         ORDER BY a.created_at DESC, a.id DESC
         LIMIT ${take}
      `),
    );
  }
}

function toEntry(row: AuditRow): AuditEntry {
  return {
    id: row.id,
    created_at: row.created_at.toISOString(),
    action: row.action,
    entity: row.entity,
    entity_id: row.entity_id,
    entity_label: row.entity_label,
    actor_type: row.actor_type as AuditActorType,
    actor: row.actor_id
      ? { id: row.actor_id, name: row.actor_name ?? 'Removed user' }
      : null,
    changed_fields: row.changed_fields ?? [],
    before: asObject(row.before),
    after: asObject(row.after),
    request_id: row.request_id,
    ip: row.ip,
    user_agent: row.user_agent,
  };
}

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/**
 * One CSV line. Quoted always, and a cell that a spreadsheet would read as a formula is
 * prefixed with an apostrophe: a worker named `=HYPERLINK(...)` must not become a live link in
 * the owner's Excel (CSV injection).
 */
function csvRow(cells: ReadonlyArray<string | null | undefined>): string {
  return cells
    .map((cell) => {
      let text = cell ?? '';
      if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
      return `"${text.replace(/"/g, '""')}"`;
    })
    .join(',');
}
