import { HttpStatus, Injectable } from '@nestjs/common';
import {
  AI_FEATURES,
  AI_USAGE_DAYS,
  ERROR_CODES,
  type AiFeature,
  type AiSettingsInput,
} from '@sitebook/shared';
import { env } from '../../config/env';
import type { RequestUser } from '../../common/auth/request-user';
import { ApiError } from '../../common/errors/api-error';
import { TenantDb } from '../../common/prisma/tenant-db.service';
import { JobQueueService } from '../../jobs/job-queue.service';
import { AiGateway } from './ai-gateway.service';

/** One day's count for one feature, as the settings screen and the console both draw it. */
export interface AiUsageRow {
  day: string;
  feature: string;
  calls: number;
}

/** The first day of the usage window: today and the 29 before it, in UTC like the counter. */
export function aiUsageSince(now = new Date()): Date {
  const since = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  since.setUTCDate(since.getUTCDate() - (AI_USAGE_DAYS - 1));
  return since;
}

/** Rows plus a total per feature, so the screen can lead with "Voice notes: 41 calls". */
export function aiPresentUsage(rows: { day: Date; feature: string; calls: number }[]) {
  const totals = Object.fromEntries(AI_FEATURES.map((feature) => [feature, 0])) as Record<AiFeature, number>;
  for (const row of rows) {
    if (row.feature in totals) totals[row.feature as AiFeature] += row.calls;
  }
  return {
    days: AI_USAGE_DAYS,
    totals,
    rows: rows
      .map((row): AiUsageRow => ({ day: row.day.toISOString().slice(0, 10), feature: row.feature, calls: row.calls }))
      .sort((a, b) => (a.day === b.day ? a.feature.localeCompare(b.feature) : a.day.localeCompare(b.day))),
  };
}

/**
 * Which model each feature uses, from this deployment's configuration — shown read-only so an owner
 * can see what is sent where without asking support.
 */
export function aiModelsByFeature(): Record<AiFeature, string[]> {
  const config = env();
  return {
    assistant: [config.OPENAI_ASK_MODEL],
    documents: [config.OPENAI_DOCUMENT_MODEL],
    reading: [config.OPENAI_VISION_MODEL],
    voice: [config.OPENAI_TRANSCRIBE_MODEL, config.OPENAI_ASK_MODEL],
    translation: [config.OPENAI_ASK_MODEL],
    suggestions: [config.OPENAI_ASK_MODEL],
  };
}

/**
 * Settings → Security → AI and data: the master switch, a switch per feature, the region, usage,
 * and deleting what AI features have stored.
 *
 * OWNER ONLY, like the rest of the Security page: the route asks for `tenant.manage`, but that can
 * be handed to a custom role, and this decides what company data may leave for a vendor at all.
 *
 * Changes land in `ai_settings`, whose audit trigger records who changed what; deleting stored AI
 * data writes its own audit entry because the table it empties is not audited row by row.
 */
@Injectable()
export class AiSettingsService {
  constructor(
    private readonly tenantDb: TenantDb,
    private readonly gateway: AiGateway,
    private readonly jobs: JobQueueService,
  ) {}

  assertOwner(actor: RequestUser): void {
    if (actor.role !== 'owner') {
      throw ApiError.forbidden('Only an owner can change AI settings.');
    }
  }

  /** `GET /ai/settings`. */
  async overview(actor: RequestUser) {
    this.assertOwner(actor);
    // Always fresh here: the owner looking at this screen must see what is stored, not a cached copy.
    this.gateway.invalidate(actor.tenantId);
    const [settings, states] = await Promise.all([
      this.gateway.settingsOf(actor.tenantId),
      this.gateway.states(actor.tenantId),
    ]);

    const since = aiUsageSince();
    const { usage, chunks, indexed, unindexed } = await this.tenantDb.transaction(actor.tenantId, async (tx) => {
      const [usage, chunks, indexed, unindexed] = await Promise.all([
        tx.aiUsageDaily.findMany({ where: { day: { gte: since } } }),
        tx.documentChunk.count(),
        tx.document.count({ where: { deletedAt: null, textPages: { gt: 0 } } }),
        tx.document.count({
          where: { deletedAt: null, textExtractedAt: null, contentType: 'application/pdf' },
        }),
      ]);
      return { usage, chunks, indexed, unindexed };
    });

    const regions = this.gateway.regionAvailability();
    return {
      deployment: {
        configured: this.gateway.configured,
        provider: 'OpenAI',
        models: aiModelsByFeature(),
        platform_disabled: this.gateway.platformDisabled(),
        regions,
      },
      settings: {
        enabled: settings.enabled,
        features: Object.fromEntries(
          AI_FEATURES.map((feature) => [feature, !settings.disabledFeatures.includes(feature)]),
        ) as Record<AiFeature, boolean>,
        region: settings.region,
      },
      states,
      usage: aiPresentUsage(usage),
      documents: { chunks, indexed_documents: indexed, unindexed_documents: unindexed },
      updated_at: settings.updatedAt?.toISOString() ?? null,
    };
  }

  /**
   * `PUT /ai/settings`.
   *
   * A region with no endpoint on this deployment is refused rather than stored: storing it would
   * switch every AI feature off (`region_unavailable`) for a choice the screen showed as greyed out.
   */
  async save(actor: RequestUser, input: AiSettingsInput) {
    this.assertOwner(actor);
    if (!this.gateway.regionAvailability()[input.region]) {
      throw ApiError.conflict('That region is not offered on this server.', { region: input.region });
    }

    const current = await this.gateway.settingsOf(actor.tenantId);
    // Merged: a feature missing from the body keeps what it had (see `aiSettingsSchema`).
    const disabled = new Set(current.disabledFeatures);
    for (const [feature, on] of Object.entries(input.features)) {
      if (on) disabled.delete(feature);
      else disabled.add(feature);
    }
    const disabledFeatures = AI_FEATURES.filter((feature) => disabled.has(feature));

    await this.tenantDb.transaction(actor.tenantId, async (tx) => {
      await tx.aiSettings.upsert({
        where: { tenantId: actor.tenantId },
        create: {
          tenantId: actor.tenantId,
          enabled: input.enabled,
          disabledFeatures,
          region: input.region,
          updatedByUserId: actor.userId,
        },
        update: {
          enabled: input.enabled,
          disabledFeatures,
          region: input.region,
          updatedByUserId: actor.userId,
        },
      });
    });
    this.gateway.invalidate(actor.tenantId);
    return this.overview(actor);
  }

  /**
   * `POST /ai/data/delete`: removes what AI features derived and stored, and nothing else.
   *
   * Today that is the page index of the documents (`document_chunks`) — the text read out of every
   * PDF so it could be asked. The documents themselves are untouched, and each is marked unread so
   * "re-index documents" can rebuild the index later.
   *
   * Deliberately left alone, because they are records people confirmed rather than derived copies:
   * a snag's or safety observation's transcript (the voice note is deleted once transcribed, so the
   * transcript is the only record of what was said), the AI-worded forecast sentence (rewritten every
   * night, and the template beside it holds the same figures), and change-order suggestions (a person
   * acts on or dismisses each one). Nothing else an AI feature produces is stored.
   */
  async deleteData(actor: RequestUser) {
    this.assertOwner(actor);
    return this.tenantDb.transaction(actor.tenantId, async (tx) => {
      const chunks = await tx.documentChunk.deleteMany({});
      const documents = await tx.document.updateMany({
        where: { textExtractedAt: { not: null } },
        data: { textExtractedAt: null, textPages: null },
      });
      await tx.auditLog.create({
        data: {
          tenantId: actor.tenantId,
          actorId: actor.userId,
          action: 'ai.data_deleted',
          entity: 'ai_settings',
          after: { document_chunks: chunks.count, documents_marked_unread: documents.count },
        },
      });
      return { deleted_chunks: chunks.count, documents_reset: documents.count };
    });
  }

  /**
   * `POST /ai/documents/reindex`: queue every unread PDF to be read again.
   *
   * Offered after turning Documents back on, and after deleting stored AI data. Bounded, as the
   * self-healing queue in the document Q&A is; a register larger than this is finished by the next
   * question about it.
   */
  async reindex(actor: RequestUser) {
    this.assertOwner(actor);
    // Refused as "turned off" even on a deployment with no key, where indexing still runs: the
    // switch that stops it is the company's (or the operator's), so that is what the error names.
    if (!(await this.gateway.documentIndexingAllowed(actor.tenantId))) {
      throw new ApiError(
        HttpStatus.FORBIDDEN,
        ERROR_CODES.AI_DISABLED,
        'Turn Documents back on before re-indexing.',
        { feature: 'documents', reason: 'off_company' },
      );
    }
    const unread = await this.tenantDb.clientFor(actor.tenantId).document.findMany({
      where: { deletedAt: null, textExtractedAt: null, contentType: 'application/pdf' },
      select: { id: true, s3Key: true, contentType: true },
      orderBy: { createdAt: 'desc' },
      take: 500,
    });
    for (const document of unread) {
      await this.jobs.extractDocumentText({
        tenantId: actor.tenantId,
        documentId: document.id,
        s3Key: document.s3Key,
        contentType: document.contentType,
      });
    }
    return { queued: unread.length };
  }
}
