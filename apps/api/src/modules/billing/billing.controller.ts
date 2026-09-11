import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
  Req,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { createHash } from 'node:crypto';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import {
  cancelSubscriptionSchema,
  startSubscriptionSchema,
  type CancelSubscriptionInput,
  type StartSubscriptionInput,
} from '@sitebook/shared';
import type { RequestUser } from '../../common/auth/request-user';
import { CurrentUser, Public, RequiresPermission } from '../../common/decorators';
import { ApiError } from '../../common/errors/api-error';
import { zodBody } from '../../common/pipes/zod-validation.pipe';
import { RazorpayService } from '../../integrations/razorpay.service';
import { BillingService } from './billing.service';

/**
 * Subscription billing (spec §3 item 12).
 *
 * Deliberately *not* gated on a `billing` module. A tenant who cannot reach this controller cannot
 * subscribe, and a module gate on the screen that sells the modules is a circle.
 */
@ApiTags('billing')
@Controller('billing')
export class BillingController {
  constructor(
    private readonly billing: BillingService,
    private readonly razorpay: RazorpayService,
  ) {}

  @RequiresPermission('tenant.manage')
  @Get()
  @ApiOperation({ summary: 'Current plan, status and period' })
  current(@CurrentUser() user: RequestUser) {
    return this.billing.current(user);
  }

  @RequiresPermission('tenant.manage')
  @Get('invoices')
  @ApiOperation({ summary: 'What this tenant has been charged' })
  invoices(@CurrentUser() user: RequestUser) {
    return this.billing.invoices(user);
  }

  @RequiresPermission('tenant.manage')
  @Post('subscribe')
  @ApiOperation({ summary: 'Begin a subscription and get the checkout link' })
  subscribe(
    @CurrentUser() user: RequestUser,
    @Body(zodBody(startSubscriptionSchema)) body: StartSubscriptionInput,
  ) {
    return this.billing.start(user, body);
  }

  @RequiresPermission('tenant.manage')
  @Post('cancel')
  @ApiOperation({ summary: 'Cancel, keeping access to the end of the paid period' })
  cancel(
    @CurrentUser() user: RequestUser,
    @Body(zodBody(cancelSubscriptionSchema)) body: CancelSubscriptionInput,
  ) {
    return this.billing.cancel(user, body);
  }

  /**
   * Razorpay's webhook.
   *
   * `@Public()` because it carries no session — Razorpay has no user. The signature is what
   * authenticates it, and that check is the only thing standing between this endpoint and anybody
   * who knows the URL being able to mark their own account paid.
   *
   * Three things are deliberate:
   *
   * - **Verified against the raw bytes**, captured in `main.ts`. An HMAC over a re-serialised object
   *   fails for reasons that look like forgery.
   * - **A duplicate returns 200.** Razorpay retries until it gets a 2xx, so replying with an error to
   *   an event already handled would have it retry forever.
   * - **Rate limited**, because an unauthenticated endpoint that does database work is otherwise a
   *   free denial-of-service. Verification happens before any write, so a flood of forged requests
   *   costs one HMAC each.
   */
  @Public()
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  @Post('webhook')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Razorpay subscription events' })
  async webhook(
    @Req() request: Request & { rawBody?: Buffer },
    @Headers('x-razorpay-signature') signature: string | undefined,
    @Headers('x-razorpay-event-id') eventId: string | undefined,
  ) {
    /*
     * Without the raw body the signature cannot be checked, so this fails closed. It would only
     * happen if the body-parser wiring in main.ts were changed, and treating it as "probably fine"
     * is how a verification step quietly stops verifying.
     */
    const raw = request.rawBody;
    if (!raw) {
      throw ApiError.unauthenticated('Webhook body could not be verified');
    }

    if (!this.razorpay.verifyWebhook(raw, signature)) {
      // No detail in the message: a forged request should learn nothing about why it failed.
      throw ApiError.unauthenticated('Invalid webhook signature');
    }

    const payload = request.body as { event?: string; payload?: Record<string, unknown> };
    const eventType = typeof payload.event === 'string' ? payload.event : 'unknown';
    /*
     * Razorpay sends an event id header; if it is ever missing, fall back to a hash of the body so
     * idempotency still holds. Using a random id instead would make every retry look new, which is
     * exactly the duplicate-charge bug the event table exists to prevent.
     */
    const id = eventId ?? `sha:${hashBody(raw)}`;

    const result = await this.billing.handleWebhook({
      eventId: id,
      eventType,
      payload: payload.payload ?? {},
    });

    return { received: true, ...result };
  }
}

function hashBody(raw: Buffer): string {
  return createHash('sha256').update(raw).digest('hex');
}
