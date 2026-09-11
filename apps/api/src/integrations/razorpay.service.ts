import { Injectable, Logger } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Plan } from '@sitebook/shared';
import { env } from '../config/env';

/**
 * Razorpay Subscriptions client (spec §11, §3 item 12).
 *
 * With no credentials configured the client runs dry: `createSubscription` returns a plausible fake
 * and logs what it would have sent. That keeps local work and the e2e suite from needing a Razorpay
 * account, matching how the WhatsApp client behaves.
 *
 * Signature verification is the exception — it is never stubbed. A dry-run that accepted unsigned
 * webhooks would be a development convenience that turns into an open door the moment anything is
 * deployed, and the code path that matters most would be the one least exercised.
 */
const API = 'https://api.razorpay.com/v1';

export interface CreatedSubscription {
  id: string;
  planId: string;
  /** Razorpay's hosted checkout. Null in dry run. */
  shortUrl: string | null;
  status: string;
  dryRun: boolean;
}

@Injectable()
export class RazorpayService {
  private readonly logger = new Logger(RazorpayService.name);
  private readonly config = env();

  get configured(): boolean {
    return Boolean(this.config.RAZORPAY_KEY_ID && this.config.RAZORPAY_SECRET);
  }

  /** The Razorpay plan id one of our plans maps to. */
  planId(plan: Plan): string | null {
    return plan === 'pro'
      ? (this.config.RAZORPAY_PLAN_ID_PRO ?? null)
      : (this.config.RAZORPAY_PLAN_ID_STARTER ?? null);
  }

  /**
   * Verify the `X-Razorpay-Signature` header against the raw request body.
   *
   * Over the raw bytes, never a re-serialised object: `JSON.parse` then `JSON.stringify` can reorder
   * keys and drop whitespace, and the HMAC would stop matching for reasons that look like an attack.
   *
   * Compared with `timingSafeEqual` so the check cannot be probed a byte at a time.
   */
  verifyWebhook(rawBody: Buffer | string, signature: string | undefined): boolean {
    const secret = this.config.RAZORPAY_WEBHOOK_SECRET;
    if (!secret) {
      this.logger.error('Webhook rejected: RAZORPAY_WEBHOOK_SECRET is not set');
      return false;
    }
    if (!signature) return false;

    const expected = createHmac('sha256', secret).update(rawBody).digest('hex');
    const given = Buffer.from(signature, 'utf8');
    const mine = Buffer.from(expected, 'utf8');
    // Length differs: not equal, and bail before timingSafeEqual which throws on a mismatch.
    if (given.length !== mine.length) return false;
    return timingSafeEqual(given, mine);
  }

  /**
   * Create a subscription against a plan.
   *
   * `total_count` is the number of cycles Razorpay will bill. 120 is ten years of monthly charges —
   * Razorpay requires a finite count, and anything shorter silently stops billing a customer who is
   * still using the product.
   */
  async createSubscription(input: {
    plan: Plan;
    tenantId: string;
    tenantName: string;
    ownerPhone: string;
    notifyUrl?: string;
  }): Promise<CreatedSubscription> {
    const planId = this.planId(input.plan);

    if (!this.configured || !planId) {
      const fake = `sub_dry_${input.tenantId.replace(/-/g, '').slice(0, 14)}`;
      this.logger.warn(
        `Razorpay not configured — dry run subscription ${fake} for ${input.tenantName} on ${input.plan}`,
      );
      return { id: fake, planId: planId ?? `plan_dry_${input.plan}`, shortUrl: null, status: 'created', dryRun: true };
    }

    const body = {
      plan_id: planId,
      total_count: 120,
      customer_notify: 1,
      notes: {
        // Carried back on every webhook, which is how an event is matched to a tenant without
        // trusting anything the caller sends.
        tenant_id: input.tenantId,
        tenant_name: input.tenantName,
      },
    };

    const response = await fetch(`${API}/subscriptions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: this.authHeader(),
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const detail = await response.text();
      this.logger.error(`Razorpay rejected the subscription: ${response.status} ${detail}`);
      throw new Error(`Razorpay returned ${response.status}`);
    }

    const created = (await response.json()) as {
      id: string;
      plan_id: string;
      short_url?: string;
      status: string;
    };
    return {
      id: created.id,
      planId: created.plan_id,
      shortUrl: created.short_url ?? null,
      status: created.status,
      dryRun: false,
    };
  }

  /** Cancel, optionally letting the paid period run out first. */
  async cancelSubscription(subscriptionId: string, atPeriodEnd: boolean): Promise<void> {
    if (!this.configured || subscriptionId.startsWith('sub_dry_')) {
      this.logger.warn(`Razorpay not configured — dry run cancel of ${subscriptionId}`);
      return;
    }

    const response = await fetch(`${API}/subscriptions/${subscriptionId}/cancel`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: this.authHeader() },
      body: JSON.stringify({ cancel_at_cycle_end: atPeriodEnd ? 1 : 0 }),
    });

    if (!response.ok) {
      const detail = await response.text();
      this.logger.error(`Razorpay rejected the cancel: ${response.status} ${detail}`);
      throw new Error(`Razorpay returned ${response.status}`);
    }
  }

  private authHeader(): string {
    const token = Buffer.from(
      `${this.config.RAZORPAY_KEY_ID}:${this.config.RAZORPAY_SECRET}`,
    ).toString('base64');
    return `Basic ${token}`;
  }
}
