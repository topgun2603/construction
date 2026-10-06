import { createTestApp, destroyTenant, type TestApp } from './utils/test-app';

/**
 * Regional plan pricing (roadmap: lower-priced plans in local currency or USD for South Asia), and
 * bank-transfer invoices for Bangladesh and Nepal:
 *
 * - a Sri Lankan company is quoted and checked out (Stripe, dry run) in rupees of its own;
 * - a company whose currency has no price falls back to the US-dollar price — never converted;
 * - with neither, it is asked to contact us;
 * - a Nepali company asks for a bank-transfer invoice, the console marks it paid, the plan applies.
 */
const ADMIN_PHONE = '919000000071';
const random = (digits: number) =>
  String(Math.floor(Math.random() * 10 ** digits)).padStart(digits, '0');

type Company = { tenantId: string; auth: { Authorization: string } };

async function onboard(
  test: TestApp,
  locale: { country: string; currency: string; timezone: string; locale: string },
  phone: string,
): Promise<Company> {
  const exchange = await test
    .http()
    .post('/v1/auth/exchange')
    .send({ firebase_token: `dev:${phone}` })
    .expect(200);
  const created = await test
    .http()
    .post('/v1/tenants')
    .set('X-Onboarding-Token', exchange.body.onboarding_token)
    .send({ name: `${locale.country} Builders`, owner_name: 'Owner', tax_regime: 'none', ...locale })
    .expect(201);
  return {
    tenantId: created.body.tenant.id,
    auth: { Authorization: `Bearer ${created.body.tokens.access_token}` },
  };
}

describe('regional plan pricing and bank-transfer invoices', () => {
  let test: TestApp;
  let admin: { Authorization: string };
  let planId: string;
  let originalPrices: unknown;
  let lanka: Company;
  let bangla: Company;
  let nepal: Company;
  let invoiceId: string;
  const originalAllowlist = process.env['PLATFORM_ADMIN_PHONES'];

  const setPrices = (prices: Record<string, string>) =>
    test.http().patch(`/v1/admin/plans/${planId}`).set(admin).send({ prices });

  beforeAll(async () => {
    process.env['PLATFORM_ADMIN_PHONES'] = ADMIN_PHONE;
    test = await createTestApp();
    const plan = await test.prisma.plan.findUniqueOrThrow({ where: { code: 'one_year' } });
    planId = plan.id;
    originalPrices = plan.prices;

    const login = await test
      .http()
      .post('/v1/admin/auth/login')
      .send({ firebase_token: `dev:${ADMIN_PHONE}` })
      .expect(201);
    admin = { Authorization: `Bearer ${login.body.access_token}` };

    lanka = await onboard(
      test,
      { country: 'LK', currency: 'LKR', timezone: 'Asia/Colombo', locale: 'en-LK' },
      `+9477${random(7)}`,
    );
    bangla = await onboard(
      test,
      { country: 'BD', currency: 'BDT', timezone: 'Asia/Dhaka', locale: 'en-BD' },
      `+88017${random(8)}`,
    );
    nepal = await onboard(
      test,
      { country: 'NP', currency: 'NPR', timezone: 'Asia/Kathmandu', locale: 'en-NP' },
      `+97798${random(8)}`,
    );
  });

  afterAll(async () => {
    await test.prisma.plan.update({
      where: { code: 'one_year' },
      data: { prices: (originalPrices ?? {}) as object },
    });
    for (const company of [lanka, bangla, nepal]) {
      if (company?.tenantId) await destroyTenant(test, company.tenantId);
    }
    await test.close();
    if (originalAllowlist === undefined) delete process.env['PLATFORM_ADMIN_PHONES'];
    else process.env['PLATFORM_ADMIN_PHONES'] = originalAllowlist;
  });

  it('refuses a price the card processor could not charge', async () => {
    const unknown = await setPrices({ XQQ: '100' }).expect(422);
    expect(JSON.stringify(unknown.body)).toMatch(/not a currency we know/);
    await setPrices({ LKR: '0' }).expect(422);
  });

  it('quotes a Sri Lankan company in rupees of its own and checks out in LKR', async () => {
    await setPrices({ LKR: '1499900', USD: '4900' }).expect(200);

    const catalogue = await test.http().get('/v1/billing/plans').set(lanka.auth).expect(200);
    expect(catalogue.body).toMatchObject({ currency: 'LKR', provider: 'stripe', bank_transfer: false });
    const plan = catalogue.body.items.find((item: { code: string }) => item.code === 'one_year');
    expect(plan.quote).toEqual({ currency: 'LKR', amount: '1499900', basis: 'local' });

    const started = await test
      .http()
      .post('/v1/billing/subscribe')
      .set(lanka.auth)
      .send({ plan: 'one_year' })
      .expect(201);
    expect(started.body).toMatchObject({ dry_run: true, amount: '1499900', currency: 'LKR' });
    expect(started.body.subscription_id).toMatch(/^cs_dry_/);

    const row = await test.tenantDb.transaction(lanka.tenantId, (tx) =>
      tx.subscription.findUniqueOrThrow({ where: { tenantId: lanka.tenantId } }),
    );
    expect(row).toMatchObject({ provider: 'stripe', currency: 'LKR', amount: 1499900n, status: 'trialing' });
  });

  it('falls back to the US-dollar price when there is none in the company’s currency', async () => {
    const catalogue = await test.http().get('/v1/billing/plans').set(bangla.auth).expect(200);
    const plan = catalogue.body.items.find((item: { code: string }) => item.code === 'one_year');
    expect(plan.quote).toEqual({ currency: 'USD', amount: '4900', basis: 'fallback' });
    expect(catalogue.body.bank_transfer).toBe(true);

    const started = await test
      .http()
      .post('/v1/billing/subscribe')
      .set(bangla.auth)
      .send({ plan: 'one_year' })
      .expect(201);
    expect(started.body).toMatchObject({ amount: '4900', currency: 'USD' });
  });

  it('asks the company to contact us when there is neither — no conversion', async () => {
    await setPrices({ LKR: '1499900' }).expect(200);
    const catalogue = await test.http().get('/v1/billing/plans').set(nepal.auth).expect(200);
    const plan = catalogue.body.items.find((item: { code: string }) => item.code === 'one_year');
    expect(plan.quote).toBeNull();

    const refused = await test
      .http()
      .post('/v1/billing/subscribe')
      .set(nepal.auth)
      .send({ plan: 'one_year' })
      .expect(409);
    expect(refused.body.message).toMatch(/no NPR price yet — contact us/);
    await test
      .http()
      .post('/v1/billing/bank-transfers')
      .set(nepal.auth)
      .send({ plan: 'one_year' })
      .expect(409);
  });

  it('takes a bank-transfer invoice request from Nepal, once, and not from Sri Lanka', async () => {
    await setPrices({ LKR: '1499900', NPR: '650000' }).expect(200);

    const requested = await test
      .http()
      .post('/v1/billing/bank-transfers')
      .set(nepal.auth)
      .send({ plan: 'one_year', note: 'Invoice to Himal Builders Pvt Ltd' })
      .expect(201);
    expect(requested.body).toMatchObject({
      plan: 'one_year',
      currency: 'NPR',
      amount: '650000',
      status: 'pending',
    });
    expect(requested.body.number).toMatch(/^BT-\d{8}-[0-9A-F]{6}$/);
    invoiceId = requested.body.id;

    await test
      .http()
      .post('/v1/billing/bank-transfers')
      .set(nepal.auth)
      .send({ plan: 'one_year' })
      .expect(409);
    await test
      .http()
      .post('/v1/billing/bank-transfers')
      .set(lanka.auth)
      .send({ plan: 'one_year' })
      .expect(409);

    // Nothing is granted by asking.
    const me = await test.http().get('/v1/me').set(nepal.auth).expect(200);
    expect(me.body.tenant.plan).not.toBe('one_year');
  });

  it('shows the request to the platform team, and marking it paid applies the plan', async () => {
    const pending = await test
      .http()
      .get('/v1/admin/bank-transfers?status=pending')
      .set(admin)
      .expect(200);
    expect(pending.body.pending).toBeGreaterThanOrEqual(1);
    expect(pending.body.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: invoiceId, tenant_name: 'NP Builders', country: 'NP' }),
      ]),
    );

    const paid = await test
      .http()
      .post(`/v1/admin/bank-transfers/${invoiceId}/settle`)
      .set(admin)
      .send({ status: 'paid', payment_reference: 'NIC-ASIA-778812' })
      .expect(200);
    expect(paid.body).toMatchObject({ status: 'paid', payment_reference: 'NIC-ASIA-778812' });
    expect(paid.body.paid_at).not.toBeNull();

    // A double click cannot extend the term twice.
    await test
      .http()
      .post(`/v1/admin/bank-transfers/${invoiceId}/settle`)
      .set(admin)
      .send({ status: 'paid' })
      .expect(409);

    const me = await test.http().get('/v1/me').set(nepal.auth).expect(200);
    expect(me.body.tenant.plan).toBe('one_year');
    const tenant = await test.tenantDb.transaction(nepal.tenantId, (tx) =>
      tx.tenant.findUniqueOrThrow({ where: { id: nepal.tenantId }, select: { planExpiresOn: true } }),
    );
    const days = (tenant.planExpiresOn!.getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(360);

    const own = await test.http().get('/v1/billing/bank-transfers').set(nepal.auth).expect(200);
    expect(own.body.items[0]).toMatchObject({ id: invoiceId, status: 'paid' });
  });

  it('writes it down in both trails', async () => {
    const trail = await test.prisma.platformAuditLog.findFirst({
      where: { action: 'bank_transfer.paid', tenantId: nepal.tenantId },
    });
    expect(trail).toMatchObject({ actorPhone: ADMIN_PHONE });

    const company = await test.tenantDb.transaction(nepal.tenantId, (tx) =>
      tx.auditLog.findMany({ where: { entity: 'plan_bank_transfer_invoices', entityId: invoiceId } }),
    );
    // The request, and the console marking it paid.
    expect(company.length).toBeGreaterThanOrEqual(2);
  });

  it('lets only a root operator settle', async () => {
    // A tenant token is not a console token at all.
    await test
      .http()
      .post(`/v1/admin/bank-transfers/${invoiceId}/settle`)
      .set(nepal.auth)
      .send({ status: 'cancelled' })
      .expect(401);
  });
});
