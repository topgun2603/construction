import {
  createTestApp,
  destroyTenant,
  onboardTenant,
  uniquePhone,
  type OnboardedTenant,
  type TestApp,
} from './utils/test-app';

/**
 * Tenancy isolation (spec §15: "a test that proves tenant A cannot read tenant B's
 * project is mandatory").
 *
 * Two builders are onboarded for real, each with a project, and then every avenue
 * by which A might reach B's data is tried: the REST API, a forged tenant id, and a
 * direct database read. The last one matters most — the API filters could be
 * deleted tomorrow and RLS must still hold the line.
 */
describe('tenancy isolation', () => {
  let test: TestApp;
  let alpha: OnboardedTenant;
  let beta: OnboardedTenant;
  let alphaProjectId: string;
  let betaProjectId: string;

  beforeAll(async () => {
    test = await createTestApp();

    alpha = await onboardTenant(test, {
      name: 'Alpha Constructions',
      phone: uniquePhone(),
      ownerName: 'Alpha Owner',
    });
    beta = await onboardTenant(test, {
      name: 'Beta Builders',
      phone: uniquePhone(),
      ownerName: 'Beta Owner',
    });

    alphaProjectId = await createProject(alpha, 'Alpha Tower');
    betaProjectId = await createProject(beta, 'Beta Residency');
  });

  afterAll(async () => {
    if (alpha) await destroyTenant(test, alpha.tenantId);
    if (beta) await destroyTenant(test, beta.tenantId);
    await test.close();
  });

  async function createProject(tenant: OnboardedTenant, name: string): Promise<string> {
    const response = await test
      .http()
      .post('/v1/projects')
      .set('Authorization', `Bearer ${tenant.accessToken}`)
      .send({ name, client_name: 'A Client', budget_amount: '50000000' })
      .expect(201);
    return response.body.id;
  }

  it('onboards two independent tenants', () => {
    expect(alpha.tenantId).not.toBe(beta.tenantId);
    expect(alphaProjectId).toBeDefined();
    expect(betaProjectId).toBeDefined();
  });

  it('does not list the other tenant’s projects', async () => {
    const response = await test
      .http()
      .get('/v1/projects')
      .set('Authorization', `Bearer ${alpha.accessToken}`)
      .expect(200);

    const ids = response.body.items.map((item: { id: string }) => item.id);
    expect(ids).toContain(alphaProjectId);
    expect(ids).not.toContain(betaProjectId);
  });

  it('returns 404, not 403, when reading the other tenant’s project by id', async () => {
    // 404 rather than 403 on purpose: a 403 would confirm the id exists somewhere,
    // which is an existence oracle across tenants.
    const response = await test
      .http()
      .get(`/v1/projects/${betaProjectId}`)
      .set('Authorization', `Bearer ${alpha.accessToken}`)
      .expect(404);

    expect(response.body.code).toBe('NOT_FOUND');
  });

  it('cannot write to the other tenant’s project', async () => {
    await test
      .http()
      .patch(`/v1/projects/${betaProjectId}`)
      .set('Authorization', `Bearer ${alpha.accessToken}`)
      .send({ name: 'Renamed by Alpha' })
      .expect(404);

    const stillThere = await test
      .http()
      .get(`/v1/projects/${betaProjectId}`)
      .set('Authorization', `Bearer ${beta.accessToken}`)
      .expect(200);
    expect(stillThere.body.name).toBe('Beta Residency');
  });

  it('ignores a tenant_id supplied in the request body', async () => {
    const response = await test
      .http()
      .post('/v1/projects')
      .set('Authorization', `Bearer ${alpha.accessToken}`)
      .send({ name: 'Smuggled', tenant_id: beta.tenantId })
      .expect(201);

    const visibleToBeta = await test
      .http()
      .get(`/v1/projects/${response.body.id}`)
      .set('Authorization', `Bearer ${beta.accessToken}`)
      .expect(404);
    expect(visibleToBeta.body.code).toBe('NOT_FOUND');
  });

  it('ignores a forged tenant header', async () => {
    const response = await test
      .http()
      .get('/v1/projects')
      .set('Authorization', `Bearer ${alpha.accessToken}`)
      .set('X-Tenant-Id', beta.tenantId)
      .expect(200);

    const ids = response.body.items.map((item: { id: string }) => item.id);
    expect(ids).not.toContain(betaProjectId);
  });

  it('does not leak the other tenant’s team', async () => {
    const response = await test
      .http()
      .get('/v1/tenants/current/team')
      .set('Authorization', `Bearer ${alpha.accessToken}`)
      .expect(200);

    const phones = response.body.map((member: { phone: string }) => member.phone);
    expect(phones).toContain(alpha.phone);
    expect(phones).not.toContain(beta.phone);
  });

  // --- the database-level guarantee ----------------------------------------

  it('enforces isolation in Postgres, not only in the API layer', async () => {
    const asAlpha = test.tenantDb.clientFor(alpha.tenantId);

    const betaProject = await asAlpha.project.findUnique({ where: { id: betaProjectId } });
    expect(betaProject).toBeNull();

    const all = await asAlpha.project.findMany({});
    expect(all.map((project) => project.id)).not.toContain(betaProjectId);

    // An explicit cross-tenant filter is refused by the policy's WITH CHECK too:
    // the update matches no rows rather than succeeding.
    const updated = await asAlpha.project.updateMany({
      where: { id: betaProjectId },
      data: { name: 'Overwritten' },
    });
    expect(updated.count).toBe(0);
  });

  it('returns no rows at all when the tenant context is never set', async () => {
    // FORCE ROW LEVEL SECURITY means even the table owner is filtered. Without
    // `app.tenant_id` the policy compares against NULL and nothing matches — an
    // untenanted query fails closed instead of returning the whole table.
    const rows = await test.prisma.project.findMany({ take: 5 });
    expect(rows).toHaveLength(0);
  });

  it('cannot insert a row carrying another tenant’s id', async () => {
    await expect(
      test.tenantDb.clientFor(alpha.tenantId).project.create({
        data: { tenantId: beta.tenantId, name: 'Planted' },
      }),
    ).rejects.toThrow();
  });
});
