import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  MAX_UPLOAD_BYTES,
  SNAG_TRADES,
  daysBetweenInclusive,
  isoDateToUtcDate,
  snagCanTransition,
  suggestSnagFromNote,
  todayIn,
  utcDateToIsoDate,
  type AddSnagPhotosInput,
  type CreateSnagInput,
  type FixSnagInput,
  type ListSnagsQuery,
  type PunchListItemView,
  type QuickSnagInput,
  type ReopenSnagInput,
  type SnagPhotoStage,
  type SnagPriority,
  type SnagSource,
  type SnagStatus,
  type SnagView,
  type UpdateSnagInput,
  type VerifySnagInput,
} from '@sitebook/shared';
import type { RequestUser } from '../../common/auth/request-user';
import { ProjectAccess } from '../../common/auth/project-access.service';
import { ApiError } from '../../common/errors/api-error';
import { TenantDb, type TenantTx } from '../../common/prisma/tenant-db.service';
import { SnagReader } from '../ai/snag-reader.service';
import { VoiceReader } from '../ai/voice-reader.service';
import { NotificationsService } from '../notifications/notifications.service';
import { UploadsService } from '../uploads/uploads.service';
import {
  PHOTO_KINDS,
  VOICE_KINDS,
  assertActiveUser,
  assertOwnKeys,
  assertSiteCostCode,
  costCodeView,
  isoOrNull,
  nextNumber,
  person,
  retryOnNumberClash,
} from './quality-common';

export const SNAG_INCLUDE = {
  project: { select: { id: true, name: true } },
  assignedUser: { select: { id: true, name: true } },
  assignedContractor: { select: { id: true, name: true } },
  costCode: { select: { id: true, code: true, name: true } },
  inspection: { select: { id: true, number: true, title: true } },
  test: { select: { id: true, number: true, sampleRef: true } },
  raisedBy: { select: { id: true, name: true } },
  photos: { orderBy: { createdAt: 'asc' }, select: { s3Key: true, stage: true } },
} as const satisfies Prisma.SnagInclude;

type SnagRow = Prisma.SnagGetPayload<{ include: typeof SNAG_INCLUDE }>;

/** Everything not yet closed. */
const ACTIVE: SnagStatus[] = ['draft', 'open', 'fixed'];

export interface RaiseSnag {
  tenantId: string;
  projectId: string;
  title: string;
  description?: string | null;
  location?: string | null;
  trade?: string | null;
  priority?: SnagPriority;
  status?: SnagStatus;
  source: SnagSource;
  assignedUserId?: string | null;
  assignedContractorId?: string | null;
  dueOn?: string | null;
  clientVisible?: boolean;
  costCodeId?: string | null;
  inspectionId?: string | null;
  inspectionItemId?: string | null;
  testId?: string | null;
  raisedById: string | null;
  transcript?: string | null;
  voiceS3Key?: string | null;
  aiSuggested?: boolean;
  photoKeys?: readonly string[];
  /** What the timeline says about how it came to be. */
  eventNote?: string | null;
}

/**
 * Writes one snag, its "before" photos and its first timeline entry, inside the caller's
 * transaction. Inspections and failed tests raise snags through here too, so a snag is the same
 * shape whichever way it arrived.
 */
export async function raiseSnag(tx: TenantTx, input: RaiseSnag): Promise<string> {
  const number = await nextNumber(tx, 'snag');
  const snag = await tx.snag.create({
    data: {
      tenantId: input.tenantId,
      projectId: input.projectId,
      number,
      title: input.title,
      description: input.description ?? null,
      location: input.location ?? null,
      trade: input.trade ?? null,
      priority: input.priority ?? 'medium',
      status: input.status ?? 'open',
      source: input.source,
      assignedUserId: input.assignedUserId ?? null,
      assignedContractorId: input.assignedContractorId ?? null,
      dueOn: input.dueOn ? isoDateToUtcDate(input.dueOn) : null,
      clientVisible: input.clientVisible ?? false,
      costCodeId: input.costCodeId ?? null,
      inspectionId: input.inspectionId ?? null,
      inspectionItemId: input.inspectionItemId ?? null,
      testId: input.testId ?? null,
      raisedById: input.raisedById,
      transcript: input.transcript ?? null,
      voiceS3Key: input.voiceS3Key ?? null,
      aiSuggested: input.aiSuggested ?? false,
    },
    select: { id: true },
  });
  if (input.photoKeys?.length) {
    await tx.snagPhoto.createMany({
      data: input.photoKeys.map((s3Key) => ({
        tenantId: input.tenantId,
        snagId: snag.id,
        stage: 'before' as const,
        s3Key,
        uploadedById: input.raisedById,
      })),
    });
  }
  await tx.snagEvent.create({
    data: {
      tenantId: input.tenantId,
      snagId: snag.id,
      actorId: input.raisedById,
      action: input.status === 'draft' ? 'drafted' : 'raised',
      note: input.eventNote ?? null,
    },
  });
  return snag.id;
}

/**
 * Snags and the punch list (QA/QC, roadmap Phase 2, module 7).
 *
 * draft → open → fixed → closed, with fixed or closed → open again when the fix did not hold.
 * Whoever fixed it records the "after" photo; somebody holding `quality.verify` says whether it is
 * really done. The punch list the client sees is the snags marked client-visible — never drafts,
 * and never who inside the company was told to fix them.
 */
@Injectable()
export class SnagsService {
  private readonly logger = new Logger(SnagsService.name);

  constructor(
    private readonly tenantDb: TenantDb,
    private readonly access: ProjectAccess,
    private readonly uploads: UploadsService,
    private readonly notifications: NotificationsService,
    private readonly voice: VoiceReader,
    private readonly reader: SnagReader,
  ) {}

  // --- reading -----------------------------------------------------------------------------------

  async list(actor: RequestUser, query: ListSnagsQuery): Promise<{ items: SnagView[] }> {
    if (query.project_id) await this.access.assertAccess(actor, query.project_id);
    const today = todayIn(actor.timezone);
    const rows = await this.tenantDb.clientFor(actor.tenantId).snag.findMany({
      where: {
        ...(query.project_id ? { projectId: query.project_id } : this.access.scopeFilterByProjectId(actor)),
        ...(query.status ? { status: query.status } : query.open_only ? { status: { in: ACTIVE } } : {}),
        ...(query.priority ? { priority: query.priority } : {}),
        ...(query.trade ? { trade: { equals: query.trade, mode: 'insensitive' as const } } : {}),
        ...(query.assigned_user_id ? { assignedUserId: query.assigned_user_id } : {}),
        ...(query.assigned_contractor_id ? { assignedContractorId: query.assigned_contractor_id } : {}),
        ...(query.inspection_id ? { inspectionId: query.inspection_id } : {}),
        ...(query.client_visible === undefined ? {} : { clientVisible: query.client_visible }),
        ...(query.overdue
          ? { status: { in: ['draft', 'open'] as SnagStatus[] }, dueOn: { lt: isoDateToUtcDate(today) } }
          : {}),
        project: { deletedAt: null },
      },
      include: SNAG_INCLUDE,
      // Worst first: what a manager opens this list to deal with.
      orderBy: [{ status: 'asc' }, { priority: 'desc' }, { createdAt: 'desc' }],
      take: query.limit,
    });
    return { items: await Promise.all(rows.map((row) => this.view(actor, row, today))) };
  }

  async get(actor: RequestUser, id: string): Promise<SnagView> {
    const row = await this.find(actor, id);
    const events = await this.tenantDb.clientFor(actor.tenantId).snagEvent.findMany({
      where: { snagId: id },
      orderBy: { createdAt: 'asc' },
      select: { action: true, note: true, createdAt: true, actor: { select: { id: true, name: true } } },
    });
    return {
      ...(await this.view(actor, row, todayIn(actor.timezone))),
      events: events.map((event) => ({
        action: event.action,
        note: event.note,
        actor: person(event.actor),
        at: event.createdAt.toISOString(),
      })),
    };
  }

  /** The handover punch list as the client sees it: client-visible, confirmed, no internals. */
  async punchList(actor: RequestUser, projectId: string): Promise<{ items: PunchListItemView[] }> {
    await this.access.assertAccess(actor, projectId);
    const rows = await this.tenantDb.clientFor(actor.tenantId).snag.findMany({
      where: { projectId, clientVisible: true, status: { not: 'draft' } },
      include: { photos: { orderBy: { createdAt: 'asc' }, select: { s3Key: true, stage: true } } },
      orderBy: [{ status: 'asc' }, { number: 'asc' }],
    });
    return {
      items: await Promise.all(
        rows.map(async (row) => ({
          id: row.id,
          number: row.number,
          title: row.title,
          description: row.description,
          location: row.location,
          trade: row.trade,
          priority: row.priority as SnagPriority,
          status: row.status as SnagStatus,
          due_on: isoOrNull(row.dueOn),
          fixed_at: row.fixedAt?.toISOString() ?? null,
          closed_at: row.closedAt?.toISOString() ?? null,
          photos: await this.photos(actor, row.photos),
        })),
      ),
    };
  }

  // --- raising -----------------------------------------------------------------------------------

  async create(actor: RequestUser, input: CreateSnagInput): Promise<SnagView> {
    await this.access.assertAccess(actor, input.project_id);
    assertOwnKeys(actor, input.photo_keys ?? [], PHOTO_KINDS);
    const id = await retryOnNumberClash(() =>
      this.tenantDb.transaction(actor.tenantId, async (tx) => {
        await this.assertAssignment(tx, input.project_id, input);
        return raiseSnag(tx, {
          tenantId: actor.tenantId,
          projectId: input.project_id,
          title: input.title,
          description: input.description,
          location: input.location,
          trade: input.trade,
          priority: input.priority,
          source: 'manual',
          assignedUserId: input.assigned_user_id,
          assignedContractorId: input.assigned_contractor_id,
          dueOn: input.due_on,
          clientVisible: input.client_visible,
          costCodeId: input.cost_code_id,
          raisedById: actor.userId,
          photoKeys: input.photo_keys,
        });
      }),
    );
    const view = await this.get(actor, id);
    await this.tellAssignee(actor, view);
    return view;
  }

  /**
   * A photo and a few words (or a voice note) from somebody walking the floor, as a draft.
   *
   * The words are read for a title, trade and priority: by the model when the deployment has one,
   * by the keyword rules in @sitebook/shared when it does not or when the model fails. Either way
   * the snag is a draft until a person confirms it — a misheard note must not land on a
   * subcontractor's list as an instruction.
   *
   * A voice note is transcribed and then deleted, like a spoken daily report. Where nothing can
   * transcribe it, it is kept on the snag so somebody can listen to it instead.
   */
  async quick(actor: RequestUser, input: QuickSnagInput): Promise<SnagView> {
    await this.access.assertAccess(actor, input.project_id);
    assertOwnKeys(actor, input.photo_keys, PHOTO_KINDS);
    if (input.voice_s3_key) assertOwnKeys(actor, [input.voice_s3_key], VOICE_KINDS);

    let transcript: string | null = null;
    let keepVoice: string | null = input.voice_s3_key ?? null;
    if (input.voice_s3_key && this.voice.enabled) {
      const audio = await this.uploads.readObject(actor, input.voice_s3_key, MAX_UPLOAD_BYTES.audio);
      if (!audio.contentType.startsWith('audio/')) {
        throw ApiError.validationFailed({ voice_s3_key: 'not a recording' }, 'That file is not a recording');
      }
      transcript = (await this.voice.transcribe(audio.body, audio.contentType)).text;
      keepVoice = null;
      // Best effort, as for a spoken report: the transcript is what anybody would want.
      void this.uploads.deleteObject(actor, input.voice_s3_key).catch(() => undefined);
    }

    const words = [input.note, transcript].filter(Boolean).join('. ');
    const guess = suggestSnagFromNote(words);
    let suggestion = { ...guess, description: words || null };
    let aiSuggested = false;
    if (words && this.reader.enabled) {
      try {
        const read = await this.reader.read(words, await this.knownTrades(actor));
        suggestion = { ...read, description: read.description ?? (words || null) };
        aiSuggested = true;
      } catch (error) {
        // The rules' guess stands; a model being down must never stop a snag being recorded.
        this.logger.warn({ err: (error as Error).message }, 'Snag suggestion fell back to keywords');
      }
    }

    const id = await retryOnNumberClash(() =>
      this.tenantDb.transaction(actor.tenantId, (tx) =>
        raiseSnag(tx, {
          tenantId: actor.tenantId,
          projectId: input.project_id,
          title: suggestion.title || (keepVoice ? 'Voice note snag' : 'Snag from photo'),
          description: suggestion.description,
          location: input.location,
          trade: suggestion.trade,
          priority: suggestion.priority,
          status: 'draft',
          source: 'quick_capture',
          raisedById: actor.userId,
          transcript,
          voiceS3Key: keepVoice,
          aiSuggested,
          photoKeys: input.photo_keys,
          eventNote: aiSuggested ? 'Suggested from the note by AI' : null,
        }),
      ),
    );
    return this.get(actor, id);
  }

  // --- changing ----------------------------------------------------------------------------------

  async update(actor: RequestUser, id: string, input: UpdateSnagInput): Promise<SnagView> {
    const before = await this.find(actor, id);
    if (before.status === 'closed') {
      throw ApiError.conflict('This snag is closed. Reopen it to change it.');
    }
    await this.tenantDb.transaction(actor.tenantId, async (tx) => {
      await this.assertAssignment(tx, before.projectId, input);
      await tx.snag.update({
        where: { id },
        data: {
          ...(input.title === undefined ? {} : { title: input.title }),
          ...(input.description === undefined ? {} : { description: input.description }),
          ...(input.location === undefined ? {} : { location: input.location }),
          ...(input.trade === undefined ? {} : { trade: input.trade }),
          ...(input.priority === undefined ? {} : { priority: input.priority }),
          ...(input.assigned_user_id === undefined ? {} : { assignedUserId: input.assigned_user_id }),
          ...(input.assigned_contractor_id === undefined
            ? {}
            : { assignedContractorId: input.assigned_contractor_id }),
          ...(input.due_on === undefined
            ? {}
            : { dueOn: input.due_on ? isoDateToUtcDate(input.due_on) : null }),
          ...(input.client_visible === undefined ? {} : { clientVisible: input.client_visible }),
          ...(input.cost_code_id === undefined ? {} : { costCodeId: input.cost_code_id }),
        },
      });
    });
    const view = await this.get(actor, id);
    if (input.assigned_user_id && input.assigned_user_id !== before.assignedUserId) {
      await this.tellAssignee(actor, view);
    }
    return view;
  }

  async addPhotos(actor: RequestUser, id: string, input: AddSnagPhotosInput): Promise<SnagView> {
    await this.find(actor, id);
    assertOwnKeys(actor, input.photo_keys, PHOTO_KINDS);
    await this.tenantDb.transaction(actor.tenantId, (tx) =>
      tx.snagPhoto.createMany({
        data: input.photo_keys.map((s3Key) => ({
          tenantId: actor.tenantId,
          snagId: id,
          stage: input.stage,
          s3Key,
          uploadedById: actor.userId,
        })),
      }),
    );
    return this.get(actor, id);
  }

  /** Confirms a quick-capture draft: from here it is somebody's job. */
  async open(actor: RequestUser, id: string): Promise<SnagView> {
    await this.move(actor, id, 'open', { status: 'open' }, 'confirmed', null);
    const view = await this.get(actor, id);
    await this.tellAssignee(actor, view);
    return view;
  }

  /** Whoever did the work says so, with the photo that shows it. */
  async fix(actor: RequestUser, id: string, input: FixSnagInput): Promise<SnagView> {
    assertOwnKeys(actor, input.photo_keys, PHOTO_KINDS);
    const snag = await this.move(actor, id, 'fix', { status: 'fixed', fixedAt: new Date() }, 'fixed', input.note ?? null, async (tx) => {
      await tx.snagPhoto.createMany({
        data: input.photo_keys.map((s3Key) => ({
          tenantId: actor.tenantId,
          snagId: id,
          stage: 'after' as const,
          s3Key,
          uploadedById: actor.userId,
        })),
      });
    });
    // Whoever checks fixes on this site is told there is one to check.
    await this.notifications
      .notify({
        tenantId: actor.tenantId,
        roles: ['project_manager'],
        projectId: snag.projectId,
        userIds: snag.raisedById ? [snag.raisedById] : [],
        exceptUserId: actor.userId,
        type: 'snag.fixed',
        title: `SN-${snag.number} is fixed — check it`,
        body: snag.title,
        payload: { snag_id: id, project_id: snag.projectId },
      })
      .catch((error: unknown) => this.logger.warn({ err: error }, 'Could not send the fixed notice'));
    return this.get(actor, id);
  }

  async verify(actor: RequestUser, id: string, input: VerifySnagInput): Promise<SnagView> {
    await this.move(actor, id, 'verify', { status: 'closed', closedAt: new Date() }, 'closed', input.note ?? null);
    return this.get(actor, id);
  }

  /** The fix did not hold. The reason goes on the timeline, where the person fixing it reads it. */
  async reopen(actor: RequestUser, id: string, input: ReopenSnagInput): Promise<SnagView> {
    const snag = await this.move(
      actor,
      id,
      'reopen',
      { status: 'open', fixedAt: null, closedAt: null, reopenCount: { increment: 1 } },
      'reopened',
      input.reason,
    );
    if (snag.assignedUserId && snag.assignedUserId !== actor.userId) {
      await this.notifications
        .notify({
          tenantId: actor.tenantId,
          userIds: [snag.assignedUserId],
          type: 'snag.reopened',
          title: `SN-${snag.number} was reopened`,
          body: input.reason,
          payload: { snag_id: id, project_id: snag.projectId },
        })
        .catch((error: unknown) => this.logger.warn({ err: error }, 'Could not send the reopened notice'));
    }
    return this.get(actor, id);
  }

  /** Only a draft: anything confirmed has a history somebody may need. Close it instead. */
  async remove(actor: RequestUser, id: string): Promise<void> {
    const snag = await this.find(actor, id);
    if (snag.status !== 'draft') {
      throw ApiError.conflict('Only a draft snag can be deleted. Close this one instead.');
    }
    await this.tenantDb.transaction(actor.tenantId, (tx) => tx.snag.delete({ where: { id } }));
  }

  // --- helpers -----------------------------------------------------------------------------------

  private async move(
    actor: RequestUser,
    id: string,
    action: 'open' | 'fix' | 'verify' | 'reopen',
    data: Prisma.SnagUpdateInput,
    event: string,
    note: string | null,
    extra?: (tx: TenantTx) => Promise<void>,
  ) {
    const snag = await this.find(actor, id);
    if (!snagCanTransition(action, snag.status as SnagStatus)) {
      throw ApiError.conflict(`A ${snag.status} snag cannot be ${event}`, { from: snag.status, action });
    }
    await this.tenantDb.transaction(actor.tenantId, async (tx) => {
      // Guarded on the status read above, so two people closing and reopening at once cannot both win.
      const moved = await tx.snag.updateMany({
        where: { id, status: snag.status },
        data: data as Prisma.SnagUpdateManyMutationInput,
      });
      if (moved.count === 0) throw ApiError.conflict('Somebody changed this snag a moment ago. Reload it.');
      await extra?.(tx);
      await tx.snagEvent.create({
        data: { tenantId: actor.tenantId, snagId: id, actorId: actor.userId, action: event, note },
      });
    });
    return snag;
  }

  private async find(actor: RequestUser, id: string): Promise<SnagRow> {
    const row = await this.tenantDb
      .clientFor(actor.tenantId)
      .snag.findFirst({ where: { id }, include: SNAG_INCLUDE });
    if (!row) throw ApiError.notFound('Snag');
    await this.access.assertAccess(actor, row.projectId);
    return row;
  }

  private async assertAssignment(
    tx: TenantTx,
    projectId: string,
    input: Pick<UpdateSnagInput, 'assigned_user_id' | 'assigned_contractor_id' | 'cost_code_id'>,
  ): Promise<void> {
    await assertActiveUser(tx, input.assigned_user_id, 'assigned_user_id');
    if (input.assigned_contractor_id) {
      const contractor = await tx.contractor.findFirst({
        where: { id: input.assigned_contractor_id, deletedAt: null },
        select: { id: true },
      });
      if (!contractor) {
        throw ApiError.validationFailed({ assigned_contractor_id: input.assigned_contractor_id }, 'No such contractor');
      }
    }
    await assertSiteCostCode(tx, projectId, input.cost_code_id);
  }

  private async tellAssignee(actor: RequestUser, snag: SnagView): Promise<void> {
    if (!snag.assigned_user || snag.assigned_user.id === actor.userId || snag.status === 'draft') return;
    await this.notifications
      .notify({
        tenantId: actor.tenantId,
        userIds: [snag.assigned_user.id],
        type: 'snag.assigned',
        title: `Snag SN-${snag.number} is yours`,
        body: [snag.title, snag.location].filter(Boolean).join(' · '),
        payload: { snag_id: snag.id, project_id: snag.project.id },
      })
      .catch((error: unknown) => this.logger.warn({ err: error }, 'Could not tell the assignee'));
  }

  /** The company's own trade words first, then the standard list. */
  private async knownTrades(actor: RequestUser): Promise<string[]> {
    const rows = await this.tenantDb.clientFor(actor.tenantId).snag.findMany({
      where: { trade: { not: null } },
      distinct: ['trade'],
      select: { trade: true },
      take: 30,
    });
    return [...new Set([...rows.map((row) => row.trade!), ...SNAG_TRADES])];
  }

  private photos(actor: RequestUser, photos: ReadonlyArray<{ s3Key: string; stage: string }>) {
    return Promise.all(
      photos.map(async (photo) => ({
        s3_key: photo.s3Key,
        url: await this.uploads.signedViewUrl(actor, photo.s3Key),
        stage: photo.stage as SnagPhotoStage,
      })),
    );
  }

  async view(actor: RequestUser, row: SnagRow, today: string): Promise<SnagView> {
    const raisedOn = todayIn(actor.timezone, row.createdAt);
    const dueOn = isoOrNull(row.dueOn);
    return {
      id: row.id,
      number: row.number,
      project: { id: row.project.id, name: row.project.name },
      title: row.title,
      description: row.description,
      location: row.location,
      trade: row.trade,
      priority: row.priority as SnagPriority,
      status: row.status as SnagStatus,
      source: row.source as SnagSource,
      assigned_user: person(row.assignedUser),
      assigned_contractor: person(row.assignedContractor),
      due_on: dueOn,
      overdue: (row.status === 'open' || row.status === 'draft') && dueOn !== null && dueOn < today,
      client_visible: row.clientVisible,
      cost_code: costCodeView(row.costCode),
      inspection: row.inspection,
      test: row.test ? { id: row.test.id, number: row.test.number, sample_ref: row.test.sampleRef } : null,
      raised_by: person(row.raisedBy),
      raised_at: row.createdAt.toISOString(),
      fixed_at: row.fixedAt?.toISOString() ?? null,
      closed_at: row.closedAt?.toISOString() ?? null,
      reopen_count: row.reopenCount,
      // Days on the company's calendar, so "raised today" is 0 in Dubai and in Pune alike.
      age_days: Math.max(0, daysBetweenInclusive(raisedOn, today) - 1),
      transcript: row.transcript,
      ai_suggested: row.aiSuggested,
      photos: await this.photos(actor, row.photos),
    };
  }
}

/** Open snags whose due date has passed, on the company's calendar. Fixed ones are waiting on us. */
export function snagOverdue(status: string, dueOn: Date | null, today: string): boolean {
  return (status === 'open' || status === 'draft') && dueOn !== null && utcDateToIsoDate(dueOn) < today;
}
