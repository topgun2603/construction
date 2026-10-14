import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { WEBHOOK_MAX_ATTEMPTS, utcDateToIsoDate, type WebhookEventType } from '@sitebook/shared';
import type { TenantTx } from '../../common/prisma/tenant-db.service';
import {
  PUBLIC_ATTENDANCE_SELECT,
  PUBLIC_CHANGE_ORDER_SELECT,
  PUBLIC_DAILY_REPORT_SELECT,
  PUBLIC_EXPENSE_SELECT,
  PUBLIC_PURCHASE_ORDER_SELECT,
  PUBLIC_RFI_SELECT,
  publicAttendanceView,
  publicChangeOrderView,
  publicDailyReportView,
  publicExpenseView,
  publicPurchaseOrderView,
  publicRfiView,
} from '../public-api/public-api.views';
import { WebhookQueue } from './webhook-queue.service';

type Payload = Record<string, unknown>;

/**
 * Announces that something happened, for the company's webhook endpoints.
 *
 * Called by the services that make the change, *inside their own transaction*, with the transaction
 * client: the event (`outbox_events`) and one delivery per subscribed endpoint are written with the
 * change and commit or roll back with it. That is the whole guarantee — no event for an expense that
 * was never saved, and no expense saved whose event is lost because the process died before sending.
 *
 * A company with no endpoint listening for the event pays one indexed read and writes nothing; the
 * payload is only built (read) when somebody is listening.
 *
 * The payload is what receivers get as `data`, shaped exactly as the public API returns the same
 * record (`public-api.views.ts`): money in integer minor units with its currency, ISO dates.
 *
 * The named helpers below are what services call — one line each, by id — so the shape of each
 * event lives here, beside the others, not in the service that happens to cause it.
 */
@Injectable()
export class WebhookEvents {
  constructor(private readonly queue: WebhookQueue) {}

  async emit(
    tx: TenantTx,
    tenantId: string,
    type: WebhookEventType,
    data: Payload | (() => Promise<Payload | null>),
  ): Promise<void> {
    const endpoints = await tx.webhookEndpoint.findMany({
      where: { status: 'active', events: { has: type } },
      select: { id: true },
    });
    if (endpoints.length === 0) return;

    const payload = typeof data === 'function' ? await data() : data;
    if (!payload) return;

    const event = await tx.outboxEvent.create({
      data: { tenantId, type, payload: webhookJson(payload) },
      select: { id: true },
    });
    await tx.webhookDelivery.createMany({
      data: endpoints.map((endpoint) => ({
        tenantId,
        endpointId: endpoint.id,
        eventId: event.id,
        maxAttempts: WEBHOOK_MAX_ATTEMPTS,
      })),
    });

    // After the caller's commit, normally: the nudge waits a second. A transaction that takes longer
    // is caught by the worker's sweep a little later — late, never lost.
    void this.queue.nudge(tenantId);
  }

  // --- the events ----------------------------------------------------------------------------------

  /** `expense.created` — recorded by a person, by the mobile app's sync, or through the public API. */
  async expenseCreated(tx: TenantTx, tenantId: string, expenseId: string): Promise<void> {
    await this.emit(tx, tenantId, 'expense.created', () => this.expense(tx, tenantId, expenseId));
  }

  /** `expense.approved`. */
  async expenseApproved(tx: TenantTx, tenantId: string, expenseId: string): Promise<void> {
    await this.emit(tx, tenantId, 'expense.approved', () => this.expense(tx, tenantId, expenseId));
  }

  /**
   * `attendance.recorded` — one event per roll call saved (a site and a day), carrying the rows that
   * call wrote, rather than one event per worker: a 120-person site would otherwise be 120 POSTs.
   */
  async attendanceRecorded(
    tx: TenantTx,
    tenantId: string,
    projectId: string,
    date: Date,
    workerIds: readonly string[],
  ): Promise<void> {
    await this.emit(tx, tenantId, 'attendance.recorded', async () => {
      const currency = await currencyOf(tx, tenantId);
      const rows = await tx.attendance.findMany({
        where: { projectId, attendanceDate: date, workerId: { in: [...workerIds] } },
        orderBy: { workerId: 'asc' },
        select: PUBLIC_ATTENDANCE_SELECT,
      });
      return {
        project_id: projectId,
        date: utcDateToIsoDate(date),
        attendance: rows.map((row) => publicAttendanceView(row, currency)),
      };
    });
  }

  /** `dpr.submitted`. */
  async dprSubmitted(tx: TenantTx, tenantId: string, reportId: string): Promise<void> {
    await this.emit(tx, tenantId, 'dpr.submitted', async () => {
      const row = await tx.dailyReport.findFirst({ where: { id: reportId }, select: PUBLIC_DAILY_REPORT_SELECT });
      return row ? { daily_report: publicDailyReportView(row) } : null;
    });
  }

  /** `purchase_order.approved` — by a person, or automatically when it is within the raiser's limit. */
  async purchaseOrderApproved(tx: TenantTx, tenantId: string, orderId: string): Promise<void> {
    await this.emit(tx, tenantId, 'purchase_order.approved', async () => {
      const row = await tx.purchaseOrder.findFirst({ where: { id: orderId }, select: PUBLIC_PURCHASE_ORDER_SELECT });
      return row ? { purchase_order: publicPurchaseOrderView(row, await currencyOf(tx, tenantId)) } : null;
    });
  }

  /** `change_order.approved`. */
  async changeOrderApproved(tx: TenantTx, tenantId: string, changeOrderId: string): Promise<void> {
    await this.emit(tx, tenantId, 'change_order.approved', async () => {
      const row = await tx.changeOrder.findFirst({ where: { id: changeOrderId }, select: PUBLIC_CHANGE_ORDER_SELECT });
      return row ? { change_order: publicChangeOrderView(row, await currencyOf(tx, tenantId)) } : null;
    });
  }

  /** `rfi.answered` — whether the answer came through the responder's link or was entered on their behalf. */
  async rfiAnswered(tx: TenantTx, tenantId: string, rfiId: string): Promise<void> {
    await this.emit(tx, tenantId, 'rfi.answered', async () => {
      const row = await tx.rfi.findFirst({ where: { id: rfiId }, select: PUBLIC_RFI_SELECT });
      return row ? { rfi: publicRfiView(row) } : null;
    });
  }

  /** `safety.incident_reported` — every incident and near miss, not only the serious ones. */
  async safetyIncidentReported(tx: TenantTx, tenantId: string, incidentId: string): Promise<void> {
    await this.emit(tx, tenantId, 'safety.incident_reported', async () => {
      const row = await tx.safetyIncident.findFirst({
        where: { id: incidentId },
        select: {
          id: true,
          projectId: true,
          number: true,
          type: true,
          severity: true,
          title: true,
          description: true,
          location: true,
          occurredAt: true,
          occurredOn: true,
          status: true,
          lostDays: true,
          createdAt: true,
          updatedAt: true,
        },
      });
      if (!row) return null;
      return {
        incident: {
          id: row.id,
          project_id: row.projectId,
          number: row.number,
          type: row.type,
          severity: row.severity,
          title: row.title,
          description: row.description,
          location: row.location,
          occurred_at: row.occurredAt.toISOString(),
          occurred_on: utcDateToIsoDate(row.occurredOn),
          status: row.status,
          lost_days: row.lostDays,
          created_at: row.createdAt.toISOString(),
          updated_at: row.updatedAt.toISOString(),
        },
      };
    });
  }

  private async expense(tx: TenantTx, tenantId: string, expenseId: string): Promise<Payload | null> {
    const row = await tx.expense.findFirst({ where: { id: expenseId }, select: PUBLIC_EXPENSE_SELECT });
    if (!row) return null;
    return { expense: publicExpenseView(row, await currencyOf(tx, tenantId)) };
  }
}

/** Read inside the transaction (RLS shows only this company's row) — only once somebody is listening. */
async function currencyOf(tx: TenantTx, tenantId: string): Promise<string> {
  const tenant = await tx.tenant.findUnique({ where: { id: tenantId }, select: { currency: true } });
  return tenant?.currency ?? 'INR';
}

/**
 * Makes a payload JSON: bigint money becomes a plain integer (minor units — a construction company's
 * amounts are nowhere near 2^53 paise), a Date its ISO string. Everything else passes through.
 */
export function webhookJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(
    JSON.stringify(value, (_key, item: unknown) => (typeof item === 'bigint' ? Number(item) : item)),
  ) as Prisma.InputJsonValue;
}
