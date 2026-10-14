import { createTestApp, destroyTenant, type TestApp } from './utils/test-app';

/**
 * Sign-in with Gulf numbers, end to end (roadmap Phase 0, item 5: "test sign-in with +971 and
 * +966 numbers end to end").
 *
 * A UAE owner signs up with a +971 number, invites a +966 manager who then signs in, and records a
 * Nepali worker — the crews in the Gulf are largely South Asian. Every number is stored E.164
 * without the plus, the same form Indian numbers always had, so sign-in finds each person again.
 */
const random = (digits: number) =>
  String(Math.floor(Math.random() * 10 ** digits)).padStart(digits, '0');

describe('international phone numbers', () => {
  let test: TestApp;
  let tenantId: string;
  let ownerToken: string;
  const owner = `97150${random(7)}`;
  const manager = `9665${random(8)}`;

  beforeAll(async () => {
    test = await createTestApp();
  });

  afterAll(async () => {
    if (tenantId) await destroyTenant(test, tenantId);
    await test.close();
  });

  it('lets a +971 number sign up a UAE company', async () => {
    const exchange = await test
      .http()
      .post('/v1/auth/exchange')
      .send({ firebase_token: `dev:+${owner}` })
      .expect(200);
    expect(exchange.body.onboarding_required).toBe(true);

    const created = await test
      .http()
      .post('/v1/tenants')
      .set('X-Onboarding-Token', exchange.body.onboarding_token)
      .send({
        name: 'Gulf Builders',
        owner_name: 'Owner',
        country: 'AE',
        currency: 'AED',
        timezone: 'Asia/Dubai',
        locale: 'en-AE',
        tax_regime: 'vat_ae',
      })
      .expect(201);
    tenantId = created.body.tenant.id;
    ownerToken = created.body.tokens.access_token;

    const me = await test
      .http()
      .get('/v1/me')
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);
    expect(me.body.user.phone).toBe(owner);
  });

  it('signs the same owner back in however the number is written', async () => {
    for (const spelled of [`+${owner}`, owner, `00${owner}`]) {
      const again = await test
        .http()
        .post('/v1/auth/exchange')
        .send({ firebase_token: `dev:${spelled}` })
        .expect(200);
      expect(again.body.onboarding_required).toBeUndefined();
      expect(again.body.access_token).toBeTruthy();
    }
  });

  it('invites a +966 manager, who can then sign in', async () => {
    await test
      .http()
      .post('/v1/tenants/current/invite')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ name: 'Riyadh PM', phone: `+${manager}`, role: 'project_manager' })
      .expect(201);

    const signIn = await test
      .http()
      .post('/v1/auth/exchange')
      .send({ firebase_token: `dev:+${manager}` })
      .expect(200);
    expect(signIn.body.access_token).toBeTruthy();
  });

  it('stores a Nepali worker’s number, and refuses one with no country code', async () => {
    const auth = { Authorization: `Bearer ${ownerToken}` };
    const worker = await test
      .http()
      .post('/v1/workers')
      .set(auth)
      .send({ name: 'Ram Thapa', phone: '+977 984 1234567', daily_wage: '15000' })
      .expect(201);
    expect(worker.body.phone).toBe('9779841234567');

    // Paid the way Nepali workers are: an eSewa transfer, recorded rather than sent (Phase 1B).
    const project = await test
      .http()
      .post('/v1/projects')
      .set(auth)
      .send({ name: 'Jumeirah Villas', status: 'active' })
      .expect(201);
    const payment = await test
      .http()
      .post('/v1/labour-payments')
      .set(auth)
      .send({
        project_id: project.body.id,
        worker_id: worker.body.id,
        type: 'advance',
        amount: '20000',
        paid_on: '2026-10-01',
        mode: 'esewa',
      })
      .expect(201);
    expect(payment.body.mode).toBe('esewa');

    // Bare digits are read as Indian; a UAE mobile without +971 is refused, never stored wrong.
    await test
      .http()
      .post('/v1/workers')
      .set(auth)
      .send({ name: 'No Code', phone: '501234567', daily_wage: '15000' })
      .expect(422);
  });

  it('refuses a number from a country no company can be in', async () => {
    const response = await test
      .http()
      .post('/v1/auth/exchange')
      .send({ firebase_token: 'dev:+447700900123' })
      .expect(401);
    expect(response.body.code).toBe('INVALID_TOKEN');
  });
});
