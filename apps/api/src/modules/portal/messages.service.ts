import { Injectable } from '@nestjs/common';
import {
  MESSAGE_DELETE_WINDOW_MINUTES,
  withinDeleteWindow,
  type ListMessagesQuery,
  type MarkMessagesReadInput,
  type PostMessageInput,
} from '@sitebook/shared';
import { ApiError } from '../../common/errors/api-error';
import { ProjectAccess } from '../../common/auth/project-access.service';
import type { RequestUser } from '../../common/auth/request-user';
import { TenantDb } from '../../common/prisma/tenant-db.service';
import { JobQueueService } from '../../jobs/job-queue.service';
import { UploadsService } from '../uploads/uploads.service';

const MESSAGE_SELECT = {
  id: true,
  body: true,
  audience: true,
  createdAt: true,
  projectId: true,
  author: { select: { id: true, name: true, role: true } },
  recipient: { select: { id: true, name: true, role: true } },
  attachments: {
    select: {
      id: true,
      s3Key: true,
      thumbS3Key: true,
      contentType: true,
      sizeBytes: true,
      filename: true,
      caption: true,
    },
  },
} as const;

/**
 * The conversation on a site.
 *
 * One thread per job, shared by the client and the team, with a second audience the client cannot
 * see. Everything here turns on that distinction, so it is enforced in one place — `audienceFor` —
 * rather than being re-decided at each call site.
 *
 * Reading is gated on being able to see the project at all; `ProjectAccess` already answers that,
 * and a client is only ever a member of their own job.
 */
@Injectable()
export class MessagesService {
  constructor(
    private readonly tenantDb: TenantDb,
    private readonly access: ProjectAccess,
    private readonly uploads: UploadsService,
    private readonly jobs: JobQueueService,
  ) {}

  /**
   * Which audiences this person may read and write.
   *
   * `messages.internal` is the whole of it: with it you are on the team, without it every word you
   * write is visible to the client and you never see theirs. A client without the permission cannot
   * ask for team messages, and cannot post one either — the API refuses rather than quietly
   * downgrading, because a note written believing it was private and delivered to the client is the
   * failure this feature must not have.
   */
  private visibleTo(actor: RequestUser) {
    const broadcast: Array<'everyone' | 'team'> = actor.permissions.includes('messages.internal')
      ? ['everyone', 'team']
      : ['everyone'];

    return {
      OR: [
        { audience: { in: broadcast } },
        /*
         * A direct message reaches its two people and nobody else.
         *
         * Not "the team can see team direct messages": somebody asking the site engineer privately
         * whether the client is being difficult has picked one person deliberately, and a rule that
         * quietly widened that to everyone holding `messages.internal` would be the same leak as
         * showing a team note to the client, one rung down.
         */
        { audience: 'direct' as const, authorId: actor.userId },
        { audience: 'direct' as const, recipientId: actor.userId },
      ],
    };
  }

  async list(actor: RequestUser, projectId: string, query: ListMessagesQuery) {
    await this.access.assertAccess(actor, projectId);

    const db = this.tenantDb.clientFor(actor.tenantId);

    const [messages, reads] = await Promise.all([
      db.siteMessage.findMany({
        where: {
          projectId,
          deletedAt: null,
          ...this.visibleTo(actor),
          ...(query.before ? { createdAt: { lt: new Date(query.before) } } : {}),
        },
        select: MESSAGE_SELECT,
        // Newest first for paging; the client reverses it to read as a conversation.
        orderBy: { createdAt: 'desc' },
        take: query.limit,
      }),
      db.siteMessageRead.findMany({
        where: { projectId },
        select: { userId: true, lastReadAt: true, user: { select: { id: true, name: true } } },
      }),
    ]);

    const mine = reads.find((row) => row.userId === actor.userId)?.lastReadAt ?? null;

    return {
      items: await Promise.all(messages.map((message) => this.view(actor, message, reads))),
      /*
       * How much of this thread this person has not seen.
       *
       * Counted from the watermark rather than from the page just fetched, so a badge is right on a
       * site with four hundred messages that nobody is going to scroll.
       */
      unread_count: await db.siteMessage.count({
        where: {
          projectId,
          deletedAt: null,
          ...this.visibleTo(actor),
          // Your own words are not news to you.
          authorId: { not: actor.userId },
          ...(mine ? { createdAt: { gt: mine } } : {}),
        },
      }),
      last_read_at: mine?.toISOString() ?? null,
      // The oldest of this page, to ask for what came before it.
      next_before:
        messages.length === query.limit
          ? messages[messages.length - 1]!.createdAt.toISOString()
          : null,
    };
  }

  /**
   * Marks this site's conversation read up to an instant.
   *
   * The watermark only ever moves forwards. A phone that has been offline replays what it queued in
   * whatever order the network allows, and letting a stale "read up to 09:14" overwrite a live
   * "read up to 11:40" would resurrect a morning of messages as unread every time somebody's train
   * went into a tunnel.
   */
  async markRead(actor: RequestUser, projectId: string, input: MarkMessagesReadInput) {
    await this.access.assertAccess(actor, projectId);

    const now = new Date();
    const asked = input.up_to ? new Date(input.up_to) : now;
    // Never into the future: a phone with a wrong clock would otherwise mark unsent messages read.
    const upTo = asked > now ? now : asked;

    const db = this.tenantDb.clientFor(actor.tenantId);
    const existing = await db.siteMessageRead.findUnique({
      where: { projectId_userId: { projectId, userId: actor.userId } },
      select: { lastReadAt: true },
    });

    if (existing && existing.lastReadAt >= upTo) {
      return { last_read_at: existing.lastReadAt.toISOString(), unread_count: 0 };
    }

    await db.siteMessageRead.upsert({
      where: { projectId_userId: { projectId, userId: actor.userId } },
      create: {
        tenantId: actor.tenantId,
        projectId,
        userId: actor.userId,
        lastReadAt: upTo,
      },
      update: { lastReadAt: upTo },
    });

    return {
      last_read_at: upTo.toISOString(),
      unread_count: await db.siteMessage.count({
        where: {
          projectId,
          deletedAt: null,
          ...this.visibleTo(actor),
          authorId: { not: actor.userId },
          createdAt: { gt: upTo },
        },
      }),
    };
  }

  /**
   * Who can be written to on this site.
   *
   * Members, plus the owners and accounts staff who see every job without being assigned to one —
   * a supervisor wanting to ask the owner something should not have to be told to add them to the
   * site first. The client is in this list like anybody else: writing to them privately is the
   * point, and the audience marker on the message is what says whether it was private.
   */
  async recipients(actor: RequestUser, projectId: string) {
    await this.access.assertAccess(actor, projectId);
    const db = this.tenantDb.clientFor(actor.tenantId);

    const [members, wide] = await Promise.all([
      db.projectMember.findMany({
        where: { projectId },
        select: { user: { select: { id: true, name: true, role: true, status: true } } },
      }),
      db.user.findMany({
        where: { status: 'active', role: { in: ['owner', 'accounts'] } },
        select: { id: true, name: true, role: true, status: true },
      }),
    ]);

    const people = new Map<string, { id: string; name: string; role: string }>();
    for (const row of [...members.map((member) => member.user), ...wide]) {
      if (row.status !== 'active' || row.id === actor.userId) continue;
      people.set(row.id, { id: row.id, name: row.name, role: row.role });
    }

    return {
      items: [...people.values()].sort((a, b) => a.name.localeCompare(b.name)),
    };
  }

  async post(actor: RequestUser, projectId: string, input: PostMessageInput) {
    await this.access.assertAccess(actor, projectId);

    if (input.audience === 'team' && !actor.permissions.includes('messages.internal')) {
      throw ApiError.forbidden('Your role cannot write team-only notes');
    }

    /*
     * A direct message must name somebody who can already see this site.
     *
     * Not a permission check on the writer — anybody who can post may write to one person — but on
     * the reader: delivering to somebody with no access would put a site's business in front of
     * someone who was never given it, and it is the one place a caller supplies a user id.
     */
    if (input.audience === 'direct') {
      await this.assertCanReceive(actor, projectId, input.recipient_id!);
    }

    for (const attachment of input.attachments) {
      // A key is a string somebody could have made up; knowing one must not be enough to attach it.
      if (!attachment.s3_key.startsWith(`${actor.tenantId}/`)) {
        throw ApiError.forbidden('That file does not belong to this account');
      }
    }

    const db = this.tenantDb.clientFor(actor.tenantId);

    if (input.client_id) {
      // A phone that posted and lost the answer retries; this is the same message, not a second one.
      const existing = await db.siteMessage.findFirst({
        where: { clientId: input.client_id },
        select: MESSAGE_SELECT,
      });
      if (existing) return this.view(actor, existing);
    }

    const message = await db.siteMessage.create({
      data: {
        tenantId: actor.tenantId,
        projectId,
        authorId: actor.userId,
        recipientId: input.audience === 'direct' ? input.recipient_id! : null,
        body: input.body,
        audience: input.audience,
        clientId: input.client_id ?? null,
        attachments: {
          create: input.attachments.map((attachment) => ({
            tenantId: actor.tenantId,
            s3Key: attachment.s3_key,
            contentType: attachment.content_type,
            sizeBytes: attachment.size_bytes,
            filename: attachment.filename ?? null,
            caption: attachment.caption ?? null,
          })),
        },
      },
      select: MESSAGE_SELECT,
    });

    /*
     * Telling the other side.
     *
     * A conversation nobody is told about is a form nobody fills in twice. Team-only notes notify
     * nobody outside the team, which the notification job works out from the audience — passing it
     * along rather than deciding here keeps the rule in one place.
     */
    await this.jobs.siteMessagePosted({
      tenantId: actor.tenantId,
      projectId,
      messageId: message.id,
      authorId: actor.userId,
      audience: input.audience,
      recipientId: input.audience === 'direct' ? input.recipient_id! : null,
    });

    return this.view(actor, message);
  }

  /**
   * Whether somebody may be written to about this site.
   *
   * Mirrors what `ProjectAccess` grants a person on the way in: assigned to the job, or one of the
   * roles that sees every job. Anything else is refused as not-found rather than forbidden — a
   * caller probing user ids should not learn which ones exist in this account.
   */
  private async assertCanReceive(actor: RequestUser, projectId: string, recipientId: string) {
    if (recipientId === actor.userId) {
      throw ApiError.conflict('You cannot send a message to yourself');
    }

    const db = this.tenantDb.clientFor(actor.tenantId);
    const recipient = await db.user.findFirst({
      where: { id: recipientId, status: 'active' },
      select: { id: true, role: true },
    });
    if (!recipient) throw ApiError.notFound('That person');

    if (recipient.role === 'owner' || recipient.role === 'accounts') return;

    const member = await db.projectMember.findFirst({
      where: { projectId, userId: recipientId },
      select: { id: true },
    });
    if (!member) throw ApiError.notFound('That person');
  }

  /**
   * Take back a message.
   *
   * Within half an hour, and only ever soft. The window is the point: thirty minutes covers the
   * wrong site, the wrong person and the thumb that sent half a sentence, and past it somebody has
   * almost certainly read the thing. A thread where a message can vanish the next day is not a
   * record of what was said about a job, which is the only reason it is here rather than on
   * WhatsApp.
   *
   * The two checks answer different questions and neither substitutes for the other. `projects.
   * manage` decides *whose* message you may take down — an owner can remove somebody else's, an
   * author only their own. The clock decides *whether anyone still can*, and it binds everybody:
   * a record a senior enough person can still edit a week later is not a record, and the client on
   * the other side of the thread would have no way of knowing it had happened.
   */
  async remove(actor: RequestUser, messageId: string) {
    const db = this.tenantDb.clientFor(actor.tenantId);
    const message = await db.siteMessage.findFirst({
      where: { id: messageId, deletedAt: null },
      select: { id: true, authorId: true, projectId: true, createdAt: true },
    });
    if (!message) throw ApiError.notFound('That message no longer exists');

    if (message.authorId !== actor.userId && !actor.permissions.includes('projects.manage')) {
      throw ApiError.forbidden('Only the person who wrote it can take a message back');
    }

    if (!withinDeleteWindow(message.createdAt)) {
      throw ApiError.forbidden(
        `A message can only be taken back within ${MESSAGE_DELETE_WINDOW_MINUTES} minutes of sending it`,
      );
    }

    await db.siteMessage.update({ where: { id: messageId }, data: { deletedAt: new Date() } });
  }

  private async view(
    actor: RequestUser,
    message: {
      id: string;
      body: string;
      audience: string;
      createdAt: Date;
      projectId: string;
      author: { id: string; name: string; role: string };
      recipient: { id: string; name: string; role: string } | null;
      attachments: Array<{
        id: string;
        s3Key: string;
        thumbS3Key: string | null;
        contentType: string;
        sizeBytes: number;
        filename: string | null;
        caption: string | null;
      }>;
    },
    reads: ReadonlyArray<{ userId: string; lastReadAt: Date; user: { id: string; name: string } }> =
      [],
  ) {
    const mine = message.author.id === actor.userId;

    return {
      id: message.id,
      body: message.body,
      audience: message.audience,
      created_at: message.createdAt.toISOString(),
      author: message.author,
      recipient: message.recipient,
      mine,
      /*
       * Whether the Remove control should be drawn at all.
       *
       * Decided here rather than by each UI comparing timestamps: a phone with a wrong clock would
       * otherwise offer a button that 403s, or hide one that would have worked. The server owns the
       * clock that matters.
       */
      can_delete:
        (mine || actor.permissions.includes('projects.manage')) &&
        withinDeleteWindow(message.createdAt),
      /*
       * Who has seen it.
       *
       * Only on your own messages: "has the client read my answer" is the question this exists to
       * settle, and telling everybody who has read everybody else's messages turns a receipt into
       * surveillance of a team by each other.
       *
       * A direct message narrows to the one person it was for — a broadcast's readers are anybody
       * whose watermark has passed it.
       */
      read_by: mine ? readersOf(message, reads) : [],
      attachments: await Promise.all(
        message.attachments.map(async (attachment) => ({
          id: attachment.id,
          content_type: attachment.contentType,
          size_bytes: attachment.sizeBytes,
          filename: attachment.filename,
          caption: attachment.caption,
          /** Whether it can be shown, or only offered for download. */
          is_image: attachment.contentType.startsWith('image/'),
          // Signed here rather than handing out keys: the objects stay private, and a link that
          // leaks stops working instead of being a permanent window into somebody's site.
          url: await this.uploads.signedViewUrl(actor, attachment.thumbS3Key ?? attachment.s3Key),
          full_url: await this.uploads.signedViewUrl(actor, attachment.s3Key),
        })),
      ),
    };
  }
}

/** Everybody whose watermark has reached this message, other than whoever wrote it. */
function readersOf(
  message: {
    createdAt: Date;
    audience: string;
    author: { id: string };
    recipient: { id: string } | null;
  },
  reads: ReadonlyArray<{ userId: string; lastReadAt: Date; user: { id: string; name: string } }>,
): Array<{ id: string; name: string }> {
  return reads
    .filter((row) => {
      if (row.userId === message.author.id) return false;
      if (row.lastReadAt < message.createdAt) return false;
      if (message.audience === 'direct') return row.userId === message.recipient?.id;
      return true;
    })
    .map((row) => row.user);
}
