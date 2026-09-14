import { createHmac } from 'node:crypto';
import { BillingService } from '../src/modules/billing/billing.service';
import {
  createTestApp,
  destroyTenant,
  onboardTenant,
  uniquePhone,
  type OnboardedTenant,
  type TestApp,
} from './utils/test-app';

/**
 * Subscription billing (spec §3 item 12).
 *
 * The webhook is the part worth testing hardest. It is unauthenticated by necessity — Razorpay has
 * no session — so its signature check is the only thing between the endpoint and anybody who knows
 * the URL marking their own account paid. Everything else here is about money not being counted
 * twice.
 */
describe('billing', () => {
  let test: TestApp;
  let tenant: OnboardedTenant;
  let owner: Record<string, string>;

  /**
   * Must match what `test/global-setup.ts` sets. It is set there rather than here because `env()`
   * caches during module import, before any `beforeAll` runs — a secret set in this file would arrive
   * too late and every signed webhook would be rejected.
   */
  const WEBHOOK_SECRET = 'test_webhook_secret_value';

  beforeAll(async () => {
    test = await createTestApp();
    tenant = await onboardTenant(test, { name: 'Billing Builders', phone: uniquePhone() });
    owner = { Authorization: `Bearer ${tenant.accessToken}` };
  });

  afterAll(async () => {
    if (tenant) await destroyTenant(test, tenant.tenantId);
    await test.close();
  });

  /** Sign exactly the bytes that will be sent, as Razorpay does. */
  function send(event: Record<string, unknown>, options: { eventId?: string; signature?: string } = {}) {
    const body = JSON.stringify(event);
    const signature =
      options.signature ?? createHmac('sha256', WEBHOOK_SECRET).update(body).digest('hex');
    const request = test
      .http()
      .post('/v1/billing/webhook')
      .set('Content-Type', 'application/json')
      .set('X-Razorpay-Signature', signature);
    if (options.eventId !== undefined) request.set('X-Razorpay-Event-Id', options.eventId);
    return request.send(body);
  }

  function chargedEvent(subscriptionId: string, currentEnd: number) {
    return {
      event: 'subscription.charged',
      payload: {
        subscription: {
          entity: {
            id: subscriptionId,
            status: 'active',
            current_end: currentEnd,
            notes: { tenant_id: tenant.tenantId },
          },
        },
        invoice: {
          entity: {
            id: `inv_${subscriptionId}`,
            subscription_id: subscriptionId,
            amount: 249900,
            status: 'paid',
            short_url: 'https://rzp.io/i/test',
            issued_at: currentEnd - 86_400,
            paid_at: currentEnd - 86_000,
          },
        },
      },
    };
  }

  describe('the webhook boundary', () => {
    it('refuses an unsigned request', async () => {
      await test
        .http()
        .post('/v1/billing/webhook')
        .set('Content-Type', 'application/json')
        .send(JSON.stringify({ event: 'subscription.charged' }))
        .expect(401);
    });

    it('refuses a wrong signature', async () => {
      const response = await send({ event: 'subscription.charged' }, { signature: 'deadbeef' });
      expect(response.status).toBe(401);
      // Tells a forger nothing about why.
      expect(JSON.stringify(response.body)).not.toMatch(/secret|hmac|length/i);
    });

    it('refuses a signature computed over different bytes', async () => {
      // The exact attack the raw-body capture exists to stop: a valid signature for one payload
      // presented with another.
      const other = JSON.stringify({ event: 'subscription.cancelled' });
      const stolen = createHmac('sha256', WEBHOOK_SECRET).update(other).digest('hex');
      await send({ event: 'subscription.charged' }, { signature: stolen }).expect(401);
    });

    it('accepts a correctly signed event', async () => {
      const response = await send(
        { event: 'payment.authorized', payload: {} },
        { eventId: `evt_ok_${Date.now()}` },
      ).expect(200);
      expect(response.body.received).toBe(true);
    });
  });

  describe('idempotency', () => {
    it('handles a replayed event once', async () => {
      const subscriptionId = `sub_replay_${Date.now()}`;
      const eventId = `evt_replay_${Date.now()}`;
      const currentEnd = Math.floor(Date.now() / 1000) + 30 * 86_400;

      // Subscribe first so the subscription id is one we know about.
      await test
        .http()
        .post('/v1/billing/subscribe')
        .set(owner)
        .send({ plan: 'one_year' })
        .expect(201);

      const first = await send(chargedEvent(subscriptionId, currentEnd), { eventId }).expect(200);
      expect(first.body.duplicate).toBe(false);

      // Razorpay retries until it gets a 2xx, so the same event arrives again as a matter of course.
      const second = await send(chargedEvent(subscriptionId, currentEnd), { eventId }).expect(200);
      expect(second.body.duplicate).toBe(true);
      expect(second.body.handled).toBe(false);

      // One invoice, not two. A second row would double the history the owner reads, and on a real
      // account would read as having been charged twice.
      const invoices = await test.http().get('/v1/billing/invoices').set(owner).expect(200);
      const matching = invoices.body.filter(
        (row: { amount: string }) => row.amount === '249900',
      );
      expect(matching).toHaveLength(1);
    });

    it('falls back to hashing the body when no event id is sent', async () => {
      const event = { event: 'payment.captured', payload: { note: `once_${Date.now()}` } };

      const first = await send(event).expect(200);
      expect(first.body.duplicate).toBe(false);

      // Identical bytes hash the same, so the retry is still recognised. A random id here would make
      // every retry look new — the exact duplicate-charge bug the event table prevents.
      const second = await send(event).expect(200);
      expect(second.body.duplicate).toBe(true);
    });
  });

  describe('plan changes', () => {
    it('does not grant the plan at checkout', async () => {
      const starter = await onboardTenant(test, {
        name: 'Checkout Only',
        phone: uniquePhone(),
      });
      const auth = { Authorization: `Bearer ${starter.accessToken}` };
      try {
        const response = await test
          .http()
          .post('/v1/billing/subscribe')
          .set(auth)
          .send({ plan: 'one_year' })
          .expect(201);
        expect(response.body.plan).toBe('one_year');

        /*
         * Razorpay has taken no money yet. Granting Pro here would hand it to anybody who opened the
         * dialog and walked away, so the tenant is still on Starter and the subscription is trialing.
         */
        const billing = await test.http().get('/v1/billing').set(auth).expect(200);
        expect(billing.body.plan).toBe('three_months');
        expect(billing.body.status).toBe('trialing');

        // Nothing is locked by a plan any more, so there is no feature to check for. What the
        // checkout must not do is claim the term has been bought before the money arrives — which
        // is what the two assertions above are for.
        await test.http().get('/v1/stock').set(auth).expect(200);
      } finally {
        await destroyTenant(test, starter.tenantId);
      }
    });

    it('grants the term when the charge clears', async () => {
      const builder = await onboardTenant(test, { name: 'Paid Up', phone: uniquePhone() });
      const auth = { Authorization: `Bearer ${builder.accessToken}` };
      try {
        await test
          .http()
          .post('/v1/billing/subscribe')
          .set(auth)
          .send({ plan: 'one_year' })
          .expect(201);

        const subscriptionId = `sub_paid_${Date.now()}`;
        const currentEnd = Math.floor(Date.now() / 1000) + 30 * 86_400;
        await send(
          {
            event: 'subscription.activated',
            payload: {
              subscription: {
                entity: {
                  id: subscriptionId,
                  status: 'active',
                  current_end: currentEnd,
                  notes: { tenant_id: builder.tenantId },
                },
              },
            },
          },
          { eventId: `evt_paid_${Date.now()}` },
        ).expect(200);

        const billing = await test.http().get('/v1/billing').set(auth).expect(200);
        expect(billing.body.plan).toBe('one_year');
        expect(billing.body.status).toBe('active');

        // The term is what a payment buys, and it takes effect on the very next request — the
        // tenant cache is invalidated rather than left to expire, because somebody who has just
        // paid should not spend thirty seconds still looking at the old plan.
        const me = await test.http().get('/v1/me').set(auth).expect(200);
        expect(me.body.tenant.plan).toBe('one_year');
        expect(me.body.tenant.plan_standing).toBe('active');
      } finally {
        await destroyTenant(test, builder.tenantId);
      }
    });
  });

  describe('a failed payment', () => {
    it('does not cut access immediately', async () => {
      const builder = await onboardTenant(test, { name: 'Card Declined', phone: uniquePhone() });
      const auth = { Authorization: `Bearer ${builder.accessToken}` };
      try {
        await test
          .http()
          .post('/v1/billing/subscribe')
          .set(auth)
          .send({ plan: 'one_year' })
          .expect(201);

        const subscriptionId = `sub_fail_${Date.now()}`;
        // Paid up to a month from now, then the card fails.
        const periodEnd = Math.floor(Date.now() / 1000) + 30 * 86_400;
        await send(
          {
            event: 'subscription.activated',
            payload: {
              subscription: {
                entity: {
                  id: subscriptionId,
                  current_end: periodEnd,
                  notes: { tenant_id: builder.tenantId },
                },
              },
            },
          },
          { eventId: `evt_act_${Date.now()}` },
        ).expect(200);

        await send(
          {
            event: 'subscription.halted',
            payload: {
              subscription: {
                entity: { id: subscriptionId, current_end: periodEnd },
              },
            },
          },
          { eventId: `evt_halt_${Date.now()}` },
        ).expect(200);

        const billing = await test.http().get('/v1/billing').set(auth).expect(200);
        expect(billing.body.status).toBe('past_due');
        expect(billing.body.last_failure_reason).toBeTruthy();

        /*
         * Still on Pro. They have paid for this period, and taking the roll call away from site staff
         * mid-shift over an expired card is not a collections strategy. The plan drops when the paid
         * period plus the grace window has passed.
         */
        expect(billing.body.plan).toBe('one_year');
        await test.http().get('/v1/stock').set(auth).expect(200);
      } finally {
        await destroyTenant(test, builder.tenantId);
      }
    });

    it('goes read-only once the paid period and grace window have passed', async () => {
      const builder = await onboardTenant(test, { name: 'Lapsed', phone: uniquePhone() });
      const auth = { Authorization: `Bearer ${builder.accessToken}` };
      try {
        await test
          .http()
          .post('/v1/billing/subscribe')
          .set(auth)
          .send({ plan: 'one_year' })
          .expect(201);

        const subscriptionId = `sub_lapsed_${Date.now()}`;
        // Period ended 60 days ago, well past any grace window.
        const longAgo = Math.floor(Date.now() / 1000) - 60 * 86_400;
        await send(
          {
            event: 'subscription.activated',
            payload: {
              subscription: {
                entity: {
                  id: subscriptionId,
                  current_end: longAgo,
                  notes: { tenant_id: builder.tenantId },
                },
              },
            },
          },
          { eventId: `evt_old_${Date.now()}` },
        ).expect(200);
        await send(
          {
            event: 'subscription.halted',
            payload: { subscription: { entity: { id: subscriptionId, current_end: longAgo } } },
          },
          { eventId: `evt_oldhalt_${Date.now()}` },
        ).expect(200);

        // What the nightly job does. Nothing arrives to say "the grace period is over" — it is the
        // absence of a payment, so it has to be looked for rather than waited for.
        // Resolved from the running app rather than added to the shared test helper: one suite
        // needs it, and widening `TestApp` for that would put a billing method in front of every
        // other test file.
        await test.app.get(BillingService).dropLapsedSubscriptions();

        /*
         * The term ends; the plan is left alone.
         *
         * There is no cheaper plan to fall back to — every account has every feature, and a plan
         * is a length of time. "They were on a year and it ran out" is also a more useful thing
         * for an operator to read than an account silently relabelled.
         */
        const me = await test.http().get('/v1/me').set(auth).expect(200);
        expect(me.body.tenant.plan).toBe('one_year');
        expect(me.body.tenant.plan_standing).toBe('expired');

        // Reads keep working. Writes do not — which is the whole of what expiry means now.
        await test.http().get('/v1/stock').set(auth).expect(200);
        const refused = await test
          .http()
          .post('/v1/projects')
          .set(auth)
          .send({ name: 'Should not be created' })
          .expect(403);
        expect(refused.body.code).toBe('PLAN_EXPIRED');
      } finally {
        await destroyTenant(test, builder.tenantId);
      }
    });
  });

  it('keeps access to the end of the period when cancelled', async () => {
    const response = await test
      .http()
      .post('/v1/billing/cancel')
      .set(owner)
      .send({ at_period_end: true })
      .expect(201);

    // Cancelled in future, not now: they have paid for this period.
    expect(response.body.cancel_at).toBeTruthy();
    expect(response.body.plan).toBe('one_year');
  });

  it('refuses billing to somebody without tenant.manage', async () => {
    const phone = uniquePhone();
    await test
      .http()
      .post('/v1/tenants/current/invite')
      .set(owner)
      .send({ phone, name: 'Not An Owner', role: 'site_supervisor', project_ids: [] })
      .expect(201);
    const login = await test
      .http()
      .post('/v1/auth/exchange')
      .send({ firebase_token: `dev:${phone}` })
      .expect(200);
    const auth = { Authorization: `Bearer ${login.body.access_token}` };

    await test.http().get('/v1/billing').set(auth).expect(403);
    await test.http().post('/v1/billing/subscribe').set(auth).send({ plan: 'one_year' }).expect(403);
  });
});
