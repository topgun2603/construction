import { TokenService } from '../src/common/auth/token.service';
import { PlatformService } from '../src/modules/platform/platform.service';
import {
  createTestApp,
  destroyTenant,
  onboardTenant,
  uniquePhone,
  type OnboardedTenant,
  type TestApp,
} from './utils/test-app';

/**
 * Company groups (Phase 2, module 11): inter-company users, the company switcher, groups and the
 * consolidated report.
 *
 * Most of what is here is a refusal, because this module is the one place the product reasons
 * about more than one company at once. Each refusal is a way across the tenant boundary that has
 * to stay shut:
 *
 * - a token for one company reading another's rows, for a person who belongs to both;
 * - signing in to, or switching to, a company the person has no membership in;
 * - a company joining a group without its own owner saying yes;
 * - the consolidated report for anybody who is not a group admin, or for a company outside the
 *   caller's group.
 */
describe('company groups', () => {
  let test: TestApp;
  /** Dubai, AED — founds the group. */
  let gulf: OnboardedTenant;
  /** Chennai, INR — invited, accepts. */
  let india: OnboardedTenant;
  /** Unrelated, INR — invited, declines; never in the group. */
  let outsider: OnboardedTenant;

  /** One person, an accountant at Gulf (sees every Gulf site) and a site supervisor at India. */
  const sharedPhone = uniquePhone();
  let indiaProjectId: string;

  const ADMIN_PHONE = '919000000001';
  const originalAllowlist = process.env['PLATFORM_ADMIN_PHONES'];

  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  function exchange(phone: string, tenantId?: string) {
    return test
      .http()
      .post('/v1/auth/exchange')
      .send({ firebase_token: `dev:${phone}`, ...(tenantId ? { tenant_id: tenantId } : {}) });
  }

  async function sharedTokenFor(tenantId: string): Promise<{ access: string; refresh: string }> {
    const response = await exchange(sharedPhone, tenantId).expect(200);
    expect(response.body.access_token).toBeDefined();
    return { access: response.body.access_token, refresh: response.body.refresh_token };
  }

  beforeAll(async () => {
    process.env['PLATFORM_ADMIN_PHONES'] = ADMIN_PHONE;
    test = await createTestApp();

    gulf = await onboardTenant(test, { name: 'Gulf Holding Contracting', phone: uniquePhone() });
    india = await onboardTenant(test, { name: 'Chennai Builders', phone: uniquePhone() });
    outsider = await onboardTenant(test, { name: 'Unrelated Constructions', phone: uniquePhone() });

    await test
      .http()
      .patch('/v1/tenants/current')
      .set(auth(gulf.accessToken))
      .send({ country: 'AE', currency: 'AED', timezone: 'Asia/Dubai', locale: 'en-AE', tax_regime: 'vat_ae' })
      .expect(200);

    // The same person in two companies, with a different role in each.
    await test
      .http()
      .post('/v1/tenants/current/invite')
      .set(auth(gulf.accessToken))
      .send({ name: 'Shared Person', phone: sharedPhone, role: 'accounts', project_ids: [] })
      .expect(201);
    await test
      .http()
      .post('/v1/tenants/current/invite')
      .set(auth(india.accessToken))
      .send({ name: 'Shared Person', phone: sharedPhone, role: 'site_supervisor', project_ids: [] })
      .expect(201);

    // Something in each company to (fail to) read across the boundary, and to add up.
    const indiaProject = await test
      .http()
      .post('/v1/projects')
      .set(auth(india.accessToken))
      .send({ name: 'Chennai Tower', status: 'active', budget_amount: '100000000' })
      .expect(201);
    indiaProjectId = indiaProject.body.id;
    await test
      .http()
      .post('/v1/projects')
      .set(auth(gulf.accessToken))
      .send({ name: 'Marina Villa', status: 'active', budget_amount: '100000' })
      .expect(201);
  });

  afterAll(async () => {
    for (const tenant of [gulf, india, outsider]) {
      if (tenant) await destroyTenant(test, tenant.tenantId);
    }
    await test.close();
    if (originalAllowlist === undefined) delete process.env['PLATFORM_ADMIN_PHONES'];
    else process.env['PLATFORM_ADMIN_PHONES'] = originalAllowlist;
  });

  describe('signing in when you belong to more than one company', () => {
    it('asks which company, listing only the ones the person belongs to', async () => {
      const response = await exchange(sharedPhone).expect(200);
      expect(response.body.tenant_choice_required).toBe(true);
      const ids = response.body.tenants.map((row: { tenant_id: string }) => row.tenant_id).sort();
      expect(ids).toEqual([gulf.tenantId, india.tenantId].sort());
    });

    it('signs in to the company chosen, with that company’s role', async () => {
      const { access } = await sharedTokenFor(india.tenantId);
      const me = await test.http().get('/v1/me').set(auth(access)).expect(200);
      expect(me.body.tenant.id).toBe(india.tenantId);
      expect(me.body.user.role).toBe('site_supervisor');
    });

    it('refuses to sign in to a company the person has no membership in', async () => {
      const response = await exchange(sharedPhone, outsider.tenantId).expect(403);
      expect(response.body.code).toBe('FORBIDDEN');
    });

    it('still signs a single-company person straight in, and ignores no tenant_id', async () => {
      const response = await exchange(outsider.phone.slice(-10)).expect(200);
      expect(response.body.access_token).toBeDefined();
    });
  });

  describe('a token is for exactly one company', () => {
    it('never reads the other company’s rows, even for a member of both', async () => {
      const { access } = await sharedTokenFor(gulf.tenantId);

      const list = await test.http().get('/v1/projects?limit=200').set(auth(access)).expect(200);
      const ids = list.body.items.map((project: { id: string }) => project.id);
      expect(ids).not.toContain(indiaProjectId);

      // Asked for by id, the row simply does not exist from inside Gulf.
      const direct = await test.http().get(`/v1/projects/${indiaProjectId}`).set(auth(access));
      expect(direct.status).toBe(404);
    });
  });

  describe('switching company', () => {
    it('lists every company the person belongs to, current first', async () => {
      const { access } = await sharedTokenFor(gulf.tenantId);
      const response = await test.http().get('/v1/auth/memberships').set(auth(access)).expect(200);
      expect(response.body.items).toHaveLength(2);
      expect(response.body.items[0]).toMatchObject({ tenant_id: gulf.tenantId, current: true });
      expect(response.body.items[1]).toMatchObject({
        tenant_id: india.tenantId,
        current: false,
        role: 'site_supervisor',
      });
    });

    it('re-issues a token for the chosen company, and revokes the session left', async () => {
      const gulfSession = await sharedTokenFor(gulf.tenantId);
      const switched = await test
        .http()
        .post('/v1/auth/switch')
        .set(auth(gulfSession.access))
        .send({ tenant_id: india.tenantId, refresh_token: gulfSession.refresh })
        .expect(200);

      const me = await test.http().get('/v1/me').set(auth(switched.body.access_token)).expect(200);
      expect(me.body.tenant.id).toBe(india.tenantId);
      expect(me.body.user.role).toBe('site_supervisor');

      // The Gulf refresh token handed in was revoked: presenting it again is a replay.
      await test
        .http()
        .post('/v1/auth/refresh')
        .send({ refresh_token: gulfSession.refresh })
        .expect(401);

      // And the new session can switch onwards, because the verified identity rode along — and
      // survives a refresh.
      const refreshed = await test
        .http()
        .post('/v1/auth/refresh')
        .send({ refresh_token: switched.body.refresh_token })
        .expect(200);
      const back = await test
        .http()
        .post('/v1/auth/switch')
        .set(auth(refreshed.body.access_token))
        .send({ tenant_id: gulf.tenantId })
        .expect(200);
      const meBack = await test.http().get('/v1/me').set(auth(back.body.access_token)).expect(200);
      expect(meBack.body.tenant.id).toBe(gulf.tenantId);
    });

    it('refuses to switch to a company the person has no membership in', async () => {
      const { access } = await sharedTokenFor(gulf.tenantId);
      await test
        .http()
        .post('/v1/auth/switch')
        .set(auth(access))
        .send({ tenant_id: outsider.tenantId })
        .expect(403);
    });

    it('refuses to switch on a session with no verified identity in it', async () => {
      // A token minted the way sessions were before switching existed: valid for Gulf, but with
      // nothing to look the person up by. It must not fall back to the phone on the user row.
      const me = await test
        .http()
        .get('/v1/me')
        .set(auth((await sharedTokenFor(gulf.tenantId)).access))
        .expect(200);
      const legacy = test.app.get(TokenService).signAccessToken({
        userId: me.body.user.id,
        tenantId: gulf.tenantId,
        role: 'accounts',
        projectIds: [],
      });
      await test
        .http()
        .post('/v1/auth/switch')
        .set(auth(legacy))
        .send({ tenant_id: india.tenantId })
        .expect(403);
      // Everything else still works on it.
      await test.http().get('/v1/me').set(auth(legacy)).expect(200);
    });
  });

  describe('forming a group', () => {
    let invitationId: string;

    it('lets only a company owner start a group', async () => {
      const { access } = await sharedTokenFor(gulf.tenantId);
      await test
        .http()
        .post('/v1/company-groups')
        .set(auth(access))
        .send({ name: 'Should Fail Holding' })
        .expect(403);

      const created = await test
        .http()
        .post('/v1/company-groups')
        .set(auth(gulf.accessToken))
        .send({ name: 'Gulf & India Holding' })
        .expect(201);
      expect(created.body.group).toMatchObject({ name: 'Gulf & India Holding', base_currency: 'AED' });
      expect(created.body.my_permissions.sort()).toEqual(['group.manage', 'group.view_reports']);
      expect(created.body.companies).toHaveLength(1);
    });

    it('invites a company, which is not a member until its owner accepts', async () => {
      const invited = await test
        .http()
        .post('/v1/company-groups/current/invitations')
        .set(auth(gulf.accessToken))
        .send({ tenant_id: india.tenantId })
        .expect(201);
      invitationId = invited.body.id;
      expect(invited.body.status).toBe('pending');

      const before = await test
        .http()
        .get('/v1/company-groups/current')
        .set(auth(gulf.accessToken))
        .expect(200);
      expect(before.body.companies.map((c: { tenant_id: string }) => c.tenant_id)).toEqual([gulf.tenantId]);

      // India's owner sees it waiting.
      const inbox = await test
        .http()
        .get('/v1/company-groups/current')
        .set(auth(india.accessToken))
        .expect(200);
      expect(inbox.body.group).toBeNull();
      expect(inbox.body.incoming_invitations).toHaveLength(1);
      expect(inbox.body.incoming_invitations[0].group_name).toBe('Gulf & India Holding');
    });

    it('refuses an acceptance from anybody but the invited company’s owner', async () => {
      // Another company's owner cannot accept it — to them the invitation does not exist…
      await test
        .http()
        .post(`/v1/company-groups/invitations/${invitationId}/accept`)
        .set(auth(outsider.accessToken))
        .expect(404);
      // …nor can the inviting company accept on the invited one's behalf…
      const byInviter = await test
        .http()
        .post(`/v1/company-groups/invitations/${invitationId}/accept`)
        .set(auth(gulf.accessToken));
      expect([404, 409]).toContain(byInviter.status);
      // …and nor can a non-owner inside the invited company.
      const { access } = await sharedTokenFor(india.tenantId);
      await test
        .http()
        .post(`/v1/company-groups/invitations/${invitationId}/accept`)
        .set(auth(access))
        .expect(403);
    });

    it('joins once the invited owner accepts, and logs it in both companies', async () => {
      const accepted = await test
        .http()
        .post(`/v1/company-groups/invitations/${invitationId}/accept`)
        .set(auth(india.accessToken))
        .expect(200);
      expect(accepted.body.group.name).toBe('Gulf & India Holding');
      expect(accepted.body.companies).toHaveLength(2);

      for (const tenant of [gulf, india]) {
        const actions = await test.tenantDb.transaction(tenant.tenantId, async (tx) =>
          (await tx.auditLog.findMany({ where: { entity: 'company_groups' }, select: { action: true } })).map(
            (row) => row.action,
          ),
        );
        expect(actions).toContain('company_group.joined');
        expect(actions).toContain('company_group.invited');
      }
    });

    it('invites by owner phone, and a decline leaves the company out', async () => {
      const invited = await test
        .http()
        .post('/v1/company-groups/current/invitations')
        .set(auth(gulf.accessToken))
        .send({ owner_phone: outsider.phone.slice(-10) })
        .expect(201);
      expect(invited.body.tenant_id).toBe(outsider.tenantId);

      await test
        .http()
        .post(`/v1/company-groups/invitations/${invited.body.id}/decline`)
        .set(auth(outsider.accessToken))
        .expect(204);

      const overview = await test
        .http()
        .get('/v1/company-groups/current')
        .set(auth(gulf.accessToken))
        .expect(200);
      expect(overview.body.companies.map((c: { tenant_id: string }) => c.tenant_id)).not.toContain(
        outsider.tenantId,
      );
    });
  });

  describe('the consolidated report', () => {
    it('shows each company in its own currency and leaves out a currency with no rate', async () => {
      const report = await test
        .http()
        .get('/v1/company-groups/current/report')
        .set(auth(gulf.accessToken))
        .expect(200);
      const byId = new Map(
        report.body.companies.map((c: { tenant_id: string }) => [c.tenant_id, c] as const),
      );
      expect(byId.get(gulf.tenantId)).toMatchObject({ currency: 'AED', money: { budget: '100000' } });
      expect(byId.get(india.tenantId)).toMatchObject({ currency: 'INR', money: { budget: '100000000' } });
      expect(report.body.total.complete).toBe(false);
      expect(report.body.total.missing_currencies).toEqual(['INR']);
      expect(report.body.total.money.budget).toBe('100000');
      expect(report.body.total.counts.sites_active).toBe(2);
    });

    it('converts at the group’s own rate and says which rate it used', async () => {
      await test
        .http()
        .post('/v1/company-groups/current/rates')
        .set(auth(gulf.accessToken))
        .send({ currency: 'INR', rate: '0.0441', effective_from: '2026-01-01' })
        .expect(201);

      const report = await test
        .http()
        .get('/v1/company-groups/current/report')
        .set(auth(gulf.accessToken))
        .expect(200);
      expect(report.body.total.complete).toBe(true);
      // AED 1,000.00 + ₹10,00,000.00 × 0.0441 = AED 45,100.00.
      expect(report.body.total.money.budget).toBe(String(100000 + 4410000));
      expect(report.body.total.rates_used).toContainEqual({
        currency: 'INR',
        rate: '0.0441',
        effective_from: '2026-01-01',
      });

      const csv = await test
        .http()
        .get('/v1/company-groups/current/report/export')
        .set(auth(gulf.accessToken))
        .expect(200);
      expect(csv.headers['content-type']).toContain('text/csv');
      expect(csv.text).toContain('Chennai Builders,INR');
      expect(csv.text).toContain('0.0441');
    });

    it('refuses everybody who is not a group admin', async () => {
      // India's owner: in the group, but holds no grant.
      await test
        .http()
        .get('/v1/company-groups/current/report')
        .set(auth(india.accessToken))
        .expect(403);
      // An accountant inside the founding company.
      const { access } = await sharedTokenFor(gulf.tenantId);
      await test.http().get('/v1/company-groups/current/report').set(auth(access)).expect(403);
      // A company in no group at all.
      await test
        .http()
        .get('/v1/company-groups/current/report')
        .set(auth(outsider.accessToken))
        .expect(404);
    });

    it('refuses a group admin a company outside their group', async () => {
      const response = await test
        .http()
        .get(`/v1/company-groups/current/report?tenant_id=${outsider.tenantId}`)
        .set(auth(gulf.accessToken))
        .expect(403);
      expect(response.body.code).toBe('FORBIDDEN');

      // The outsider founds a group of its own; its admin cannot reach into Gulf's.
      await test
        .http()
        .post('/v1/company-groups')
        .set(auth(outsider.accessToken))
        .send({ name: 'Outsider Group' })
        .expect(201);
      await test
        .http()
        .get(`/v1/company-groups/current/report?tenant_id=${gulf.tenantId}`)
        .set(auth(outsider.accessToken))
        .expect(403);
      const own = await test
        .http()
        .get('/v1/company-groups/current/report')
        .set(auth(outsider.accessToken))
        .expect(200);
      expect(own.body.companies.map((c: { tenant_id: string }) => c.tenant_id)).toEqual([
        outsider.tenantId,
      ]);
    });

    it('a grant follows the person into any of the group’s companies', async () => {
      // Granted on the India account; the person is then signed in to Gulf.
      const granted = await test
        .http()
        .post('/v1/company-groups/current/admins')
        .set(auth(gulf.accessToken))
        .send({ tenant_id: india.tenantId, phone: sharedPhone, permissions: ['group.view_reports'] })
        .expect(201);
      expect(granted.body).toMatchObject({ tenant_id: india.tenantId, active: true });

      const { access } = await sharedTokenFor(gulf.tenantId);
      await test.http().get('/v1/company-groups/current/report').set(auth(access)).expect(200);
      // View, not manage.
      await test
        .http()
        .post('/v1/company-groups/current/rates')
        .set(auth(access))
        .send({ currency: 'INR', rate: '1', effective_from: '2026-02-01' })
        .expect(403);

      const actions = await test.tenantDb.transaction(india.tenantId, async (tx) =>
        (await tx.auditLog.findMany({ where: { entity: 'company_groups' }, select: { action: true } })).map(
          (row) => row.action,
        ),
      );
      expect(actions).toContain('company_group.admin_granted');
    });

    it('will not remove the group’s last manager', async () => {
      const overview = await test
        .http()
        .get('/v1/company-groups/current')
        .set(auth(gulf.accessToken))
        .expect(200);
      const manager = overview.body.admins.find((admin: { permissions: string[] }) =>
        admin.permissions.includes('group.manage'),
      );
      await test
        .http()
        .delete(`/v1/company-groups/current/admins/${manager.id}`)
        .set(auth(gulf.accessToken))
        .expect(409);
    });
  });

  describe('row-level security on the group tables', () => {
    it('shows nothing with no context, and only a company’s own rows with a tenant context', async () => {
      // The raw client sets no context at all.
      expect(await test.prisma.companyGroup.findMany()).toEqual([]);
      expect(await test.prisma.companyGroupMember.findMany()).toEqual([]);

      // India's context, without entering its group: its own membership, nobody else's.
      const seen = await test.tenantDb.transaction(india.tenantId, (tx) =>
        tx.companyGroupMember.findMany({ select: { tenantId: true } }),
      );
      expect(seen.map((row) => row.tenantId)).toEqual([india.tenantId]);
      const rates = await test.tenantDb.transaction(india.tenantId, (tx) =>
        tx.companyGroupExchangeRate.findMany(),
      );
      expect(rates).toEqual([]);
    });

    it('will not let a company enrol another company', async () => {
      // Even inside a group's context, a membership row for a different tenant fails the policy.
      const groupId = await test.tenantDb.transaction(gulf.tenantId, async (tx) => {
        const row = await tx.companyGroupMember.findUniqueOrThrow({ where: { tenantId: gulf.tenantId } });
        return row.groupId;
      });
      await expect(
        test.tenantDb.transaction(gulf.tenantId, async (tx) => {
          await tx.$executeRaw`SELECT set_config('app.group_id', ${groupId}::text, TRUE)`;
          await tx.companyGroupMember.create({ data: { groupId, tenantId: outsider.tenantId } });
        }),
      ).rejects.toThrow();
    });
  });

  describe('the platform console', () => {
    it('shows which group a company is in', async () => {
      const platform = test.app.get(PlatformService);
      const list = await platform.listTenants({ search: 'Chennai Builders' });
      const row = list.tenants.find((tenant) => tenant.id === india.tenantId);
      expect(row?.group_name).toBe('Gulf & India Holding');

      const detail = await platform.getTenant(gulf.tenantId);
      expect(detail.group?.companies.map((c) => c.tenant_id).sort()).toEqual(
        [gulf.tenantId, india.tenantId].sort(),
      );
    });
  });

  describe('leaving', () => {
    it('only the company’s owner can take it out, and its grants go with it', async () => {
      const { access } = await sharedTokenFor(india.tenantId);
      await test.http().post('/v1/company-groups/current/leave').set(auth(access)).expect(403);

      await test
        .http()
        .post('/v1/company-groups/current/leave')
        .set(auth(india.accessToken))
        .expect(204);

      const overview = await test
        .http()
        .get('/v1/company-groups/current')
        .set(auth(gulf.accessToken))
        .expect(200);
      expect(overview.body.companies.map((c: { tenant_id: string }) => c.tenant_id)).toEqual([
        gulf.tenantId,
      ]);
      expect(
        overview.body.admins.some((admin: { tenant_id: string }) => admin.tenant_id === india.tenantId),
      ).toBe(false);

      // The shared person's grant was on their India account, so the report is closed to them now.
      const gulfSession = await sharedTokenFor(gulf.tenantId);
      await test
        .http()
        .get('/v1/company-groups/current/report')
        .set(auth(gulfSession.access))
        .expect(403);

      const actions = await test.tenantDb.transaction(india.tenantId, async (tx) =>
        (await tx.auditLog.findMany({ where: { entity: 'company_groups' }, select: { action: true } })).map(
          (row) => row.action,
        ),
      );
      expect(actions).toContain('company_group.left');
    });
  });
});
