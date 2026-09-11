import { Injectable, Logger } from '@nestjs/common';
import {
  assignWorkerSchema,
  attendanceRowSchema,
  createDprSchema,
  createIndentSchema,
  createLabourPaymentSchema,
  createWorkerSchema,
  isoDateSchema,
  updateDprSchema,
  updateWorkerSchema,
  type OutboxEntry,
  type SyncEntity,
  type SyncPullQuery,
  type SyncPushInput,
  type SyncResult,
} from '@sitebook/shared';
import { z } from 'zod';
import { HttpException } from '@nestjs/common';
import type { RequestUser } from '../../common/auth/request-user';
import { ProjectAccess } from '../../common/auth/project-access.service';
import { TenantDb } from '../../common/prisma/tenant-db.service';
import { AttendanceService } from '../attendance/attendance.service';
import { DprService } from '../dpr/dpr.service';
import { IndentsService } from '../indents/indents.service';
import { LabourPaymentsService } from '../labour-payments/labour-payments.service';
import { WorkersService } from '../workers/workers.service';

const attendanceEntrySchema = attendanceRowSchema.extend({
  project_id: z.string().uuid(),
  attendance_date: isoDateSchema,
});

@Injectable()
export class SyncService {
  private readonly logger = new Logger(SyncService.name);

  constructor(
    private readonly tenantDb: TenantDb,
    private readonly access: ProjectAccess,
    private readonly workers: WorkersService,
    private readonly dpr: DprService,
    private readonly attendance: AttendanceService,
    private readonly payments: LabourPaymentsService,
    private readonly indents: IndentsService,
  ) {}

  /**
   * Drain a device's outbox (spec §8).
   *
   * Entries are applied one at a time, in order, each in its own transaction: a
   * single bad row must not roll back a day's work that synced fine before it. The
   * per-entry result tells the device exactly which outbox rows it may delete.
   *
   * The real work is delegated to the domain services, so an offline write goes
   * through the same wage snapshots, period locks and overbooking checks as an
   * online one. Sync is transport, not a second implementation of the rules.
   */
  async push(actor: RequestUser, input: SyncPushInput): Promise<{ results: SyncResult[] }> {
    const results: SyncResult[] = [];

    for (const entry of input.entries) {
      let result: SyncResult;
      try {
        result = await this.apply(actor, entry);
      } catch (error) {
        result = {
          outbox_id: entry.outbox_id,
          status: 'error',
          code: errorCode(error),
          message: errorMessage(error),
        };
        this.logger.warn(
          { entity: entry.entity, clientId: entry.client_id, err: error },
          'Sync entry failed',
        );
      }

      results.push(result);
      await this.log(actor, input.device_id, entry, result);
    }

    return { results };
  }

  /**
   * Everything the device may not have seen since `since`.
   *
   * The cursor is a server timestamp, and the next cursor is the newest
   * `updated_at` actually returned rather than "now" — so a row written while the
   * response was being assembled is picked up next time instead of being skipped.
   */
  async pull(actor: RequestUser, query: SyncPullQuery) {
    const db = this.tenantDb.clientFor(actor.tenantId);
    const since = query.since ? new Date(query.since) : new Date(0);
    const scope = this.access.scopeFilterByProjectId(actor);
    const changed = { updatedAt: { gt: since } };
    const take = query.limit;

    const [projects, contractors, materials, workers, workerProjects, reports, attendance, payments, indents] =
      await Promise.all([
        db.project.findMany({
          where: { ...changed, ...this.access.scopeFilter(actor) },
          orderBy: { updatedAt: 'asc' },
          take,
        }),
        db.contractor.findMany({ where: changed, orderBy: { updatedAt: 'asc' }, take }),
        db.material.findMany({ where: changed, orderBy: { updatedAt: 'asc' }, take }),
        db.worker.findMany({ where: changed, orderBy: { updatedAt: 'asc' }, take }),
        db.workerProject.findMany({
          where: { ...changed, ...scope },
          orderBy: { updatedAt: 'asc' },
          take,
        }),
        db.dailyReport.findMany({
          where: { ...changed, ...scope },
          include: { activities: true, manpower: true, photos: true },
          orderBy: { updatedAt: 'asc' },
          take,
        }),
        db.attendance.findMany({
          where: { ...changed, ...scope },
          orderBy: { updatedAt: 'asc' },
          take,
        }),
        db.labourPayment.findMany({
          where: { ...changed, ...scope },
          orderBy: { updatedAt: 'asc' },
          take,
        }),
        db.materialIndent.findMany({
          where: { ...changed, ...scope },
          include: { items: true },
          orderBy: { updatedAt: 'asc' },
          take,
        }),
      ]);

    const batches = [
      projects,
      contractors,
      materials,
      workers,
      workerProjects,
      reports,
      attendance,
      payments,
      indents,
    ];

    let newest = since;
    for (const batch of batches) {
      for (const row of batch as Array<{ updatedAt: Date }>) {
        if (row.updatedAt > newest) newest = row.updatedAt;
      }
    }

    // A full page in any entity means there is more to come; the device should
    // pull again immediately rather than waiting for the next interval.
    const hasMore = batches.some((batch) => batch.length >= take);

    return {
      since: newest.toISOString(),
      has_more: hasMore,
      changes: {
        projects,
        contractors,
        materials,
        workers,
        worker_projects: workerProjects,
        daily_reports: reports,
        attendance,
        labour_payments: payments,
        material_indents: indents,
      },
    };
  }

  private async apply(actor: RequestUser, entry: OutboxEntry): Promise<SyncResult> {
    switch (entry.entity) {
      case 'workers':
        return this.applyWorker(actor, entry);
      case 'worker_projects':
        return this.applyAssignment(actor, entry);
      case 'daily_reports':
        return this.applyDpr(actor, entry);
      case 'attendance':
        return this.applyAttendance(actor, entry);
      case 'labour_payments':
        return this.applyPayment(actor, entry);
      case 'material_indents':
        return this.applyIndent(actor, entry);
    }
  }

  private async applyWorker(actor: RequestUser, entry: OutboxEntry): Promise<SyncResult> {
    const db = this.tenantDb.clientFor(actor.tenantId);
    const existing = await db.worker.findFirst({
      where: { clientId: entry.client_id },
      select: { id: true, updatedAt: true },
    });

    if (entry.op === 'create' || !existing) {
      const input = createWorkerSchema.parse({ ...entry.payload, client_id: entry.client_id });
      const worker = await this.workers.create(actor, input);
      return { outbox_id: entry.outbox_id, status: 'ok', server_id: worker.id };
    }

    const stale = this.staleness(entry, existing.updatedAt);
    if (stale) return { ...stale, outbox_id: entry.outbox_id, server_record: existing };

    const worker = await this.workers.update(
      actor,
      existing.id,
      updateWorkerSchema.parse(entry.payload),
    );
    return { outbox_id: entry.outbox_id, status: 'ok', server_id: existing.id, server_record: worker };
  }

  private async applyAssignment(actor: RequestUser, entry: OutboxEntry): Promise<SyncResult> {
    const payload = z
      .object({ worker_id: z.string().uuid() })
      .and(assignWorkerSchema)
      .parse(entry.payload);
    const assignment = await this.workers.assign(actor, payload.worker_id, payload);
    return { outbox_id: entry.outbox_id, status: 'ok', server_id: assignment.id };
  }

  private async applyDpr(actor: RequestUser, entry: OutboxEntry): Promise<SyncResult> {
    const db = this.tenantDb.clientFor(actor.tenantId);
    const existing = await db.dailyReport.findFirst({
      where: { clientId: entry.client_id },
      select: { id: true, updatedAt: true, status: true },
    });

    if (entry.op === 'create' || !existing) {
      const input = createDprSchema.parse({ ...entry.payload, client_id: entry.client_id });
      const report = await this.dpr.create(actor, input);
      return { outbox_id: entry.outbox_id, status: 'ok', server_id: report.id };
    }

    const stale = this.staleness(entry, existing.updatedAt);
    if (stale) return { ...stale, outbox_id: entry.outbox_id, server_record: existing };

    const report = await this.dpr.update(actor, existing.id, updateDprSchema.parse(entry.payload));
    return { outbox_id: entry.outbox_id, status: 'ok', server_id: existing.id, server_record: report };
  }

  /**
   * Attendance arrives one worker-day at a time from the device, but the service
   * takes a roll call, so a single row is sent as a batch of one. That keeps the
   * period lock and the two-sites-in-one-day check on the offline path too.
   */
  private async applyAttendance(actor: RequestUser, entry: OutboxEntry): Promise<SyncResult> {
    const payload = attendanceEntrySchema.parse({ ...entry.payload, client_id: entry.client_id });

    await this.attendance.record(actor, {
      project_id: payload.project_id,
      attendance_date: payload.attendance_date,
      rows: [
        {
          worker_id: payload.worker_id,
          status: payload.status,
          overtime_hours: payload.overtime_hours,
          lat: payload.lat,
          lng: payload.lng,
          client_id: payload.client_id,
        },
      ],
    });

    const saved = await this.tenantDb.clientFor(actor.tenantId).attendance.findFirst({
      where: { clientId: entry.client_id },
      select: { id: true },
    });
    return { outbox_id: entry.outbox_id, status: 'ok', server_id: saved?.id };
  }

  private async applyPayment(actor: RequestUser, entry: OutboxEntry): Promise<SyncResult> {
    const input = createLabourPaymentSchema.parse({
      ...entry.payload,
      client_id: entry.client_id,
    });
    const payment = await this.payments.create(actor, input);
    return { outbox_id: entry.outbox_id, status: 'ok', server_id: payment.id };
  }

  private async applyIndent(actor: RequestUser, entry: OutboxEntry): Promise<SyncResult> {
    const input = createIndentSchema.parse({ ...entry.payload, client_id: entry.client_id });
    const indent = await this.indents.create(actor, input);
    return { outbox_id: entry.outbox_id, status: 'ok', server_id: indent.id };
  }

  /**
   * Last-write-wins by timestamp (spec §8, conflict policy v1). A device edit older
   * than the server's copy loses, and the server record is returned so the app can
   * show what actually happened rather than silently discarding the supervisor's
   * work.
   */
  private staleness(entry: OutboxEntry, serverUpdatedAt: Date): { status: 'conflict' } | null {
    const deviceUpdatedAt = new Date(entry.updated_at);
    return deviceUpdatedAt >= serverUpdatedAt ? null : { status: 'conflict' };
  }

  private async log(
    actor: RequestUser,
    deviceId: string,
    entry: OutboxEntry,
    result: SyncResult,
  ): Promise<void> {
    try {
      await this.tenantDb.clientFor(actor.tenantId).syncLog.create({
        data: {
          tenantId: actor.tenantId,
          deviceId,
          entity: entry.entity satisfies SyncEntity,
          entityId: result.server_id ?? null,
          clientId: entry.client_id,
          op: entry.op,
          status: result.status,
          detail:
            result.status === 'ok'
              ? undefined
              : { code: result.code ?? null, message: result.message ?? null },
        },
      });
    } catch (error) {
      // The log is for visibility, not correctness — never fail a sync over it.
      this.logger.warn({ err: error }, 'Could not write sync_log');
    }
  }
}

function errorCode(error: unknown): string {
  if (error instanceof z.ZodError) return 'VALIDATION_FAILED';
  if (error instanceof HttpException) {
    const body = error.getResponse();
    if (typeof body === 'object' && body !== null && 'code' in body) {
      return String((body as { code: unknown }).code);
    }
  }
  return 'INTERNAL';
}

function errorMessage(error: unknown): string {
  if (error instanceof z.ZodError) {
    return error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ');
  }
  if (error instanceof HttpException) {
    const body = error.getResponse();
    if (typeof body === 'object' && body !== null && 'message' in body) {
      return String((body as { message: unknown }).message);
    }
    return error.message;
  }
  return 'Could not apply this change';
}
