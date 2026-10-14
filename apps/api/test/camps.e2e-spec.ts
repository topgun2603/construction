import { todayIn } from '@sitebook/shared';
import {
  createTestApp,
  destroyTenant,
  onboardTenant,
  uniquePhone,
  type OnboardedTenant,
  type TestApp,
} from './utils/test-app';

/**
 * Labour camps (roadmap Phase 1, item 4): who lives where, and the day's bus loads worked out from
 * the roll call.
 */
describe('labour camps', () => {
  let test: TestApp;
  let alpha: OnboardedTenant;
  let beta: OnboardedTenant;
  let auth: { Authorization: string };
  let campId: string;
  let workers: string[];
  let marina: string;
  let jumeirah: string;
  const today = todayIn('Asia/Kolkata');

  beforeAll(async () => {
    test = await createTestApp();
    alpha = await onboardTenant(test, { name: 'Camp Builders', phone: uniquePhone() });
    beta = await onboardTenant(test, { name: 'Other Builders', phone: uniquePhone() });
    auth = { Authorization: `Bearer ${alpha.accessToken}` };

    const site = async (name: string) =>
      (
        await test
          .http()
          .post('/v1/projects')
          .set(auth)
          .send({ name, status: 'active' })
          .expect(201)
      ).body.id as string;
    marina = await site('Marina Tower');
    jumeirah = await site('Jumeirah Villas');
    workers = [];
    for (const name of ['Ram', 'Hari', 'Shyam', 'Local Ali']) {
      workers.push(
        (
          await test
            .http()
            .post('/v1/workers')
            .set(auth)
            .send({ name, daily_wage: '15000' })
            .expect(201)
        ).body.id,
      );
    }
  });

  afterAll(async () => {
    await destroyTenant(test, alpha.tenantId);
    await destroyTenant(test, beta.tenantId);
    await test.close();
  });

  it('houses workers in a camp and counts today’s loads by site', async () => {
    campId = (
      await test
        .http()
        .post('/v1/camps')
        .set(auth)
        .send({ name: 'Al Quoz Camp 2', capacity: 400, transport_note: 'Bus 3' })
        .expect(201)
    ).body.id;
    await test
      .http()
      .post(`/v1/camps/${campId}/residents`)
      .set(auth)
      .send({ worker_ids: workers.slice(0, 3) })
      .expect(201);

    // Two from the camp to Marina, one to Jumeirah, and a local hire with no camp at Marina.
    const roll = (project: string, ids: string[]) =>
      test
        .http()
        .post('/v1/attendance')
        .set(auth)
        .send({
          project_id: project,
          attendance_date: today,
          rows: ids.map((id) => ({ worker_id: id, status: 'present' })),
        })
        .expect(201);
    await roll(marina, [workers[0]!, workers[1]!, workers[3]!]);
    await roll(jumeirah, [workers[2]!]);

    const { body } = await test.http().get(`/v1/camps?date=${today}`).set(auth).expect(200);
    const camp = body.camps.find((c: { id: string }) => c.id === campId);
    expect(camp).toMatchObject({ residents: 3, on_site: 3, transport_note: 'Bus 3' });
    expect(camp.by_site).toEqual([
      { project_id: marina, project_name: 'Marina Tower', count: 2 },
      { project_id: jumeirah, project_name: 'Jumeirah Villas', count: 1 },
    ]);
    expect(body.unhoused_on_site).toBe(1);
  });

  it('leaves residents unassigned when a camp is archived', async () => {
    await test.http().delete(`/v1/camps/${campId}`).set(auth).expect(204);
    const { body } = await test.http().get('/v1/camps').set(auth).expect(200);
    expect(body.camps).toEqual([]);
    const ram = await test.tenantDb.transaction(alpha.tenantId, (tx) =>
      tx.worker.findUniqueOrThrow({ where: { id: workers[0]! }, select: { campId: true } }),
    );
    expect(ram.campId).toBeNull();
  });

  it('never shows one company another company’s camps', async () => {
    const other = { Authorization: `Bearer ${beta.accessToken}` };
    const { body } = await test.http().get('/v1/camps').set(other).expect(200);
    expect(body.camps).toEqual([]);
    await test
      .http()
      .post(`/v1/camps/${campId}/residents`)
      .set(other)
      .send({ worker_ids: [workers[0]] })
      .expect(404);
  });
});
