import { createTestApp, destroyTenant, type TestApp } from './utils/test-app';

/**
 * Saudi Arabia's WPS payroll file for Mudad, end to end: a Saudi company's finalised month, the
 * file refused while the company and its workers are missing details, then written once they are —
 * the Iqama read from the worker's encrypted papers, the bank from the IBAN. A UAE company on the
 * same build still gets the SIF.
 */
const random = (digits: number) =>
  String(Math.floor(Math.random() * 10 ** digits)).padStart(digits, '0');

// The IBAN registry's Saudi example: Al Rajhi (bank id 80, BIC RJHISARI).
const IBAN = 'SA0380000000608010167519';

async function onboard(
  test: TestApp,
  locale: { country: string; currency: string; timezone: string; locale: string; tax_regime: string },
  phonePrefix: string,
) {
  const exchange = await test
    .http()
    .post('/v1/auth/exchange')
    .send({ firebase_token: `dev:${phonePrefix}${random(7)}` })
    .expect(200);
  const created = await test
    .http()
    .post('/v1/tenants')
    .set('X-Onboarding-Token', exchange.body.onboarding_token)
    .send({ name: `${locale.country} Contracting`, owner_name: 'Owner', ...locale })
    .expect(201);
  return {
    tenantId: created.body.tenant.id as string,
    auth: { Authorization: `Bearer ${created.body.tokens.access_token}` },
  };
}

describe('Saudi Mudad payroll file', () => {
  let test: TestApp;
  let saudi: { tenantId: string; auth: { Authorization: string } };
  let uae: { tenantId: string; auth: { Authorization: string } };
  let periodId: string;
  let salaried: string;

  beforeAll(async () => {
    test = await createTestApp();
    saudi = await onboard(
      test,
      { country: 'SA', currency: 'SAR', timezone: 'Asia/Riyadh', locale: 'en-SA', tax_regime: 'vat_sa' },
      '+96650',
    );
    uae = await onboard(
      test,
      { country: 'AE', currency: 'AED', timezone: 'Asia/Dubai', locale: 'en-AE', tax_regime: 'vat_ae' },
      '+97150',
    );
  });

  afterAll(async () => {
    if (saudi?.tenantId) await destroyTenant(test, saudi.tenantId);
    if (uae?.tenantId) await destroyTenant(test, uae.tenantId);
    await test.close();
  });

  it('builds a Saudi payroll month', async () => {
    const { auth } = saudi;
    const project = (
      await test.http().post('/v1/projects').set(auth).send({ name: 'Riyadh Metro Depot', status: 'active' }).expect(201)
    ).body.id;

    salaried = (
      await test
        .http()
        .post('/v1/workers')
        .set(auth)
        .send({
          name: 'Ramesh Kumar',
          pay_basis: 'monthly',
          // SAR 3,000 basic + 750 housing + 250 transport, in halalas.
          basic_salary: '300000',
          housing_allowance: '75000',
          transport_allowance: '25000',
          // Typed in lower case; stored as the bank prints it.
          wps_account: IBAN.toLowerCase(),
        })
        .expect(201)
    ).body.id;

    // A day hire with nothing set up, to be listed rather than silently dropped.
    const daily = (
      await test.http().post('/v1/workers').set(auth).send({ name: 'Day Hire', daily_wage: '15000' }).expect(201)
    ).body.id;

    await test
      .http()
      .post('/v1/attendance')
      .set(auth)
      .send({
        project_id: project,
        attendance_date: '2026-09-07',
        rows: [
          { worker_id: salaried, status: 'present' },
          { worker_id: daily, status: 'present' },
        ],
      })
      .expect(201);

    const period = await test
      .http()
      .post('/v1/wage-periods/generate')
      .set(auth)
      .send({ period_start: '2026-09-01', period_end: '2026-09-30' })
      .expect(201);
    periodId = period.body.id;
    const line = period.body.lines.find((l: { worker_id: string }) => l.worker_id === salaried);
    expect(line).toMatchObject({ gross_amount: '400000', net_payable: '400000' });
  });

  it('refuses the file while the company, the period and the workers are not ready', async () => {
    const { body } = await test
      .http()
      .get(`/v1/wage-periods/${periodId}/mudad`)
      .set(saudi.auth)
      .expect(200);
    expect(body.ready).toBe(false);
    expect(body.content).toBeNull();
    expect(body.problems.join(' ')).toMatch(/establishment number/);
    expect(body.problems.join(' ')).toMatch(/Finalise/);
    expect(body.missing).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ worker_name: 'Ramesh Kumar', missing: ['Iqama or national ID'] }),
        expect.objectContaining({ worker_name: 'Day Hire', missing: ['Iqama or national ID', 'IBAN'] }),
      ]),
    );
  });

  it('checks the establishment number’s shape', async () => {
    await test
      .http()
      .patch('/v1/tenants/current')
      .set(saudi.auth)
      .send({ mudad_establishment_id: '123456' })
      .expect(422);
  });

  it('writes the file once they are, the Iqama from the worker’s papers and the bank from the IBAN', async () => {
    const settings = await test
      .http()
      .patch('/v1/tenants/current')
      .set(saudi.auth)
      .send({ mudad_establishment_id: '1-123456' })
      .expect(200);
    expect(settings.body.mudad_establishment_id).toBe('1-123456');

    await test
      .http()
      .post(`/v1/workers/${salaried}/documents`)
      .set(saudi.auth)
      .send({ kind: 'iqama', number: '2123456789', expires_on: '2027-06-30' })
      .expect(201);
    await test.http().post(`/v1/wage-periods/${periodId}/finalise`).set(saudi.auth).expect(201);

    const { body } = await test
      .http()
      .get(`/v1/wage-periods/${periodId}/mudad`)
      .set(saudi.auth)
      .expect(200);
    expect(body.problems).toEqual([]);
    expect(body.included).toBe(1);
    expect(body.total).toBe('400000');
    expect(body.file_name).toBe('MUDAD-1-123456-202609.csv');
    expect(body.missing).toEqual([
      expect.objectContaining({ worker_name: 'Day Hire', missing: ['Iqama or national ID', 'IBAN'] }),
    ]);

    const lines = (body.content as string).trimEnd().split('\r\n');
    expect(lines[0]).toBe(
      'Employee ID,Employee Name,Bank Code,IBAN,Basic Salary,Housing Allowance,Other Earnings,Deductions,Net Salary,Establishment Number,Salary Month',
    );
    expect(lines[1]).toBe(
      `2123456789,Ramesh Kumar,RJHISARI,${IBAN},3000.00,750.00,250.00,0.00,4000.00,1-123456,2026-09`,
    );
    expect(lines).toHaveLength(2);

    // The identity numbers left their encrypted column, so the company's trail says who did it.
    const audit = await test.tenantDb.transaction(saudi.tenantId, (tx) =>
      tx.auditLog.findFirst({ where: { action: 'wage_period.mudad_file', entityId: periodId } }),
    );
    expect(audit).not.toBeNull();
  });

  it('flags a bad IBAN rather than writing it', async () => {
    await test
      .http()
      .patch(`/v1/workers/${salaried}`)
      .set(saudi.auth)
      .send({ wps_account: 'SA0480000000608010167519' })
      .expect(200);
    const { body } = await test
      .http()
      .get(`/v1/wage-periods/${periodId}/mudad`)
      .set(saudi.auth)
      .expect(200);
    expect(body.included).toBe(0);
    expect(body.missing).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          worker_name: 'Ramesh Kumar',
          missing: ['a valid Saudi IBAN (SA + 22 digits)'],
        }),
      ]),
    );
  });

  it('still gives a UAE company its SIF, and no Mudad file', async () => {
    const { auth } = uae;
    const project = (
      await test.http().post('/v1/projects').set(auth).send({ name: 'Marina Tower', status: 'active' }).expect(201)
    ).body.id;
    const worker = (
      await test
        .http()
        .post('/v1/workers')
        .set(auth)
        .send({
          name: 'Ram Thapa',
          daily_wage: '20000',
          wps_person_id: '10012345678901',
          wps_agent_code: '803320101',
          wps_account: 'AE070331234567890123456',
        })
        .expect(201)
    ).body.id;
    await test
      .http()
      .post('/v1/attendance')
      .set(auth)
      .send({ project_id: project, attendance_date: '2026-09-07', rows: [{ worker_id: worker, status: 'present' }] })
      .expect(201);
    const period = (
      await test
        .http()
        .post('/v1/wage-periods/generate')
        .set(auth)
        .send({ period_start: '2026-09-01', period_end: '2026-09-30' })
        .expect(201)
    ).body.id;
    await test
      .http()
      .patch('/v1/tenants/current')
      .set(auth)
      .send({ wps_employer_id: '1000000123456', wps_bank_code: '802920101' })
      .expect(200);
    await test.http().post(`/v1/wage-periods/${period}/finalise`).set(auth).expect(201);

    const sif = await test.http().get(`/v1/wage-periods/${period}/wps`).set(auth).expect(200);
    expect(sif.body.included).toBe(1);
    expect(sif.body.file_name).toMatch(/\.SIF$/);
    expect(sif.body.content).toContain(',AED,');

    const mudad = await test.http().get(`/v1/wage-periods/${period}/mudad`).set(auth).expect(200);
    expect(mudad.body.content).toBeNull();
    expect(mudad.body.problems.join(' ')).toMatch(/Saudi Arabia/);
  });
});
