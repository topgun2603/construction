import { Injectable } from '@nestjs/common';
import {
  MAX_UPLOAD_BYTES,
  isoDateToUtcDate,
  safetyNumber,
  safetySuggestFromNote,
  type CloseSafetyObservationInput,
  type CreateSafetyObservationInput,
  type ListSafetyObservationsQuery,
  type QuickSafetyObservationInput,
  type SafetySuggestion,
} from '@sitebook/shared';
import { can, type RequestUser } from '../../common/auth/request-user';
import { ProjectAccess } from '../../common/auth/project-access.service';
import { ApiError } from '../../common/errors/api-error';
import { TenantDb, type TenantTx } from '../../common/prisma/tenant-db.service';
import { siteActor } from '../../common/site-clock';
import { SafetyReader } from '../ai/safety-reader.service';
import { VoiceReader } from '../ai/voice-reader.service';
import { AiGateway } from '../ai/ai-gateway.service';
import { UploadsService } from '../uploads/uploads.service';
import { dayRange } from './safety-incidents.service';
import {
  PHOTO_SELECT,
  actionView,
  addPhotos,
  assertSafetyPhotoKey,
  companyDay,
  companyInstant,
  companyLocal,
  companyToday,
  isoDay,
  namesFor,
  nextSafetyNumber,
  person,
  photoView,
  withNumberRetry,
} from './safety-common';

export interface SuggestionResult extends SafetySuggestion {
  /** `ai` when the model answered, `rules` when the keyword fallback did. */
  source: 'ai' | 'rules';
}

/**
 * Safety observations (roadmap Phase 2, module 8): what somebody walking the site noticed — an
 * unsafe act, an unsafe condition, or good practice worth saying so about — with a photo, and the
 * corrective action and close-out photo that settle it.
 *
 * Quick capture is the way most of these arrive: a photo and a few words, or a voice note. People on
 * site rarely type, so the type, category and severity are suggested and only confirmed.
 */
@Injectable()
export class SafetyObservationsService {
  constructor(
    private readonly tenantDb: TenantDb,
    private readonly access: ProjectAccess,
    private readonly uploads: UploadsService,
    private readonly reader: SafetyReader,
    private readonly voice: VoiceReader,
    private readonly gateway: AiGateway,
  ) {}

  async list(actor: RequestUser, query: ListSafetyObservationsQuery) {
    if (query.project_id) await this.access.assertAccess(actor, query.project_id);
    return this.tenantDb.transaction(actor.tenantId, async (tx) => {
      const rows = await tx.safetyObservation.findMany({
        where: {
          ...(query.project_id ? { projectId: query.project_id } : this.access.scopeFilterByProjectId(actor)),
          ...(query.status ? { status: query.status } : {}),
          ...(query.type ? { type: query.type } : {}),
          ...(query.category ? { category: query.category } : {}),
          ...dayRange('observedOn', query.from, query.to),
          project: { deletedAt: null },
        },
        include: {
          project: { select: { id: true, name: true } },
          actions: { select: { status: true } },
          photos: { select: { id: true } },
        },
        orderBy: [{ observedAt: 'desc' }, { id: 'desc' }],
        take: query.limit,
      });
      const names = await namesFor(tx, rows.map((row) => row.reportedBy));
      return {
        items: rows.map((row) => ({
          id: row.id,
          number: safetyNumber('OBS', row.number),
          project: row.project,
          observed_at: row.observedAt.toISOString(),
          observed_on: isoDay(row.observedOn),
          type: row.type,
          category: row.category,
          severity: row.severity,
          description: row.description,
          location: row.location,
          status: row.status,
          suggested_by: row.suggestedBy,
          open_actions: row.actions.filter((a) => a.status === 'open').length,
          photos: row.photos.length,
          reported_by: person(names, row.reportedBy),
        })),
      };
    });
  }

  async get(actor: RequestUser, id: string) {
    return this.tenantDb.transaction(actor.tenantId, async (tx) => {
      const row = await this.find(tx, actor, id);
      const names = await namesFor(tx, [
        row.reportedBy,
        row.closedBy,
        ...row.actions.flatMap((a) => [a.assigneeId, a.raisedBy, a.doneBy]),
        ...row.photos.map((p) => p.uploadedBy),
      ]);
      const today = companyToday(actor);
      const site = await siteActor(tx, actor, row.projectId);
      const photos = await Promise.all(
        row.photos.map(async (photo) => ({
          ...photoView(photo, names),
          url: await this.uploads.signedViewUrl(actor, photo.s3Key),
        })),
      );
      return {
        id: row.id,
        number: safetyNumber('OBS', row.number),
        project: row.project,
        observed_at: row.observedAt.toISOString(),
        observed_local: companyLocal(site, row.observedAt),
        observed_on: isoDay(row.observedOn),
        type: row.type,
        category: row.category,
        severity: row.severity,
        description: row.description,
        location: row.location,
        transcript: row.transcript,
        suggested_by: row.suggestedBy,
        status: row.status,
        reported_by: person(names, row.reportedBy),
        closed_by: person(names, row.closedBy),
        closed_at: row.closedAt?.toISOString() ?? null,
        close_note: row.closeNote,
        actions: row.actions.map((action) => actionView(action, names, today)),
        photos,
        created_at: row.createdAt.toISOString(),
      };
    });
  }

  /** The form, filled in by hand. */
  async create(actor: RequestUser, input: CreateSafetyObservationInput) {
    await this.access.assertAccess(actor, input.project_id);
    const existing = await this.byClientId(actor, input.client_id);
    if (existing) return this.get(actor, existing);
    for (const key of input.photo_keys ?? []) assertSafetyPhotoKey(actor, key);
    // A time typed on site is the site's wall clock.
    const site = await siteActor(this.tenantDb.clientFor(actor.tenantId), actor, input.project_id);
    const observedAt = input.observed_at ? companyInstant(site, input.observed_at) : new Date();

    const id = await withNumberRetry(() =>
      this.tenantDb.transaction(actor.tenantId, async (tx) => {
        const made = await this.insert(tx, actor, {
          projectId: input.project_id,
          observedAt,
          type: input.type,
          category: input.category,
          severity: input.severity,
          description: input.description,
          location: input.location ?? null,
          transcript: null,
          suggestedBy: null,
          clientId: input.client_id ?? null,
        });
        await addPhotos(tx, actor, input.project_id, { observationId: made }, input.photo_keys ?? []);
        if (input.action && input.type !== 'positive') {
          if (input.action.assignee_id) await assertMember(tx, input.action.assignee_id);
          await tx.safetyAction.create({
            data: {
              tenantId: actor.tenantId,
              projectId: input.project_id,
              observationId: made,
              kind: input.action.kind,
              description: input.action.description,
              assigneeId: input.action.assignee_id ?? null,
              dueOn: input.action.due_on ? isoDateToUtcDate(input.action.due_on) : null,
              raisedOn: isoDateToUtcDate(companyToday(actor)),
              raisedBy: actor.userId,
            },
          });
        }
        return made;
      }),
    );
    return this.get(actor, id);
  }

  /**
   * A photo and a few words — or a voice note — and nothing else required.
   *
   * Works without an AI key: the note is read by keyword rules. With a key, the voice note is
   * transcribed and the model makes the first guess, falling back to the rules if it fails. Either
   * way the result is a normal, editable observation, and the response says where the guess came
   * from so the screen can ask the person to check it.
   */
  async quick(actor: RequestUser, input: QuickSafetyObservationInput) {
    await this.access.assertAccess(actor, input.project_id);
    const existing = await this.byClientId(actor, input.client_id);
    if (existing) return { observation: await this.get(actor, existing), suggestion: null };
    if (input.photo_key) assertSafetyPhotoKey(actor, input.photo_key);

    let transcript: string | null = null;
    if (input.voice_s3_key) {
      // Refused before the recording is read; typing a few words still works either way.
      await this.gateway.assertEnabled(
        actor.tenantId,
        'voice',
        'Voice notes are not configured on this deployment. Type a few words instead.',
      );
      const audio = await this.uploads.readObject(actor, input.voice_s3_key, MAX_UPLOAD_BYTES.audio);
      if (!audio.contentType.startsWith('audio/')) {
        throw ApiError.validationFailed({ voice_s3_key: 'not a recording' }, 'That file is not a recording');
      }
      transcript = (await this.voice.transcribe(actor.tenantId, audio.body, audio.contentType)).text;
      // A recording of somebody's voice has no business outliving its transcript.
      void this.uploads.deleteObject(actor, input.voice_s3_key).catch(() => undefined);
    }

    const description = [input.note, transcript].filter(Boolean).join('\n');
    const needsGuess = !input.type || !input.category || !input.severity;
    const suggestion = needsGuess ? await this.suggest(actor.tenantId, description) : null;
    const type = input.type ?? suggestion!.type;

    const id = await withNumberRetry(() =>
      this.tenantDb.transaction(actor.tenantId, async (tx) => {
        const made = await this.insert(tx, actor, {
          projectId: input.project_id,
          observedAt: new Date(),
          type,
          category: input.category ?? suggestion!.category,
          severity: input.severity ?? suggestion!.severity,
          description,
          location: input.location ?? null,
          transcript,
          suggestedBy: suggestion?.source ?? null,
          clientId: input.client_id ?? null,
        });
        if (input.photo_key) {
          await addPhotos(tx, actor, input.project_id, { observationId: made }, [input.photo_key]);
        }
        return made;
      }),
    );
    return { observation: await this.get(actor, id), suggestion };
  }

  /** The guess on its own, to pre-fill a form before anything is saved. */
  async suggest(tenantId: string, note: string): Promise<SuggestionResult> {
    // The rules answer whenever the model is not asked — switched off, no key, or a failed call.
    const ai = await this.reader.classify(tenantId, note);
    if (ai) return { ...ai, source: 'ai' };
    return { ...safetySuggestFromNote(note), source: 'rules' };
  }

  /**
   * Settled: the condition is fixed, or the person was spoken to. Closing completes the
   * observation's open actions with the same note, because for most observations the fix and the
   * close-out are one act by one person.
   */
  async close(actor: RequestUser, id: string, input: CloseSafetyObservationInput) {
    if (input.closeout_photo_key) assertSafetyPhotoKey(actor, input.closeout_photo_key);
    await this.tenantDb.transaction(actor.tenantId, async (tx) => {
      const row = await this.find(tx, actor, id);
      if (row.status === 'closed') throw ApiError.conflict('This observation is already closed');
      const assignee = row.actions.some((a) => a.status === 'open' && a.assigneeId === actor.userId);
      if (!can(actor, 'safety.manage') && !assignee) {
        throw ApiError.forbidden('Only a safety manager or the person the fix is assigned to can close this');
      }
      const now = new Date();
      await tx.safetyObservation.update({
        where: { id },
        data: { status: 'closed', closedBy: actor.userId, closedAt: now, closeNote: input.note ?? null },
      });
      await tx.safetyAction.updateMany({
        where: { observationId: id, status: 'open' },
        data: { status: 'done', doneBy: actor.userId, doneAt: now, note: input.note ?? null },
      });
      if (input.closeout_photo_key) {
        await addPhotos(tx, actor, row.projectId, { observationId: id }, [input.closeout_photo_key], 'closeout');
      }
    });
    return this.get(actor, id);
  }

  // --- helpers -----------------------------------------------------------------------------------

  private async insert(
    tx: TenantTx,
    actor: RequestUser,
    data: {
      projectId: string;
      observedAt: Date;
      type: 'unsafe_act' | 'unsafe_condition' | 'positive';
      category: string;
      severity: 'low' | 'medium' | 'high' | 'critical';
      description: string;
      location: string | null;
      transcript: string | null;
      suggestedBy: string | null;
      clientId: string | null;
    },
  ): Promise<string> {
    const number = await nextSafetyNumber(tx, 'observation');
    const positive = data.type === 'positive';
    const made = await tx.safetyObservation.create({
      data: {
        tenantId: actor.tenantId,
        number,
        ...data,
        observedOn: companyDay(await siteActor(tx, actor, data.projectId), data.observedAt),
        reportedBy: actor.userId,
        // Good practice has nothing to fix: it is recorded and done.
        ...(positive ? { status: 'closed', closedBy: actor.userId, closedAt: new Date() } : {}),
      },
      select: { id: true },
    });
    return made.id;
  }

  private async byClientId(actor: RequestUser, clientId: string | undefined): Promise<string | null> {
    if (!clientId) return null;
    const row = await this.tenantDb
      .clientFor(actor.tenantId)
      .safetyObservation.findFirst({ where: { clientId }, select: { id: true } });
    return row?.id ?? null;
  }

  private async find(tx: TenantTx, actor: RequestUser, id: string) {
    const row = await tx.safetyObservation.findFirst({
      where: { id },
      include: {
        project: { select: { id: true, name: true } },
        actions: { orderBy: { createdAt: 'asc' } },
        photos: { select: PHOTO_SELECT, orderBy: { createdAt: 'asc' } },
      },
    });
    if (!row) throw ApiError.notFound('Observation');
    await this.access.assertAccess(actor, row.projectId);
    return row;
  }
}

async function assertMember(tx: TenantTx, userId: string): Promise<void> {
  const user = await tx.user.findFirst({ where: { id: userId, deletedAt: null }, select: { id: true } });
  if (!user) throw ApiError.validationFailed({ assignee_id: userId }, 'That person is not on the team');
}
