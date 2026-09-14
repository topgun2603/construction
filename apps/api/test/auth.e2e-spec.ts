import {
  createTestApp,
  destroyTenant,
  onboardTenant,
  uniquePhone,
  type OnboardedTenant,
  type TestApp,
} from './utils/test-app';

describe('auth and plan gating', () => {
  let test: TestApp;
  let tenant: OnboardedTenant;

  beforeAll(async () => {
    test = await createTestApp();
    tenant = await onboardTenant(test, {
      name: 'Gating Constructions',
      phone: uniquePhone(),
      plan: 'three_months',
    });
  });

  afterAll(async () => {
    if (tenant) await destroyTenant(test, tenant.tenantId);
    await test.close();
  });

  it('rejects a request with no token', async () => {
    const response = await test.http().get('/v1/me').expect(401);
    expect(response.body.code).toBe('UNAUTHENTICATED');
  });

  it('rejects a tampered token', async () => {
    const tampered = `${tenant.accessToken.slice(0, -4)}AAAA`;
    const response = await test
      .http()
      .get('/v1/me')
      .set('Authorization', `Bearer ${tampered}`)
      .expect(401);
    expect(response.body.code).toBe('INVALID_TOKEN');
  });

  it('rejects a token whose user no longer exists with 401, not 404', async () => {
    // Rebuilding a tenant (a re-seed, a deleted account) leaves live tokens
    // pointing at ids that are gone. That is a dead session, and a client must be
    // able to tell it apart from a missing page — a 404 here crashed the web shell
    // on every route because it reads as a server fault rather than "sign in".
    const doomed = await onboardTenant(test, { name: 'Vanishing Builders', phone: uniquePhone() });
    await destroyTenant(test, doomed.tenantId);

    const response = await test
      .http()
      .get('/v1/me')
      .set('Authorization', `Bearer ${doomed.accessToken}`)
      .expect(401);

    expect(response.body.code).toBe('INVALID_TOKEN');
  });

  it('returns the tenant, role and module list on /me', async () => {
    const response = await test
      .http()
      .get('/v1/me')
      .set('Authorization', `Bearer ${tenant.accessToken}`)
      .expect(200);

    expect(response.body.user.role).toBe('owner');
    expect(response.body.tenant.plan).toBe('three_months');
    // Every account gets every module. The plan is a length of time, so a three-month account and
    // a lifetime one differ in when they end, not in what they can do.
    expect(response.body.enabled_modules).toContain('attendance');
    expect(response.body.enabled_modules).toContain('expenses');
    expect(response.body.enabled_modules).toContain('client_portal');
    expect(response.body.sees_all_projects).toBe(true);

    // And the term is on `/me`, because both clients warn from it.
    expect(response.body.tenant.plan_standing).toBe('active');
    expect(typeof response.body.tenant.plan_expires_on).toBe('string');
  });

  it('signs an existing owner straight in on the second exchange', async () => {
    const response = await test
      .http()
      .post('/v1/auth/exchange')
      .send({ firebase_token: `dev:${tenant.phone}` })
      .expect(200);

    expect(response.body.onboarding_required).toBeUndefined();
    expect(response.body.access_token).toBeDefined();
  });

  it('refuses to onboard a second tenant on the same phone', async () => {
    const exchange = await test
      .http()
      .post('/v1/auth/exchange')
      .send({ firebase_token: `dev:${tenant.phone}` })
      .expect(200);

    // A signed-in phone gets a session, not an onboarding token, so there is no
    // ticket to replay. Reusing a stale one is caught by the identity re-check.
    expect(exchange.body.onboarding_token).toBeUndefined();
  });

  describe('refresh token rotation', () => {
    it('rotates the refresh token and invalidates the old one', async () => {
      const session = await onboardTenant(test, {
        name: 'Rotation Builders',
        phone: uniquePhone(),
      });

      const first = await test
        .http()
        .post('/v1/auth/refresh')
        .send({ refresh_token: session.refreshToken })
        .expect(200);

      expect(first.body.refresh_token).not.toBe(session.refreshToken);

      // Replaying the consumed token is treated as theft: rejected, and every live
      // session for that user is revoked.
      const replay = await test
        .http()
        .post('/v1/auth/refresh')
        .send({ refresh_token: session.refreshToken })
        .expect(401);
      expect(replay.body.code).toBe('INVALID_TOKEN');

      const afterRevoke = await test
        .http()
        .post('/v1/auth/refresh')
        .send({ refresh_token: first.body.refresh_token })
        .expect(401);
      expect(afterRevoke.body.code).toBe('INVALID_TOKEN');

      await destroyTenant(test, session.tenantId);
    });
  });

  describe('validation', () => {
    it('reports a field-level VALIDATION_FAILED body', async () => {
      const response = await test
        .http()
        .post('/v1/projects')
        .set('Authorization', `Bearer ${tenant.accessToken}`)
        .send({ name: 'x' })
        .expect(422);

      expect(response.body.code).toBe('VALIDATION_FAILED');
      expect(response.body.details[0].path).toBe('name');
    });

    it('rejects an end date before the start date', async () => {
      const response = await test
        .http()
        .post('/v1/projects')
        .set('Authorization', `Bearer ${tenant.accessToken}`)
        .send({ name: 'Backwards Tower', start_date: '2026-06-01', target_end_date: '2026-01-01' })
        .expect(422);

      expect(response.body.details[0].path).toBe('target_end_date');
    });
  });

  describe('role checks', () => {
    it('stops a site supervisor from creating a project', async () => {
      const supervisorPhone = uniquePhone();
      await test
        .http()
        .post('/v1/tenants/current/invite')
        .set('Authorization', `Bearer ${tenant.accessToken}`)
        .send({ phone: supervisorPhone, name: 'Ravi', role: 'site_supervisor' })
        .expect(201);

      const login = await test
        .http()
        .post('/v1/auth/exchange')
        .send({ firebase_token: `dev:${supervisorPhone}` })
        .expect(200);

      const response = await test
        .http()
        .post('/v1/projects')
        .set('Authorization', `Bearer ${login.body.access_token}`)
        .send({ name: 'Supervisor Tower' })
        .expect(403);

      expect(response.body.code).toBe('FORBIDDEN');
    });

    it('shows a supervisor only their assigned projects', async () => {
      const ownerAuth = `Bearer ${tenant.accessToken}`;
      const assigned = await test
        .http()
        .post('/v1/projects')
        .set('Authorization', ownerAuth)
        .send({ name: 'Assigned Site' })
        .expect(201);
      const unassigned = await test
        .http()
        .post('/v1/projects')
        .set('Authorization', ownerAuth)
        .send({ name: 'Unassigned Site' })
        .expect(201);

      const supervisorPhone = uniquePhone();
      await test
        .http()
        .post('/v1/tenants/current/invite')
        .set('Authorization', ownerAuth)
        .send({
          phone: supervisorPhone,
          name: 'Meena',
          role: 'site_supervisor',
          project_ids: [assigned.body.id],
        })
        .expect(201);

      const login = await test
        .http()
        .post('/v1/auth/exchange')
        .send({ firebase_token: `dev:${supervisorPhone}` })
        .expect(200);

      const list = await test
        .http()
        .get('/v1/projects')
        .set('Authorization', `Bearer ${login.body.access_token}`)
        .expect(200);

      const ids = list.body.items.map((item: { id: string }) => item.id);
      expect(ids).toContain(assigned.body.id);
      expect(ids).not.toContain(unassigned.body.id);

      // Within the same tenant, an unassigned project is a 403 rather than a 404:
      // the caller is allowed to know the project exists, just not to open it.
      const denied = await test
        .http()
        .get(`/v1/projects/${unassigned.body.id}`)
        .set('Authorization', `Bearer ${login.body.access_token}`)
        .expect(403);
      expect(denied.body.code).toBe('PROJECT_NOT_ASSIGNED');
    });
  });

  describe('plan gating', () => {
    it('returns MODULE_NOT_ENABLED once a module is removed from the tenant', async () => {
      await test.tenantDb.transaction(tenant.tenantId, async (tx) => {
        await tx.tenant.update({
          where: { id: tenant.tenantId },
          data: { enabledModules: ['dpr', 'attendance'] },
        });
      });

      const response = await test
        .http()
        .get('/v1/projects')
        .set('Authorization', `Bearer ${tenant.accessToken}`)
        .expect(403);

      expect(response.body.code).toBe('MODULE_NOT_ENABLED');
      expect(response.body.details.module).toBe('projects');

      await test.tenantDb.transaction(tenant.tenantId, async (tx) => {
        await tx.tenant.update({
          where: { id: tenant.tenantId },
          data: { enabledModules: [] },
        });
      });
    });
  });
});
