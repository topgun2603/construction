import { HttpStatus, Injectable } from '@nestjs/common';
import {
  ERROR_CODES,
  WEBHOOK_MAX_ENDPOINTS,
  WEBHOOK_PING_EVENT,
  WEBHOOK_URL_PROBLEM_COPY,
  type WebhookEndpointCreateInput,
  type WebhookEndpointUpdateInput,
} from '@sitebook/shared';
import type { RequestUser } from '../../common/auth/request-user';
import type { FieldCipher } from '../../common/crypto/field-cipher';
import { ApiError } from '../../common/errors/api-error';
import { TenantDb } from '../../common/prisma/tenant-db.service';
import { env } from '../../config/env';
import { newWebhookSecret, webhookCipherFor } from './webhook-crypto';
import { WebhookDeliveryService, type DeliveryOutcome } from './webhook-delivery.service';
import { webhookJson } from './webhook-events.service';
import { WebhookSender, WebhookTargetRefused } from './webhook-sender.service';

const ENDPOINT_SELECT = {
  id: true,
  url: true,
  description: true,
  events: true,
  secretLast4: true,
  status: true,
  disabledReason: true,
  disabledAt: true,
  consecutiveFailures: true,
  lastSuccessAt: true,
  lastFailureAt: true,
  createdAt: true,
} as const;

type EndpointRow = {
  id: string;
  url: string;
  description: string | null;
  events: string[];
  secretLast4: string;
  status: string;
  disabledReason: string | null;
  disabledAt: Date | null;
  consecutiveFailures: number;
  lastSuccessAt: Date | null;
  lastFailureAt: Date | null;
  createdAt: Date;
};

/** Deliveries shown per page of an endpoint's log. */
const LOG_PAGE = 25;

/**
 * Settings → Developers → Webhooks: where a company's events go. Owner only — an endpoint is a copy
 * of company data leaving for somebody else's server, the same weight as the security settings.
 *
 * Every change to an endpoint is in the audit log through its row trigger (the secret redacted by
 * name); a resend is recorded by hand, since it writes no endpoint row.
 */
@Injectable()
export class WebhookEndpointsService {
  private readonly cipher: FieldCipher | null = webhookCipherFor(env());

  constructor(
    private readonly tenantDb: TenantDb,
    private readonly sender: WebhookSender,
    private readonly deliveries: WebhookDeliveryService,
  ) {}

  async list(actor: RequestUser) {
    assertOwner(actor);
    const rows = await this.tenantDb
      .clientFor(actor.tenantId)
      .webhookEndpoint.findMany({ orderBy: { createdAt: 'asc' }, select: ENDPOINT_SELECT });
    return { configured: this.cipher !== null, endpoints: rows.map(endpointView) };
  }

  /** The secret is in this answer and never again. */
  async create(actor: RequestUser, input: WebhookEndpointCreateInput) {
    assertOwner(actor);
    const cipher = this.requireCipher();
    await this.assertDeliverable(input.url);

    const secret = newWebhookSecret();
    const row = await this.tenantDb.transaction(actor.tenantId, async (tx) => {
      const count = await tx.webhookEndpoint.count();
      if (count >= WEBHOOK_MAX_ENDPOINTS) {
        throw ApiError.conflict(`A company can have at most ${WEBHOOK_MAX_ENDPOINTS} webhook endpoints.`);
      }
      return tx.webhookEndpoint.create({
        data: {
          tenantId: actor.tenantId,
          url: input.url,
          description: input.description ?? null,
          events: input.events,
          secretCipher: cipher.encrypt(secret),
          secretLast4: secret.slice(-4),
          createdByUserId: actor.userId,
        },
        select: ENDPOINT_SELECT,
      });
    });
    return { endpoint: endpointView(row), secret };
  }

  async update(actor: RequestUser, id: string, input: WebhookEndpointUpdateInput) {
    assertOwner(actor);
    if (input.url !== undefined) await this.assertDeliverable(input.url);
    const row = await this.tenantDb.transaction(actor.tenantId, async (tx) => {
      const existing = await tx.webhookEndpoint.findFirst({ where: { id }, select: { status: true } });
      if (!existing) throw ApiError.notFound('Webhook endpoint');
      const reEnabling = input.status === 'active' && existing.status !== 'active';
      return tx.webhookEndpoint.update({
        where: { id },
        data: {
          ...(input.url === undefined ? {} : { url: input.url }),
          ...(input.description === undefined ? {} : { description: input.description }),
          ...(input.events === undefined ? {} : { events: input.events }),
          ...(input.status === 'disabled' && existing.status !== 'disabled'
            ? { status: 'disabled', disabledReason: 'owner', disabledAt: new Date() }
            : {}),
          // Back on with a clean slate: the failures that switched it off are history.
          ...(reEnabling
            ? { status: 'active', disabledReason: null, disabledAt: null, consecutiveFailures: 0 }
            : {}),
        },
        select: ENDPOINT_SELECT,
      });
    });
    return endpointView(row);
  }

  /** Gone with its delivery history. Events already written stay for any other endpoint. */
  async remove(actor: RequestUser, id: string): Promise<void> {
    assertOwner(actor);
    const { count } = await this.tenantDb
      .clientFor(actor.tenantId)
      .webhookEndpoint.deleteMany({ where: { id } });
    if (count === 0) throw ApiError.notFound('Webhook endpoint');
  }

  /**
   * "Send test event": a `webhook.ping`, to this endpoint only, sent now and answered with what the
   * receiver said. One try — it is a check, not a delivery anything depends on.
   */
  async ping(actor: RequestUser, id: string): Promise<DeliveryOutcome> {
    assertOwner(actor);
    this.requireCipher();
    const deliveryId = await this.tenantDb.transaction(actor.tenantId, async (tx) => {
      const endpoint = await tx.webhookEndpoint.findFirst({ where: { id }, select: { id: true } });
      if (!endpoint) throw ApiError.notFound('Webhook endpoint');
      const event = await tx.outboxEvent.create({
        data: {
          tenantId: actor.tenantId,
          type: WEBHOOK_PING_EVENT,
          payload: webhookJson({ message: 'A test event from BUILDR. Nothing happened.', endpoint_id: id }),
        },
        select: { id: true },
      });
      const delivery = await tx.webhookDelivery.create({
        data: { tenantId: actor.tenantId, endpointId: id, eventId: event.id, maxAttempts: 1 },
        select: { id: true },
      });
      return delivery.id;
    });
    // Sent to a switched-off endpoint too: checking a receiver before switching it back on is the point.
    return this.deliveries.deliver(actor.tenantId, deliveryId, new Date(), { evenIfSwitchedOff: true });
  }

  /**
   * "Resend": the same event (same id — receivers that already have it can tell) to the same
   * endpoint, as a new delivery with the full retry schedule, first try now.
   */
  async resend(actor: RequestUser, deliveryId: string): Promise<DeliveryOutcome> {
    assertOwner(actor);
    const created = await this.tenantDb.transaction(actor.tenantId, async (tx) => {
      const original = await tx.webhookDelivery.findFirst({
        where: { id: deliveryId },
        select: { id: true, endpointId: true, eventId: true, maxAttempts: true, endpoint: { select: { status: true } } },
      });
      if (!original) throw ApiError.notFound('Webhook delivery');
      if (original.endpoint.status !== 'active') {
        throw ApiError.conflict('Switch the endpoint back on before resending to it.');
      }
      const copy = await tx.webhookDelivery.create({
        data: {
          tenantId: actor.tenantId,
          endpointId: original.endpointId,
          eventId: original.eventId,
          maxAttempts: original.maxAttempts,
          resendOfId: original.id,
        },
        select: { id: true },
      });
      await tx.auditLog.create({
        data: {
          tenantId: actor.tenantId,
          actorId: actor.userId,
          action: 'webhook.resent',
          entity: 'webhook_endpoints',
          entityId: original.endpointId,
          after: { delivery_id: copy.id, resend_of: original.id, event_id: original.eventId },
        },
      });
      return copy.id;
    });
    return this.deliveries.deliver(actor.tenantId, created);
  }

  /** An endpoint's delivery log, newest first, each with its tries. */
  async deliveryLog(actor: RequestUser, endpointId: string, cursor?: string) {
    assertOwner(actor);
    const db = this.tenantDb.clientFor(actor.tenantId);
    const endpoint = await db.webhookEndpoint.findFirst({ where: { id: endpointId }, select: { id: true } });
    if (!endpoint) throw ApiError.notFound('Webhook endpoint');
    const rows = await db.webhookDelivery.findMany({
      where: { endpointId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: LOG_PAGE + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: {
        id: true,
        status: true,
        attemptCount: true,
        maxAttempts: true,
        nextAttemptAt: true,
        lastStatusCode: true,
        lastError: true,
        lastLatencyMs: true,
        deliveredAt: true,
        resendOfId: true,
        createdAt: true,
        event: { select: { id: true, type: true, createdAt: true } },
        attempts: {
          orderBy: { attempt: 'asc' },
          select: { attempt: true, statusCode: true, ok: true, latencyMs: true, error: true, responseSnippet: true, createdAt: true },
        },
      },
    });
    const page = rows.slice(0, LOG_PAGE);
    return {
      data: page.map((row) => ({
        id: row.id,
        status: row.status,
        event: { id: row.event.id, type: row.event.type, created_at: row.event.createdAt.toISOString() },
        attempt_count: row.attemptCount,
        max_attempts: row.maxAttempts,
        next_attempt_at: row.status === 'pending' ? row.nextAttemptAt.toISOString() : null,
        last_status_code: row.lastStatusCode,
        last_error: row.lastError,
        last_latency_ms: row.lastLatencyMs,
        delivered_at: row.deliveredAt?.toISOString() ?? null,
        resend_of_id: row.resendOfId,
        created_at: row.createdAt.toISOString(),
        attempts: row.attempts.map((attempt) => ({
          attempt: attempt.attempt,
          status_code: attempt.statusCode,
          ok: attempt.ok,
          latency_ms: attempt.latencyMs,
          error: attempt.error,
          response_snippet: attempt.responseSnippet,
          created_at: attempt.createdAt.toISOString(),
        })),
      })),
      next_cursor: rows.length > LOG_PAGE ? page[page.length - 1]!.id : null,
    };
  }

  private requireCipher(): FieldCipher {
    if (!this.cipher) {
      throw new ApiError(
        HttpStatus.CONFLICT,
        ERROR_CODES.CONFLICT,
        'Webhooks are not set up on this server (WEBHOOK_ENCRYPTION_KEY is missing).',
        { webhooks: 'not_configured' },
      );
    }
    return this.cipher;
  }

  /** Refuses URLs that are not public https, by their text and by every address they resolve to. */
  private async assertDeliverable(url: string): Promise<void> {
    try {
      await this.sender.assertDeliverable(url);
    } catch (error) {
      if (!(error instanceof WebhookTargetRefused)) throw error;
      const message =
        error.problem === 'unresolvable'
          ? 'That address does not resolve. Check the host name.'
          : WEBHOOK_URL_PROBLEM_COPY[error.problem];
      throw ApiError.validationFailed({ url: error.problem }, message);
    }
  }
}

function assertOwner(actor: RequestUser): void {
  if (actor.role !== 'owner') throw ApiError.forbidden('Only an owner can manage webhooks.');
}

function endpointView(row: EndpointRow) {
  return {
    id: row.id,
    url: row.url,
    description: row.description,
    events: row.events,
    secret_last4: row.secretLast4,
    status: row.status,
    disabled_reason: row.disabledReason,
    disabled_at: row.disabledAt?.toISOString() ?? null,
    consecutive_failures: row.consecutiveFailures,
    last_success_at: row.lastSuccessAt?.toISOString() ?? null,
    last_failure_at: row.lastFailureAt?.toISOString() ?? null,
    created_at: row.createdAt.toISOString(),
  };
}
