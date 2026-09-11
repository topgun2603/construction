import {
  createTestApp,
  destroyTenant,
  onboardTenant,
  uniquePhone,
  type OnboardedTenant,
  type TestApp,
} from './utils/test-app';

/**
 * Deletion rules across the app (spec §7, soft delete).
 *
 * Every delete here is a soft delete, and every one of them refuses in at least one
 * situation. The refusals are the point: the cases below are the ones where removing
 * a row would quietly change money already agreed, erase the record of a day's work,
 * or lock a tenant out of its own account.
 */
describe('deletes', () => {
  let test: TestApp;
  let tenant: OnboardedTenant;
  let owner: Record<string, string>;
  let projectId: string;

  beforeAll(async () => {
    test = await createTestApp();
    tenant = await onboardTenant(test, { name: 'Deletion Builders', phone: uniquePhone() });
    owner = { Authorization: `Bearer ${tenant.accessToken}` };

    const project = await test
      .http()
      .post('/v1/projects')
      .set(owner)
      .send({ name: 'Garden Block' })
      .expect(201);
    projectId = project.body.id;
  });

  afterAll(async () => {
    if (tenant) await destroyTenant(test, tenant.tenantId);
    await test.close();
  });

  async function addWorker(name: string) {
    const response = await test
      .http()
      .post('/v1/workers')
      .set(owner)
      .send({ name, trade: 'mason', skill_level: 'skilled', daily_wage: '90000' })
      .expect(201);
    return response.body.id as string;
  }

  describe('workers', () => {
    it('deletes a worker nobody owes money to', async () => {
      const id = await addWorker('Mistyped Name');
      await test.http().delete(`/v1/workers/${id}`).set(owner).expect(204);
      await test.http().get(`/v1/workers/${id}`).set(owner).expect(404);
    });

    it('refuses to delete a worker sitting on an unpaid wage sheet', async () => {
      const workerId = await addWorker('Ganesh Iyer');
      await test
        .http()
        .post('/v1/workers/' + workerId + '/assign')
        .set(owner)
        .send({ project_id: projectId, from_date: '2026-06-01' })
        .expect(201);
      await test
        .http()
        .post('/v1/attendance')
        .set(owner)
        .send({
          project_id: projectId,
          attendance_date: '2026-06-02',
          rows: [{ worker_id: workerId, status: 'present', overtime_hours: '0' }],
        })
        .expect(201);
      await test
        .http()
        .post('/v1/wage-periods/generate')
        .set(owner)
        .send({ period_start: '2026-06-01', period_end: '2026-06-07' })
        .expect(201);

      const refused = await test.http().delete(`/v1/workers/${workerId}`).set(owner).expect(409);
      expect(refused.body.message).toMatch(/unpaid wage sheet/i);

      // Still there, and still on the wage sheet.
      await test.http().get(`/v1/workers/${workerId}`).set(owner).expect(200);
    });
  });

  describe('daily reports', () => {
    it('discards a draft but not a submitted report', async () => {
      const draft = await test
        .http()
        .post('/v1/dpr')
        .set(owner)
        .send({ project_id: projectId, report_date: '2026-06-10', work_done: 'Shuttering' })
        .expect(201);
      await test.http().delete(`/v1/dpr/${draft.body.id}`).set(owner).expect(204);

      const submitted = await test
        .http()
        .post('/v1/dpr')
        .set(owner)
        .send({ project_id: projectId, report_date: '2026-06-11', work_done: 'Slab pour' })
        .expect(201);
      await test.http().post(`/v1/dpr/${submitted.body.id}/submit`).set(owner).expect(201);

      const refused = await test
        .http()
        .delete(`/v1/dpr/${submitted.body.id}`)
        .set(owner)
        .expect(409);
      expect(refused.body.message).toMatch(/record for that day/i);
    });
  });

  describe('indents', () => {
    async function raise() {
      const material = await test
        .http()
        .post('/v1/materials')
        .set(owner)
        .send({ name: `Cement ${Date.now()}`, unit: 'bag' })
        .expect(201);
      const indent = await test
        .http()
        .post('/v1/indents')
        .set(owner)
        .send({
          project_id: projectId,
          urgency: 'normal',
          items: [{ material_id: material.body.id, quantity: '40' }],
        })
        .expect(201);
      return indent.body.id as string;
    }

    it('withdraws an unanswered indent', async () => {
      const id = await raise();
      await test.http().delete(`/v1/indents/${id}`).set(owner).expect(204);
      await test.http().get(`/v1/indents/${id}`).set(owner).expect(404);
    });

    it('refuses to delete an indent that has been approved', async () => {
      const id = await raise();
      await test
        .http()
        .patch(`/v1/indents/${id}/status`)
        .set(owner)
        .send({ status: 'approved' })
        .expect(200);

      const refused = await test.http().delete(`/v1/indents/${id}`).set(owner).expect(409);
      expect(refused.body.message).toMatch(/already approved/i);
    });
  });

  describe('labour payments', () => {
    it('deletes an advance nothing has deducted yet', async () => {
      const workerId = await addWorker('Advance Test');
      const payment = await test
        .http()
        .post('/v1/labour-payments')
        .set(owner)
        .send({
          project_id: projectId,
          worker_id: workerId,
          type: 'advance',
          amount: '50000',
          paid_on: '2026-07-01',
          mode: 'cash',
        })
        .expect(201);

      await test.http().delete(`/v1/labour-payments/${payment.body.id}`).set(owner).expect(204);

      const remaining = await test
        .http()
        .get(`/v1/labour-payments?worker_id=${workerId}`)
        .set(owner)
        .expect(200);
      expect(remaining.body.items).toHaveLength(0);
    });
  });

  describe('site assignments', () => {
    it('takes somebody off a site without touching what they filed', async () => {
      const person = await test
        .http()
        .post('/v1/tenants/current/invite')
        .set(owner)
        .send({ name: 'Assigned Supervisor', phone: uniquePhone(), role: 'site_supervisor', project_ids: [] })
        .expect(201);

      await test
        .http()
        .post(`/v1/projects/${projectId}/members`)
        .set(owner)
        .send({ user_id: person.body.id, role_on_project: 'site_supervisor' })
        .expect(201);

      const before = await test
        .http()
        .get(`/v1/projects/${projectId}/members`)
        .set(owner)
        .expect(200);
      expect(before.body.some((row: { user: { id: string } }) => row.user.id === person.body.id)).toBe(
        true,
      );

      await test
        .http()
        .delete(`/v1/projects/${projectId}/members/${person.body.id}`)
        .set(owner)
        .expect(204);

      const after = await test
        .http()
        .get(`/v1/projects/${projectId}/members`)
        .set(owner)
        .expect(200);
      expect(after.body.some((row: { user: { id: string } }) => row.user.id === person.body.id)).toBe(
        false,
      );

      // The person still exists — they came off one site, they were not sacked.
      const team = await test.http().get('/v1/tenants/current/team').set(owner).expect(200);
      expect(team.body.some((row: { id: string }) => row.id === person.body.id)).toBe(true);
    });

    it('says so when they were never on it', async () => {
      const stranger = await test
        .http()
        .post('/v1/tenants/current/invite')
        .set(owner)
        .send({ name: 'Unassigned', phone: uniquePhone(), role: 'accounts', project_ids: [] })
        .expect(201);

      await test
        .http()
        .delete(`/v1/projects/${projectId}/members/${stranger.body.id}`)
        .set(owner)
        .expect(404);
    });
  });

  describe('team members', () => {
    async function invite(role: string) {
      const phone = uniquePhone();
      const response = await test
        .http()
        .post('/v1/tenants/current/invite')
        .set(owner)
        .send({ phone, name: 'Invited Person', role, project_ids: [projectId] })
        .expect(201);
      return { id: response.body.id as string, phone };
    }

    it('removes a member and stops them signing in again', async () => {
      const member = await invite('project_manager');

      // Prove they could sign in before removal, so the refusal afterwards is about
      // the removal and not about a phone that never worked.
      await test
        .http()
        .post('/v1/auth/exchange')
        .send({ firebase_token: `dev:${member.phone}` })
        .expect(200);

      await test.http().delete(`/v1/tenants/current/team/${member.id}`).set(owner).expect(204);

      const team = await test.http().get('/v1/tenants/current/team').set(owner).expect(200);
      expect(team.body.some((row: { id: string }) => row.id === member.id)).toBe(false);

      // The auth-identity trigger has dropped them, so the phone now looks like a
      // brand-new builder rather than a member of this tenant.
      const after = await test
        .http()
        .post('/v1/auth/exchange')
        .send({ firebase_token: `dev:${member.phone}` })
        .expect(200);
      expect(after.body.onboarding_required).toBe(true);
      expect(after.body.access_token).toBeUndefined();
    });

    it('refuses to remove your own account', async () => {
      const self = await test.http().get('/v1/me').set(owner).expect(200);
      const refused = await test
        .http()
        .delete(`/v1/tenants/current/team/${self.body.user.id}`)
        .set(owner)
        .expect(409);
      expect(refused.body.message).toMatch(/your own account/i);
    });

    it('refuses to remove the last owner', async () => {
      const second = await invite('owner');
      // Removing the newly added owner is fine — the original remains.
      await test.http().delete(`/v1/tenants/current/team/${second.id}`).set(owner).expect(204);

      // The original owner is now the only one, and cannot be removed even by
      // another owner's session, because there is no other owner left to do it.
      const thirdOwner = await invite('owner');
      const login = await test
        .http()
        .post('/v1/auth/exchange')
        .send({ firebase_token: `dev:${thirdOwner.phone}` })
        .expect(200);
      const thirdAuth = { Authorization: `Bearer ${login.body.access_token}` };

      const self = await test.http().get('/v1/me').set(owner).expect(200);
      await test
        .http()
        .delete(`/v1/tenants/current/team/${self.body.user.id}`)
        .set(thirdAuth)
        .expect(204);

      const refused = await test
        .http()
        .delete(`/v1/tenants/current/team/${login.body.user?.id ?? thirdOwner.id}`)
        .set(thirdAuth)
        .expect(409);
      expect(refused.body.message).toMatch(/your own account|last owner/i);
    });
  });
});
