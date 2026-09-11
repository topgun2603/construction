import {
  createTestApp,
  destroyTenant,
  onboardTenant,
  uniquePhone,
  type OnboardedTenant,
  type TestApp,
} from './utils/test-app';

/**
 * Project milestones — the site timeline (spec §7 `milestones`, §3 item 2).
 *
 * The interesting rules are about ordering and about scope: a timeline whose stages
 * can arrive out of sequence is useless to a site engineer, and a milestone must not
 * be reachable through a sibling project's URL.
 */
describe('milestones', () => {
  let test: TestApp;
  let tenant: OnboardedTenant;
  let ownerAuth: Record<string, string>;
  let projectId: string;
  let otherProjectId: string;

  beforeAll(async () => {
    test = await createTestApp();
    tenant = await onboardTenant(test, {
      name: 'Timeline Builders',
      phone: uniquePhone(),
    });
    ownerAuth = { Authorization: `Bearer ${tenant.accessToken}` };

    const make = async (name: string) => {
      const response = await test
        .http()
        .post('/v1/projects')
        .set(ownerAuth)
        .send({ name })
        .expect(201);
      return response.body.id as string;
    };
    projectId = await make('Lake View Villas');
    otherProjectId = await make('Hill Road Apartments');
  });

  afterAll(async () => {
    if (tenant) await destroyTenant(test, tenant.tenantId);
    await test.close();
  });

  async function addStage(name: string, plannedDate?: string) {
    const response = await test
      .http()
      .post(`/v1/projects/${projectId}/milestones`)
      .set(ownerAuth)
      .send({ name, ...(plannedDate ? { planned_date: plannedDate } : {}) })
      .expect(201);
    return response.body.id as string;
  }

  async function list(project = projectId) {
    const response = await test
      .http()
      .get(`/v1/projects/${project}/milestones`)
      .set(ownerAuth)
      .expect(200);
    return response.body as Array<{
      id: string;
      name: string;
      planned_date: string | null;
      actual_date: string | null;
      sort_order: number;
    }>;
  }

  it('adds a stage with a planned date and no actual date', async () => {
    const id = await addStage('Excavation', '2026-04-01');
    const stages = await list();
    const added = stages.find((stage) => stage.id === id);

    expect(added).toMatchObject({
      name: 'Excavation',
      planned_date: '2026-04-01',
      actual_date: null,
    });
  });

  it('marks a stage done and reopens it', async () => {
    const id = await addStage('Footing');

    const done = await test
      .http()
      .patch(`/v1/projects/${projectId}/milestones/${id}`)
      .set(ownerAuth)
      .send({ actual_date: '2026-04-20' })
      .expect(200);
    expect(done.body.actual_date).toBe('2026-04-20');

    // Clearing the date is a real edit, so null has to survive the round trip
    // rather than being treated as "field omitted".
    const reopened = await test
      .http()
      .patch(`/v1/projects/${projectId}/milestones/${id}`)
      .set(ownerAuth)
      .send({ actual_date: null })
      .expect(200);
    expect(reopened.body.actual_date).toBeNull();
  });

  it('renames a stage without touching its dates', async () => {
    const id = await addStage('Slab', '2026-05-10');
    const response = await test
      .http()
      .patch(`/v1/projects/${projectId}/milestones/${id}`)
      .set(ownerAuth)
      .send({ name: 'Slab casting — ground floor' })
      .expect(200);

    expect(response.body.name).toBe('Slab casting — ground floor');
    expect(response.body.planned_date).toBe('2026-05-10');
  });

  it('rejects a patch that names no fields', async () => {
    const id = await addStage('Plastering');
    await test
      .http()
      .patch(`/v1/projects/${projectId}/milestones/${id}`)
      .set(ownerAuth)
      .send({})
      .expect(422);
  });

  it('reorders the whole timeline and renumbers from zero', async () => {
    // A fresh project, so the ordering assertions are not disturbed by stages the
    // earlier tests added.
    const created = await test
      .http()
      .post('/v1/projects')
      .set(ownerAuth)
      .send({ name: 'Orchard Street Row' })
      .expect(201);
    const ordered = created.body.id as string;

    const names = ['Excavation', 'Footing', 'Slab', 'Brickwork'];
    for (const name of names) {
      await test
        .http()
        .post(`/v1/projects/${ordered}/milestones`)
        .set(ownerAuth)
        .send({ name })
        .expect(201);
    }

    const before = await test
      .http()
      .get(`/v1/projects/${ordered}/milestones`)
      .set(ownerAuth)
      .expect(200);
    const ids: string[] = before.body.map((stage: { id: string }) => stage.id);

    // Move the last stage to the front.
    const reversedFirst = [ids[3], ids[0], ids[1], ids[2]];
    await test
      .http()
      .patch(`/v1/projects/${ordered}/milestones/reorder`)
      .set(ownerAuth)
      .send({ milestone_ids: reversedFirst })
      .expect(204);

    const after = await test
      .http()
      .get(`/v1/projects/${ordered}/milestones`)
      .set(ownerAuth)
      .expect(200);
    expect(after.body.map((stage: { name: string }) => stage.name)).toEqual([
      'Brickwork',
      'Excavation',
      'Footing',
      'Slab',
    ]);
    // Contiguous from zero, so the next insert cannot collide with an existing slot.
    expect(after.body.map((stage: { sort_order: number }) => stage.sort_order)).toEqual([
      0, 1, 2, 3,
    ]);
  });

  it('refuses a reorder that does not list every stage', async () => {
    const id = await addStage('Painting');
    await test
      .http()
      .patch(`/v1/projects/${projectId}/milestones/reorder`)
      .set(ownerAuth)
      .send({ milestone_ids: [id] })
      .expect(422);
  });

  it('removes a stage from the timeline', async () => {
    const id = await addStage('Temporary stage');
    await test
      .http()
      .delete(`/v1/projects/${projectId}/milestones/${id}`)
      .set(ownerAuth)
      .expect(204);

    expect((await list()).some((stage) => stage.id === id)).toBe(false);

    // Soft deleted, so the second delete is a 404 rather than a silent success.
    await test
      .http()
      .delete(`/v1/projects/${projectId}/milestones/${id}`)
      .set(ownerAuth)
      .expect(404);
  });

  it('will not reach a milestone through a sibling project', async () => {
    const id = await addStage('Waterproofing');

    // Same tenant, so RLS permits the row; the project scope is what must refuse it.
    await test
      .http()
      .patch(`/v1/projects/${otherProjectId}/milestones/${id}`)
      .set(ownerAuth)
      .send({ name: 'Hijacked' })
      .expect(404);

    await test
      .http()
      .delete(`/v1/projects/${otherProjectId}/milestones/${id}`)
      .set(ownerAuth)
      .expect(404);

    expect((await list()).find((stage) => stage.id === id)?.name).toBe('Waterproofing');
    expect((await list(otherProjectId)).some((stage) => stage.id === id)).toBe(false);
  });
});
