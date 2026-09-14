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
        .send({ plan: 'one_year' })
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


  describe('support access', () => {
    it('answers the usual support call without becoming the customer', async () => {
      const response = await test
        .http()
        .get(`/v1/admin/tenants/${tenantA.tenantId}/support`)
        .set(adminAuth)
        .expect(200);

      // The three things that explain most "I cannot see it" calls.
      expect(response.body.tenant.status).toBe('active');
      expect(Array.isArray(response.body.tenant.enabled_modules)).toBe(true);
      expect(response.body.users.length).toBeGreaterThan(0);
      expect(response.body.activity).toHaveProperty('reports');

      // No token for the tenant comes back. Support looks; it does not become anybody, because an
      // action taken as the customer is indistinguishable from the customer in their own log.
      expect(JSON.stringify(response.body)).not.toContain('access_token');
    });

    it('records that somebody looked', async () => {
      await test
        .http()
        .get(`/v1/admin/tenants/${tenantB.tenantId}/support`)
        .set(adminAuth)
        .expect(200);

      const audit = await test.http().get('/v1/admin/audit').set(adminAuth).expect(200);
      const viewed = audit.body.entries.find(
        (entry: { action: string; tenant_id: string }) =>
          entry.action === 'tenant.support_viewed' && entry.tenant_id === tenantB.tenantId,
      );
      expect(viewed).toBeDefined();
    });

    it('is refused without a console token', async () => {
      await test
        .http()
        .get(`/v1/admin/tenants/${tenantA.tenantId}/support`)
        .set({ Authorization: `Bearer ${tenantA.accessToken}` })
        .expect(401);
    });
  });

  describe('export', () => {
    it('hands back everything the tenant owns', async () => {
      const response = await test
        .http()
        .get(`/v1/admin/tenants/${tenantA.tenantId}/export`)
        .set(adminAuth)
        .expect(200);

      expect(response.body.tenant.id).toBe(tenantA.tenantId);
      for (const section of ['users', 'projects', 'workers', 'attendance', 'expenses']) {
        expect(Array.isArray(response.body[section])).toBe(true);
      }
      expect(response.body.exported_by).toBe(ADMIN_PHONE);
    });

    it('does not leak another tenant into the file', async () => {
      const response = await test
        .http()
        .get(`/v1/admin/tenants/${tenantA.tenantId}/export`)
        .set(adminAuth)
        .expect(200);

      // The export runs on the BYPASSRLS connection, which is exactly the connection that could
      // return everybody's rows if a `where` were ever dropped.
      const foreign = JSON.stringify(response.body).includes(tenantB.tenantId);
      expect(foreign).toBe(false);
    });
  });

  describe('operators', () => {
    const GRANTED = '919000000077';

    it('lists the deployment config as root, which cannot be revoked', async () => {
      const response = await test.http().get('/v1/admin/operators').set(adminAuth).expect(200);

      const root = response.body.items.find(
        (item: { phone: string }) => item.phone === ADMIN_PHONE,
      );
      expect(root.root).toBe(true);

      // Locking the owners out of their own console from inside it must not be possible.
      await test.http().delete(`/v1/admin/operators/${ADMIN_PHONE}`).set(adminAuth).expect(409);
    });

    it('grants and revokes, and the grant is what lets them in', async () => {
      // Before the grant, a verified OTP from that number is refused.
      await test
        .http()
        .post('/v1/admin/auth/login')
        .send({ firebase_token: `dev:${GRANTED}` })
        .expect(401);

      await test
        .http()
        .post('/v1/admin/operators')
        .set(adminAuth)
        .send({ phone: '9000000077', name: 'Support' })
        .expect(201);

      const login = await test
        .http()
        .post('/v1/admin/auth/login')
        .send({ firebase_token: `dev:${GRANTED}` })
        .expect(201);
      const grantedAuth = { Authorization: `Bearer ${login.body.access_token}` };

      // They can work, but they are not root and cannot widen the circle.
      await test.http().get('/v1/admin/tenants').set(grantedAuth).expect(200);
      await test
        .http()
        .post('/v1/admin/operators')
        .set(grantedAuth)
        .send({ phone: '9000000078' })
        .expect(403);

      await test.http().delete(`/v1/admin/operators/${GRANTED}`).set(adminAuth).expect(204);

      // Revocation takes effect on the next request, not when the eight-hour token expires.
      await test.http().get('/v1/admin/tenants').set(grantedAuth).expect(403);
    });
  });

  describe('the plan catalogue', () => {
    it('is what tenants are offered, and an operator can add to it', async () => {
      const code = `two_years_${Date.now()}`;

      const created = await test
        .http()
        .post('/v1/admin/plans')
        .set(adminAuth)
        .send({
          code,
          name: '2 years',
          months: 24,
          price: '1799900',
          description: 'For somebody who has decided.',
          badge: 'Best value',
          highlights: ['Every feature', 'Two years of it'],
          sort_order: 9,
        })
        .expect(201);
      expect(created.body.code).toBe(code);
      expect(created.body.badge).toBe('Best value');

      // The whole point: a builder sees it without anybody deploying anything.
      const offered = await test
        .http()
        .get('/v1/plans')
        .set({ Authorization: `Bearer ${tenantA.accessToken}` })
        .expect(200);
      expect(offered.body.items.map((plan: { code: string }) => plan.code)).toContain(code);

      // The ribbon travels with it: what an operator wants called out is called out everywhere a
      // builder sees the catalogue, the app included.
      const offeredPlan = offered.body.items.find(
        (plan: { code: string }) => plan.code === code,
      );
      expect(offeredPlan.badge).toBe('Best value');

      // And clearing it is a plain edit, not a second endpoint.
      const cleared = await test
        .http()
        .patch(`/v1/admin/plans/${created.body.id}`)
        .set(adminAuth)
        .send({ badge: null })
        .expect(200);
      expect(cleared.body.badge).toBeNull();

      // Retiring stops it being offered without touching anybody already on it.
      await test
        .http()
        .patch(`/v1/admin/plans/${created.body.id}`)
        .set(adminAuth)
        .send({ is_active: false })
        .expect(200);

      const after = await test
        .http()
        .get('/v1/plans')
        .set({ Authorization: `Bearer ${tenantA.accessToken}` })
        .expect(200);
      expect(after.body.items.map((plan: { code: string }) => plan.code)).not.toContain(code);

      await test.http().delete(`/v1/admin/plans/${created.body.id}`).set(adminAuth).expect(204);
    });

    it('decides a term from the catalogue, not from anything compiled in', async () => {
      const code = `one_month_${Date.now()}`;
      const plan = await test
        .http()
        .post('/v1/admin/plans')
        .set(adminAuth)
        .send({ code, name: '1 month', months: 1, price: '99900' })
        .expect(201);

      const builder = await onboardTenant(test, {
        name: 'Monthly Builders',
        phone: uniquePhone(),
      });

      try {
        await test
          .http()
          .patch(`/v1/admin/tenants/${builder.tenantId}`)
          .set(adminAuth)
          .send({ plan: code })
          .expect(200);

        const me = await test
          .http()
          .get('/v1/me')
          .set({ Authorization: `Bearer ${builder.accessToken}` })
          .expect(200);

        // A month from today, from a plan that did not exist when this code was written.
        expect(me.body.tenant.plan).toBe(code);
        expect(me.body.tenant.plan_name).toBe('1 month');
        const expires = new Date(me.body.tenant.plan_expires_on as string);
        const monthsAway = Math.round(
          (expires.getTime() - Date.now()) / (30.44 * 24 * 60 * 60 * 1000),
        );
        expect(monthsAway).toBe(1);
      } finally {
        await destroyTenant(test, builder.tenantId);
        await test.http().delete(`/v1/admin/plans/${plan.body.id}`).set(adminAuth).expect(204);
      }
    });

    it('refuses to delete a plan somebody is on', async () => {
      // Its own plan and its own tenant. An earlier version of this reached for a seeded plan and
      // deleted it out of the shared database when the assertions moved around — a test that can
      // destroy the catalogue it is checking is worse than no test.
      const code = `doomed_${Date.now()}`;
      const plan = await test
        .http()
        .post('/v1/admin/plans')
        .set(adminAuth)
        .send({ code, name: 'Doomed term', months: 6, price: '100000' })
        .expect(201);

      const builder = await onboardTenant(test, { name: 'On Doomed', phone: uniquePhone() });

      try {
        await test
          .http()
          .patch(`/v1/admin/tenants/${builder.tenantId}`)
          .set(adminAuth)
          .send({ plan: code })
          .expect(200);

        // Deleting it would leave that account pointing at a code resolving to nothing, and its
        // plan page would go blank. Retiring is the operation an operator actually wants.
        const refused = await test
          .http()
          .delete(`/v1/admin/plans/${plan.body.id}`)
          .set(adminAuth)
          .expect(409);
        expect(refused.body.message).toContain('Retire it');
      } finally {
        await destroyTenant(test, builder.tenantId);
        await test.http().delete(`/v1/admin/plans/${plan.body.id}`).set(adminAuth).expect(204);
      }
    });
  });

  describe('when a term runs out', () => {
    it('tells an operator when each account expires, and where that leaves it', async () => {
      const builder = await onboardTenant(test, { name: 'Termly Builders', phone: uniquePhone() });

      try {
        await test
          .http()
          .patch(`/v1/admin/tenants/${builder.tenantId}`)
          .set(adminAuth)
          .send({ plan: 'three_months' })
          .expect(200);

        // The list is where "who lapses next" gets answered, so the date has to be on the row and
        // not only on the detail page an operator would have to open one account at a time.
        const list = await test.http().get('/v1/admin/tenants').set(adminAuth).expect(200);
        const row = list.body.tenants.find(
          (tenant: { id: string }) => tenant.id === builder.tenantId,
        );
        expect(row.plan_standing).toBe('active');
        const months = Math.round(
          (new Date(row.plan_expires_on as string).getTime() - Date.now()) /
            (30.44 * 24 * 60 * 60 * 1000),
        );
        expect(months).toBe(3);

        const detail = await test
          .http()
          .get(`/v1/admin/tenants/${builder.tenantId}`)
          .set(adminAuth)
          .expect(200);
        expect(detail.body.tenant.plan_started_on).not.toBeNull();
        expect(detail.body.tenant.plan_expires_on).toBe(row.plan_expires_on);
        expect(detail.body.tenant.plan_standing).toBe('active');
      } finally {
        await destroyTenant(test, builder.tenantId);
      }
    });

    it('reports a lifetime account as never expiring rather than as expired', async () => {
      const builder = await onboardTenant(test, { name: 'Forever Builders', phone: uniquePhone() });

      try {
        await test
          .http()
          .patch(`/v1/admin/tenants/${builder.tenantId}`)
          .set(adminAuth)
          .send({ plan: 'lifetime' })
          .expect(200);

        const detail = await test
          .http()
          .get(`/v1/admin/tenants/${builder.tenantId}`)
          .set(adminAuth)
          .expect(200);
        // A null date is the one case where absent is correct, and the standing has to agree —
        // reading it as "no term" would make every lifetime account read-only.
        expect(detail.body.tenant.plan_expires_on).toBeNull();
        expect(detail.body.tenant.plan_standing).toBe('active');
      } finally {
        await destroyTenant(test, builder.tenantId);
      }
    });
  });

  describe('creating a tenant', () => {
    it('makes an account nobody signed up for, ready for its owner', async () => {
      const phone = uniquePhone();
      const created = await test
        .http()
        .post('/v1/admin/tenants')
        .set(adminAuth)
        .send({
          name: 'Cheque Payers LLP',
          owner_name: 'Ravi K',
          owner_phone: phone,
          plan: 'one_year',
        })
        .expect(201);

      expect(created.body.name).toBe('Cheque Payers LLP');
      expect(created.body.plan).toBe('one_year');

      // The whole point: the owner can now sign in with that number and land in this tenant,
      // without anybody having onboarded them.
      const session = await test
        .http()
        .post('/v1/auth/exchange')
        // 200, not 201: the owner already exists, so this signs them in rather than creating them.
        .send({ firebase_token: `dev:${phone}`, device_id: 'console-made' })
        .expect(200);
      expect(session.body.onboarding_required).toBeUndefined();

      const me = await test
        .http()
        .get('/v1/me')
        .set({ Authorization: `Bearer ${session.body.access_token}` })
        .expect(200);
      expect(me.body.tenant.id).toBe(created.body.id);
      expect(me.body.user.role).toBe('owner');

      // And the built-in roles exist as rows, so the owner can base a custom role on one. A tenant
      // without them works until somebody tries exactly that.
      const roles = await test
        .http()
        .get('/v1/roles')
        .set({ Authorization: `Bearer ${session.body.access_token}` })
        .expect(200);
      expect(roles.body.length).toBeGreaterThanOrEqual(5);

      await destroyTenant(test, created.body.id);
    });

    it('refuses a number that already belongs to an account', async () => {
      await test
        .http()
        .post('/v1/admin/tenants')
        .set(adminAuth)
        .send({
          name: 'Duplicate Builders',
          owner_name: 'Someone',
          owner_phone: tenantA.phone,
          plan: 'three_months',
        })
        .expect(409);
    });
  });

  describe('deleting a tenant', () => {
    it('refuses unless the name is typed back', async () => {
      const doomed = await onboardTenant(test, {
        name: 'Doomed Builders',
        phone: uniquePhone(),
      });

      await test
        .http()
        .delete(`/v1/admin/tenants/${doomed.tenantId}`)
        .set(adminAuth)
        .send({ confirm_name: 'Doomed Builder' })
        .expect(409);

      // Still there, because the name did not match.
      await test.http().get(`/v1/admin/tenants/${doomed.tenantId}`).set(adminAuth).expect(200);

      await test
        .http()
        .delete(`/v1/admin/tenants/${doomed.tenantId}`)
        .set(adminAuth)
        .send({ confirm_name: 'Doomed Builders' })
        .expect(200);

      await test.http().get(`/v1/admin/tenants/${doomed.tenantId}`).set(adminAuth).expect(404);
    });

    it('leaves the record of the deletion behind', async () => {
      const doomed = await onboardTenant(test, {
        name: 'Briefly Builders',
        phone: uniquePhone(),
      });
      await test
        .http()
        .delete(`/v1/admin/tenants/${doomed.tenantId}`)
        .set(adminAuth)
        .send({ confirm_name: 'Briefly Builders' })
        .expect(200);

      // `platform_audit_log` holds no foreign key to the tenant precisely so that what was done to
      // an account outlives the account.
      const audit = await test.http().get('/v1/admin/audit').set(adminAuth).expect(200);
      const entry = audit.body.entries.find(
        (row: { action: string; tenant_id: string }) =>
          row.action === 'tenant.deleted' && row.tenant_id === doomed.tenantId,
      );
      expect(entry).toBeDefined();
      expect(entry.before.name).toBe('Briefly Builders');
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

    it('restarts the term when the plan changes, and leaves the modules alone', async () => {
      const yearly = await test
        .http()
        .patch(`/v1/admin/tenants/${tenantA.tenantId}`)
        .set(adminAuth)
        .send({ plan: 'one_year' })
        .expect(200);
      expect(yearly.body.plan).toBe('one_year');

      // Modules no longer follow the plan. Every account has every one of them, and an operator
      // withdrawing one is a separate, deliberate act.
      expect(yearly.body.enabled_modules).toContain('expenses');

      const shortened = await test
        .http()
        .patch(`/v1/admin/tenants/${tenantA.tenantId}`)
        .set(adminAuth)
        .send({ plan: 'three_months' })
        .expect(200);
      expect(shortened.body.plan).toBe('three_months');
      expect(shortened.body.enabled_modules).toContain('expenses');
    });

    it('gives a lifetime account no expiry at all', async () => {
      // Its own tenant rather than one of the shared fixtures: this changes a plan, and the audit
      // test below reads the *previous* plan of the account it touches.
      const forever = await onboardTenant(test, {
        name: 'Forever Builders',
        phone: uniquePhone(),
      });

      try {
        await test
          .http()
          .patch(`/v1/admin/tenants/${forever.tenantId}`)
          .set(adminAuth)
          .send({ plan: 'lifetime' })
          .expect(200);

        // Null expiry is what makes it never end. Read as "expired at the epoch" it would lock out
        // the customers who paid the most, which is the failure this asserts against.
        const session = await test
          .http()
          .get('/v1/me')
          .set({ Authorization: `Bearer ${forever.accessToken}` })
          .expect(200);
        expect(session.body.tenant.plan).toBe('lifetime');
        expect(session.body.tenant.plan_expires_on).toBeNull();
        expect(session.body.tenant.plan_standing).toBe('active');
      } finally {
        await destroyTenant(test, forever.tenantId);
      }
    });

    it('makes the gate follow the module list', async () => {
      // Withdrawing a module is now an explicit act rather than a side effect of a cheaper plan,
      // which makes this the only way a module can be off — and so the only thing worth proving.
      await test
        .http()
        .patch(`/v1/admin/tenants/${tenantA.tenantId}`)
        .set(adminAuth)
        .send({ enabled_modules: ['projects', 'dpr', 'attendance', 'labour'] })
        .expect(200);

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
        .send({ plan: 'one_year' })
        .expect(200);

      const audit = await test.http().get('/v1/admin/audit').set(adminAuth).expect(200);
      const entry = audit.body.entries.find(
        (row: { tenant_id: string; action: string }) =>
          row.tenant_id === tenantB.tenantId && row.action === 'tenant.updated',
      );
      expect(entry).toBeDefined();
      expect(entry.actor_phone).toBe(ADMIN_PHONE);
      expect(entry.before.plan).toBe('three_months');
      expect(entry.after.plan).toBe('one_year');
    });
  });
});
