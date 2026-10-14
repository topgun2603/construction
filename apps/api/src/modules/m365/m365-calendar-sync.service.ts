import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { addDays, rfiLabel, utcDateToIsoDate, type M365CalendarSource } from '@sitebook/shared';
import { TenantDb } from '../../common/prisma/tenant-db.service';
import { GraphClient, GraphRequestError, type GraphEvent } from './graph-client.service';
import { M365ConfigService } from './m365-config.service';
import { M365ConnectionService, type M365Session } from './m365-connection.service';

/** More than a busy company has open at once; a ceiling so one sync cannot run for an hour. */
const MAX_EVENTS = 500;

interface Wanted {
  sourceType: M365CalendarSource;
  sourceId: string;
  event: GraphEvent;
  fingerprint: string;
}

export interface CalendarSyncResult {
  created: number;
  updated: number;
  removed: number;
  unchanged: number;
  failed: number;
}

const NOTHING: CalendarSyncResult = { created: 0, updated: 0, removed: 0, unchanged: 0, failed: 0 };

/**
 * Puts site milestones (not yet achieved) and open RFIs' due dates in the connected mailbox's
 * calendar as all-day events, when the company switches it on — and keeps them current.
 *
 * IDEMPOTENT BY CONSTRUCTION. Every event made is a row in `integration_m365_calendar_events` keyed
 * by (source type, source id) with Graph's event id and a hash of what the event says. A sync
 * compares what *should* be in the calendar with those rows: same hash → no call at all; changed →
 * PATCH the same event; gone (milestone achieved or deleted, RFI answered or closed) → DELETE it;
 * new → POST with a `transactionId` derived from the source, so a create retried after a timeout
 * cannot leave two events. Running it twice in a row makes no Graph calls the second time.
 *
 * Runs when the setting is switched on, from "Sync now", and every morning on the company's own
 * clock with the RFI reminders. Events are marked free with no reminder: they are dates to see, not
 * meetings that block the mailbox's day.
 */
@Injectable()
export class M365CalendarSyncService {
  private readonly logger = new Logger(M365CalendarSyncService.name);

  constructor(
    private readonly tenantDb: TenantDb,
    private readonly config: M365ConfigService,
    private readonly connection: M365ConnectionService,
    private readonly graph: GraphClient,
  ) {}

  async syncTenant(tenantId: string): Promise<CalendarSyncResult> {
    const settings = await this.tenantDb
      .clientFor(tenantId)
      .integrationM365Connection.findFirst({ select: { status: true, calendarSync: true } });
    if (!settings || settings.status !== 'connected' || !settings.calendarSync || !this.config.configured) return NOTHING;

    const wanted = await this.wanted(tenantId);
    const rows = await this.tenantDb.clientFor(tenantId).integrationM365CalendarEvent.findMany({});
    const existing = new Map(rows.map((row) => [`${row.sourceType}:${row.sourceId}`, row]));
    const result = { ...NOTHING };

    for (const item of wanted) {
      const key = `${item.sourceType}:${item.sourceId}`;
      const row = existing.get(key);
      existing.delete(key);
      if (row && row.fingerprint === item.fingerprint) {
        result.unchanged += 1;
        continue;
      }
      try {
        if (row) {
          try {
            await this.connection.withGraph(tenantId, (s) => this.graph.updateEvent(s.accessToken, row.graphEventId, item.event));
            await this.tenantDb.clientFor(tenantId).integrationM365CalendarEvent.update({
              where: { id: row.id },
              data: { fingerprint: item.fingerprint, syncedAt: new Date() },
            });
            result.updated += 1;
            continue;
          } catch (error) {
            // Somebody deleted it in Outlook: make it again rather than give up on the date.
            if (!(error instanceof GraphRequestError && error.status === 404)) throw error;
            await this.tenantDb.clientFor(tenantId).integrationM365CalendarEvent.delete({ where: { id: row.id } });
          }
        }
        const made = await this.connection.withGraph(tenantId, (s) =>
          this.graph.createEvent(s.accessToken, { ...item.event, transactionId: transactionId(tenantId, key, item.fingerprint) }),
        );
        await this.tenantDb.clientFor(tenantId).integrationM365CalendarEvent.create({
          data: {
            tenantId,
            sourceType: item.sourceType,
            sourceId: item.sourceId,
            graphEventId: made.id,
            fingerprint: item.fingerprint,
          },
        });
        result.created += 1;
      } catch (error) {
        if (!(error instanceof GraphRequestError)) throw error;
        result.failed += 1;
        this.logger.warn({ err: error, tenantId, key }, 'Calendar event not synced');
      }
    }

    // What is left is in the calendar but no longer wanted.
    for (const row of existing.values()) {
      try {
        await this.connection.withGraph(tenantId, (s) => this.graph.deleteEvent(s.accessToken, row.graphEventId));
        await this.tenantDb.clientFor(tenantId).integrationM365CalendarEvent.delete({ where: { id: row.id } });
        result.removed += 1;
      } catch (error) {
        if (!(error instanceof GraphRequestError)) throw error;
        result.failed += 1;
      }
    }

    await this.tenantDb
      .clientFor(tenantId)
      .integrationM365Connection.updateMany({ data: { calendarSyncedAt: new Date() } });
    return result;
  }

  /** The morning tick: never throws, so one company's Microsoft trouble cannot fail the job. */
  async syncTenantQuietly(tenantId: string): Promise<void> {
    try {
      await this.syncTenant(tenantId);
    } catch (error) {
      this.logger.warn({ err: error, tenantId }, 'Calendar sync skipped');
    }
  }

  /** Takes every synced event out of the calendar — switching the sync off, or disconnecting. */
  async removeAll(tenantId: string, session?: M365Session): Promise<number> {
    const rows = await this.tenantDb.clientFor(tenantId).integrationM365CalendarEvent.findMany({});
    let removed = 0;
    for (const row of rows) {
      try {
        if (session) await this.graph.deleteEvent(session.accessToken, row.graphEventId);
        else await this.connection.withGraph(tenantId, (s) => this.graph.deleteEvent(s.accessToken, row.graphEventId));
        removed += 1;
      } catch (error) {
        this.logger.warn({ err: error, tenantId }, 'Synced event not removed');
      }
      await this.tenantDb.clientFor(tenantId).integrationM365CalendarEvent.delete({ where: { id: row.id } });
    }
    return removed;
  }

  private async wanted(tenantId: string): Promise<Wanted[]> {
    const base = this.config.webBase;
    const { milestones, rfis } = await this.tenantDb.transaction(tenantId, async (tx) => ({
      milestones: await tx.milestone.findMany({
        where: { deletedAt: null, plannedDate: { not: null }, actualDate: null, project: { deletedAt: null } },
        select: { id: true, name: true, plannedDate: true, projectId: true, project: { select: { name: true } } },
        orderBy: { plannedDate: 'asc' },
        take: MAX_EVENTS,
      }),
      rfis: await tx.rfi.findMany({
        where: { status: 'open', dueOn: { not: null }, project: { deletedAt: null } },
        select: { id: true, number: true, subject: true, dueOn: true, project: { select: { name: true } } },
        orderBy: { dueOn: 'asc' },
        take: MAX_EVENTS,
      }),
    }));
    const out: Wanted[] = [];
    for (const milestone of milestones) {
      out.push(
        allDay('milestone', milestone.id, `Milestone: ${milestone.name} — ${milestone.project.name}`, utcDateToIsoDate(milestone.plannedDate!), base ? `${base}/projects/${milestone.projectId}` : null),
      );
    }
    for (const rfi of rfis) {
      out.push(
        allDay('rfi_due', rfi.id, `${rfiLabel(rfi.number)} due: ${rfi.subject} — ${rfi.project.name}`, utcDateToIsoDate(rfi.dueOn!), base ? `${base}/rfis/${rfi.id}` : null),
      );
    }
    return out.slice(0, MAX_EVENTS);
  }
}

function allDay(sourceType: M365CalendarSource, sourceId: string, subject: string, day: string, url: string | null): Wanted {
  const event: GraphEvent = {
    subject: subject.slice(0, 250),
    // Text, not HTML: the only content is a link, and Outlook makes a plain URL clickable.
    body: { contentType: 'Text', content: url ? `Open in BUILDR: ${url}` : 'From BUILDR' },
    // All-day events are midnight to midnight; UTC keeps them on the same date for everybody.
    start: { dateTime: `${day}T00:00:00`, timeZone: 'UTC' },
    end: { dateTime: `${addDays(day, 1)}T00:00:00`, timeZone: 'UTC' },
    isAllDay: true,
    showAs: 'free',
    isReminderOn: false,
  };
  const fingerprint = createHash('sha256').update(JSON.stringify(event)).digest('hex');
  return { sourceType, sourceId, event, fingerprint };
}

/** Same source, same content, same id: Graph treats a repeat as the same create. */
function transactionId(tenantId: string, key: string, fingerprint: string): string {
  return createHash('sha256').update(`${tenantId}:${key}:${fingerprint}`).digest('hex').slice(0, 36);
}
