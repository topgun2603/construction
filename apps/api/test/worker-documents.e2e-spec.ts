import { addDays, todayIn } from '@sitebook/shared';
import { WorkerDocumentsService } from '../src/modules/worker-documents/worker-documents.service';
import {
  createTestApp,
  destroyTenant,
  onboardTenant,
  uniquePhone,
  type OnboardedTenant,
  type TestApp,
} from './utils/test-app';

/**
 * Workers' papers (roadmap Phase 1, item 3): stored encrypted, shown masked, revealed only with an
 * audit entry, and reminded about once before they lapse.
 */
describe('worker documents', () => {
  let test: TestApp;
  let alpha: OnboardedTenant;
  let beta: OnboardedTenant;
  let auth: { Authorization: string };
  let workerId: string;
  let documentId: string;
  const EMIRATES_ID = '784-1990-1234567-1';

  beforeAll(async () => {
    test = await createTestApp();
    alpha = await onboardTenant(test, { name: 'Papers Builders', phone: uniquePhone() });
    beta = await onboardTenant(test, { name: 'Prying Builders', phone: uniquePhone() });
    auth = { Authorization: `Bearer ${alpha.accessToken}` };
    workerId = (
      await test
        .http()
        .post('/v1/workers')
        .set(auth)
        .send({ name: 'Ram Thapa', daily_wage: '15000' })
        .expect(201)
    ).body.id;
  });

  afterAll(async () => {
    await destroyTenant(test, alpha.tenantId);
    await destroyTenant(test, beta.tenantId);
    await test.close();
  });

  it('stores the number encrypted and shows only its last four characters', async () => {
    const created = await test
      .http()
      .post(`/v1/workers/${workerId}/documents`)
      .set(auth)
      .send({
        kind: 'emirates_id',
        number: EMIRATES_ID,
        expires_on: addDays(todayIn('Asia/Kolkata'), 10),
      })
      .expect(201);
    documentId = created.body.id;
    expect(created.body).toMatchObject({ number_hint: '5671', standing: 'expiring' });
    expect(JSON.stringify(created.body)).not.toContain('1234567');

    const row = await test.tenantDb.transaction(alpha.tenantId, (tx) =>
      tx.workerDocument.findUniqueOrThrow({ where: { id: documentId } }),
    );
    expect(row.numberCipher.startsWith('v1:')).toBe(true);
    expect(row.numberCipher).not.toContain('1234567');
  });

  it('reveals the full number only on request, and writes the look down', async () => {
    const revealed = await test
      .http()
      .post(`/v1/worker-documents/${documentId}/reveal`)
      .set(auth)
      .expect(201);
    expect(revealed.body.number).toBe(EMIRATES_ID);

    const audit = await test.tenantDb.transaction(alpha.tenantId, (tx) =>
      tx.auditLog.findFirst({ where: { action: 'worker_document.reveal', entityId: documentId } }),
    );
    expect(audit?.actorId).toBe(alpha.ownerId);
  });

  it('lists it as lapsing, and reminds the owners once', async () => {
    const expiring = await test.http().get('/v1/worker-documents/expiring').set(auth).expect(200);
    expect(expiring.body.map((d: { id: string }) => d.id)).toContain(documentId);
    expect(expiring.body[0].worker_name).toBe('Ram Thapa');

    const service = test.app.get(WorkerDocumentsService);
    expect((await service.remindTenant(alpha.tenantId)).reminded).toBe(1);
    expect((await service.remindTenant(alpha.tenantId)).reminded).toBe(0);

    // Renewing it makes the new expiry worth a reminder of its own.
    await test
      .http()
      .patch(`/v1/worker-documents/${documentId}`)
      .set(auth)
      .send({ expires_on: addDays(todayIn('Asia/Kolkata'), 20) })
      .expect(200);
    expect((await service.remindTenant(alpha.tenantId)).reminded).toBe(1);
  });

  it('never shows one company another company’s papers', async () => {
    const other = { Authorization: `Bearer ${beta.accessToken}` };
    await test.http().get(`/v1/workers/${workerId}/documents`).set(other).expect(404);
    await test.http().post(`/v1/worker-documents/${documentId}/reveal`).set(other).expect(404);
    const expiring = await test.http().get('/v1/worker-documents/expiring').set(other).expect(200);
    expect(expiring.body).toEqual([]);
  });
});
