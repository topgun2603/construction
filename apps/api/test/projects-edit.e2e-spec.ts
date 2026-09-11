import {
  createTestApp,
  destroyTenant,
  onboardTenant,
  uniquePhone,
  type OnboardedTenant,
  type TestApp,
} from './utils/test-app';

/**
 * Editing a site.
 *
 * The property worth pinning is that a PATCH touches only what it names. The edit dialog sends just
 * the changed fields, and on a site several people manage, a patch that carried every value would
 * quietly overwrite whatever a colleague changed while the dialog sat open.
 */
describe('editing a site', () => {
  let test: TestApp;
  let tenant: OnboardedTenant;
  let owner: Record<string, string>;
  let projectId: string;

  beforeAll(async () => {
    test = await createTestApp();
    tenant = await onboardTenant(test, { name: 'Edit Builders', phone: uniquePhone() });
    owner = { Authorization: `Bearer ${tenant.accessToken}` };

    const created = await test
      .http()
      .post('/v1/projects')
      .set(owner)
      .send({
        name: 'Original Name',
        client_name: 'Original Client',
        address: 'Original Address',
        start_date: '2026-01-01',
        target_end_date: '2026-12-31',
        budget_amount: '5000000',
      })
      .expect(201);
    projectId = created.body.id;
  });

  afterAll(async () => {
    if (tenant) await destroyTenant(test, tenant.tenantId);
    await test.close();
  });

  it('changes only the field it names', async () => {
    const response = await test
      .http()
      .patch(`/v1/projects/${projectId}`)
      .set(owner)
      .send({ name: 'Renamed Site' })
      .expect(200);

    expect(response.body.name).toBe('Renamed Site');
    // Everything else survives untouched — this is the whole point of sending a partial patch.
    expect(response.body.client_name).toBe('Original Client');
    expect(response.body.address).toBe('Original Address');
    expect(response.body.start_date).toBe('2026-01-01');
    expect(response.body.budget_amount).toBe('5000000');
  });

  it('clears a field when explicitly sent null', async () => {
    // Distinct from omitting the key: "the address we had was wrong" is a real edit.
    const response = await test
      .http()
      .patch(`/v1/projects/${projectId}`)
      .set(owner)
      .send({ address: null })
      .expect(200);
    expect(response.body.address).toBeNull();
    expect(response.body.client_name).toBe('Original Client');
  });

  it('sets a location on a site that never had one', async () => {
    const response = await test
      .http()
      .patch(`/v1/projects/${projectId}`)
      .set(owner)
      .send({ lat: 12.9698, lng: 77.75, address: 'Whitefield Main Road' })
      .expect(200);
    expect(response.body.lat).toBeCloseTo(12.9698, 4);
    expect(response.body.lng).toBeCloseTo(77.75, 4);
  });

  it('puts a site on hold and back', async () => {
    const held = await test
      .http()
      .patch(`/v1/projects/${projectId}`)
      .set(owner)
      .send({ status: 'on_hold' })
      .expect(200);
    expect(held.body.status).toBe('on_hold');

    const resumed = await test
      .http()
      .patch(`/v1/projects/${projectId}`)
      .set(owner)
      .send({ status: 'active' })
      .expect(200);
    expect(resumed.body.status).toBe('active');
  });

  it('refuses an empty patch and an out-of-range coordinate', async () => {
    await test.http().patch(`/v1/projects/${projectId}`).set(owner).send({}).expect(422);
    await test
      .http()
      .patch(`/v1/projects/${projectId}`)
      .set(owner)
      .send({ lat: 200, lng: 77 })
      .expect(422);
  });

  it('refuses somebody without projects.manage', async () => {
    const phone = uniquePhone();
    await test
      .http()
      .post('/v1/tenants/current/invite')
      .set(owner)
      .send({ phone, name: 'Site Supervisor', role: 'site_supervisor', project_ids: [projectId] })
      .expect(201);
    const login = await test
      .http()
      .post('/v1/auth/exchange')
      .send({ firebase_token: `dev:${phone}` })
      .expect(200);

    await test
      .http()
      .patch(`/v1/projects/${projectId}`)
      .set({ Authorization: `Bearer ${login.body.access_token}` })
      .send({ name: 'Not allowed' })
      .expect(403);
  });
});
