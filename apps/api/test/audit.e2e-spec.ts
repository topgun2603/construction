import { PrismaClient } from '@prisma/client';
import { addDays, todayIn } from '@sitebook/shared';
import {
  createTestApp,
  destroyTenant,
  onboardTenant,
  uniquePhone,
  type OnboardedTenant,
  type TestApp,
} from './utils/test-app';

interface Entry {
  id: string;
  action: string;
  entity: string;
  entity_id: string | null;
  entity_label: string | null;
  actor_type: string;
  actor: { id: string; name: string } | null;
  changed_fields: string[];
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  request_id: string | null;
  user_agent: string | null;
}

/**
 * The full audit log (roadmap Phase 3): every create, update and delete is written by a database
 * trigger with who did it and what changed, readable and exportable only by those allowed to,
 * and never across tenants.
 */
describe('audit log', () => {
  let test: TestApp;
  let alpha: OnboardedTenant;
  let beta: OnboardedTenant;
  let auth: { Authorization: string };
  let pmAuth: { Authorization: string };
  let campId: string;

  async function entries(
    who: { Authorization: string },
    query: Record<string, string>,
  ): Promise<{ items: Entry[]; next_cursor: string | null }> {
    const response = await test.http().get('/v1/audit').query(query).set(who).expect(200);
    return response.body;
  }

  beforeAll(async () => {
    test = await createTestApp();
    alpha = await onboardTenant(test, { name: 'Audited Builders', phone: uniquePhone() });
    beta = await onboardTenant(test, { name: 'Curious Builders', phone: uniquePhone() });
    auth = { Authorization: `Bearer ${alpha.accessToken}` };

    const pmPhone = uniquePhone();
    await test
      .http()
      .post('/v1/tenants/current/invite')
      .set(auth)
      .send({ phone: pmPhone, name: 'Priya', role: 'project_manager', project_ids: [] })
      .expect(201);
    const pmLogin = await test
      .http()
      .post('/v1/auth/exchange')
      .send({ firebase_token: `dev:${pmPhone}` })
      .expect(200);
    pmAuth = { Authorization: `Bearer ${pmLogin.body.access_token}` };
  });

  afterAll(async () => {
    // Also the proof that the append-only guard lets a whole company's history go with it.
    if (alpha) await destroyTenant(test, alpha.tenantId);
    if (beta) await destroyTenant(test, beta.tenantId);
    await test.close();
  });

  it('records a create with the actor, request id and the new values', async () => {
    campId = (
      await test
        .http()
        .post('/v1/camps')
        .set(auth)
        .set('X-Request-Id', 'audit-spec-create-1')
        .set('User-Agent', 'audit-spec/1.0')
        .send({ name: 'Al Quoz Camp 2', capacity: 400 })
        .expect(201)
    ).body.id;

    const { items } = await entries(auth, { entity: 'camps', entity_id: campId });
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      action: 'create',
      entity: 'camps',
      entity_id: campId,
      entity_label: 'Al Quoz Camp 2',
      actor_type: 'user',
      actor: { id: alpha.ownerId },
      request_id: 'audit-spec-create-1',
      user_agent: 'audit-spec/1.0',
      before: null,
    });
    expect(items[0]!.after).toMatchObject({ name: 'Al Quoz Camp 2', capacity: 400 });
    // The tenant is the entry's own column, not noise in the snapshot.
    expect(items[0]!.after).not.toHaveProperty('tenant_id');
  });

  it('records an update as only the fields that changed, before and after', async () => {
    await test
      .http()
      .patch(`/v1/camps/${campId}`)
      .set(auth)
      .send({ capacity: 450, transport_note: 'Bus 3' })
      .expect(200);

    const { items } = await entries(auth, { entity_id: campId, action: 'update' });
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      actor: { id: alpha.ownerId },
      changed_fields: ['capacity', 'transport_note'],
      before: { capacity: 400, transport_note: null },
      after: { capacity: 450, transport_note: 'Bus 3' },
    });
  });

  it('records a soft delete as a delete, and a hard one with the whole row', async () => {
    await test.http().delete(`/v1/camps/${campId}`).set(auth).expect(204);
    let { items } = await entries(auth, { entity_id: campId, action: 'delete' });
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ actor: { id: alpha.ownerId }, changed_fields: ['deleted_at'] });

    // Outside any request — a job, a script — the change is the system's, and still recorded.
    await test.tenantDb.transaction(alpha.tenantId, (tx) => tx.camp.delete({ where: { id: campId } }));
    ({ items } = await entries(auth, { entity_id: campId, action: 'delete' }));
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ actor_type: 'system', actor: null });
    expect(items[0]!.before).toMatchObject({ name: 'Al Quoz Camp 2', capacity: 450 });
  });

  it('pages newest first with a cursor', async () => {
    const first = await entries(auth, { entity_id: campId, limit: '2' });
    expect(first.items.map((e) => e.action)).toEqual(['delete', 'delete']);
    expect(first.next_cursor).toBe(first.items[1]!.id);
    const second = await entries(auth, { entity_id: campId, limit: '2', cursor: first.next_cursor! });
    expect(second.items.map((e) => e.action)).toEqual(['update', 'create']);
    expect(second.next_cursor).toBeNull();
  });

  it('redacts secrets, and keeps the hand-written events beside the row changes', async () => {
    const workerId = (
      await test
        .http()
        .post('/v1/workers')
        .set(auth)
        .send({ name: 'Ram Thapa', daily_wage: '15000' })
        .expect(201)
    ).body.id;
    const documentId = (
      await test
        .http()
        .post(`/v1/workers/${workerId}/documents`)
        .set(auth)
        .send({
          kind: 'emirates_id',
          number: '784-1990-1234567-1',
          expires_on: addDays(todayIn('Asia/Kolkata'), 90),
        })
        .expect(201)
    ).body.id;
    await test.http().post(`/v1/worker-documents/${documentId}/reveal`).set(auth);

    const { items } = await entries(auth, { entity: 'worker_documents', entity_id: documentId });
    const created = items.find((e) => e.action === 'create');
    expect(created?.after).toMatchObject({ number_cipher: '[redacted]', number_hint: '5671' });
    expect(JSON.stringify(items)).not.toContain('v1:');

    // Refresh tokens are sessions, rotated constantly and never readable: not audited at all.
    const sessions = await entries(auth, { entity: 'refresh_tokens' });
    expect(sessions.items).toHaveLength(0);

    // The named events written by services before this log existed are still there, and filter
    // as events.
    const events = await entries(auth, { action: 'event' });
    expect(events.items.length).toBeGreaterThan(0);
    expect(events.items.every((e) => !['create', 'update', 'delete'].includes(e.action))).toBe(true);
    expect(events.items.map((e) => e.action)).toContain('user.invited');
  });

  it('never shows one company another’s history', async () => {
    const betaAuth = { Authorization: `Bearer ${beta.accessToken}` };
    const theirs = await entries(betaAuth, { entity_id: campId });
    expect(theirs.items).toHaveLength(0);
    // Not even by paging from a cursor that belongs to the other tenant.
    const mine = await entries(auth, { entity_id: campId, limit: '1' });
    const sneaky = await entries(betaAuth, { cursor: mine.items[0]!.id });
    expect(sneaky.items).toHaveLength(0);
    const all = await entries(betaAuth, { limit: '200' });
    expect(JSON.stringify(all.items)).not.toContain('Al Quoz');
  });

  it('is for those holding audit.view only', async () => {
    await test.http().get('/v1/audit').set(pmAuth).expect(403);
    await test.http().get('/v1/audit/export').set(pmAuth).expect(403);
    await test.http().get('/v1/audit').expect(401);
  });

  it('exports the filtered set as CSV, and records that it was exported', async () => {
    const response = await test
      .http()
      .get('/v1/audit/export')
      .query({ entity_id: campId })
      .set(auth)
      .expect(200);
    expect(response.headers['content-type']).toContain('text/csv');
    expect(response.headers['content-disposition']).toContain('attachment');
    const lines = response.text.replace(new RegExp(`^${String.fromCharCode(0xfeff)}`), '').trim().split('\r\n');
    expect(lines[0]).toContain('"who"');
    expect(lines).toHaveLength(5); // header + create, update, two deletes
    expect(lines[4]).toContain('"create"');
    expect(lines[4]).toContain('Al Quoz Camp 2');

    const { items } = await entries(auth, { action: 'audit.exported' });
    expect(items[0]).toMatchObject({ actor: { id: alpha.ownerId }, after: { rows: 4 } });
  });

  it('records the support console’s changes as the platform’s', async () => {
    // The console's BYPASSRLS connection, which sets no tenant: the trigger still files the entry
    // under the tenant whose row changed.
    const admin = new PrismaClient({ datasources: { db: { url: process.env['ADMIN_DATABASE_URL']! } } });
    try {
      await admin.tenant.update({ where: { id: alpha.tenantId }, data: { name: 'Audited Builders LLC' } });
    } finally {
      await admin.$disconnect();
    }
    const { items } = await entries(auth, { entity: 'tenants', action: 'update' });
    expect(items[0]).toMatchObject({
      actor_type: 'platform',
      actor: null,
      changed_fields: ['name'],
      before: { name: 'Audited Builders' },
      after: { name: 'Audited Builders LLC' },
    });
  });

  it('cannot be edited or deleted, even by the app’s own connection', async () => {
    const { items } = await entries(auth, { limit: '1' });
    await expect(
      test.tenantDb.transaction(alpha.tenantId, (tx) =>
        tx.auditLog.update({ where: { id: items[0]!.id }, data: { action: 'nothing' } }),
      ),
    ).rejects.toThrow(/append-only/);
    await expect(
      test.tenantDb.transaction(alpha.tenantId, (tx) =>
        tx.auditLog.deleteMany({ where: { tenantId: alpha.tenantId } }),
      ),
    ).rejects.toThrow(/append-only/);
  });
});
