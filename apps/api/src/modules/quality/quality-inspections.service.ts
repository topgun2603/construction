import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  isoDateToUtcDate,
  qualityCompletionProblems,
  qualityMeasurementOutcome,
  qualityOverallResult,
  todayIn,
  type CompleteQualityInspectionInput,
  type CreateQualityInspectionInput,
  type ListQualityInspectionsQuery,
  type QualityInspectionResult,
  type QualityInspectionStatus,
  type QualityInspectionSummary,
  type QualityInspectionView,
  type QualityItemKind,
  type QualityItemOutcome,
  type QualitySignoffParty,
  type RecordQualityInspectionItemsInput,
  type SignQualityInspectionInput,
  type SnagStatus,
  type UpdateQualityInspectionInput,
} from '@sitebook/shared';
import { can, type RequestUser } from '../../common/auth/request-user';
import { ProjectAccess } from '../../common/auth/project-access.service';
import { ApiError } from '../../common/errors/api-error';
import { TenantDb, type TenantTx } from '../../common/prisma/tenant-db.service';
import { NotificationsService } from '../notifications/notifications.service';
import { UploadsService } from '../uploads/uploads.service';
import {
  PHOTO_KINDS,
  assertActiveUser,
  assertOwnKeys,
  assertSiteCostCode,
  costCodeView,
  dec,
  isoOrNull,
  nextNumber,
  person,
  retryOnNumberClash,
  signPhotos,
} from './quality-common';
import { raiseSnag } from './snags.service';

const SUMMARY_INCLUDE = {
  project: { select: { id: true, name: true } },
  template: { select: { id: true, name: true } },
  inspector: { select: { id: true, name: true } },
  items: { select: { outcome: true } },
  signoffs: { select: { party: true } },
  _count: { select: { snags: true } },
} as const satisfies Prisma.QualityInspectionInclude;

const DETAIL_INCLUDE = {
  project: { select: { id: true, name: true } },
  template: { select: { id: true, name: true } },
  inspector: { select: { id: true, name: true } },
  costCode: { select: { id: true, code: true, name: true } },
  milestone: { select: { id: true, name: true } },
  items: {
    orderBy: { position: 'asc' },
    include: { snag: { select: { id: true, number: true, status: true } } },
  },
  signoffs: {
    orderBy: { signedAt: 'asc' },
    include: { user: { select: { id: true, name: true } } },
  },
  _count: { select: { snags: true } },
} as const satisfies Prisma.QualityInspectionInclude;

type SummaryRow = Prisma.QualityInspectionGetPayload<{ include: typeof SUMMARY_INCLUDE }>;
type DetailRow = Prisma.QualityInspectionGetPayload<{ include: typeof DETAIL_INCLUDE }>;

/**
 * Inspections: a checklist run on one place on one site (QA/QC, roadmap Phase 2, module 7).
 *
 * The template's lines are copied in when it starts, so the library can change without rewriting
 * anything somebody signed. The inspector answers line by line (the runner saves as they go), then
 * signs: the signature fixes the result, and every failed line becomes a snag with the line's
 * photos as its "before" — a failure nobody owns is a failure nobody fixes.
 */
@Injectable()
export class QualityInspectionsService {
  private readonly logger = new Logger(QualityInspectionsService.name);

  constructor(
    private readonly tenantDb: TenantDb,
    private readonly access: ProjectAccess,
    private readonly uploads: UploadsService,
    private readonly notifications: NotificationsService,
  ) {}

  // --- reading -----------------------------------------------------------------------------------

  async list(actor: RequestUser, query: ListQualityInspectionsQuery): Promise<{ items: QualityInspectionSummary[] }> {
    if (query.project_id) await this.access.assertAccess(actor, query.project_id);
    const rows = await this.tenantDb.clientFor(actor.tenantId).qualityInspection.findMany({
      where: {
        ...(query.project_id ? { projectId: query.project_id } : this.access.scopeFilterByProjectId(actor)),
        ...(query.status ? { status: query.status } : {}),
        ...(query.result ? { result: query.result } : {}),
        ...(query.template_id ? { templateId: query.template_id } : {}),
        ...(query.from || query.to
          ? {
              inspectionDate: {
                ...(query.from ? { gte: isoDateToUtcDate(query.from) } : {}),
                ...(query.to ? { lte: isoDateToUtcDate(query.to) } : {}),
              },
            }
          : {}),
        project: { deletedAt: null },
      },
      include: SUMMARY_INCLUDE,
      orderBy: [{ inspectionDate: 'desc' }, { number: 'desc' }],
      take: query.limit,
    });
    return { items: rows.map(summaryView) };
  }

  /** The completed inspections shared with the client of one site: what the portal shows them. */
  async shared(actor: RequestUser, projectId: string): Promise<{ items: QualityInspectionSummary[] }> {
    await this.access.assertAccess(actor, projectId);
    const rows = await this.tenantDb.clientFor(actor.tenantId).qualityInspection.findMany({
      where: { projectId, shareWithClient: true, status: 'completed' },
      include: SUMMARY_INCLUDE,
      orderBy: [{ inspectionDate: 'desc' }, { number: 'desc' }],
    });
    return { items: rows.map(summaryView) };
  }

  async get(actor: RequestUser, id: string): Promise<QualityInspectionView> {
    const row = await this.tenantDb
      .clientFor(actor.tenantId)
      .qualityInspection.findFirst({ where: { id }, include: DETAIL_INCLUDE });
    if (!row) throw ApiError.notFound('Inspection');
    await this.access.assertAccess(actor, row.projectId);
    // Somebody outside the quality team (the client) sees only what was shared with them, signed.
    if (!seesQuality(actor) && !(row.shareWithClient && row.status === 'completed')) {
      throw ApiError.notFound('Inspection');
    }
    return this.detailView(actor, row);
  }

  // --- running one -------------------------------------------------------------------------------

  async create(actor: RequestUser, input: CreateQualityInspectionInput): Promise<QualityInspectionView> {
    await this.access.assertAccess(actor, input.project_id);
    const id = await retryOnNumberClash(() =>
      this.tenantDb.transaction(actor.tenantId, async (tx) => {
        const template = await tx.qualityChecklistTemplate.findFirst({
          where: { id: input.template_id },
          include: { items: { orderBy: { position: 'asc' } } },
        });
        if (!template) throw ApiError.notFound('Checklist');
        if (!template.active) throw ApiError.conflict('That checklist is archived. Restore it to use it.');
        await assertSiteCostCode(tx, input.project_id, input.cost_code_id);
        await assertMilestone(tx, input.project_id, input.milestone_id);
        await assertActiveUser(tx, input.inspector_id, 'inspector_id');

        const made = await tx.qualityInspection.create({
          data: {
            tenantId: actor.tenantId,
            projectId: input.project_id,
            templateId: template.id,
            number: await nextNumber(tx, 'qualityInspection'),
            title: template.name,
            trade: template.trade,
            location: input.location,
            inspectionDate: isoDateToUtcDate(input.inspection_date ?? todayIn(actor.timezone)),
            inspectorId: input.inspector_id ?? actor.userId,
            costCodeId: input.cost_code_id ?? null,
            milestoneId: input.milestone_id ?? null,
            notes: input.notes ?? null,
            shareWithClient: input.share_with_client ?? false,
          },
          select: { id: true },
        });
        // The lines as they are today. Editing the library later never reaches this inspection.
        await tx.qualityInspectionItem.createMany({
          data: template.items.map((item) => ({
            tenantId: actor.tenantId,
            inspectionId: made.id,
            position: item.position,
            label: item.label,
            kind: item.kind,
            required: item.required,
            photoRequired: item.photoRequired,
            unit: item.unit,
            targetValue: item.targetValue,
            toleranceMinus: item.toleranceMinus,
            tolerancePlus: item.tolerancePlus,
            guidance: item.guidance,
          })),
        });
        return made.id;
      }),
    );
    return this.get(actor, id);
  }

  /** Sharing with the client can change at any time; everything else only while it is open. */
  async update(actor: RequestUser, id: string, input: UpdateQualityInspectionInput): Promise<QualityInspectionView> {
    await this.tenantDb.transaction(actor.tenantId, async (tx) => {
      const row = await this.lockFor(tx, actor, id);
      const { share_with_client: share, ...rest } = input;
      if (Object.keys(rest).length > 0 && row.status !== 'in_progress') {
        throw ApiError.conflict('This inspection is signed. Only whether the client sees it can change.');
      }
      await assertSiteCostCode(tx, row.projectId, input.cost_code_id);
      await assertMilestone(tx, row.projectId, input.milestone_id);
      await assertActiveUser(tx, input.inspector_id, 'inspector_id');
      await tx.qualityInspection.update({
        where: { id },
        data: {
          ...(input.location === undefined ? {} : { location: input.location }),
          ...(input.inspection_date === undefined
            ? {}
            : { inspectionDate: isoDateToUtcDate(input.inspection_date) }),
          ...(input.inspector_id === undefined ? {} : { inspectorId: input.inspector_id }),
          ...(input.cost_code_id === undefined ? {} : { costCodeId: input.cost_code_id }),
          ...(input.milestone_id === undefined ? {} : { milestoneId: input.milestone_id }),
          ...(input.notes === undefined ? {} : { notes: input.notes }),
          ...(share === undefined ? {} : { shareWithClient: share }),
        },
      });
    });
    return this.get(actor, id);
  }

  /**
   * Answers for some lines. A number line's outcome is worked out from its reading and tolerance —
   * a measurement outside the tolerance is a fail whatever was tapped — unless it was marked not
   * applicable. A text line counts as answered once something is written.
   */
  async recordItems(
    actor: RequestUser,
    id: string,
    input: RecordQualityInspectionItemsInput,
  ): Promise<QualityInspectionView> {
    assertOwnKeys(actor, input.items.flatMap((item) => item.photo_keys ?? []), PHOTO_KINDS);
    await this.tenantDb.transaction(actor.tenantId, async (tx) => {
      const row = await this.lockFor(tx, actor, id);
      if (row.status !== 'in_progress') throw ApiError.conflict('This inspection is signed and cannot change');
      const lines = await tx.qualityInspectionItem.findMany({ where: { inspectionId: id } });
      const byId = new Map(lines.map((line) => [line.id, line]));

      for (const answer of input.items) {
        const line = byId.get(answer.id);
        if (!line) throw ApiError.validationFailed({ id: answer.id }, 'That line is not on this inspection');

        const numberValue = answer.number_value === undefined ? dec(line.numberValue) : answer.number_value;
        const textValue = answer.text_value === undefined ? line.textValue : answer.text_value;
        let outcome: QualityItemOutcome | null =
          answer.outcome === undefined ? (line.outcome as QualityItemOutcome | null) : answer.outcome;

        if (line.kind === 'number' && outcome !== 'na') {
          if (numberValue === null) {
            outcome = null;
          } else {
            const judged = qualityMeasurementOutcome(numberValue, {
              target: dec(line.targetValue),
              minus: dec(line.toleranceMinus),
              plus: dec(line.tolerancePlus),
            });
            // No target: a reading is recorded, and the inspector's own call stands (pass by default).
            outcome = judged ?? (outcome === 'fail' ? 'fail' : 'pass');
          }
        }
        if (line.kind === 'text' && outcome === null && textValue) outcome = 'pass';

        await tx.qualityInspectionItem.update({
          where: { id: line.id },
          data: {
            outcome,
            numberValue: line.kind === 'number' && outcome !== 'na' ? numberValue : null,
            textValue,
            ...(answer.photo_keys === undefined ? {} : { photoKeys: answer.photo_keys }),
            ...(answer.comment === undefined ? {} : { comment: answer.comment }),
          },
        });
      }
    });
    return this.get(actor, id);
  }

  /**
   * The inspector's signature. Refused while a required line is blank or a photo line has no
   * photo; the result follows from the answers (a failed line fails it, full stop); and every
   * failed line becomes a snag unless the inspector says they are tracked elsewhere.
   */
  async complete(
    actor: RequestUser,
    id: string,
    input: CompleteQualityInspectionInput,
  ): Promise<QualityInspectionView> {
    const outcome = await retryOnNumberClash(() =>
      this.tenantDb.transaction(actor.tenantId, async (tx) => {
        const row = await this.lockFor(tx, actor, id);
        if (row.status !== 'in_progress') throw ApiError.conflict('This inspection is already signed');
        const lines = await tx.qualityInspectionItem.findMany({
          where: { inspectionId: id },
          orderBy: { position: 'asc' },
          include: { snag: { select: { id: true } } },
        });
        const answered = lines.map((line) => ({
          label: line.label,
          kind: line.kind as QualityItemKind,
          required: line.required,
          photoRequired: line.photoRequired,
          outcome: line.outcome as QualityItemOutcome | null,
          photoCount: line.photoKeys.length,
          comment: line.comment,
        }));
        const problems = qualityCompletionProblems(answered);
        if (problems.length > 0) {
          throw ApiError.conflict(problems[0]!, { problems });
        }
        const notes = input.notes === undefined ? row.notes : input.notes;
        const result = qualityOverallResult(answered, { notes, requested: input.result ?? null });

        await tx.qualityInspection.update({
          where: { id },
          data: { status: 'completed', result, completedAt: new Date(), notes },
        });
        await tx.qualityInspectionSignoff.create({
          data: {
            tenantId: actor.tenantId,
            inspectionId: id,
            party: 'inspector',
            userId: actor.userId,
            signatureName: input.signature_name,
          },
        });

        const raised: number[] = [];
        if (input.raise_snags !== false) {
          for (const line of lines) {
            if (line.outcome !== 'fail' || line.snag) continue;
            const reading =
              line.kind === 'number' && line.numberValue !== null
                ? `Measured ${dec(line.numberValue)}${line.unit ? ` ${line.unit}` : ''}`
                : null;
            const snagId = await raiseSnag(tx, {
              tenantId: actor.tenantId,
              projectId: row.projectId,
              title: line.label,
              description: [line.comment, reading, `Failed on QI-${row.number} ${row.title}`]
                .filter(Boolean)
                .join('. '),
              location: row.location,
              trade: row.trade,
              priority: 'high',
              source: 'inspection',
              costCodeId: row.costCodeId,
              inspectionId: id,
              inspectionItemId: line.id,
              raisedById: actor.userId,
              photoKeys: line.photoKeys,
              eventNote: `Failed line on inspection QI-${row.number}`,
            });
            raised.push((await tx.snag.findUniqueOrThrow({ where: { id: snagId }, select: { number: true } })).number);
          }
        }
        return { result, raised, projectId: row.projectId, number: row.number, title: row.title, location: row.location };
      }),
    );

    if (outcome.result === 'fail') {
      // A failed pour card holds up the pour: the site's managers hear about it now, not at the
      // weekly review.
      await this.notifications
        .notify({
          tenantId: actor.tenantId,
          roles: ['owner', 'project_manager'],
          projectId: outcome.projectId,
          exceptUserId: actor.userId,
          type: 'quality.inspection_failed',
          title: `Inspection failed: ${outcome.title}`,
          body: `QI-${outcome.number} · ${outcome.location} · ${outcome.raised.length} snag(s) raised`,
          payload: { inspection_id: id, project_id: outcome.projectId },
        })
        .catch((error: unknown) => this.logger.warn({ err: error }, 'Could not send the failed-inspection notice'));
    }
    return this.get(actor, id);
  }

  /**
   * A countersignature on a completed inspection: the client's (through the portal, only on what
   * was shared with them) or a consultant's — anyone else holding `quality.verify`. Once per
   * party; accepted or not, it is on the record.
   */
  async sign(actor: RequestUser, id: string, input: SignQualityInspectionInput): Promise<QualityInspectionView> {
    const party: QualitySignoffParty = actor.role === 'client' ? 'client' : 'consultant';
    if (party === 'consultant' && !can(actor, 'quality.verify')) {
      throw ApiError.forbidden('Countersigning an inspection needs “Close or reopen fixed snags, and countersign”');
    }
    await this.tenantDb
      .transaction(actor.tenantId, async (tx) => {
        const row = await this.lockFor(tx, actor, id);
        if (party === 'client' && !row.shareWithClient) throw ApiError.notFound('Inspection');
        if (row.status !== 'completed') {
          throw ApiError.conflict('The inspector signs first; countersign it once it is complete');
        }
        await tx.qualityInspectionSignoff.create({
          data: {
            tenantId: actor.tenantId,
            inspectionId: id,
            party,
            userId: actor.userId,
            signatureName: input.signature_name,
            accepted: input.accepted,
            note: input.note ?? null,
          },
        });
      })
      .catch((error: unknown) => {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
          throw ApiError.conflict(`The ${party} has already signed this inspection`);
        }
        throw error;
      });
    return this.get(actor, id);
  }

  /** Only an unsigned one: a signed inspection is evidence. */
  async remove(actor: RequestUser, id: string): Promise<void> {
    await this.tenantDb.transaction(actor.tenantId, async (tx) => {
      const row = await this.lockFor(tx, actor, id);
      if (row.status !== 'in_progress') {
        throw ApiError.conflict('A signed inspection cannot be deleted');
      }
      await tx.qualityInspection.delete({ where: { id } });
    });
  }

  // --- helpers -----------------------------------------------------------------------------------

  /** The row, with a lock so two phones saving the same inspection apply one after the other. */
  private async lockFor(tx: TenantTx, actor: RequestUser, id: string) {
    const locked = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM quality_inspections WHERE id = ${id}::uuid FOR UPDATE`;
    if (locked.length === 0) throw ApiError.notFound('Inspection');
    const row = await tx.qualityInspection.findUniqueOrThrow({ where: { id } });
    await this.access.assertAccess(actor, row.projectId);
    return row;
  }

  private async detailView(actor: RequestUser, row: DetailRow): Promise<QualityInspectionView> {
    const items = await Promise.all(
      row.items.map(async (item) => ({
        id: item.id,
        position: item.position,
        label: item.label,
        kind: item.kind as QualityItemKind,
        required: item.required,
        photo_required: item.photoRequired,
        unit: item.unit,
        target_value: dec(item.targetValue),
        tolerance_minus: dec(item.toleranceMinus),
        tolerance_plus: dec(item.tolerancePlus),
        guidance: item.guidance,
        outcome: item.outcome as QualityItemOutcome | null,
        number_value: dec(item.numberValue),
        text_value: item.textValue,
        comment: item.comment,
        photos: await signPhotos(this.uploads, actor, item.photoKeys),
        snag: item.snag
          ? { id: item.snag.id, number: item.snag.number, status: item.snag.status as SnagStatus }
          : null,
      })),
    );
    const problems =
      row.status === 'in_progress'
        ? qualityCompletionProblems(
            items.map((item) => ({
              label: item.label,
              kind: item.kind,
              required: item.required,
              photoRequired: item.photo_required,
              outcome: item.outcome,
              photoCount: item.photos.length,
              comment: item.comment,
            })),
          )
        : [];
    return {
      ...summaryView({ ...row, items: row.items.map((item) => ({ outcome: item.outcome })) } as unknown as SummaryRow),
      notes: row.notes,
      cost_code: costCodeView(row.costCode),
      milestone: row.milestone,
      items,
      signoffs: row.signoffs.map((signoff) => ({
        party: signoff.party as QualitySignoffParty,
        signature_name: signoff.signatureName,
        accepted: signoff.accepted,
        note: signoff.note,
        signed_at: signoff.signedAt.toISOString(),
        user: person(signoff.user),
      })),
      problems,
    };
  }
}

/** Whether somebody is on the quality side at all, rather than a client looking at what is shared. */
export function seesQuality(actor: RequestUser): boolean {
  return can(actor, 'quality.view') || can(actor, 'quality.inspect');
}

async function assertMilestone(tx: TenantTx, projectId: string, milestoneId: string | null | undefined) {
  if (!milestoneId) return;
  const milestone = await tx.milestone.findFirst({
    where: { id: milestoneId, projectId, deletedAt: null },
    select: { id: true },
  });
  if (!milestone) throw ApiError.validationFailed({ milestone_id: milestoneId }, 'That stage is not on this site');
}

function summaryView(row: SummaryRow): QualityInspectionSummary {
  const answered = row.items.filter((item) => item.outcome !== null).length;
  return {
    id: row.id,
    number: row.number,
    project: { id: row.project.id, name: row.project.name },
    template: row.template,
    title: row.title,
    trade: row.trade,
    location: row.location,
    inspection_date: isoOrNull(row.inspectionDate)!,
    inspector: person(row.inspector),
    status: row.status as QualityInspectionStatus,
    result: row.result as QualityInspectionResult | null,
    share_with_client: row.shareWithClient,
    counts: {
      total: row.items.length,
      answered,
      failed: row.items.filter((item) => item.outcome === 'fail').length,
    },
    snag_count: row._count.snags,
    signed_by: row.signoffs.map((signoff) => signoff.party as QualitySignoffParty),
    completed_at: row.completedAt?.toISOString() ?? null,
  };
}
