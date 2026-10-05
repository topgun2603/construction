import { addDays, isoDateToUtcDate, todayIn } from '@sitebook/shared';
import {
  createTestApp,
  destroyTenant,
  onboardTenant,
  uniquePhone,
  type OnboardedTenant,
  type TestApp,
} from './utils/test-app';

/**
 * Leak and fraud checks, through the API: the findings come from real records, a decision sticks,
 * and one company never sees another's.
 */
describe('leak and fraud checks', () => {
  let test: TestApp;
  let alpha: OnboardedTenant;
  let beta: OnboardedTenant;
  let auth: { Authorization: string };
  const day = addDays(todayIn('Asia/Kolkata'), -2);

  beforeAll(async () => {
    test = await createTestApp();
    alpha = await onboardTenant(test, { name: 'Leaky Builders', phone: uniquePhone() });
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
    const north = await site('North Block');
    const south = await site('South Block');
    const worker = (
      await test
        .http()
        .post('/v1/workers')
        .set(auth)
        .send({ name: 'Ghost Kumar', daily_wage: '80000' })
        .expect(201)
    ).body.id as string;

    // The same man present on both sites on the same day. The roll call refuses the second one
    // (WORKER_OVERBOOKED), so it is written the way a late offline sync or a backdated edit would
    // land it: straight into the table.
    await test
      .http()
      .post('/v1/attendance')
      .set(auth)
      .send({
        project_id: north,
        attendance_date: day,
        rows: [{ worker_id: worker, status: 'present' }],
      })
      .expect(201);
    await test.tenantDb.transaction(alpha.tenantId, (tx) =>
      tx.attendance.create({
        data: {
          tenantId: alpha.tenantId,
          projectId: south,
          workerId: worker,
          attendanceDate: isoDateToUtcDate(day),
          status: 'present',
          wageSnapshot: 80000n,
          recordedBy: alpha.ownerId,
        },
      }),
    );
    // The same diesel bill, twice.
    for (const spent of [day, addDays(day, 1)]) {
      await test
        .http()
        .post('/v1/expenses')
        .set(auth)
        .send({ project_id: north, amount: '420000', category: 'fuel', spent_on: spent })
        .expect(201);
    }
  });

  afterAll(async () => {
    await destroyTenant(test, alpha.tenantId);
    await destroyTenant(test, beta.tenantId);
    await test.close();
  });

  it('finds the double-booked worker and the bill entered twice', async () => {
    const run = await test.http().post('/v1/checks/run').set(auth).expect(201);
    expect(run.body.added).toBeGreaterThanOrEqual(2);

    const { body } = await test.http().get('/v1/checks').set(auth).expect(200);
    const kinds = body.map((check: { kind: string }) => check.kind);
    expect(kinds).toContain('double_booked');
    expect(kinds).toContain('duplicate_expense');
    expect(body.find((c: { kind: string }) => c.kind === 'double_booked').title).toMatch(
      /Ghost Kumar is marked as working more than one full day/,
    );
  });

  it('keeps a dismissal: the same finding is not raised again', async () => {
    const open = (await test.http().get('/v1/checks').set(auth).expect(200)).body;
    const duplicate = open.find((c: { kind: string }) => c.kind === 'duplicate_expense');

    await test
      .http()
      .patch(`/v1/checks/${duplicate.id}`)
      .set(auth)
      .send({ decision: 'dismissed', note: 'Two tankers that day' })
      .expect(200);

    const rerun = await test.http().post('/v1/checks/run').set(auth).expect(201);
    expect(rerun.body.added).toBe(0);
    const after = (await test.http().get('/v1/checks').set(auth).expect(200)).body;
    expect(after.map((c: { id: string }) => c.id)).not.toContain(duplicate.id);

    const decided = (await test.http().get('/v1/checks?status=decided').set(auth).expect(200)).body;
    expect(decided[0]).toMatchObject({ status: 'dismissed', note: 'Two tankers that day' });
  });

  it('never shows one company another company’s findings', async () => {
    const other = await test
      .http()
      .get('/v1/checks')
      .set('Authorization', `Bearer ${beta.accessToken}`)
      .expect(200);
    expect(other.body).toEqual([]);
  });
});
