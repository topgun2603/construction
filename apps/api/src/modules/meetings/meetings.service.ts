import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import {
  isoDateToUtcDate,
  meetingActionIsOverdue,
  todayIn,
  utcDateToIsoDate,
  type MeetingActionItemInput,
  type MeetingActionItemUpdateInput,
  type MeetingActionStatus,
  type MeetingAttendeeInput,
  type MeetingCreateInput,
  type MeetingListQuery,
  type MeetingSendMinutesInput,
  type MeetingStatus,
  type MeetingUpdateInput,
} from '@sitebook/shared';
import type { RequestUser } from '../../common/auth/request-user';
import { ProjectAccess } from '../../common/auth/project-access.service';
import { ApiError } from '../../common/errors/api-error';
import { TenantDb, type TenantTx } from '../../common/prisma/tenant-db.service';
import { meetingInviteBody, meetingMinutesEmail } from '../m365/email-templates';
import { GraphClient, GraphRequestError, type GraphEvent } from '../m365/graph-client.service';
import { M365ConfigService } from '../m365/m365-config.service';
import { M365ConnectionService, audit } from '../m365/m365-connection.service';
import { M365MailService } from '../m365/m365-mail.service';

const MEETING_INCLUDE = {
  project: { select: { id: true, name: true } },
  attendees: { orderBy: { createdAt: 'asc' } },
  actionItems: { orderBy: { createdAt: 'asc' } },
} as const satisfies Prisma.MeetingInclude;

type MeetingRow = Prisma.MeetingGetPayload<{ include: typeof MEETING_INCLUDE }>;

/**
 * Site meetings (roadmap Phase 3, "Calendar and email: Microsoft 365 for meeting minutes"): the
 * weekly coordination meeting, the design review with the architect, the client walk-round.
 *
 * Lightweight on purpose — when, who, the agenda, then the minutes and the action items with an
 * owner and a due date. With Microsoft 365 connected, "Send invite" books it in the connected
 * mailbox's calendar with everybody invited (and a second press updates the same event, which
 * Outlook sends on as an update), and "Send minutes" emails the minutes and actions to everybody who
 * was asked. Without it, the meeting is still a record the site keeps.
 */
@Injectable()
export class MeetingsService {
  private readonly logger = new Logger(MeetingsService.name);

  constructor(
    private readonly tenantDb: TenantDb,
    private readonly access: ProjectAccess,
    private readonly config: M365ConfigService,
    private readonly connection: M365ConnectionService,
    private readonly mail: M365MailService,
    private readonly graph: GraphClient,
  ) {}

  async list(actor: RequestUser, query: MeetingListQuery) {
    if (query.project_id) await this.access.assertAccess(actor, query.project_id);
    const rows = await this.tenantDb.transaction(actor.tenantId, (tx) =>
      tx.meeting.findMany({
        where: {
          project: { deletedAt: null },
          ...(query.project_id ? { projectId: query.project_id } : this.access.scopeFilterByProjectId(actor)),
        },
        orderBy: { startsAt: 'desc' },
        take: 200,
        include: {
          project: { select: { id: true, name: true } },
          _count: { select: { attendees: true } },
          actionItems: { where: { status: 'open' }, select: { id: true } },
        },
      }),
    );
    return rows.map((row) => ({
      ...summary(row),
      attendee_count: row._count.attendees,
      open_actions: row.actionItems.length,
    }));
  }

  async get(actor: RequestUser, id: string) {
    const row = await this.tenantDb.transaction(actor.tenantId, (tx) => this.load(tx, actor, id));
    return this.detail(actor, row);
  }

  async create(actor: RequestUser, input: MeetingCreateInput) {
    await this.access.assertAccess(actor, input.project_id);
    const id = await this.tenantDb.transaction(actor.tenantId, async (tx) => {
      const attendees = await resolveAttendees(tx, input.attendees ?? []);
      const made = await tx.meeting.create({
        data: {
          tenantId: actor.tenantId,
          projectId: input.project_id,
          title: input.title,
          startsAt: new Date(input.starts_at),
          endsAt: new Date(input.ends_at),
          location: input.location ?? null,
          agenda: input.agenda ?? null,
          createdByUserId: actor.userId,
        },
        select: { id: true },
      });
      if (attendees.length > 0) {
        await tx.meetingAttendee.createMany({
          data: attendees.map((attendee) => ({ tenantId: actor.tenantId, meetingId: made.id, ...attendee })),
        });
      }
      return made.id;
    });
    return this.get(actor, id);
  }

  async update(actor: RequestUser, id: string, input: MeetingUpdateInput) {
    await this.tenantDb.transaction(actor.tenantId, async (tx) => {
      const row = await this.load(tx, actor, id);
      assertLive(row);
      const holdsMinutes = typeof input.minutes === 'string' && input.minutes.trim() !== '';
      await tx.meeting.update({
        where: { id },
        data: {
          ...(input.title === undefined ? {} : { title: input.title }),
          ...(input.starts_at === undefined ? {} : { startsAt: new Date(input.starts_at), endsAt: new Date(input.ends_at!) }),
          ...(input.location === undefined ? {} : { location: input.location }),
          ...(input.agenda === undefined ? {} : { agenda: input.agenda }),
          ...(input.minutes === undefined ? {} : { minutes: input.minutes }),
          // Minutes are written after a meeting has happened.
          ...(holdsMinutes && row.status === 'scheduled' ? { status: 'held' } : {}),
        },
      });
      if (input.attendees !== undefined) {
        const attendees = await resolveAttendees(tx, input.attendees);
        await tx.meetingAttendee.deleteMany({ where: { meetingId: id } });
        if (attendees.length > 0) {
          await tx.meetingAttendee.createMany({
            data: attendees.map((attendee) => ({ tenantId: actor.tenantId, meetingId: id, ...attendee })),
          });
        }
      }
    });
    return this.get(actor, id);
  }

  /**
   * Called off. An invite that went out is cancelled in Outlook too, which tells every attendee —
   * best effort: the meeting is cancelled here whatever Microsoft says.
   */
  async cancel(actor: RequestUser, id: string) {
    const row = await this.tenantDb.transaction(actor.tenantId, async (tx) => {
      const current = await this.load(tx, actor, id);
      if (current.status === 'cancelled') return current;
      await tx.meeting.update({ where: { id }, data: { status: 'cancelled' } });
      await audit(tx, actor.tenantId, actor.userId, 'meeting.cancelled', { title: current.title }, 'meetings', id);
      return current;
    });
    if (row.graphEventId && row.status !== 'cancelled') {
      try {
        await this.connection.withGraph(actor.tenantId, (session) =>
          this.graph.cancelEvent(session.accessToken, row.graphEventId!, 'This meeting has been cancelled.'),
        );
      } catch (error) {
        this.logger.warn({ err: error, meetingId: id }, 'Outlook event not cancelled');
      }
    }
    return this.get(actor, id);
  }

  /** Only a meeting nobody was invited to — once invites are out, it is cancelled, not erased. */
  async remove(actor: RequestUser, id: string): Promise<void> {
    await this.tenantDb.transaction(actor.tenantId, async (tx) => {
      const row = await this.load(tx, actor, id);
      if (row.inviteSentAt || row.minutesSentAt) {
        throw ApiError.conflict('Invites or minutes have gone out for this meeting. Cancel it instead.');
      }
      await tx.meeting.delete({ where: { id } });
    });
  }

  // --- action items --------------------------------------------------------------------------------

  async addAction(actor: RequestUser, id: string, input: MeetingActionItemInput) {
    await this.tenantDb.transaction(actor.tenantId, async (tx) => {
      const row = await this.load(tx, actor, id);
      if (row.status === 'cancelled') throw ApiError.conflict('This meeting was cancelled');
      await assertMember(tx, input.owner_user_id);
      await tx.meetingActionItem.create({
        data: {
          tenantId: actor.tenantId,
          meetingId: id,
          description: input.description,
          ownerUserId: input.owner_user_id ?? null,
          ownerName: input.owner_user_id ? null : (input.owner_name ?? null),
          dueOn: input.due_on ? isoDateToUtcDate(input.due_on) : null,
        },
      });
    });
    return this.get(actor, id);
  }

  async updateAction(actor: RequestUser, id: string, itemId: string, input: MeetingActionItemUpdateInput) {
    await this.tenantDb.transaction(actor.tenantId, async (tx) => {
      const row = await this.load(tx, actor, id);
      const item = row.actionItems.find((entry) => entry.id === itemId);
      if (!item) throw ApiError.notFound('Action item');
      await assertMember(tx, input.owner_user_id);
      await tx.meetingActionItem.update({
        where: { id: itemId },
        data: {
          ...(input.description === undefined ? {} : { description: input.description }),
          ...(input.owner_user_id === undefined ? {} : { ownerUserId: input.owner_user_id, ...(input.owner_user_id ? { ownerName: null } : {}) }),
          ...(input.owner_name === undefined || input.owner_user_id ? {} : { ownerName: input.owner_name }),
          ...(input.due_on === undefined ? {} : { dueOn: input.due_on ? isoDateToUtcDate(input.due_on) : null }),
          ...(input.status === undefined || input.status === item.status
            ? {}
            : { status: input.status, completedAt: input.status === 'done' ? new Date() : null }),
        },
      });
    });
    return this.get(actor, id);
  }

  async removeAction(actor: RequestUser, id: string, itemId: string) {
    await this.tenantDb.transaction(actor.tenantId, async (tx) => {
      await this.load(tx, actor, id);
      const deleted = await tx.meetingActionItem.deleteMany({ where: { id: itemId, meetingId: id } });
      if (deleted.count === 0) throw ApiError.notFound('Action item');
    });
    return this.get(actor, id);
  }

  // --- Microsoft 365 -------------------------------------------------------------------------------

  /**
   * Books the meeting in the connected mailbox's calendar with every attendee who has an address
   * invited — or, pressed again after a change, updates that same event (Outlook sends the attendees
   * the update). People on the team without an email on their profile are listed back as skipped.
   */
  async sendInvite(actor: RequestUser, id: string) {
    await this.connection.session(actor.tenantId);
    const row = await this.tenantDb.transaction(actor.tenantId, (tx) => this.load(tx, actor, id));
    if (row.status === 'cancelled') throw ApiError.conflict('This meeting was cancelled');
    const { invited, skipped } = await this.addresses(actor.tenantId, row);
    if (invited.length === 0) throw ApiError.validationFailed({ attendees: 'no email' }, 'Nobody on the list has an email address to invite.');

    const company = await this.companyName(actor.tenantId);
    const event: GraphEvent = {
      subject: `${row.title} — ${row.project.name}`.slice(0, 250),
      body: {
        contentType: 'HTML',
        content: meetingInviteBody({ companyName: company, siteName: row.project.name, agenda: row.agenda, url: this.link(id) }),
      },
      // UTC on the wire; every attendee's Outlook shows it in their own zone.
      start: { dateTime: graphDateTime(row.startsAt), timeZone: 'UTC' },
      end: { dateTime: graphDateTime(row.endsAt), timeZone: 'UTC' },
      ...(row.location ? { location: { displayName: row.location } } : {}),
      attendees: invited.map((person) => ({
        emailAddress: person.name ? { address: person.address, name: person.name } : { address: person.address },
        type: 'required' as const,
      })),
    };

    let eventId = row.graphEventId;
    try {
      if (eventId) {
        const existing = eventId;
        await this.connection.withGraph(actor.tenantId, (s) => this.graph.updateEvent(s.accessToken, existing, event));
      } else {
        const made = await this.connection.withGraph(actor.tenantId, (s) =>
          this.graph.createEvent(s.accessToken, { ...event, transactionId: inviteTransactionId(row) }),
        );
        eventId = made.id;
      }
    } catch (error) {
      if (error instanceof GraphRequestError) {
        throw ApiError.conflict(`Microsoft 365 did not send the invite: ${error.message}`);
      }
      throw error;
    }

    await this.tenantDb.transaction(actor.tenantId, async (tx) => {
      await tx.meeting.update({ where: { id }, data: { graphEventId: eventId, inviteSentAt: new Date() } });
      await audit(
        tx,
        actor.tenantId,
        actor.userId,
        'meeting.invite_sent',
        { title: row.title, to: invited.map((person) => person.address), updated: Boolean(row.graphEventId) },
        'meetings',
        id,
      );
    });
    return { meeting: await this.get(actor, id), invited: invited.map((person) => person.address), skipped };
  }

  /** Emails the minutes and the action items to everybody who was asked, from the connected mailbox. */
  async sendMinutes(actor: RequestUser, id: string, input: MeetingSendMinutesInput) {
    await this.connection.session(actor.tenantId);
    const row = await this.tenantDb.transaction(actor.tenantId, (tx) => this.load(tx, actor, id));
    if (row.status === 'cancelled') throw ApiError.conflict('This meeting was cancelled');
    if (!row.minutes?.trim() && row.actionItems.length === 0) {
      throw ApiError.validationFailed({ minutes: 'empty' }, 'Write the minutes or add an action item before sending.');
    }
    const { invited, skipped } = await this.addresses(actor.tenantId, row);
    if (invited.length === 0) throw ApiError.validationFailed({ attendees: 'no email' }, 'Nobody on the list has an email address.');

    const names = await this.ownerNames(actor.tenantId, row);
    const delivery = await this.mail.send({
      tenantId: actor.tenantId,
      actorId: actor.userId,
      kind: 'meeting_minutes',
      entityType: 'meeting',
      entityId: id,
      projectId: row.projectId,
      to: invited,
      content: meetingMinutesEmail({
        companyName: await this.companyName(actor.tenantId),
        siteName: row.project.name,
        title: row.title,
        when: whenText(row.startsAt, row.endsAt, actor),
        location: row.location,
        attendees: row.attendees.map((attendee) => attendee.name),
        minutes: row.minutes,
        actionItems: row.actionItems.map((item) => ({
          description: item.description,
          owner: item.ownerUserId ? (names.get(item.ownerUserId) ?? 'Former member') : item.ownerName,
          dueOn: item.dueOn ? utcDateToIsoDate(item.dueOn) : null,
          done: item.status === 'done',
        })),
        url: this.link(id),
        note: input.note,
      }),
    });
    await this.tenantDb.transaction(actor.tenantId, async (tx) => {
      await tx.meeting.update({
        where: { id },
        data: { minutesSentAt: new Date(), ...(row.status === 'scheduled' ? { status: 'held' } : {}) },
      });
      await audit(tx, actor.tenantId, actor.userId, 'meeting.minutes_sent', { title: row.title, delivery_id: delivery.id }, 'meetings', id);
    });
    return { meeting: await this.get(actor, id), delivery, skipped };
  }

  // --- reading -------------------------------------------------------------------------------------

  private async load(tx: TenantTx, actor: RequestUser, id: string): Promise<MeetingRow> {
    const row = await tx.meeting.findFirst({ where: { id, project: { deletedAt: null } }, include: MEETING_INCLUDE });
    if (!row) throw ApiError.notFound('Meeting');
    await this.access.assertAccess(actor, row.projectId);
    return row;
  }

  private async detail(actor: RequestUser, row: MeetingRow) {
    const [names, deliveries] = await Promise.all([
      this.ownerNames(actor.tenantId, row),
      this.mail.deliveriesFor(actor.tenantId, 'meeting', row.id),
    ]);
    const today = todayIn(actor.timezone);
    return {
      ...summary(row),
      agenda: row.agenda,
      minutes: row.minutes,
      created_by: { id: row.createdByUserId, name: names.get(row.createdByUserId) ?? 'Former member' },
      attendees: row.attendees.map((attendee) => ({
        id: attendee.id,
        user_id: attendee.userId,
        name: attendee.userId ? (names.get(attendee.userId) ?? attendee.name) : attendee.name,
        email: attendee.userId ? names.email(attendee.userId) : attendee.email,
        external: !attendee.userId,
      })),
      action_items: row.actionItems.map((item) => {
        const due = item.dueOn ? utcDateToIsoDate(item.dueOn) : null;
        return {
          id: item.id,
          description: item.description,
          owner: item.ownerUserId
            ? { user_id: item.ownerUserId, name: names.get(item.ownerUserId) ?? 'Former member' }
            : item.ownerName
              ? { user_id: null, name: item.ownerName }
              : null,
          due_on: due,
          status: item.status as MeetingActionStatus,
          overdue: meetingActionIsOverdue(item.status as MeetingActionStatus, due, today),
          completed_at: item.completedAt?.toISOString() ?? null,
        };
      }),
      emails: deliveries,
    };
  }

  /** Names (and addresses) of everybody on the team a meeting mentions. */
  private async ownerNames(tenantId: string, row: MeetingRow) {
    const ids = [
      row.createdByUserId,
      ...row.attendees.map((attendee) => attendee.userId),
      ...row.actionItems.map((item) => item.ownerUserId),
    ].filter((value): value is string => Boolean(value));
    const users = await this.tenantDb
      .clientFor(tenantId)
      .user.findMany({ where: { id: { in: [...new Set(ids)] } }, select: { id: true, name: true, email: true } });
    return new People(users);
  }

  /** Who the invite or minutes go to: team members by their profile address, outsiders by theirs. */
  private async addresses(tenantId: string, row: MeetingRow) {
    const names = await this.ownerNames(tenantId, row);
    const invited: Array<{ address: string; name: string }> = [];
    const skipped: string[] = [];
    const seen = new Set<string>();
    for (const attendee of row.attendees) {
      const address = (attendee.userId ? names.email(attendee.userId) : attendee.email)?.trim().toLowerCase();
      const name = attendee.userId ? (names.get(attendee.userId) ?? attendee.name) : attendee.name;
      if (!address) {
        skipped.push(name);
        continue;
      }
      if (seen.has(address)) continue;
      seen.add(address);
      invited.push({ address, name });
    }
    return { invited, skipped };
  }

  private link(id: string): string | null {
    return this.config.webBase ? `${this.config.webBase}/meetings/${id}` : null;
  }

  private async companyName(tenantId: string): Promise<string> {
    const tenant = await this.tenantDb
      .clientFor(tenantId)
      .tenant.findUnique({ where: { id: tenantId }, select: { name: true } });
    return tenant?.name ?? 'Your builder';
  }
}

/** Team members a meeting mentions, by id. A removed member keeps a name. */
class People {
  private readonly byId: Map<string, { name: string; email: string | null }>;

  constructor(users: Array<{ id: string; name: string; email: string | null }>) {
    this.byId = new Map(users.map((user) => [user.id, { name: user.name, email: user.email }]));
  }

  get(id: string): string | undefined {
    return this.byId.get(id)?.name;
  }

  email(id: string): string | null {
    return this.byId.get(id)?.email ?? null;
  }
}

function summary(row: {
  id: string;
  project: { id: string; name: string };
  title: string;
  startsAt: Date;
  endsAt: Date;
  location: string | null;
  status: string;
  graphEventId: string | null;
  inviteSentAt: Date | null;
  minutesSentAt: Date | null;
}) {
  return {
    id: row.id,
    project: row.project,
    title: row.title,
    starts_at: row.startsAt.toISOString(),
    ends_at: row.endsAt.toISOString(),
    location: row.location,
    status: row.status as MeetingStatus,
    in_calendar: Boolean(row.graphEventId),
    invite_sent_at: row.inviteSentAt?.toISOString() ?? null,
    minutes_sent_at: row.minutesSentAt?.toISOString() ?? null,
  };
}

function assertLive(row: { status: string }): void {
  if (row.status === 'cancelled') throw ApiError.conflict('This meeting was cancelled');
}

/**
 * Team members must be people in this company (live accounts); their address is read when an invite
 * goes, so a corrected profile email is the one used. Outsiders are kept by address. Duplicates —
 * the same person twice, or a team member also typed in by address — are dropped.
 */
async function resolveAttendees(
  tx: TenantTx,
  input: readonly MeetingAttendeeInput[],
): Promise<Array<{ userId: string | null; email: string | null; name: string }>> {
  const userIds = [...new Set(input.flatMap((entry) => ('user_id' in entry ? [entry.user_id] : [])))];
  const users = userIds.length
    ? await tx.user.findMany({ where: { id: { in: userIds }, deletedAt: null }, select: { id: true, name: true, email: true } })
    : [];
  if (users.length !== userIds.length) {
    throw ApiError.validationFailed({ attendees: 'unknown person' }, 'One of those people is not in this company');
  }
  const byId = new Map(users.map((user) => [user.id, user]));
  const out: Array<{ userId: string | null; email: string | null; name: string }> = [];
  const seenUsers = new Set<string>();
  const seenEmails = new Set(users.map((user) => user.email?.toLowerCase()).filter(Boolean));
  for (const entry of input) {
    if ('user_id' in entry) {
      if (seenUsers.has(entry.user_id)) continue;
      seenUsers.add(entry.user_id);
      out.push({ userId: entry.user_id, email: null, name: byId.get(entry.user_id)!.name });
    } else {
      if (seenEmails.has(entry.email)) continue;
      seenEmails.add(entry.email);
      out.push({ userId: null, email: entry.email, name: entry.name?.trim() || entry.email });
    }
  }
  return out;
}

async function assertMember(tx: TenantTx, userId: string | null | undefined): Promise<void> {
  if (!userId) return;
  const user = await tx.user.findFirst({ where: { id: userId, deletedAt: null }, select: { id: true } });
  if (!user) throw ApiError.validationFailed({ owner_user_id: userId }, 'That person is not in this company');
}

/** Graph's `dateTime`: no offset, read in the `timeZone` beside it (UTC here). */
function graphDateTime(value: Date): string {
  return value.toISOString().slice(0, 19);
}

/** One create per version of the meeting: a retried request cannot book it twice. */
function inviteTransactionId(row: { id: string; updatedAt: Date }): string {
  return createHash('sha256').update(`${row.id}:${row.updatedAt.toISOString()}`).digest('hex').slice(0, 36);
}

/** "7 Oct 2026, 10:00 – 11:00" on the company's clock, for the minutes. */
function whenText(start: Date, end: Date, actor: Pick<RequestUser, 'locale' | 'timezone'>): string {
  const day = new Intl.DateTimeFormat(actor.locale, { dateStyle: 'medium', timeZone: actor.timezone });
  const time = new Intl.DateTimeFormat(actor.locale, { timeStyle: 'short', timeZone: actor.timezone });
  return `${day.format(start)}, ${time.format(start)} – ${time.format(end)}`;
}
