import { Injectable, Logger } from '@nestjs/common';
import {
  defaultModulesForPlan,
  type CancelSubscriptionInput,
  type Plan,
  type StartSubscriptionInput,
} from '@sitebook/shared';
import type { RequestUser } from '../../common/auth/request-user';
import { TenantCache } from '../../common/auth/tenant-cache.service';
import { ApiError } from '../../common/errors/api-error';
import { PlansService } from '../plans/plans.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TenantDb } from '../../common/prisma/tenant-db.service';
import { RazorpayService } from '../../integrations/razorpay.service';
import { env } from '../../config/env';

export interface BillingView {
  plan: string;
  status: string;
  /** Paise per cycle. */
  amount: string;
  current_period_end: string | null;
  cancel_at: string | null;
  last_failure_reason: string | null;
  /** Razorpay's hosted checkout, when one is waiting to be completed. */
  checkout_url: string | null;
  /** False when this deployment has no Razorpay credentials — the UI says so rather than failing. */
  billing_configured: boolean;
}

/**
 * Subscription billing (spec §3 item 12).
 *
 * The shape of the trust here is the whole design: a browser may ask to *start* or *cancel* a
 * subscription, and nothing more. What plan a tenant is on, whether it is paid, and until when are
 * set only from a signature-verified webhook. A client that could set its own status would be a
 * client that could have Pro for free.
 */
@Injectable()
export class BillingService {
  private readonly logger = new Logger(BillingService.name);
  private readonly config = env();

  constructor(
    private readonly plans: PlansService,
    private readonly tenantDb: TenantDb,
    /** Webhooks arrive with no tenant context, so they are handled outside RLS by event id. */
    private readonly prisma: PrismaService,
    private readonly razorpay: RazorpayService,
    private readonly tenantCache: TenantCache,
  ) {}

  async current(actor: RequestUser): Promise<BillingView> {
    const db = this.tenantDb.clientFor(actor.tenantId);
    const [subscription, tenant] = await Promise.all([
      db.subscription.findUnique({ where: { tenantId: actor.tenantId } }),
      db.tenant.findUniqueOrThrow({
        where: { id: actor.tenantId },
        select: { plan: true },
      }),
    ]);

    return {
      // The tenant's plan is what gates features; the subscription's plan is what is being billed.
      // They differ while an upgrade is mid-checkout, and the screen should show the real one.
      plan: tenant.plan,
      status: subscription?.status ?? 'none',
      amount: (subscription?.amount ?? 0n).toString(),
      current_period_end: subscription?.currentPeriodEnd?.toISOString() ?? null,
      cancel_at: subscription?.cancelAt?.toISOString() ?? null,
      last_failure_reason: subscription?.lastFailureReason ?? null,
      checkout_url: null,
      billing_configured: this.razorpay.configured,
    };
  }

  async invoices(actor: RequestUser) {
    const rows = await this.tenantDb.clientFor(actor.tenantId).invoice.findMany({
      where: {},
      orderBy: [{ issuedAt: 'desc' }, { createdAt: 'desc' }],
      take: 50,
    });

    return rows.map((row) => ({
      id: row.id,
      amount: row.amount.toString(),
      status: row.status,
      invoice_url: row.invoiceUrl,
      issued_at: row.issuedAt?.toISOString() ?? null,
      paid_at: row.paidAt?.toISOString() ?? null,
    }));
  }

  /**
   * Begin a subscription, returning Razorpay's checkout link.
   *
   * The plan is *not* applied here. Razorpay has taken no money yet, and granting Pro the moment
   * somebody clicks upgrade would hand out the plan to anyone who opens the dialog and walks away.
   * `subscription.activated` does it, once the first charge has actually cleared.
   */
  async start(actor: RequestUser, input: StartSubscriptionInput) {
    const db = this.tenantDb.clientFor(actor.tenantId);

    const [tenant, existing] = await Promise.all([
      db.tenant.findUniqueOrThrow({
        where: { id: actor.tenantId },
        select: { id: true, name: true, plan: true },
      }),
      db.subscription.findUnique({ where: { tenantId: actor.tenantId } }),
    ]);

    if (existing?.status === 'active' && existing.plan === input.plan) {
      throw ApiError.conflict(`You are already subscribed to ${input.plan}`);
    }

    const owner = await db.user.findFirst({
      where: { role: 'owner', deletedAt: null },
      select: { phone: true },
      orderBy: { createdAt: 'asc' },
    });

    const created = await this.razorpay.createSubscription({
      plan: input.plan,
      tenantId: actor.tenantId,
      tenantName: tenant.name,
      ownerPhone: owner?.phone ?? '',
    });

    // The amount is the catalogue's, never the caller's. A client that could name its price
    // would be a client that could buy a year for a rupee.
    const plan = await this.plans.forCode(input.plan);
    if (!plan) throw ApiError.notFound('Plan');
    const price = BigInt(plan.price);

    await db.subscription.upsert({
      where: { tenantId: actor.tenantId },
      create: {
        tenantId: actor.tenantId,
        plan: input.plan,
        // `trialing` rather than `active`: nothing has been charged. Only the webhook says active.
        status: 'trialing',
        razorpaySubscriptionId: created.id,
        razorpayPlanId: created.planId,
        amount: price,
      },
      update: {
        plan: input.plan,
        status: 'trialing',
        razorpaySubscriptionId: created.id,
        razorpayPlanId: created.planId,
        amount: price,
        cancelAt: null,
        cancelledAt: null,
        lastFailureReason: null,
      },
    });

    return {
      subscription_id: created.id,
      checkout_url: created.shortUrl,
      /** True when no Razorpay account is configured: the UI explains instead of pretending. */
      dry_run: created.dryRun,
      plan: input.plan,
      amount: price.toString(),
    };
  }

  /**
   * Cancel, keeping access until the period already paid for runs out.
   *
   * `at_period_end` defaults true because the alternative takes away something the builder has paid
   * for. The plan is not dropped here either — `subscription.cancelled` does that when the period
   * actually ends, so somebody who cancels on day 2 of a month keeps the month.
   */
  async cancel(actor: RequestUser, input: CancelSubscriptionInput) {
    const db = this.tenantDb.clientFor(actor.tenantId);
    const subscription = await db.subscription.findUnique({
      where: { tenantId: actor.tenantId },
    });

    if (!subscription || !subscription.razorpaySubscriptionId) {
      throw ApiError.conflict('There is no subscription to cancel');
    }
    if (subscription.status === 'cancelled') {
      throw ApiError.conflict('This subscription is already cancelled');
    }

    await this.razorpay.cancelSubscription(
      subscription.razorpaySubscriptionId,
      input.at_period_end,
    );

    const immediate = !input.at_period_end;
    await db.subscription.update({
      where: { tenantId: actor.tenantId },
      data: immediate
        ? { status: 'cancelled', cancelledAt: new Date(), cancelAt: null }
        : { cancelAt: subscription.currentPeriodEnd ?? new Date() },
    });

    // An immediate cancel has no "period end" webhook coming, so the downgrade happens now.
    if (immediate) await this.lapseTerm(actor.tenantId, 'cancelled immediately');

    return this.current(actor);
  }

  /**
   * Handle a webhook Razorpay has delivered.
   *
   * Called only after the signature has been verified. Two properties matter more than which events
   * are handled:
   *
   * - **Idempotent.** Razorpay retries until it gets a 2xx, so every event arrives more than once.
   *   The event id is inserted first and a duplicate is a no-op, which is what stops a retried
   *   `subscription.charged` raising a second invoice and extending the period twice.
   * - **Tenant resolved from our own data.** The tenant comes from the subscription id we stored, or
   *   from the `notes.tenant_id` we set when creating it — never from anything a caller could choose.
   */
  async handleWebhook(input: {
    eventId: string;
    eventType: string;
    payload: Record<string, unknown>;
  }): Promise<{ handled: boolean; duplicate: boolean }> {
    // The insert is the lock. A unique violation means this event has been seen, so there is nothing
    // to do and Razorpay should stop retrying — hence a 2xx, not an error.
    try {
      await this.prisma.webhookEvent.create({
        data: {
          eventId: input.eventId,
          eventType: input.eventType,
          payload: input.payload as never,
        },
      });
    } catch {
      this.logger.log(`Webhook ${input.eventId} already seen — ignoring the retry`);
      return { handled: false, duplicate: true };
    }

    try {
      await this.dispatch(input.eventType, input.payload);
      await this.prisma.webhookEvent.update({
        where: { eventId: input.eventId },
        data: { handledAt: new Date() },
      });
      return { handled: true, duplicate: false };
    } catch (error) {
      /*
       * The row stays with `handled_at` null and the error recorded, so a failure is visible and
       * retryable rather than a silent gap. Rethrown so Razorpay gets a non-2xx and retries.
       */
      const message = error instanceof Error ? error.message : String(error);
      await this.prisma.webhookEvent.update({
        where: { eventId: input.eventId },
        data: { error: message.slice(0, 500) },
      });
      this.logger.error(`Webhook ${input.eventType} failed: ${message}`);
      throw error;
    }
  }

  /** Route an event to its handler. Unknown types are recorded and ignored, never an error. */
  private async dispatch(eventType: string, payload: Record<string, unknown>): Promise<void> {
    const entity = subscriptionEntity(payload);

    switch (eventType) {
      case 'subscription.activated':
      case 'subscription.charged':
        await this.onCharged(entity, payload);
        break;
      case 'subscription.pending':
      case 'subscription.halted':
        await this.onPaymentFailed(entity);
        break;
      case 'subscription.cancelled':
      case 'subscription.completed':
        await this.onCancelled(entity);
        break;
      case 'invoice.paid':
        await this.onInvoice(payload, 'paid');
        break;
      default:
        // Razorpay sends a great many events. Recording one we do not act on is not a failure, and
        // treating it as one would have us return 5xx and be retried forever.
        this.logger.log(`Webhook ${eventType} recorded, no action taken`);
    }
  }

  /**
   * Money cleared: the plan applies and the period extends.
   *
   * This is the only place a tenant's plan goes *up*. Upgrading at checkout time would hand out Pro
   * to anybody who opened the dialog, and upgrading on `invoice.paid` alone would miss the first
   * cycle — `subscription.activated` is the event that means the mandate is live and paid.
   */
  private async onCharged(
    entity: SubscriptionEntity | null,
    payload: Record<string, unknown>,
  ): Promise<void> {
    const resolved = await this.resolveTenant(entity);
    if (!resolved) return;

    const periodEnd = entity?.current_end
      ? new Date(entity.current_end * 1000)
      : monthFromNow();

    await this.tenantDb.clientFor(resolved.tenantId).subscription.update({
      where: { tenantId: resolved.tenantId },
      data: {
        status: 'active',
        currentPeriodEnd: periodEnd,
        lastFailureReason: null,
        ...(entity?.id ? { razorpaySubscriptionId: entity.id } : {}),
      },
    });

    await this.applyPlan(resolved.tenantId, resolved.plan, 'payment cleared');
    await this.onInvoice(payload, 'paid');
  }

  /**
   * A charge failed.
   *
   * Access is *not* cut here. The builder has already paid for the current period, and their site
   * staff should not lose the roll call mid-shift because a card expired. The plan drops when the
   * paid period plus the grace window has passed, which `dropLapsedSubscriptions` does.
   */
  private async onPaymentFailed(entity: SubscriptionEntity | null): Promise<void> {
    const resolved = await this.resolveTenant(entity);
    if (!resolved) return;

    await this.tenantDb.clientFor(resolved.tenantId).subscription.update({
      where: { tenantId: resolved.tenantId },
      data: {
        status: 'past_due',
        lastFailureReason: 'The last payment did not go through',
        ...(entity?.current_end ? { currentPeriodEnd: new Date(entity.current_end * 1000) } : {}),
      },
    });
    this.logger.warn(`Subscription past due for tenant ${resolved.tenantId}`);
  }

  /** Cancelled or run to completion: the plan drops to Starter once the paid period is over. */
  private async onCancelled(entity: SubscriptionEntity | null): Promise<void> {
    const resolved = await this.resolveTenant(entity);
    if (!resolved) return;

    const periodEnd = entity?.current_end ? new Date(entity.current_end * 1000) : new Date();
    await this.tenantDb.clientFor(resolved.tenantId).subscription.update({
      where: { tenantId: resolved.tenantId },
      data: {
        status: 'cancelled',
        cancelledAt: new Date(),
        cancelAt: null,
        currentPeriodEnd: periodEnd,
      },
    });

    // Already past the paid period, so there is nothing left to honour.
    if (periodEnd.getTime() <= Date.now()) {
      await this.lapseTerm(resolved.tenantId, 'subscription cancelled', periodEnd);
    }
  }

  /** Record a charge so the owner can see their billing history without calling Razorpay. */
  private async onInvoice(payload: Record<string, unknown>, status: string): Promise<void> {
    const invoice = entityOf(payload, 'invoice');
    if (!invoice) return;

    // Narrowed to strings explicitly: these come off the wire as `unknown`, and a truthy check
    // alone leaves them unusable as ids — which is the compiler being right, not pedantic.
    const invoiceId = typeof invoice['id'] === 'string' ? invoice['id'] : null;
    const subscriptionId =
      typeof invoice['subscription_id'] === 'string' ? invoice['subscription_id'] : null;
    if (!invoiceId || !subscriptionId) return;

    const mapped = await this.prisma.billingIdentity.findUnique({
      where: { razorpaySubscriptionId: subscriptionId },
      select: { tenantId: true },
    });
    if (!mapped) return;

    const db = this.tenantDb.clientFor(mapped.tenantId);
    const subscription = await db.subscription.findUnique({
      where: { tenantId: mapped.tenantId },
      select: { id: true, tenantId: true },
    });
    if (!subscription) return;

    const amount = typeof invoice['amount'] === 'number' ? BigInt(invoice['amount']) : 0n;
    const paymentId = typeof invoice['payment_id'] === 'string' ? invoice['payment_id'] : null;
    const invoiceStatus = typeof invoice['status'] === 'string' ? invoice['status'] : status;
    const shortUrl = typeof invoice['short_url'] === 'string' ? invoice['short_url'] : null;
    const issuedAt =
      typeof invoice['issued_at'] === 'number' ? new Date(invoice['issued_at'] * 1000) : new Date();
    const paidAt =
      typeof invoice['paid_at'] === 'number' ? new Date(invoice['paid_at'] * 1000) : null;

    await db.invoice.upsert({
      where: { razorpayInvoiceId: invoiceId },
      create: {
        tenantId: subscription.tenantId,
        subscriptionId: subscription.id,
        razorpayInvoiceId: invoiceId,
        razorpayPaymentId: paymentId,
        amount,
        status: invoiceStatus,
        invoiceUrl: shortUrl,
        issuedAt,
        paidAt,
      },
      // Upsert, not create: `invoice.paid` can arrive after `subscription.charged` already recorded
      // the same invoice, and a second row would double the history the owner reads.
      update: {
        status: invoiceStatus,
        ...(paymentId ? { razorpayPaymentId: paymentId } : {}),
        ...(paidAt ? { paidAt } : {}),
      },
    });
  }

  /**
   * Which tenant an event belongs to.
   *
   * Matched on the subscription id we stored when creating it, falling back to the `tenant_id` we
   * put in Razorpay's `notes` at the same time. Both came from us — nothing here takes a tenant id
   * straight off the wire, because a forged webhook that could name its own tenant would be able to
   * upgrade somebody else's account or cancel it.
   */
  private async resolveTenant(
    entity: SubscriptionEntity | null,
  ): Promise<{ tenantId: string; plan: Plan } | null> {
    if (!entity) return null;

    /*
     * Read from `billing_identities`, the one table here without RLS.
     *
     * `subscriptions` is FORCE ROW LEVEL SECURITY, so querying it without a tenant context returns
     * nothing — which is what the first version of this did, silently resolving no tenant so a paid
     * subscription never upgraded the plan. The directory exists to break that circle, and a trigger
     * keeps it in step.
     */
    let tenantId: string | null = null;

    if (entity.id) {
      const mapped = await this.prisma.billingIdentity.findUnique({
        where: { razorpaySubscriptionId: entity.id },
        select: { tenantId: true },
      });
      tenantId = mapped?.tenantId ?? null;
    }

    /*
     * Fall back to the `notes.tenant_id` we set when creating the subscription. Needed for the very
     * first event of a subscription Razorpay created with an id we have not seen yet, and safe because
     * we put it there — it is checked against a tenant that exists, not trusted on its face.
     */
    if (!tenantId && typeof entity.notes?.['tenant_id'] === 'string') {
      /*
       * No existence check needed, and none possible without a bypass: `tenants` is RLS protected
       * too. The scoped lookup below is the check — a forged tenant id simply finds no subscription
       * and the event is ignored.
       */
      tenantId = entity.notes['tenant_id'] as string;
    }

    if (!tenantId) {
      this.logger.warn('Webhook could not be matched to a tenant — ignoring it');
      return null;
    }

    // Now there is a tenant, so everything after this runs tenant-scoped.
    const subscription = await this.tenantDb
      .clientFor(tenantId)
      .subscription.findUnique({ where: { tenantId }, select: { plan: true } });
    if (!subscription) return null;

    return { tenantId, plan: subscription.plan };
  }

  /**
   * Move a tenant onto a plan and reset its modules to that plan's defaults.
   *
   * Resetting the modules is the part that matters on a downgrade: leaving the Pro modules switched
   * on would let a tenant keep stock and the portal while the plan field said Starter, which is the
   * same bug the platform console guards against.
   *
   * The tenant cache is invalidated so the change takes effect on the next request instead of when a
   * TTL happens to expire — a builder who has just paid should not watch the feature stay locked.
   */
  /**
   * Ends a term now, rather than moving the account to a cheaper one.
   *
   * There is no cheaper one any more: a plan is a length of time and every account has every
   * module. Lapsing therefore means the paid period is over, which `plan_expires_on` already
   * expresses — and the grace period and read-only behaviour follow from it without this code
   * having to know about either.
   *
   * The plan itself is left alone deliberately. "They were on a year and it ran out" is a more
   * useful thing for an operator to read than an account silently relabelled.
   */
  private async lapseTerm(tenantId: string, reason: string, endedOn?: Date): Promise<void> {
    const db = this.tenantDb.clientFor(tenantId);
    const current = await db.tenant.findUnique({
      where: { id: tenantId },
      select: { planExpiresOn: true },
    });
    if (!current) return;

    /*
     * Ended when the paid period ended, not when we noticed.
     *
     * The nightly sweep can find a subscription that lapsed two months ago, and dating the expiry
     * to today would hand that account a fresh grace period every time the job ran — an account
     * that had not paid since June would never leave grace.
     */
    const ended = endedOn ?? new Date();
    if (current.planExpiresOn && current.planExpiresOn <= ended) return;

    await db.tenant.update({ where: { id: tenantId }, data: { planExpiresOn: ended } });
    this.tenantCache.invalidate(tenantId);
    this.logger.log(`Tenant ${tenantId} term ended (${reason})`);
  }

  private async applyPlan(tenantId: string, plan: Plan, reason: string): Promise<void> {
    const db = this.tenantDb.clientFor(tenantId);
    const current = await db.tenant.findUnique({ where: { id: tenantId }, select: { plan: true } });
    if (!current) return;
    if (current.plan === plan) return;

    await db.tenant.update({
      where: { id: tenantId },
      data: { plan, enabledModules: defaultModulesForPlan(plan) },
    });
    this.tenantCache.invalidate(tenantId);
    this.logger.log(`Tenant ${tenantId} moved to ${plan} (${reason})`);
  }

  /**
   * Drop the plan for subscriptions whose paid period and grace window have both passed.
   *
   * Run from the nightly job rather than on a webhook, because nothing arrives to say "the grace
   * period is over" — it is the absence of a payment. Separated from the failure webhook on purpose:
   * a card failing is not the moment to cut off a site, but a month of silence is.
   */
  async dropLapsedSubscriptions(): Promise<{ dropped: string[] }> {
    const cutoff = new Date(Date.now() - this.config.BILLING_GRACE_DAYS * 86_400_000);

    /*
     * The candidate list comes from `billing_identities`, the non-RLS directory: only tenants that have
     * ever had a Razorpay subscription can have one lapse, and `subscriptions` itself cannot be scanned
     * across tenants without a bypass this module deliberately does not have.
     *
     * Each candidate is then checked with its own scoped client. That is one query per subscribed
     * tenant rather than one for all of them, which is the right trade here: it runs once a night, the
     * list is small, and the alternative is handing billing an RLS-bypassing connection so that every
     * future bug in it can read across tenants.
     */
    const candidates = await this.prisma.billingIdentity.findMany({
      select: { tenantId: true },
      distinct: ['tenantId'],
    });

    const dropped: string[] = [];
    for (const candidate of candidates) {
      const db = this.tenantDb.clientFor(candidate.tenantId);
      const subscription = await db.subscription.findUnique({
        where: { tenantId: candidate.tenantId },
        select: { status: true, currentPeriodEnd: true },
      });
      if (!subscription) continue;
      if (subscription.status !== 'past_due' && subscription.status !== 'cancelled') continue;
      if (!subscription.currentPeriodEnd || subscription.currentPeriodEnd >= cutoff) continue;

      await this.lapseTerm(
        candidate.tenantId,
        'subscription lapsed past the grace period',
        subscription.currentPeriodEnd,
      );
      dropped.push(candidate.tenantId);
    }

    return { dropped };
  }
}

interface SubscriptionEntity {
  id?: string;
  status?: string;
  current_end?: number;
  notes?: Record<string, unknown>;
}

/** Razorpay nests entities as `payload.<name>.entity`. */
function entityOf(
  payload: Record<string, unknown>,
  name: string,
): Record<string, unknown> | null {
  const wrapper = payload[name];
  if (!wrapper || typeof wrapper !== 'object') return null;
  const entity = (wrapper as Record<string, unknown>)['entity'];
  return entity && typeof entity === 'object' ? (entity as Record<string, unknown>) : null;
}

function subscriptionEntity(payload: Record<string, unknown>): SubscriptionEntity | null {
  const entity = entityOf(payload, 'subscription');
  if (!entity) return null;
  return {
    ...(typeof entity['id'] === 'string' ? { id: entity['id'] } : {}),
    ...(typeof entity['status'] === 'string' ? { status: entity['status'] } : {}),
    ...(typeof entity['current_end'] === 'number' ? { current_end: entity['current_end'] } : {}),
    ...(entity['notes'] && typeof entity['notes'] === 'object'
      ? { notes: entity['notes'] as Record<string, unknown> }
      : {}),
  };
}

/** A month out, for the case where Razorpay did not send a period end. */
function monthFromNow(): Date {
  const date = new Date();
  date.setUTCMonth(date.getUTCMonth() + 1);
  return date;
}
