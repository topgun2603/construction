import { Injectable, Logger } from '@nestjs/common';
import { WEBHOOK_PING_EVENT, WEBHOOK_SIGNATURE_HEADER, webhookRetryDelaySeconds } from '@sitebook/shared';
import type { FieldCipher } from '../../common/crypto/field-cipher';
import { TenantDb } from '../../common/prisma/tenant-db.service';
import { env } from '../../config/env';
import { NotificationsService } from '../notifications/notifications.service';
import { webhookCipherFor, webhookSignature } from './webhook-crypto';
import { WebhookQueue } from './webhook-queue.service';
import { WebhookSender, type SendResult } from './webhook-sender.service';

/** How long a claimed delivery is held before another worker may take it (a crashed sender's). */
const CLAIM_MS = 60_000;
/** Due deliveries sent per company per sweep; the rest wait for the next one. */
const SWEEP_BATCH = 50;
/** Delivery history kept for the log, and how long idempotency answers are kept. */
const RETENTION_DAYS = 30;

export interface DeliveryOutcome {
  delivery_id: string;
  status: 'succeeded' | 'pending' | 'failed' | 'skipped';
  attempt: number;
  status_code: number | null;
  latency_ms: number | null;
  error: string | null;
}

/**
 * Sends webhook deliveries and keeps their retry state (roadmap Phase 3).
 *
 * Postgres is the record: a delivery is `pending` with a `next_attempt_at`, a sender *claims* it by
 * moving it to `sending` in one conditional update (so the queue job, the sweep and a person pressing
 * "Resend" can never send the same try twice), sends, logs the try in `webhook_delivery_attempts`,
 * and either marks it `succeeded` or schedules the next try on the WEBHOOK_RETRY_DELAYS_SECONDS
 * curve. After the last try it is `failed`.
 *
 * An endpoint that has not accepted a single delivery for the whole retry window (about a day) is
 * switched off, and the owners are told — a dead URL would otherwise be retried for ever, and the
 * company would not know its integration had stopped.
 *
 * Every method takes `now`, so the e2e suite can walk a delivery through a day of retries without
 * waiting a day or faking timers in a process that also runs Postgres I/O.
 */
@Injectable()
export class WebhookDeliveryService {
  private readonly logger = new Logger(WebhookDeliveryService.name);
  private readonly cipher: FieldCipher | null = webhookCipherFor(env());

  constructor(
    private readonly tenantDb: TenantDb,
    private readonly sender: WebhookSender,
    private readonly queue: WebhookQueue,
    private readonly notifications: NotificationsService,
  ) {}

  /** Sends whatever is due for one company. Returns how many tries were made. */
  async processDue(tenantId: string, now = new Date()): Promise<number> {
    const due = await this.tenantDb.clientFor(tenantId).webhookDelivery.findMany({
      where: {
        nextAttemptAt: { lte: now },
        OR: [
          { status: 'pending' },
          // A sender that died mid-send leaves its claim to run out; then it is due again.
          { status: 'sending', lockedUntil: { lt: now } },
        ],
      },
      orderBy: { nextAttemptAt: 'asc' },
      take: SWEEP_BATCH,
      select: { id: true },
    });
    let sent = 0;
    for (const row of due) {
      const outcome = await this.deliver(tenantId, row.id, now);
      if (outcome.status !== 'skipped') sent += 1;
    }
    return sent;
  }

  /** One try at one delivery, if it is due and nobody else holds it. */
  async deliver(
    tenantId: string,
    deliveryId: string,
    now = new Date(),
    options: { evenIfSwitchedOff?: boolean } = {},
  ): Promise<DeliveryOutcome> {
    const claimed = await this.tenantDb.transaction(tenantId, async (tx) => {
      const { count } = await tx.webhookDelivery.updateMany({
        where: {
          id: deliveryId,
          nextAttemptAt: { lte: now },
          OR: [{ status: 'pending' }, { status: 'sending', lockedUntil: { lt: now } }],
        },
        data: { status: 'sending', lockedUntil: new Date(now.getTime() + CLAIM_MS) },
      });
      if (count === 0) return null;
      return tx.webhookDelivery.findUniqueOrThrow({
        where: { id: deliveryId },
        select: {
          id: true,
          createdAt: true,
          attemptCount: true,
          maxAttempts: true,
          endpoint: { select: { id: true, url: true, status: true, secretCipher: true, lastSuccessAt: true } },
          event: { select: { id: true, type: true, payload: true, createdAt: true } },
        },
      });
    });
    if (!claimed) {
      return { delivery_id: deliveryId, status: 'skipped', attempt: 0, status_code: null, latency_ms: null, error: null };
    }

    const attempt = claimed.attemptCount + 1;

    // Switched off since this was queued: stop here. "Resend" after switching back on sends it again.
    if (claimed.endpoint.status !== 'active' && !options.evenIfSwitchedOff) {
      await this.tenantDb.transaction(tenantId, (tx) =>
        tx.webhookDelivery.update({
          where: { id: deliveryId },
          data: { status: 'failed', lockedUntil: null, lastError: 'The endpoint is switched off' },
        }),
      );
      return { delivery_id: deliveryId, status: 'failed', attempt: claimed.attemptCount, status_code: null, latency_ms: null, error: 'The endpoint is switched off' };
    }

    const result = await this.attempt(claimed, deliveryId, attempt);
    return this.record(tenantId, deliveryId, claimed, attempt, result, now);
  }

  /** Clears old history for one company: deliveries, events and idempotency answers. */
  async prune(tenantId: string, now = new Date()): Promise<void> {
    const before = new Date(now.getTime() - RETENTION_DAYS * 24 * 3600 * 1000);
    await this.tenantDb.transaction(tenantId, async (tx) => {
      // Attempts and deliveries cascade from their event.
      await tx.outboxEvent.deleteMany({ where: { createdAt: { lt: before } } });
      await tx.apiIdempotencyKey.deleteMany({
        where: { createdAt: { lt: new Date(now.getTime() - 24 * 3600 * 1000) } },
      });
    });
  }

  private async attempt(
    claimed: {
      endpoint: { url: string; secretCipher: string };
      event: { id: string; type: string; payload: unknown; createdAt: Date };
    },
    deliveryId: string,
    attempt: number,
  ): Promise<SendResult> {
    if (!this.cipher) {
      return { ok: false, statusCode: null, latencyMs: 0, error: 'Webhooks are not configured on this server', snippet: null };
    }
    let secret: string;
    try {
      secret = this.cipher.decrypt(claimed.endpoint.secretCipher);
    } catch {
      return { ok: false, statusCode: null, latencyMs: 0, error: 'The signing secret could not be read', snippet: null };
    }

    // The envelope receivers parse. `id` is the event's, the same on every try and every endpoint:
    // what a receiver de-duplicates on.
    const body = JSON.stringify({
      id: claimed.event.id,
      type: claimed.event.type,
      api_version: 'v1',
      created_at: claimed.event.createdAt.toISOString(),
      data: claimed.event.payload,
    });
    // Real wall-clock time, not the injectable `now`: the receiver checks it against its own clock.
    const timestamp = Math.floor(Date.now() / 1000);
    return this.sender.send(claimed.endpoint.url, body, {
      'Content-Type': 'application/json',
      'User-Agent': 'BUILDR-Webhooks/1.0',
      'X-Buildr-Event': claimed.event.type,
      'X-Buildr-Event-Id': claimed.event.id,
      'X-Buildr-Delivery': deliveryId,
      'X-Buildr-Attempt': String(attempt),
      [WEBHOOK_SIGNATURE_HEADER]: webhookSignature(secret, body, timestamp),
    });
  }

  private async record(
    tenantId: string,
    deliveryId: string,
    claimed: {
      createdAt: Date;
      maxAttempts: number;
      endpoint: { id: string; url: string };
      event: { type: string };
    },
    attempt: number,
    result: SendResult,
    now: Date,
  ): Promise<DeliveryOutcome> {
    const retryIn =
      result.ok || attempt >= claimed.maxAttempts ? null : webhookRetryDelaySeconds(attempt, Math.random());
    const status: DeliveryOutcome['status'] = result.ok ? 'succeeded' : retryIn === null ? 'failed' : 'pending';
    // A test ping says nothing about whether real deliveries are getting through.
    const countsForEndpoint = claimed.event.type !== WEBHOOK_PING_EVENT;

    const switchedOff = await this.tenantDb.transaction(tenantId, async (tx) => {
      await tx.webhookDeliveryAttempt.create({
        data: {
          tenantId,
          deliveryId,
          attempt,
          statusCode: result.statusCode,
          ok: result.ok,
          latencyMs: result.latencyMs,
          error: result.error,
          responseSnippet: result.snippet,
        },
      });
      await tx.webhookDelivery.update({
        where: { id: deliveryId },
        data: {
          status,
          attemptCount: attempt,
          lockedUntil: null,
          lastStatusCode: result.statusCode,
          lastError: result.error,
          lastLatencyMs: result.latencyMs,
          ...(result.ok ? { deliveredAt: now } : {}),
          ...(retryIn !== null ? { nextAttemptAt: new Date(now.getTime() + retryIn * 1000) } : {}),
        },
      });
      if (!countsForEndpoint) return false;

      if (result.ok) {
        await tx.webhookEndpoint.update({
          where: { id: claimed.endpoint.id },
          data: { consecutiveFailures: 0, lastSuccessAt: now },
        });
        return false;
      }
      const endpoint = await tx.webhookEndpoint.update({
        where: { id: claimed.endpoint.id },
        data: { consecutiveFailures: { increment: 1 }, lastFailureAt: now },
        select: { status: true, lastSuccessAt: true },
      });
      /*
       * Switch the endpoint off when a delivery has used every try *and* nothing at all got through
       * since that delivery was first sent — i.e. the receiver has been failing for the whole retry
       * window, about a day. One bad event among good ones (a receiver that chokes on one payload)
       * fails alone and leaves the endpoint on.
       */
      const deadForAWindow =
        status === 'failed' &&
        claimed.maxAttempts > 1 &&
        endpoint.status === 'active' &&
        (!endpoint.lastSuccessAt || endpoint.lastSuccessAt < claimed.createdAt);
      if (!deadForAWindow) return false;
      await tx.webhookEndpoint.update({
        where: { id: claimed.endpoint.id },
        data: { status: 'disabled', disabledReason: 'failing', disabledAt: now },
      });
      return true;
    });

    if (retryIn !== null) await this.queue.deliver({ tenantId, deliveryId }, attempt + 1, retryIn * 1000);
    if (switchedOff) await this.tellOwners(tenantId, claimed.endpoint);

    return {
      delivery_id: deliveryId,
      status,
      attempt,
      status_code: result.statusCode,
      latency_ms: result.latencyMs,
      error: result.error,
    };
  }

  /** In the app and by push, to every owner: their integration has stopped hearing from BUILDR. */
  private async tellOwners(tenantId: string, endpoint: { id: string; url: string }): Promise<void> {
    try {
      await this.notifications.notify({
        tenantId,
        roles: ['owner'],
        type: 'webhook.endpoint_disabled',
        title: 'A webhook was switched off',
        body: `${hostOf(endpoint.url)} has not accepted a delivery for a day, so BUILDR stopped sending to it. Fix the receiver, then switch it back on in Settings → Developers.`,
        payload: { endpoint_id: endpoint.id },
      });
    } catch (error) {
      // The switch-off itself is committed and audited; a failed push must not undo or hide it.
      this.logger.warn({ err: error, endpointId: endpoint.id }, 'Could not tell owners about a switched-off webhook');
    }
  }
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return 'An endpoint';
  }
}
