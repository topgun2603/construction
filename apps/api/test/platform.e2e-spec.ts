import {
  createTestApp,
  destroyTenant,
  onboardTenant,
  uniquePhone,
  type OnboardedTenant,
  type TestApp,
} from './utils/test-app';

/**
 * The platform console (spec §6.1, superadmin operations).
 *
 * The tests that matter most here are the refusals. This surface reads and writes across
 * every tenant, so the boundary around it is the only thing standing between one
 * builder's data and another's. Each of the following is a way in that must stay shut:
 *
 * - a tenant session presented to a console route
 * - a console session presented to a tenant route
 * - a verified OTP from a phone that is not on the allowlist
 * - a console token whose phone has since been removed from the allowlist
 */
describe('platform console', () => {
  let test: TestApp;
  let tenantA: OnboardedTenant;
  let tenantB: OnboardedTenant;
  let adminAuth: Record<string, string>;

  const ADMIN_PHONE = '919000000001';
  const originalAllowlist = process.env['PLATFORM_ADMIN_PHONES'];

  beforeAll(async () => {
    process.env['PLATFORM_ADMIN_PHONES'] = ADMIN_PHONE;
    test = await createTestApp();

    tenantA = await onboardTenant(test, { name: 'Console Builders A', phone: uniquePhone() });
    tenantB = await onboardTenant(test, { name: 'Console Builders B', phone: uniquePhone() });

    const login = await test
      .http()
      .post('/v1/admin/auth/login')
      .send({ firebase_token: `dev:${ADMIN_PHONE}` })
      .expect(201);
    adminAuth = { Authorization: `Bearer ${login.body.access_token}` };
  });

  afterAll(async () => {
    if (tenantA) await destroyTenant(test, tenantA.tenantId);
    if (tenantB) await destroyTenant(test, tenantB.tenantId);
    await test.close();
    if (originalAllowlist === undefined) delete process.env['PLATFORM_ADMIN_PHONES'];
    else process.env['PLATFORM_ADMIN_PHONES'] = originalAllowlist;
  });

  describe('the boundary', () => {
    it('refuses a tenant access token', async () => {
      // The token is valid, unexpired, and belongs to an owner. It is simply the wrong
      // kind of token: audience `api`, not `platform`.
      await test
        .http()
        .get('/v1/admin/tenants')
        .set({ Authorization: `Bearer ${tenantA.accessToken}` })
        .expect(401);
    });

    it('refuses a console token on a tenant route', async () => {
      await test.http().get('/v1/projects').set(adminAuth).expect(401);
      await test.http().get('/v1/me').set(adminAuth).expect(401);
    });

    it('refuses no token at all', async () => {
      await test.http().get('/v1/admin/tenants').expect(401);
      await test.http().get('/v1/admin/metrics').expect(401);
    });

    it('refuses a verified phone that is not on the allowlist', async () => {
      const stranger = uniquePhone();
      const response = await test
        .http()
        .post('/v1/admin/auth/login')
        .send({ firebase_token: `dev:${stranger}` })
        .expect(401);

      // Nothing in the refusal says whether the number exists or is merely not an
      // administrator — the console must not be an oracle for its own allowlist.
      expect(JSON.stringify(response.body)).not.toContain(stranger);
    });

    it('stops honouring a token once its phone leaves the allowlist', async () => {
      await test.http().get('/v1/admin/metrics').set(adminAuth).expect(200);

      process.env['PLATFORM_ADMIN_PHONES'] = '919000000099';
      try {
        // Same token, still cryptographically valid. Revocation does not wait for the
        // 8-hour expiry.
        await test.http().get('/v1/admin/metrics').set(adminAuth).expect(403);
      } finally {
        process.env['PLATFORM_ADMIN_PHONES'] = ADMIN_PHONE;
      }

      await test.http().get('/v1/admin/metrics').set(adminAuth).expect(200);
    });
  });

  describe('reading across tenants', () => {
    it('sees every tenant, which no tenant session can', async () => {
      const response = await test.http().get('/v1/admin/tenants').set(adminAuth).expect(200);

      const names = response.body.tenants.map((row: { name: string }) => row.name);
      expect(names).toContain('Console Builders A');
      expect(names).toContain('Console Builders B');

      // The counts are what make the list useful, so they have to be real rather than
      // zero-filled placeholders.
      const rowA = response.body.tenants.find(
        (row: { id: string }) => row.id === tenantA.tenantId,
      );
      expect(rowA.user_count).toBeGreaterThanOrEqual(1);
      expect(rowA.owner_phone).toBeTruthy();
    });

    it('counts the platform rather than one tenant', async () => {
      const response = await test.http().get('/v1/admin/metrics').set(adminAuth).expect(200);
      expect(response.body.tenants.total).toBeGreaterThanOrEqual(2);
      expect(response.body.tenants.active).toBeGreaterThanOrEqual(2);
      expect(response.body.usage.users).toBeGreaterThanOrEqual(2);
    });

    it('filters by search without leaking the rest', async () => {
      const response = await test
        .http()
        .get('/v1/admin/tenants?search=Console Builders A')
        .set(adminAuth)
        .expect(200);
      const names = response.body.tenants.map((row: { name: string }) => row.name);
      expect(names).toContain('Console Builders A');
      expect(names).not.toContain('Console Builders B');
    });

    it('returns one tenant in detail', async () => {
      const response = await test
        .http()
        .get(`/v1/admin/tenants/${tenantA.tenantId}`)
        .set(adminAuth)
        .expect(200);
      expect(response.body.tenant.name).toBe('Console Builders A');
      expect(Array.isArray(response.body.team)).toBe(true);
      expect(response.body.team.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('revenue', () => {
    it('counts only subscriptions that are actually being charged', async () => {
      /*
       * MRR was deliberately absent from this console until billing shipped, because no plan price
       * existed and an invented figure is the one number here somebody would act on. Now that it is
       * real, what matters is that it stays honest: a trial is not revenue.
       */
      const before = await test.http().get('/v1/admin/metrics').set(adminAuth).expect(200);
      const baseline = BigInt(before.body.revenue.mrr);

      // Subscribing puts the row in `trialing` — nothing has been charged.
      await test
        .http()
        .post('/v1/billing/subscribe')
        .set({ Authorization: `Bearer ${tenantA.accessToken}` })
        .send({ plan: 'pro' })
        .expect(201);

      const afterTrial = await test.http().get('/v1/admin/metrics').set(adminAuth).expect(200);
      expect(BigInt(afterTrial.body.revenue.mrr)).toBe(baseline);
      expect(afterTrial.body.revenue.trialing).toBeGreaterThanOrEqual(1);
    });

    it('reports a figure in paise, never a float', async () => {
      const response = await test.http().get('/v1/admin/metrics').set(adminAuth).expect(200);
      // A string of integer paise, like every other money value on the wire.
      expect(response.body.revenue.mrr).toMatch(/^\d+$/);
      expect(typeof response.body.revenue.mrr).toBe('string');
    });
  });

  describe('analytics', () => {
    /*
     * These are raw SQL, which the Prisma client cannot typecheck and a schema change
     * cannot break at compile time. The tests therefore assert on the *shape* as well as
     * the numbers: a renamed column surfaces here as a failing query rather than as an
     * empty chart somebody eventually notices.
     */

    it('returns every section with a consistent funnel', async () => {
      const response = await test
        .http()
        .get('/v1/admin/analytics?weeks=12')
        .set(adminAuth)
        .expect(200);

      expect(response.body).toHaveProperty('signups');
      expect(response.body).toHaveProperty('funnel');
      expect(response.body).toHaveProperty('activity');
      expect(response.body).toHaveProperty('volume');
      expect(response.body).toHaveProperty('dormant');
      expect(response.body).toHaveProperty('leaders');
      expect(response.body).toHaveProperty('plan_mix');

      // Each funnel step counts distinct tenants that got at least this far, so the
      // sequence can only ever fall. A rise means a step is counting the wrong thing.
      const counts = response.body.funnel.map((step: { count: number }) => step.count);
      for (let index = 1; index < counts.length; index += 1) {
        expect(counts[index]).toBeLessThanOrEqual(counts[index - 1]);
      }
      expect(response.body.funnel[0].label).toBe('Signed up');
      expect(response.body.funnel[0].count).toBeGreaterThanOrEqual(2);
    });

    it('never reports more active tenants than existed', async () => {
      const response = await test
        .http()
        .get('/v1/admin/analytics?weeks=12')
        .set(adminAuth)
        .expect(200);

      // Attendance carries the date the work happened, so a tenant can have work dated
      // before it signed up — back-entering a muster roll is ordinary. The denominator
      // counts tenants that existed *or* worked that week, so this must always hold.
      for (const week of response.body.activity) {
        expect(week.active).toBeLessThanOrEqual(week.existing);
        expect(week.percent).toBeLessThanOrEqual(100);
      }
    });

    it('returns one bucket per day for 30 days', async () => {
      const response = await test
        .http()
        .get('/v1/admin/analytics?weeks=4')
        .set(adminAuth)
        .expect(200);

      // A generated date spine, so a day nobody worked is a zero rather than a gap.
      expect(response.body.volume).toHaveLength(30);
      for (const day of response.body.volume) {
        expect(day.day).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(typeof day.attendance).toBe('number');
      }
    });

    it('clamps a nonsense range instead of failing', async () => {
      // A bookmarked URL with a silly value should show a sensible window, not an error.
      const huge = await test
        .http()
        .get('/v1/admin/analytics?weeks=9999')
        .set(adminAuth)
        .expect(200);
      expect(huge.body.weeks).toBe(52);

      const rubbish = await test
        .http()
        .get('/v1/admin/analytics?weeks=banana')
        .set(adminAuth)
        .expect(200);
      expect(rubbish.body.weeks).toBe(12);
    });

    it('lists a brand-new tenant as never having worked', async () => {
      const fresh = await onboardTenant(test, {
        name: 'Did Nothing Builders',
        phone: uniquePhone(),
      });
      try {
        const response = await test
          .http()
          .get('/v1/admin/analytics?weeks=12')
          .set(adminAuth)
          .expect(200);

        const row = response.body.dormant.find(
          (entry: { id: string }) => entry.id === fresh.tenantId,
        );
        expect(row).toBeDefined();
        // null rather than a large number: there is no last-worked date to count from.
        expect(row.quiet_days).toBeNull();
        expect(row.last_work).toBeNull();
      } finally {
        await destroyTenant(test, fresh.tenantId);
      }
    });

    it('refuses analytics to a tenant token', async () => {
      await test
        .http()
        .get('/v1/admin/analytics')
        .set({ Authorization: `Bearer ${tenantA.accessToken}` })
        .expect(401);
    });
  });

  describe('acting on a tenant', () => {
    it('suspends a tenant and locks their sessions out immediately', async () => {
      // Their token works before.
      await test
        .http()
        .get('/v1/me')
        .set({ Authorization: `Bearer ${tenantB.accessToken}` })
        .expect(200);

      await test
        .http()
        .patch(`/v1/admin/tenants/${tenantB.tenantId}`)
        .set(adminAuth)
        .send({ status: 'suspended' })
        .expect(200);

      // TENANT_SUSPENDED: the guard reads tenants.status on every request, so an
      // unexpired token stops working rather than waiting out its 15 minutes.
      const refused = await test
        .http()
        .get('/v1/me')
        .set({ Authorization: `Bearer ${tenantB.accessToken}` })
        .expect(403);
      expect(refused.body.code).toBe('TENANT_SUSPENDED');

      await test
        .http()
        .patch(`/v1/admin/tenants/${tenantB.tenantId}`)
        .set(adminAuth)
        .send({ status: 'active' })
        .expect(200);

      await test
        .http()
        .get('/v1/me')
        .set({ Authorization: `Bearer ${tenantB.accessToken}` })
        .expect(200);
    });

    it('resets the module list when the plan changes', async () => {
      const upgraded = await test
        .http()
        .patch(`/v1/admin/tenants/${tenantA.tenantId}`)
        .set(adminAuth)
        .send({ plan: 'pro' })
        .expect(200);
      expect(upgraded.body.plan).toBe('pro');
      expect(upgraded.body.enabled_modules).toContain('expenses');

      // The downgrade must actually take the Pro modules away. Leaving them on would
      // let a tenant keep features they stopped paying for while the plan field claimed
      // otherwise.
      const downgraded = await test
        .http()
        .patch(`/v1/admin/tenants/${tenantA.tenantId}`)
        .set(adminAuth)
        .send({ plan: 'starter' })
        .expect(200);
      expect(downgraded.body.plan).toBe('starter');
      expect(downgraded.body.enabled_modules).not.toContain('expenses');
    });

    it('makes the gate follow the module list', async () => {
      await test
        .http()
        .patch(`/v1/admin/tenants/${tenantA.tenantId}`)
        .set(adminAuth)
        .send({ plan: 'starter' })
        .expect(200);

      // Starter has no expenses module, so PlanGuard refuses — proving the console's
      // write is the same switch the tenant API reads.
      const refused = await test
        .http()
        .get('/v1/expenses')
        .set({ Authorization: `Bearer ${tenantA.accessToken}` })
        .expect(403);
      expect(refused.body.code).toBe('MODULE_NOT_ENABLED');
    });

    it('refuses a patch that changes nothing', async () => {
      await test
        .http()
        .patch(`/v1/admin/tenants/${tenantA.tenantId}`)
        .set(adminAuth)
        .send({})
        .expect(422);
    });

    it('writes an audit entry naming the operator and both states', async () => {
      await test
        .http()
        .patch(`/v1/admin/tenants/${tenantB.tenantId}`)
        .set(adminAuth)
        .send({ plan: 'pro' })
        .expect(200);

      const audit = await test.http().get('/v1/admin/audit').set(adminAuth).expect(200);
      const entry = audit.body.entries.find(
        (row: { tenant_id: string; action: string }) =>
          row.tenant_id === tenantB.tenantId && row.action === 'tenant.updated',
      );
      expect(entry).toBeDefined();
      expect(entry.actor_phone).toBe(ADMIN_PHONE);
      expect(entry.before.plan).toBe('starter');
      expect(entry.after.plan).toBe('pro');
    });
  });
});
