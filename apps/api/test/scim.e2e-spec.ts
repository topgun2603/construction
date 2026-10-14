// Must come first: the SSO settings have to be in the environment before the app loads `env()`.
import { restoreSsoEnv } from './utils/sso-env';
import { randomBytes } from 'node:crypto';
import { promises as dns } from 'node:dns';
import {
  createTestApp,
  destroyTenant,
  onboardTenant,
  uniquePhone,
  type OnboardedTenant,
  type TestApp,
} from './utils/test-app';

const SCIM_USER = 'urn:ietf:params:scim:schemas:core:2.0:User';
const SCIM_GROUP = 'urn:ietf:params:scim:schemas:core:2.0:Group';
const SCIM_PATCH = 'urn:ietf:params:scim:api:messages:2.0:PatchOp';
const SCIM_LIST = 'urn:ietf:params:scim:api:messages:2.0:ListResponse';

/**
 * SCIM 2.0 provisioning, driven the way Microsoft Entra ID and Okta drive it: a bearer token per
 * company, users created, found by `userName`, patched (Entra's capitalised ops and string
 * booleans, Okta's path-less replace), switched off — never deleted — and groups mapped to roles.
 */
describe('SCIM provisioning', () => {
  let test: TestApp;
  let owner: OnboardedTenant;
  let other: OnboardedTenant;
  let token: string;
  let otherToken: string;
  let domain: string;
  const tenants: string[] = [];

  const auth = (tenant: { accessToken: string }) => ({ Authorization: `Bearer ${tenant.accessToken}` });
  const scim = (bearer: string) => ({ Authorization: `Bearer ${bearer}`, 'Content-Type': 'application/scim+json' });

  async function prepare(name: string): Promise<{ tenant: OnboardedTenant; token: string; domain: string }> {
    const tenant = await onboardTenant(test, { name, phone: uniquePhone() });
    tenants.push(tenant.tenantId);
    const claimed = `${name.toLowerCase().replace(/\W+/g, '')}-${randomBytes(4).toString('hex')}.example`;
    const added = await test.http().post('/v1/sso/domains').set(auth(tenant)).send({ domain: claimed }).expect(201);
    jest.spyOn(dns, 'resolveTxt').mockResolvedValueOnce([[added.body.domains[0].txt_value]]);
    await test.http().post(`/v1/sso/domains/${added.body.domains[0].id}/verify`).set(auth(tenant)).expect(200);

    const settings = await test.http().get('/v1/sso/settings').set(auth(tenant)).expect(200);
    const supervisor = settings.body.roles.find((role: { base_role: string }) => role.base_role === 'site_supervisor');
    // SAML, left off: provisioning only needs the default role, not a working sign-in.
    await test
      .http()
      .put('/v1/sso/connection')
      .set(auth(tenant))
      .send({ protocol: 'saml', enabled: false, jit_role_id: supervisor.id })
      .expect(200);

    const minted = await test.http().post('/v1/sso/scim-token').set(auth(tenant)).expect(201);
    return { tenant, token: minted.body.token, domain: claimed };
  }

  beforeAll(async () => {
    test = await createTestApp();
    ({ tenant: owner, token, domain } = await prepare('Scim Main'));
    ({ tenant: other, token: otherToken } = await prepare('Scim Other'));
  });

  afterAll(async () => {
    for (const id of tenants) await destroyTenant(test, id);
    await test.close();
    restoreSsoEnv();
  });

  afterEach(() => jest.restoreAllMocks());

  function createUser(email: string, extra: Record<string, unknown> = {}) {
    return test
      .http()
      .post('/v1/scim/v2/Users')
      .set(scim(token))
      .send({
        schemas: [SCIM_USER],
        userName: email,
        name: { givenName: 'Aisha', familyName: 'Rahman' },
        emails: [{ value: email, type: 'work', primary: true }],
        active: true,
        externalId: `ext-${email}`,
        ...extra,
      });
  }

  it('refuses a missing, wrong or revoked token', async () => {
    await test.http().get('/v1/scim/v2/Users').expect(401);
    const wrong = await test.http().get('/v1/scim/v2/Users').set(scim('scim_not-a-real-token')).expect(401);
    expect(wrong.body.schemas).toEqual(['urn:ietf:params:scim:api:messages:2.0:Error']);
    expect(wrong.body.status).toBe('401');

    // Rotating makes the old token stop working at once.
    const rotated = await test.http().post('/v1/sso/scim-token').set(auth(owner)).expect(201);
    await test.http().get('/v1/scim/v2/Users').set(scim(token)).expect(401);
    token = rotated.body.token;
    await test.http().get('/v1/scim/v2/Users').set(scim(token)).expect(200);

    // Only the hash is stored.
    const stored = await test.tenantDb.transaction(owner.tenantId, (tx) => tx.scimToken.findMany());
    expect(stored.every((row) => row.tokenHash !== token && row.tokenHash.length === 64)).toBe(true);
  });

  it('describes itself', async () => {
    const config = await test.http().get('/v1/scim/v2/ServiceProviderConfig').set(scim(token)).expect(200);
    expect(config.body.patch.supported).toBe(true);
    expect(config.headers['content-type']).toMatch(/application\/scim\+json/);
  });

  it('creates a user, finds them by userName, and refuses a duplicate as `uniqueness`', async () => {
    const email = `aisha@${domain}`;
    const created = await createUser(email).expect(201);
    expect(created.body).toMatchObject({
      schemas: [SCIM_USER],
      userName: email,
      active: true,
      externalId: `ext-${email}`,
      name: { givenName: 'Aisha', familyName: 'Rahman' },
      emails: [{ value: email, primary: true }],
    });
    expect(created.body.meta.location).toContain(`/scim/v2/Users/${created.body.id}`);

    const user = await test.tenantDb.transaction(owner.tenantId, (tx) =>
      tx.user.findUniqueOrThrow({ where: { id: created.body.id } }),
    );
    expect(user).toMatchObject({ email, name: 'Aisha Rahman', role: 'site_supervisor', status: 'pending' });

    const found = await test
      .http()
      .get('/v1/scim/v2/Users')
      .query({ filter: `userName eq "${email.toUpperCase()}"` })
      .set(scim(token))
      .expect(200);
    expect(found.body).toMatchObject({ schemas: [SCIM_LIST], totalResults: 1, startIndex: 1, itemsPerPage: 1 });
    expect(found.body.Resources[0].id).toBe(created.body.id);

    const duplicate = await createUser(email).expect(409);
    expect(duplicate.body.scimType).toBe('uniqueness');

    const badFilter = await test.http().get('/v1/scim/v2/Users').query({ filter: 'userName sw "a"' }).set(scim(token)).expect(400);
    expect(badFilter.body.scimType).toBe('invalidFilter');
  });

  it('refuses an address on a domain the company has not verified', async () => {
    const refused = await createUser(`someone@unverified-${randomBytes(3).toString('hex')}.example`).expect(400);
    expect(refused.body.scimType).toBe('invalidValue');
  });

  it('pages through users', async () => {
    for (let index = 0; index < 3; index += 1) await createUser(`page${index}@${domain}`).expect(201);
    const first = await test.http().get('/v1/scim/v2/Users').query({ startIndex: 1, count: 2 }).set(scim(token)).expect(200);
    expect(first.body.itemsPerPage).toBe(2);
    expect(first.body.totalResults).toBeGreaterThanOrEqual(4);
    const second = await test.http().get('/v1/scim/v2/Users').query({ startIndex: 3, count: 2 }).set(scim(token)).expect(200);
    expect(second.body.startIndex).toBe(3);
    const ids = new Set([...first.body.Resources, ...second.body.Resources].map((row: { id: string }) => row.id));
    expect(ids.size).toBe(first.body.Resources.length + second.body.Resources.length);
  });

  it('patches the way Entra ID does: capitalised ops and string booleans, ending in deactivation', async () => {
    const created = await createUser(`entra@${domain}`).expect(201);
    const id = created.body.id;

    const renamed = await test
      .http()
      .patch(`/v1/scim/v2/Users/${id}`)
      .set(scim(token))
      .send({
        schemas: [SCIM_PATCH],
        Operations: [
          { op: 'Replace', path: 'name.givenName', value: 'Fatima' },
          { op: 'Replace', path: 'emails[type eq "work"].value', value: `fatima@${domain}` },
          { op: 'Add', path: 'urn:ietf:params:scim:schemas:extension:enterprise:2.0:User:department', value: 'Site' },
        ],
      })
      .expect(200);
    expect(renamed.body).toMatchObject({ userName: `fatima@${domain}`, name: { givenName: 'Fatima', familyName: 'Rahman' } });

    // A session the person already has, which switching them off must end.
    await test.tenantDb.transaction(owner.tenantId, (tx) =>
      tx.refreshToken.create({
        data: { tenantId: owner.tenantId, userId: id, tokenHash: randomBytes(32).toString('hex'), expiresAt: new Date(Date.now() + 86_400_000) },
      }),
    );

    const off = await test
      .http()
      .patch(`/v1/scim/v2/Users/${id}`)
      .set(scim(token))
      .send({ schemas: [SCIM_PATCH], Operations: [{ op: 'Replace', path: 'active', value: 'False' }] })
      .expect(200);
    expect(off.body.active).toBe(false);

    const row = await test.tenantDb.transaction(owner.tenantId, async (tx) => ({
      user: await tx.user.findUniqueOrThrow({ where: { id } }),
      live: await tx.refreshToken.count({ where: { userId: id, revokedAt: null } }),
      logged: await tx.auditLog.count({ where: { action: 'scim.user_deactivated', entityId: id } }),
    }));
    expect(row.user.status).toBe('disabled');
    expect(row.user.deletedAt).toBeNull();
    expect(row.live).toBe(0);
    expect(row.logged).toBe(1);

    // And back on.
    const on = await test
      .http()
      .patch(`/v1/scim/v2/Users/${id}`)
      .set(scim(token))
      .send({ schemas: [SCIM_PATCH], Operations: [{ op: 'replace', value: { active: true } }] })
      .expect(200);
    expect(on.body.active).toBe(true);
  });

  it('switches a user off with Okta’s path-less replace, PUT, and DELETE — and never deletes them', async () => {
    const okta = await createUser(`okta@${domain}`).expect(201);
    const patched = await test
      .http()
      .patch(`/v1/scim/v2/Users/${okta.body.id}`)
      .set(scim(token))
      .send({ schemas: [SCIM_PATCH], Operations: [{ op: 'replace', value: { active: false } }] })
      .expect(200);
    expect(patched.body.active).toBe(false);

    const put = await createUser(`put@${domain}`).expect(201);
    const replaced = await test
      .http()
      .put(`/v1/scim/v2/Users/${put.body.id}`)
      .set(scim(token))
      .send({ schemas: [SCIM_USER], userName: `put@${domain}`, name: { formatted: 'Put Person' }, active: false })
      .expect(200);
    expect(replaced.body).toMatchObject({ displayName: 'Put Person', active: false });

    const gone = await createUser(`delete@${domain}`).expect(201);
    await test.http().delete(`/v1/scim/v2/Users/${gone.body.id}`).set(scim(token)).expect(204);
    const kept = await test.tenantDb.transaction(owner.tenantId, (tx) =>
      tx.user.findUniqueOrThrow({ where: { id: gone.body.id } }),
    );
    expect(kept).toMatchObject({ status: 'disabled', deletedAt: null });
    const fetched = await test.http().get(`/v1/scim/v2/Users/${gone.body.id}`).set(scim(token)).expect(200);
    expect(fetched.body.active).toBe(false);
  });

  it('will not switch off an owner', async () => {
    await test.tenantDb.transaction(owner.tenantId, (tx) =>
      tx.user.update({ where: { id: owner.ownerId }, data: { email: `owner@${domain}` } }),
    );
    const refused = await test
      .http()
      .patch(`/v1/scim/v2/Users/${owner.ownerId}`)
      .set(scim(token))
      .send({ schemas: [SCIM_PATCH], Operations: [{ op: 'replace', path: 'active', value: false }] })
      .expect(400);
    expect(refused.body.scimType).toBe('mutability');
    await test.http().delete(`/v1/scim/v2/Users/${owner.ownerId}`).set(scim(token)).expect(400);
  });

  it('maps groups to roles, never to an owner', async () => {
    const settings = await test.http().get('/v1/sso/settings').set(auth(owner)).expect(200);
    const manager = settings.body.roles.find((role: { base_role: string }) => role.base_role === 'project_manager');
    expect(settings.body.roles.some((role: { base_role: string }) => role.base_role === 'owner')).toBe(false);
    await test
      .http()
      .post('/v1/sso/role-mappings')
      .set(auth(owner))
      .send({ group_name: 'BUILDR Managers', role_id: manager.id })
      .expect(201);

    const person = await createUser(`grouped@${domain}`).expect(201);
    const group = await test
      .http()
      .post('/v1/scim/v2/Groups')
      .set(scim(token))
      .send({ schemas: [SCIM_GROUP], displayName: 'BUILDR Managers', members: [] })
      .expect(201);

    await test
      .http()
      .patch(`/v1/scim/v2/Groups/${group.body.id}`)
      .set(scim(token))
      .send({
        schemas: [SCIM_PATCH],
        Operations: [{ op: 'Add', path: 'members', value: [{ value: person.body.id }] }],
      })
      .expect(200);

    const promoted = await test.tenantDb.transaction(owner.tenantId, (tx) =>
      tx.user.findUniqueOrThrow({ where: { id: person.body.id } }),
    );
    expect(promoted).toMatchObject({ role: 'project_manager', roleId: manager.id });

    const listed = await test
      .http()
      .get('/v1/scim/v2/Groups')
      .query({ filter: 'displayName eq "BUILDR Managers"' })
      .set(scim(token))
      .expect(200);
    expect(listed.body.Resources[0].members).toEqual([expect.objectContaining({ value: person.body.id })]);

    await test
      .http()
      .patch(`/v1/scim/v2/Groups/${group.body.id}`)
      .set(scim(token))
      .send({
        schemas: [SCIM_PATCH],
        Operations: [{ op: 'Remove', path: `members[value eq "${person.body.id}"]` }],
      })
      .expect(200);
    const emptied = await test.http().get(`/v1/scim/v2/Groups/${group.body.id}`).set(scim(token)).expect(200);
    expect(emptied.body.members).toEqual([]);

    // An owner role cannot be mapped at all.
    const ownerRole = await test.tenantDb.transaction(owner.tenantId, (tx) =>
      tx.role.findFirstOrThrow({ where: { baseRole: 'owner' }, select: { id: true } }),
    );
    await test
      .http()
      .post('/v1/sso/role-mappings')
      .set(auth(owner))
      .send({ group_name: 'Owners', role_id: ownerRole.id })
      .expect(422);

    await test.http().delete(`/v1/scim/v2/Groups/${group.body.id}`).set(scim(token)).expect(204);
  });

  it('keeps each company’s token to its own company', async () => {
    const mine = await createUser(`isolated@${domain}`).expect(201);
    await test.http().get(`/v1/scim/v2/Users/${mine.body.id}`).set(scim(otherToken)).expect(404);
    await test
      .http()
      .patch(`/v1/scim/v2/Users/${mine.body.id}`)
      .set(scim(otherToken))
      .send({ schemas: [SCIM_PATCH], Operations: [{ op: 'replace', path: 'active', value: false }] })
      .expect(404);
    const theirs = await test
      .http()
      .get('/v1/scim/v2/Users')
      .query({ filter: `userName eq "isolated@${domain}"` })
      .set(scim(otherToken))
      .expect(200);
    expect(theirs.body.totalResults).toBe(0);
    // And the other company cannot create people on this company's domain.
    await test
      .http()
      .post('/v1/scim/v2/Users')
      .set(scim(otherToken))
      .send({ schemas: [SCIM_USER], userName: `intruder@${domain}` })
      .expect(400);
    expect(other.tenantId).not.toBe(owner.tenantId);
  });
});
