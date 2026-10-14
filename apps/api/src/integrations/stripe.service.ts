import { Injectable, Logger } from '@nestjs/common';
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { env } from '../config/env';

/**
 * Stripe client (roadmap Phase 0, item 7): subscriptions for every currency other than rupees.
 *
 * Plain HTTPS rather than the SDK — three calls do not earn a dependency — and, like the Razorpay
 * client, it runs dry with no credentials: checkout returns a plausible fake and logs what it would
 * have sent, so local work and the e2e suite need no Stripe account.
 *
 * Signature verification is never stubbed. A dry run that accepted unsigned webhooks would be an
 * open door the day the keys are added.
 */

const API = 'https://api.stripe.com/v1';
/** Stripe's own default: a signed event older than five minutes is refused as a possible replay. */
const SIGNATURE_TOLERANCE_SECONDS = 300;

export interface StripeCheckout {
  id: string;
  url: string | null;
  dryRun: boolean;
}

@Injectable()
export class StripeService {
  private readonly logger = new Logger(StripeService.name);
  private readonly config = env();

  get configured(): boolean {
    return Boolean(this.config.STRIPE_SECRET_KEY);
  }

  /**
   * A hosted checkout for one plan.
   *
   * A term plan is a subscription renewing every `months`; lifetime is a single payment. The price
   * is sent inline (`price_data`), so there is nothing to create in the Stripe dashboard first.
   * The tenant id rides in metadata on both the session and the subscription it creates — it came
   * from us, so the webhook can trust it after the signature check.
   */
  async createCheckout(input: {
    tenantId: string;
    tenantName: string;
    plan: string;
    planName: string;
    currency: string;
    /** Minor units of `currency`. */
    amount: bigint;
    /** Null for lifetime. */
    months: number | null;
    successUrl: string;
    cancelUrl: string;
  }): Promise<StripeCheckout> {
    if (!this.configured) {
      this.logger.log({ plan: input.plan, currency: input.currency }, 'Stripe dry run: checkout');
      return { id: `cs_dry_${randomUUID()}`, url: null, dryRun: true };
    }

    const form: Record<string, string> = {
      mode: input.months ? 'subscription' : 'payment',
      success_url: input.successUrl,
      cancel_url: input.cancelUrl,
      client_reference_id: input.tenantId,
      'metadata[tenant_id]': input.tenantId,
      'metadata[plan]': input.plan,
      'line_items[0][quantity]': '1',
      'line_items[0][price_data][currency]': input.currency.toLowerCase(),
      'line_items[0][price_data][unit_amount]': input.amount.toString(),
      'line_items[0][price_data][product_data][name]': `BUILDR — ${input.planName}`,
    };
    if (input.months) {
      form['line_items[0][price_data][recurring][interval]'] = 'month';
      form['line_items[0][price_data][recurring][interval_count]'] = String(input.months);
      form['subscription_data[metadata][tenant_id]'] = input.tenantId;
      form['subscription_data[metadata][plan]'] = input.plan;
    } else {
      form['payment_intent_data[metadata][tenant_id]'] = input.tenantId;
    }

    const session = await this.post<{ id: string; url: string | null }>('/checkout/sessions', form);
    return { id: session.id, url: session.url, dryRun: false };
  }

  async cancelSubscription(subscriptionId: string, atPeriodEnd: boolean): Promise<void> {
    if (!this.configured) {
      this.logger.log({ subscriptionId, atPeriodEnd }, 'Stripe dry run: cancel');
      return;
    }
    if (atPeriodEnd) {
      await this.post(`/subscriptions/${subscriptionId}`, { cancel_at_period_end: 'true' });
    } else {
      await this.request('DELETE', `/subscriptions/${subscriptionId}`);
    }
  }

  /**
   * Checks a `Stripe-Signature` header (`t=…,v1=…`) against the raw body: HMAC-SHA256 of
   * `${t}.${body}` with the endpoint secret, and a timestamp within tolerance.
   */
  verifyWebhook(rawBody: Buffer, header: string | undefined, now = Date.now()): boolean {
    const secret = this.config.STRIPE_WEBHOOK_SECRET;
    if (!secret || !header) return false;
    return verifyStripeSignature(rawBody, header, secret, now);
  }

  private post<T>(path: string, form: Record<string, string>): Promise<T> {
    return this.request<T>('POST', path, form);
  }

  private async request<T>(
    method: string,
    path: string,
    form?: Record<string, string>,
  ): Promise<T> {
    const response = await fetch(`${API}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.config.STRIPE_SECRET_KEY}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: form ? new URLSearchParams(form).toString() : undefined,
    });
    const body = (await response.json()) as T & { error?: { message?: string } };
    if (!response.ok) {
      // Stripe's message, not the request: the request carries the key.
      throw new Error(`Stripe ${method} ${path} failed: ${body.error?.message ?? response.status}`);
    }
    return body;
  }
}

/** Exported for its test; the service is the only caller. */
export function verifyStripeSignature(
  rawBody: Buffer,
  header: string,
  secret: string,
  now: number,
): boolean {
  const parts = header.split(',').map((part) => part.split('=') as [string, string]);
  const timestamp = Number(parts.find(([key]) => key === 't')?.[1]);
  const signatures = parts.filter(([key]) => key === 'v1').map(([, value]) => value);
  if (!Number.isFinite(timestamp) || signatures.length === 0) return false;
  if (Math.abs(now / 1000 - timestamp) > SIGNATURE_TOLERANCE_SECONDS) return false;

  const expected = Buffer.from(
    createHmac('sha256', secret).update(`${timestamp}.`).update(rawBody).digest('hex'),
    'utf8',
  );
  return signatures.some((signature) => {
    const given = Buffer.from(signature, 'utf8');
    return given.length === expected.length && timingSafeEqual(given, expected);
  });
}
