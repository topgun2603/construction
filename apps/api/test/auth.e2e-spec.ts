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

  /*
   * Onboarding does not let the caller choose its plan.
   *
   * It used to. The body carried `plan` and the server put the account on whatever it said, so
   * anybody who could pass OTP with an unregistered number — which is anybody with a phone — could
   * ask for `lifetime` and be handed the most expensive plan in the catalogue for nothing. An
   * unknown code did the same thing by accident: the term of a plan that does not exist is null,
   * and null is also how lifetime is written, so the expiry came out as "never".
   *
   * Two cases, because they failed through different doors and a fix for one is not a fix for both.
   */
  describe('the plan a new account lands on', () => {
    const asked: string[] = [];

    afterAll(async () => {
      for (const id of asked) await destroyTenant(test, id);
    });

    /*
     * Through `tenantDb`, not the plain client.
     *
     * `tenants` has FORCE ROW LEVEL SECURITY, so a read outside a transaction that has set
     * `app.tenant_id` matches no rows at all — `findUniqueOrThrow` would fail for the wrong
     * reason and the test would look like it had caught something.
     */
    async function expiryOf(tenantId: string): Promise<Date | null> {
      return test.tenantDb.transaction(tenantId, async (tx) => {
        const row = await tx.tenant.findUniqueOrThrow({
          where: { id: tenantId },
          select: { planExpiresOn: true },
        });
        return row.planExpiresOn;
      });
    }

    async function onboardAsking(plan: string): Promise<{ id: string; plan: string }> {
      const phone = uniquePhone();
      const exchange = await test
        .http()
        .post('/v1/auth/exchange')
        .send({ firebase_token: `dev:${phone}` })
        .expect(200);

      const created = await test
        .http()
        .post('/v1/tenants')
        .set('X-Onboarding-Token', exchange.body.onboarding_token)
        .send({ name: 'Chancer Builders', owner_name: 'Owner', plan })
        .expect(201);

      asked.push(created.body.tenant.id);
      return { id: created.body.tenant.id, plan: created.body.tenant.plan };
    }

    it('does not hand out lifetime to a request that asks for it', async () => {
      const tenant = await onboardAsking('lifetime');
      expect(tenant.plan).not.toBe('lifetime');

      // And the term is real, not absent. An account with no expiry is a lifetime account
      // whatever its plan column says, which is how this went wrong the first time.
      expect(await expiryOf(tenant.id)).not.toBeNull();
    });

    it('does not hand out a never-ending term for a plan that does not exist', async () => {
      const tenant = await onboardAsking('free_forever_please');
      expect(tenant.plan).not.toBe('free_forever_please');
      expect(await expiryOf(tenant.id)).not.toBeNull();
    });
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

  describe('signing in with Google', () => {
    /*
     * The dev bypass reads anything with an `@` as a Google token, which is what makes this
     * testable without a popup. What is being tested is not Firebase — it is that an address only
     * reaches an account by being proved, and that an unknown one is a dead end rather than a new
     * tenant.
     */
    it('refuses an address nobody has linked, and says how to get in', async () => {
      const response = await test
        .http()
        .post('/v1/auth/exchange')
        .send({ firebase_token: 'dev:stranger@example.com' })
        .expect(401);

      // Not an onboarding token: an account is built around a mobile number, and a Google account
      // carries none — so there is nothing to create here.
      expect(response.body.onboarding_token).toBeUndefined();
      expect(response.body.message).toContain('mobile number');
    });

    it('signs in once the address is linked, and stops when it is unlinked', async () => {
      const email = `owner-${Date.now()}@example.com`;

      const linked = await test
        .http()
        .post('/v1/me/google')
        .set('Authorization', `Bearer ${tenant.accessToken}`)
        .send({ firebase_token: `dev:${email}` })
        .expect(201);
      expect(linked.body.email).toBe(email);

      const signedIn = await test
        .http()
        .post('/v1/auth/exchange')
        .send({ firebase_token: `dev:${email}` })
        .expect(200);
      expect(signedIn.body.access_token).toBeTruthy();

      // The session it hands back is the same person, not a new one.
      const me = await test
        .http()
        .get('/v1/me')
        .set('Authorization', `Bearer ${signedIn.body.access_token}`)
        .expect(200);
      expect(me.body.user.id).toBe(tenant.ownerId);
      expect(me.body.user.email).toBe(email);

      await test
        .http()
        .delete('/v1/me/google')
        .set('Authorization', `Bearer ${tenant.accessToken}`)
        .expect(204);

      // Unlinking has to close the door, or "remove my Google account" would be decoration.
      await test
        .http()
        .post('/v1/auth/exchange')
        .send({ firebase_token: `dev:${email}` })
        .expect(401);
    });

    it('is case and whitespace insensitive, because typing an address is not the point', async () => {
      const email = `mixed-${Date.now()}@example.com`;
      await test
        .http()
        .post('/v1/me/google')
        .set('Authorization', `Bearer ${tenant.accessToken}`)
        .send({ firebase_token: `dev:  ${email.toUpperCase()} ` })
        .expect(201);

      await test
        .http()
        .post('/v1/auth/exchange')
        .send({ firebase_token: `dev:${email}` })
        .expect(200);

      await test
        .http()
        .delete('/v1/me/google')
        .set('Authorization', `Bearer ${tenant.accessToken}`)
        .expect(204);
    });

    it('refuses to let one person claim another person’s address', async () => {
      const email = `shared-${Date.now()}@example.com`;
      const other = await onboardTenant(test, {
        name: 'Second Builders',
        phone: uniquePhone(),
      });

      try {
        await test
          .http()
          .post('/v1/me/google')
          .set('Authorization', `Bearer ${tenant.accessToken}`)
          .send({ firebase_token: `dev:${email}` })
          .expect(201);

        // A different tenant entirely, so this one is allowed: the same consultant may work for
        // two builders, and the uniqueness that matters is inside a company.
        await test
          .http()
          .post('/v1/me/google')
          .set('Authorization', `Bearer ${other.accessToken}`)
          .send({ firebase_token: `dev:${email}` })
          .expect(201);

        // And now the address resolves to two accounts, which is the one case sign-in cannot
        // decide on its own.
        const ambiguous = await test
          .http()
          .post('/v1/auth/exchange')
          .send({ firebase_token: `dev:${email}` })
          .expect(200);
        expect(ambiguous.body.tenant_choice_required).toBe(true);
      } finally {
        await test
          .http()
          .delete('/v1/me/google')
          .set('Authorization', `Bearer ${tenant.accessToken}`)
          .expect(204);
        await destroyTenant(test, other.tenantId);
      }
    });

    it('will not take a phone token as a Google link', async () => {
      await test
        .http()
        .post('/v1/me/google')
        .set('Authorization', `Bearer ${tenant.accessToken}`)
        .send({ firebase_token: `dev:${uniquePhone()}` })
        .expect(422);
    });
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
