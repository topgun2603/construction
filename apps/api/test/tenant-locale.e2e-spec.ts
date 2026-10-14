import {
  createTestApp,
  destroyTenant,
  onboardTenant,
  uniquePhone,
  type OnboardedTenant,
  type TestApp,
} from './utils/test-app';

/**
 * Per-company locale settings (roadmap Phase 0, item 1).
 *
 * The promise to existing customers is that nothing changes for them: a company onboarded the
 * old way is Indian in every setting. The promise to new ones is that a Gulf company can say so
 * at signup — and that currency, which fixes how every stored amount is read, cannot be edited
 * afterwards.
 */
describe('tenant locale settings', () => {
  let test: TestApp;
  let indian: OnboardedTenant;
  let gulf: { tenantId: string; accessToken: string };

  beforeAll(async () => {
    test = await createTestApp();
    indian = await onboardTenant(test, { name: 'Chennai Builders', phone: uniquePhone() });

    const exchange = await test
      .http()
      .post('/v1/auth/exchange')
      .send({ firebase_token: `dev:${uniquePhone()}` })
      .expect(200);
    const created = await test
      .http()
      .post('/v1/tenants')
      .set('X-Onboarding-Token', exchange.body.onboarding_token)
      .send({
        name: 'Dubai Contracting',
        owner_name: 'Owner',
        country: 'ae',
        currency: 'aed',
        timezone: 'Asia/Dubai',
        locale: 'ar-AE',
        tax_regime: 'vat_ae',
      })
      .expect(201);
    gulf = {
      tenantId: created.body.tenant.id,
      accessToken: created.body.tokens.access_token,
    };
  });

  afterAll(async () => {
    await destroyTenant(test, indian.tenantId);
    await destroyTenant(test, gulf.tenantId);
    await test.close();
  });

  const me = (token: string) =>
    test.http().get('/v1/me').set('Authorization', `Bearer ${token}`).expect(200);

  it('makes an Indian company when onboarding sends no settings', async () => {
    const { body } = await me(indian.accessToken);
    expect(body.tenant).toMatchObject({
      country: 'IN',
      currency: 'INR',
      timezone: 'Asia/Kolkata',
      locale: 'en-IN',
      tax_regime: 'gst_in',
    });
  });

  it('takes a Gulf company at its word at signup, normalising case', async () => {
    const { body } = await me(gulf.accessToken);
    expect(body.tenant).toMatchObject({
      country: 'AE',
      currency: 'AED',
      timezone: 'Asia/Dubai',
      locale: 'ar-AE',
      tax_regime: 'vat_ae',
    });
  });

  it('refuses a time zone the runtime does not know', async () => {
    await test
      .http()
      .patch('/v1/tenants/current')
      .set('Authorization', `Bearer ${indian.accessToken}`)
      .send({ timezone: 'Asia/Atlantis' })
      .expect(422);
  });

  it('lets an owner change currency while nothing is recorded in it', async () => {
    const patch = (body: object) =>
      test
        .http()
        .patch('/v1/tenants/current')
        .set('Authorization', `Bearer ${indian.accessToken}`)
        .send(body);

    const moved = await patch({ timezone: 'Asia/Kathmandu', currency: 'NPR' }).expect(200);
    expect(moved.body).toMatchObject({
      timezone: 'Asia/Kathmandu',
      currency: 'NPR',
      currency_locked: false,
    });

    // Back to rupees for the rest of the suite.
    await patch({ timezone: 'Asia/Kolkata', currency: 'INR' }).expect(200);
  });

  it('locks the currency once a site is recorded', async () => {
    const auth = { Authorization: `Bearer ${indian.accessToken}` };
    await test
      .http()
      .post('/v1/projects')
      .set(auth)
      .send({ name: 'Anna Nagar Villa', budget_amount: '250000000' })
      .expect(201);

    const current = await test.http().get('/v1/tenants/current').set(auth).expect(200);
    expect(current.body.currency_locked).toBe(true);

    // The budget above is paise; reading it as dirhams would misstate it by a factor of ~23.
    const refused = await test
      .http()
      .patch('/v1/tenants/current')
      .set(auth)
      .send({ currency: 'AED' })
      .expect(409);
    expect(refused.body.message).toMatch(/currency/i);

    // Re-sending the same currency with another change is not a currency change.
    await test
      .http()
      .patch('/v1/tenants/current')
      .set(auth)
      .send({ currency: 'INR', locale: 'ta-IN' })
      .expect(200);
  });
});
