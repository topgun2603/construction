import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import {
  EQUIPMENT_DOCUMENT_LABELS,
  EQUIPMENT_DOCUMENT_WARNING_DAYS,
  INDIA_LOCALE,
  addDays,
  equipmentDocumentStanding,
  equipmentServiceNeedsAttention,
  isoDateToUtcDate,
  todayIn,
  utcDateToIsoDate,
  type CreateEquipmentMaintenanceInput,
  type EquipmentDocumentKind,
  type EquipmentMeterType,
  type ListEquipmentLogsQuery,
} from '@sitebook/shared';
import { can, type RequestUser } from '../../common/auth/request-user';
import { ProjectAccess } from '../../common/auth/project-access.service';
import { ApiError } from '../../common/errors/api-error';
import { TenantDb } from '../../common/prisma/tenant-db.service';
import { NotificationsService } from '../notifications/notifications.service';
import { allocationOn, assertEquipmentKey, costCodeOnSite, isoDay, money, oneDecimalText, tenthsOf } from './equipment-common';
import { planView } from './equipment.service';

const RECORD_INCLUDE = {
  equipment: { select: { id: true, code: true, name: true } },
  project: { select: { id: true, name: true } },
  plan: { select: { id: true, name: true } },
} satisfies Prisma.EquipmentMaintenanceInclude;

type RecordRow = Prisma.EquipmentMaintenanceGetPayload<{ include: typeof RECORD_INCLUDE }>;

/**
 * Servicing and repairs (roadmap Phase 2, module 10): what was done to a machine, what it cost, how
 * long it was out — and the reminders, on each company's own clock, when a service falls due or a
 * machine's papers are about to lapse.
 */
@Injectable()
export class EquipmentMaintenanceService {
  private readonly logger = new Logger(EquipmentMaintenanceService.name);

  constructor(
    private readonly tenantDb: TenantDb,
    private readonly access: ProjectAccess,
    private readonly notifications: NotificationsService,
  ) {}

  async list(actor: RequestUser, query: ListEquipmentLogsQuery) {
    if (query.project_id) await this.access.assertAccess(actor, query.project_id);
    return this.tenantDb.transaction(actor.tenantId, async (tx) => {
      const rows = await tx.equipmentMaintenance.findMany({
        where: {
          // The sites this person works on, and the yard, which belongs to no site.
          ...(actor.seesAllProjects ? {} : { OR: [{ projectId: { in: actor.projectIds } }, { projectId: null }] }),
          ...(query.equipment_id ? { equipmentId: query.equipment_id } : {}),
          ...(query.project_id ? { projectId: query.project_id } : {}),
          ...(query.from || query.to
            ? {
                doneOn: {
                  ...(query.from ? { gte: isoDateToUtcDate(query.from) } : {}),
                  ...(query.to ? { lte: isoDateToUtcDate(query.to) } : {}),
                },
              }
            : {}),
        },
        include: RECORD_INCLUDE,
        orderBy: [{ doneOn: 'desc' }, { id: 'desc' }],
        take: query.limit,
      });
      return { items: rows.map((row) => recordView(actor, row)) };
    });
  }

  async create(actor: RequestUser, equipmentId: string, input: CreateEquipmentMaintenanceInput) {
    assertEquipmentKey(actor, input.bill_s3_key);
    return this.tenantDb.transaction(actor.tenantId, async (tx) => {
      const machine = await tx.equipment.findUnique({
        where: { id: equipmentId },
        select: { id: true, code: true, meterReading: true },
      });
      if (!machine) throw ApiError.notFound('Equipment');

      // Left out, the site the machine was on that day bears the cost; null is the yard.
      const allocation = await allocationOn(tx, equipmentId, input.done_on);
      const projectId = input.project_id === undefined ? (allocation?.projectId ?? null) : input.project_id;
      if (projectId) await this.access.assertAccess(actor, projectId);
      const costCodeId = projectId
        ? input.cost_code_id !== undefined
          ? await costCodeOnSite(tx, projectId, input.cost_code_id)
          : allocation?.projectId === projectId
            ? allocation.costCodeId
            : null
        : null;

      if (input.plan_id) {
        const plan = await tx.equipmentServicePlan.findFirst({ where: { id: input.plan_id, equipmentId } });
        if (!plan) throw ApiError.validationFailed({ plan_id: 'not this machine' }, 'That service plan is not for this machine');
      }

      let expenseId: string | null = null;
      if (input.expense_id) {
        const expense = await tx.expense.findFirst({
          where: { id: input.expense_id, deletedAt: null },
          select: { id: true, projectId: true },
        });
        if (!expense) throw ApiError.notFound('Expense');
        if (expense.projectId !== projectId) {
          throw ApiError.validationFailed({ expense_id: 'another site' }, 'That expense is on another site');
        }
        expenseId = expense.id;
      } else if (input.create_expense) {
        if (!projectId) {
          throw ApiError.validationFailed({ project_id: 'needs a site' }, 'An expense belongs to a site. Pick the site that pays.');
        }
        if (input.cost <= 0n) throw ApiError.validationFailed({ cost: 'required' }, 'Enter what the work cost');
        if (!can(actor, 'expenses.record')) throw ApiError.forbidden('Recording an expense needs permission to record expenses');
        const expense = await tx.expense.create({
          data: {
            tenantId: actor.tenantId,
            projectId,
            amount: input.cost,
            category: 'repairs',
            spentOn: isoDateToUtcDate(input.done_on),
            billS3Key: input.bill_s3_key ?? null,
            note: `${machine.code}: ${input.description}`.slice(0, 500),
            costCodeId,
            submittedBy: actor.userId,
          },
        });
        expenseId = expense.id;
      }

      const reading = input.meter_reading ?? null;
      const record = await tx.equipmentMaintenance.create({
        data: {
          tenantId: actor.tenantId,
          equipmentId,
          projectId,
          planId: input.plan_id ?? null,
          costCodeId,
          doneOn: isoDateToUtcDate(input.done_on),
          kind: input.kind,
          description: input.description,
          parts: input.parts ?? null,
          cost: input.cost,
          meterReading: reading,
          downtimeHours: input.downtime_hours ?? null,
          vendorName: input.vendor_name ?? null,
          expenseId,
          billS3Key: input.bill_s3_key ?? null,
          recordedBy: actor.userId,
        },
        include: RECORD_INCLUDE,
      });
      if (reading) {
        await tx.$executeRaw`UPDATE "equipment" SET "meter_reading" = GREATEST(COALESCE("meter_reading", 0), ${reading}::numeric), "updated_at" = now() WHERE "id" = ${equipmentId}::uuid`;
      }
      if (input.plan_id) {
        // Doing the service starts its count again, and re-arms its reminder.
        await tx.equipmentServicePlan.update({
          where: { id: input.plan_id },
          data: {
            lastDoneOn: isoDateToUtcDate(input.done_on),
            lastDoneMeter: reading ?? machine.meterReading,
            remindedAt: null,
          },
        });
      }
      return recordView(actor, record);
    });
  }

  /** Services due or overdue, and papers lapsing, across the fleet. */
  async due(actor: RequestUser) {
    return this.tenantDb.transaction(actor.tenantId, async (tx) => {
      const today = todayIn(actor.timezone);
      const [plans, documents] = await Promise.all([
        tx.equipmentServicePlan.findMany({
          where: { active: true, equipment: { archivedAt: null } },
          include: { equipment: { select: { id: true, code: true, name: true, meterType: true, meterReading: true } } },
        }),
        tx.equipmentDocument.findMany({
          where: {
            deletedAt: null,
            equipment: { archivedAt: null },
            expiresOn: { lte: isoDateToUtcDate(addDays(today, EQUIPMENT_DOCUMENT_WARNING_DAYS)) },
          },
          include: { equipment: { select: { id: true, code: true, name: true } } },
          orderBy: { expiresOn: 'asc' },
        }),
      ]);
      const services = plans
        .map((plan) => ({
          ...planView(plan, plan.equipment.meterType as EquipmentMeterType, tenthsOf(plan.equipment.meterReading), today),
          equipment: { id: plan.equipment.id, code: plan.equipment.code, name: plan.equipment.name },
          meter_reading: oneDecimalText(plan.equipment.meterReading),
        }))
        .filter((plan) => plan.state !== 'ok')
        .sort((a, b) => rank(b.state) - rank(a.state));
      return {
        date: today,
        services,
        documents: documents.map((doc) => ({
          id: doc.id,
          equipment: doc.equipment,
          kind: doc.kind,
          number: doc.number,
          expires_on: isoDay(doc.expiresOn),
          standing: equipmentDocumentStanding(isoDay(doc.expiresOn), today),
        })),
      };
    });
  }

  /**
   * The morning reminder for one company, run by the worker when *its* clock reaches
   * EQUIPMENT_REMINDER_CRON: services that have fallen due, and machine papers inside the warning
   * window. Each is claimed as it is sent, so a retried run cannot remind twice; doing the service or
   * renewing the paper re-arms it.
   */
  async remindTenant(tenantId: string): Promise<{ services: number; documents: number }> {
    const due = await this.tenantDb.transaction(tenantId, async (tx) => {
      const tenant = await tx.tenant.findUnique({ where: { id: tenantId }, select: { timezone: true } });
      const today = todayIn(tenant?.timezone ?? INDIA_LOCALE.timezone);
      const plans = await tx.equipmentServicePlan.findMany({
        where: { active: true, remindedAt: null, equipment: { archivedAt: null } },
        include: { equipment: { select: { code: true, name: true, meterType: true, meterReading: true } } },
      });
      const services = plans
        .map((plan) => ({
          plan,
          view: planView(plan, plan.equipment.meterType as EquipmentMeterType, tenthsOf(plan.equipment.meterReading), today),
        }))
        .filter((entry) => equipmentServiceNeedsAttention(entry.view.state));
      const documents = await tx.equipmentDocument.findMany({
        where: {
          deletedAt: null,
          remindedAt: null,
          equipment: { archivedAt: null },
          expiresOn: { lte: isoDateToUtcDate(addDays(today, EQUIPMENT_DOCUMENT_WARNING_DAYS)) },
        },
        include: { equipment: { select: { code: true, name: true } } },
        orderBy: { expiresOn: 'asc' },
      });
      const now = new Date();
      if (services.length > 0) {
        await tx.equipmentServicePlan.updateMany({
          where: { id: { in: services.map((entry) => entry.plan.id) } },
          data: { remindedAt: now },
        });
      }
      if (documents.length > 0) {
        await tx.equipmentDocument.updateMany({
          where: { id: { in: documents.map((doc) => doc.id) } },
          data: { remindedAt: now },
        });
      }
      return { services, documents };
    });

    if (due.services.length > 0) {
      const lines = due.services.slice(0, 5).map(({ plan, view }) => {
        const by =
          view.remaining_meter !== null && Number(view.remaining_meter) <= 0
            ? ` at ${view.next_meter} ${plan.equipment.meterType === 'km' ? 'km' : 'h'}`
            : view.next_on
              ? ` on ${view.next_on}`
              : '';
        return `${plan.equipment.code} ${plan.equipment.name}: ${plan.name}${by}`;
      });
      await this.notifications.notify({
        tenantId,
        roles: ['owner', 'project_manager'],
        type: 'equipment.service_due',
        title:
          due.services.length === 1
            ? `A service is due: ${due.services[0]!.plan.equipment.code}`
            : `${due.services.length} machines are due for a service`,
        body: lines.join('\n') + (due.services.length > 5 ? `\n…and ${due.services.length - 5} more` : ''),
        payload: { plan_ids: due.services.map((entry) => entry.plan.id) },
      });
    }
    if (due.documents.length > 0) {
      const lines = due.documents
        .slice(0, 5)
        .map(
          (doc) =>
            `${doc.equipment.code}: ${EQUIPMENT_DOCUMENT_LABELS[doc.kind as EquipmentDocumentKind] ?? doc.kind}, ${utcDateToIsoDate(doc.expiresOn!)}`,
        );
      await this.notifications.notify({
        tenantId,
        roles: ['owner', 'project_manager'],
        type: 'equipment.documents_expiring',
        title:
          due.documents.length === 1
            ? 'A machine’s papers are about to lapse'
            : `${due.documents.length} machine papers are about to lapse`,
        body: lines.join('\n') + (due.documents.length > 5 ? `\n…and ${due.documents.length - 5} more` : ''),
        payload: { document_ids: due.documents.map((doc) => doc.id) },
      });
    }
    const result = { services: due.services.length, documents: due.documents.length };
    if (result.services + result.documents > 0) this.logger.log({ tenantId, ...result }, 'Equipment reminders sent');
    return result;
  }
}

function rank(state: string): number {
  return state === 'overdue' ? 3 : state === 'due' ? 2 : state === 'due_soon' ? 1 : 0;
}

function recordView(actor: RequestUser, row: RecordRow) {
  return {
    id: row.id,
    equipment: row.equipment,
    project: row.project,
    plan: row.plan,
    done_on: utcDateToIsoDate(row.doneOn),
    kind: row.kind,
    description: row.description,
    parts: row.parts,
    cost: money(actor, row.cost),
    meter_reading: oneDecimalText(row.meterReading),
    downtime_hours: oneDecimalText(row.downtimeHours),
    vendor_name: row.vendorName,
    expense_id: row.expenseId,
    has_bill: Boolean(row.billS3Key),
  };
}
