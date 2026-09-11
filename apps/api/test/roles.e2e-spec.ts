import {
  createTestApp,
  destroyTenant,
  onboardTenant,
  uniquePhone,
  type OnboardedTenant,
  type TestApp,
} from './utils/test-app';

/**
 * Owner-defined roles.
 *
 * The tests that matter are the ones about escalation. This endpoint lets somebody define
 * what other people may do, which makes it the most attractive thing in the API to abuse:
 * mint a role holding `tenant.manage`, assign it to yourself, own the account. Each refusal
 * below closes one route to that.
 */
describe('roles', () => {
  let test: TestApp;
  let tenant: OnboardedTenant;
  let owner: Record<string, string>;

  beforeAll(async () => {
    test = await createTestApp();
    tenant = await onboardTenant(test, { name: 'Role Builders', phone: uniquePhone(), plan: 'pro' });
    owner = { Authorization: `Bearer ${tenant.accessToken}` };
  });

  afterAll(async () => {
    if (tenant) await destroyTenant(test, tenant.tenantId);
    await test.close();
  });

  async function invite(role: string, name = 'Invited', projectIds: string[] = []) {
    const phone = uniquePhone();
    const created = await test
      .http()
      .post('/v1/tenants/current/invite')
      .set(owner)
      .send({ phone, name, role, project_ids: projectIds })
      .expect(201);
    const login = await test
      .http()
      .post('/v1/auth/exchange')
      .send({ firebase_token: `dev:${phone}` })
      .expect(200);
    return {
      id: created.body.id as string,
      auth: { Authorization: `Bearer ${login.body.access_token}` },
    };
  }

  it('seeds the five built-in roles for a new tenant', async () => {
    const response = await test.http().get('/v1/roles').set(owner).expect(200);

    const names = response.body.map((role: { name: string }) => role.name).sort();
    expect(names).toEqual(['Accounts', 'Client', 'Owner', 'Project manager', 'Site supervisor']);
    for (const role of response.body) {
      expect(role.is_system).toBe(true);
    }

    const ownerRole = response.body.find((role: { name: string }) => role.name === 'Owner');
    expect(ownerRole.permissions).toContain('tenant.manage');
    expect(ownerRole.member_count).toBe(1);
  });

  it('refuses to edit or delete a built-in role', async () => {
    const roles = await test.http().get('/v1/roles').set(owner).expect(200);
    const ownerRole = roles.body.find((role: { name: string }) => role.name === 'Owner');

    // An owner who could strip roles.manage from the Owner role would have no way back.
    const edit = await test
      .http()
      .patch(`/v1/roles/${ownerRole.id}`)
      .set(owner)
      .send({ permissions: ['projects.view'] })
      .expect(409);
    expect(edit.body.message).toMatch(/built-in/i);

    await test.http().delete(`/v1/roles/${ownerRole.id}`).set(owner).expect(409);
  });

  it('creates a custom role and enforces it on the API', async () => {
    const created = await test
      .http()
      .post('/v1/roles')
      .set(owner)
      .send({
        name: 'Store keeper',
        base_role: 'site_supervisor',
        // Can raise an indent, cannot approve one, cannot touch expenses.
        permissions: ['projects.view', 'materials.manage', 'indents.raise', 'dpr.view'],
        sees_all_projects: false,
      })
      .expect(201);
    expect(created.body.is_system).toBe(false);

    const keeper = await invite('site_supervisor', 'Store Keeper Person');
    await test
      .http()
      .patch(`/v1/roles/members/${keeper.id}`)
      .set(owner)
      .send({ role_id: created.body.id })
      .expect(204);

    // Their own /me must describe the custom role, not the base one.
    const me = await test.http().get('/v1/me').set(keeper.auth).expect(200);
    expect(me.body.role_name).toBe('Store keeper');
    expect(me.body.permissions).toContain('materials.manage');
    expect(me.body.permissions).not.toContain('expenses.approve');

    // A permission they hold, on a route that checks it.
    const material = await test
      .http()
      .post('/v1/materials')
      .set(keeper.auth)
      .send({ name: `Cement ${Date.now()}`, unit: 'bag' })
      .expect(201);
    // And one they do not: deleting a material needs materials.manage, which they have,
    // so use a route gated on something they were not given.
    const refused = await test
      .http()
      .get('/v1/reports/person-ledger?from=2026-08-01&to=2026-08-31')
      .set(keeper.auth)
      .expect(403);
    expect(refused.body.message).toMatch(/Store keeper/);
    expect(material.body.id).toBeTruthy();
  });

  it('applies a permission change without waiting for the token to expire', async () => {
    const created = await test
      .http()
      .post('/v1/roles')
      .set(owner)
      .send({
        name: 'Temporary reader',
        base_role: 'accounts',
        permissions: ['projects.view', 'reports.view', 'reports.people'],
        sees_all_projects: true,
      })
      .expect(201);

    const person = await invite('accounts', 'Temp Reader');
    await test
      .http()
      .patch(`/v1/roles/members/${person.id}`)
      .set(owner)
      .send({ role_id: created.body.id })
      .expect(204);

    await test
      .http()
      .get('/v1/reports/person-ledger?from=2026-08-01&to=2026-08-31')
      .set(person.auth)
      .expect(200);

    // Take the permission away. The token in their hand is unchanged and unexpired; it
    // carries a role id, not a permission list, so the next request must already refuse.
    await test
      .http()
      .patch(`/v1/roles/${created.body.id}`)
      .set(owner)
      .send({ permissions: ['projects.view'] })
      .expect(200);

    await test
      .http()
      .get('/v1/reports/person-ledger?from=2026-08-01&to=2026-08-31')
      .set(person.auth)
      .expect(403);
  });

  it('will not let somebody grant a permission they do not hold', async () => {
    // A project manager given roles.manage must not be able to mint themselves an owner.
    const pmRole = await test
      .http()
      .post('/v1/roles')
      .set(owner)
      .send({
        name: 'Lead PM',
        base_role: 'project_manager',
        permissions: ['projects.view', 'projects.manage', 'roles.manage'],
        sees_all_projects: false,
      })
      .expect(201);

    const lead = await invite('project_manager', 'Lead Person');
    await test
      .http()
      .patch(`/v1/roles/members/${lead.id}`)
      .set(owner)
      .send({ role_id: pmRole.body.id })
      .expect(204);

    // They can create a role within their own authority.
    await test
      .http()
      .post('/v1/roles')
      .set(lead.auth)
      .send({
        name: 'Assistant PM',
        base_role: 'site_supervisor',
        permissions: ['projects.view', 'projects.manage'],
        sees_all_projects: false,
      })
      .expect(201);

    // But not beyond it. This is the escalation route, and it has to stay shut.
    const refused = await test
      .http()
      .post('/v1/roles')
      .set(lead.auth)
      .send({
        name: 'Shadow owner',
        base_role: 'project_manager',
        permissions: ['tenant.manage', 'team.manage'],
        sees_all_projects: true,
      })
      .expect(403);
    expect(refused.body.message).toMatch(/do not hold yourself/i);
  });

  it('refuses a custom role based on owner', async () => {
    // Otherwise "create a narrow role" becomes a way to mint a second administrator.
    await test
      .http()
      .post('/v1/roles')
      .set(owner)
      .send({
        name: 'Co-owner',
        base_role: 'owner',
        permissions: ['projects.view'],
        sees_all_projects: true,
      })
      .expect(422);
  });

  it('refuses to delete a role somebody holds', async () => {
    const created = await test
      .http()
      .post('/v1/roles')
      .set(owner)
      .send({
        name: 'Occupied role',
        base_role: 'site_supervisor',
        permissions: ['projects.view'],
        sees_all_projects: false,
      })
      .expect(201);

    const person = await invite('site_supervisor', 'Occupier');
    await test
      .http()
      .patch(`/v1/roles/members/${person.id}`)
      .set(owner)
      .send({ role_id: created.body.id })
      .expect(204);

    const refused = await test
      .http()
      .delete(`/v1/roles/${created.body.id}`)
      .set(owner)
      .expect(409);
    expect(refused.body.message).toMatch(/Move them to another role/i);

    // Move them off, and the delete goes through.
    const roles = await test.http().get('/v1/roles').set(owner).expect(200);
    const supervisor = roles.body.find((r: { name: string }) => r.name === 'Site supervisor');
    await test
      .http()
      .patch(`/v1/roles/members/${person.id}`)
      .set(owner)
      .send({ role_id: supervisor.id })
      .expect(204);
    await test.http().delete(`/v1/roles/${created.body.id}`).set(owner).expect(204);
  });

  it('refuses to change your own role, and to demote the last owner', async () => {
    const me = await test.http().get('/v1/me').set(owner).expect(200);
    const roles = await test.http().get('/v1/roles').set(owner).expect(200);
    const supervisor = roles.body.find((r: { name: string }) => r.name === 'Site supervisor');

    // Both refusals protect the same thing: an account always has somebody who can fix it.
    const refused = await test
      .http()
      .patch(`/v1/roles/members/${me.body.user.id}`)
      .set(owner)
      .send({ role_id: supervisor.id })
      .expect(409);
    expect(refused.body.message).toMatch(/your own role/i);
  });

  it('enforces every permission the role editor offers', async () => {
    /*
     * The role editor shows a checkbox per permission, so each one has to actually gate
     * something. Routes that shipped without a `@Roles` decorator were initially converted
     * without a permission either, which made several of those boxes decorative: untick
     * "Take the roll call" and the supervisor could still take one.
     *
     * This walks a deliberately narrow role against one route per permission it lacks.
     */
    const narrow = await test
      .http()
      .post('/v1/roles')
      .set(owner)
      .send({
        name: 'Timekeeper',
        base_role: 'site_supervisor',
        // Attendance only. No DPR, no indents, no expenses, no workers.
        permissions: ['projects.view', 'attendance.view', 'attendance.record'],
        sees_all_projects: false,
      })
      .expect(201);

    const project = await test
      .http()
      .post('/v1/projects')
      .set(owner)
      .send({ name: 'Permission Probe Site' })
      .expect(201);

    // Assigned to the site, because this role sees only its own. Otherwise the refusals
    // below would be about project access rather than about permissions, and the test would
    // pass while proving nothing.
    const person = await invite('site_supervisor', 'Timekeeper Person', [project.body.id]);
    await test
      .http()
      .patch(`/v1/roles/members/${person.id}`)
      .set(owner)
      .send({ role_id: narrow.body.id })
      .expect(204);

    // Held: reading attendance.
    await test
      .http()
      .get(`/v1/attendance?project_id=${project.body.id}&date=2026-09-10`)
      .set(person.auth)
      .expect(200);

    // Not held: each of these is a checkbox left unticked, and each must refuse.
    const refusals: Array<[string, () => Promise<unknown>]> = [
      ['dpr.view', () => test.http().get('/v1/dpr').set(person.auth).expect(403)],
      ['workers.view', () => test.http().get('/v1/workers').set(person.auth).expect(403)],
      ['expenses.view', () => test.http().get('/v1/expenses').set(person.auth).expect(403)],
      [
        'indents.raise',
        () => test.http().get('/v1/indents').set(person.auth).expect(403),
      ],
      [
        'payments.view',
        () => test.http().get('/v1/labour-payments').set(person.auth).expect(403),
      ],
      [
        'wages.view',
        () => test.http().get('/v1/wage-periods').set(person.auth).expect(403),
      ],
      [
        'dpr.file',
        () =>
          test
            .http()
            .post('/v1/dpr')
            .set(person.auth)
            .send({ project_id: project.body.id, report_date: '2026-09-10', work_done: 'x' })
            .expect(403),
      ],
    ];
    for (const [, call] of refusals) await call();
  });

  it('hides role management from somebody without the permission', async () => {
    const supervisor = await invite('site_supervisor', 'No Access');
    await test.http().get('/v1/roles').set(supervisor.auth).expect(403);
    await test
      .http()
      .post('/v1/roles')
      .set(supervisor.auth)
      .send({
        name: 'Nope',
        base_role: 'site_supervisor',
        permissions: ['projects.view'],
        sees_all_projects: false,
      })
      .expect(403);
  });
});
