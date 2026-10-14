import { createHmac } from 'node:crypto';
import { createTestApp, destroyTenant, type TestApp } from './utils/test-app';

/**
 * Stripe beside Razorpay (roadmap Phase 0, item 7): a UAE company subscribes in dirhams through
 * Stripe (dry run — no account in tests), and Stripe's signed webhooks apply the plan, record the
 * invoice, and are idempotent.
 */
const SECRET = 'whsec_test_secret_value';
const random = (digits: number) =>
  String(Math.floor(Math.random() * 10 ** digits)).padStart(digits, '0');

describe('Stripe billing', () => {
  let test: TestApp;
  let tenantId: string;
  let auth: { Authorization: string };
  let sessionId: string;
  const stripeSubscriptionId = `sub_test_${random(8)}`;
  let originalPrices: unknown;

  const signedWebhook = (event: object) => {
    const body = JSON.stringify(event);
    const t = Math.floor(Date.now() / 1000);
    const v1 = createHmac('sha256', SECRET).update(`${t}.${body}`).digest('hex');
    return test
      .http()
      .post('/v1/billing/stripe/webhook')
      .set('Content-Type', 'application/json')
      .set('Stripe-Signature', `t=${t},v1=${v1}`)
      .send(body);
  };

  beforeAll(async () => {
    test = await createTestApp();
    const plan = await test.prisma.plan.findUniqueOrThrow({ where: { code: 'one_year' } });
    originalPrices = plan.prices;

    const exchange = await test
      .http()
      .post('/v1/auth/exchange')
      .send({ firebase_token: `dev:+97150${random(7)}` })
      .expect(200);
    const created = await test
      .http()
      .post('/v1/tenants')
      .set('X-Onboarding-Token', exchange.body.onboarding_token)
      .send({
        name: 'Al Noor Contracting',
        owner_name: 'Owner',
        country: 'AE',
        currency: 'AED',
        timezone: 'Asia/Dubai',
        locale: 'en-AE',
        tax_regime: 'vat_ae',
      })
      .expect(201);
    tenantId = created.body.tenant.id;
    auth = { Authorization: `Bearer ${created.body.tokens.access_token}` };
  });

  afterAll(async () => {
    await test.prisma.plan.update({
      where: { code: 'one_year' },
      data: { prices: (originalPrices ?? {}) as object },
    });
    if (tenantId) await test.prisma.stripeIdentity.deleteMany({ where: { tenantId } });
    if (tenantId) await destroyTenant(test, tenantId);
    await test.close();
  });

  it('refuses to invent a dirham price the catalogue does not have', async () => {
    await test.prisma.plan.update({ where: { code: 'one_year' }, data: { prices: {} } });
    const refused = await test
      .http()
      .post('/v1/billing/subscribe')
      .set(auth)
      .send({ plan: 'one_year' })
      .expect(409);
    expect(refused.body.message).toMatch(/no AED price/);
  });

  it('starts a Stripe checkout in dirhams at the catalogue price', async () => {
    await test.prisma.plan.update({
      where: { code: 'one_year' },
      data: { prices: { AED: '399900' } },
    });
    const started = await test
      .http()
      .post('/v1/billing/subscribe')
      .set(auth)
      .send({ plan: 'one_year' })
      .expect(201);
    expect(started.body).toMatchObject({ dry_run: true, amount: '399900' });
    sessionId = started.body.subscription_id;
    expect(sessionId).toMatch(/^cs_dry_/);

    const row = await test.tenantDb.transaction(tenantId, (tx) =>
      tx.subscription.findUniqueOrThrow({ where: { tenantId } }),
    );
    expect(row).toMatchObject({ provider: 'stripe', currency: 'AED', status: 'trialing' });
  });

  it('rejects a webhook with a bad signature', async () => {
    await test
      .http()
      .post('/v1/billing/stripe/webhook')
      .set('Content-Type', 'application/json')
      .set('Stripe-Signature', `t=${Math.floor(Date.now() / 1000)},v1=deadbeef`)
      .send(JSON.stringify({ id: 'evt_forged', type: 'checkout.session.completed' }))
      .expect(401);
  });

  it('applies the plan when checkout completes, once', async () => {
    const event = {
      id: `evt_${random(10)}`,
      type: 'checkout.session.completed',
      data: {
        object: {
          id: sessionId,
          subscription: stripeSubscriptionId,
          metadata: { tenant_id: tenantId, plan: 'one_year' },
        },
      },
    };
    const first = await signedWebhook(event).expect(200);
    expect(first.body).toMatchObject({ handled: true, duplicate: false });
    const again = await signedWebhook(event).expect(200);
    expect(again.body).toMatchObject({ duplicate: true });

    const billing = await test.http().get('/v1/billing').set(auth).expect(200);
    expect(billing.body).toMatchObject({ plan: 'one_year', status: 'active' });
  });

  it('records a paid renewal invoice', async () => {
    await signedWebhook({
      id: `evt_${random(10)}`,
      type: 'invoice.paid',
      data: {
        object: {
          id: `in_${random(8)}`,
          subscription: stripeSubscriptionId,
          amount_paid: 399900,
          created: Math.floor(Date.now() / 1000),
          hosted_invoice_url: 'https://invoice.stripe.com/i/test',
        },
      },
    }).expect(200);

    const invoices = await test.http().get('/v1/billing/invoices').set(auth).expect(200);
    expect(invoices.body[0]).toMatchObject({ amount: '399900', status: 'paid' });
  });
});
