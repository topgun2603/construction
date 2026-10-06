import { addDays, todayIn } from '@sitebook/shared';
import { TenantCache } from '../src/common/auth/tenant-cache.service';
import { env } from '../src/config/env';
import { firesIn, tickWindow } from '../src/jobs/tenant-clock';
import { ChecksService } from '../src/modules/checks/checks.service';
import { EquipmentMaintenanceService } from '../src/modules/equipment/equipment-maintenance.service';
import {
  createTestApp,
  destroyTenant,
  onboardTenant,
  uniquePhone,
  type OnboardedTenant,
  type TestApp,
} from './utils/test-app';

type Auth = { Authorization: string };

/**
 * Equipment and plant (roadmap Phase 2, module 10): owned and hired machines, their history on
 * sites, daily logs with their validation, fuel from every source, servicing that falls due by the
 * hour meter with its reminder on the company's clock, document expiry, cost per site in the cost
 * report with hire minimums and nothing counted twice, the hire statement and booking the vendor's
 * invoice, the fuel leakage check, permissions, tenant isolation and the audit trail.
 *
 * Runs with OPENAI_API_KEY empty: the photo readers say so and the form is typed by hand.
 */
describe('equipment and plant', () => {
  let test: TestApp;
  let alpha: OnboardedTenant;
  let beta: OnboardedTenant;
  let owner: Auth;
  let pm: Auth;
  let supervisor: Auth;
  let accounts: Auth;
  let stranger: Auth;
  let site: string;
  let otherSite: string;
  let earthworks: string;
  let vendor: string;
  let operatorWorker: string;
  let diesel: string;
  let jcb: string;
  let dg: string;
  let plan: string;
  let firstLog: string;
  let fuelExpense: string;
  let insurance: string;

  const tz = 'Asia/Kolkata';
  const today = todayIn(tz);
  const d = (offset: number) => addDays(today, offset);
  const http = () => test.http();
  const photoKey = (name: string) => `${alpha.tenantId}/equipment_photo/p/${site}/202610/${name}.jpg`;

  async function invite(role: string, projectIds: string[]): Promise<Auth> {
    const phone = uniquePhone();
    await http()
      .post('/v1/tenants/current/invite')
      .set(owner)
      .send({ phone, name: `A ${role}`, role, project_ids: projectIds })
      .expect(201);
    const login = await http().post('/v1/auth/exchange').send({ firebase_token: `dev:${phone}` }).expect(200);
    return { Authorization: `Bearer ${login.body.access_token}` };
  }

  const report = async () =>
    (await http().get(`/v1/projects/${site}/cost-report`).set(owner).expect(200)).body as {
      lines: Array<{ code: string; own: { actual: string } }>;
      unallocated: { actual: string };
      totals: { actual: string };
    };
  const earthworksActual = async () => (await report()).lines.find((line) => line.code === '02')!.own.actual;

  beforeAll(async () => {
    test = await createTestApp();
    alpha = await onboardTenant(test, { name: 'Heavy Lift Builders', phone: uniquePhone() });
    beta = await onboardTenant(test, { name: 'Prying Builders', phone: uniquePhone() });
    owner = { Authorization: `Bearer ${alpha.accessToken}` };
    stranger = { Authorization: `Bearer ${beta.accessToken}` };

    site = (await http().post('/v1/projects').set(owner).send({ name: 'Harbour Point', status: 'active' }).expect(201)).body.id;
    otherSite = (await http().post('/v1/projects').set(owner).send({ name: 'Quiet Meadows', status: 'active' }).expect(201))
      .body.id;
    earthworks = (
      await http()
        .post(`/v1/projects/${site}/cost-codes`)
        .set(owner)
        .send({ code: '02', name: 'Earthworks', budget: '50000000' })
        .expect(201)
    ).body.id;

    pm = await invite('project_manager', [site]);
    supervisor = await invite('site_supervisor', [site]);
    accounts = await invite('accounts', []);

    vendor = (await http().post('/v1/vendors').set(owner).send({ name: 'Raj Earthmovers' }).expect(201)).body.id;
    operatorWorker = (
      await http()
        .post('/v1/workers')
        .set(owner)
        .send({ name: 'Murugan', trade: 'Operator', daily_wage: '90000', overtime_rate_per_hour: '10000', project_id: site, from_date: d(-20) })
        .expect(201)
    ).body.id;
    diesel = (await http().post('/v1/materials').set(owner).send({ name: 'Diesel', unit: 'L' }).expect(201)).body.id;
    await http()
      .post('/v1/stock/movements')
      .set(owner)
      .send({ project_id: site, material_id: diesel, type: 'in', quantity: '200', moved_on: d(-13) })
      .expect(201);
  });

  afterAll(async () => {
    await destroyTenant(test, alpha.tenantId);
    await destroyTenant(test, beta.tenantId);
    await test.close();
  });

  // --- the register -------------------------------------------------------------------------------

  it('registers hired and owned machines, with their terms', async () => {
    await http()
      .post('/v1/equipment')
      .set(supervisor)
      .send({ name: 'JCB', category: 'backhoe', ownership: 'owned' })
      .expect(403);
    // A hired machine is hired from somebody.
    await http()
      .post('/v1/equipment')
      .set(owner)
      .send({ name: 'JCB 3DX', category: 'backhoe', ownership: 'hired', hire_basis: 'hour' })
      .expect(422);

    const hired = await http()
      .post('/v1/equipment')
      .set(owner)
      .send({
        name: 'JCB 3DX',
        category: 'backhoe',
        make: 'JCB',
        model: '3DX Super',
        registration_no: 'TN-01-AB-1234',
        ownership: 'hired',
        vendor_id: vendor,
        // ₹1,200 an hour, 8 hours a day minimum, operator ₹1,000 a day extra, ₹5,000 to bring it.
        hire_basis: 'hour',
        hire_rate: '120000',
        min_hours: '8',
        operator_included: false,
        operator_rate: '100000',
        fuel_included: false,
        mobilisation_charge: '500000',
        meter_type: 'hours',
        meter_reading: '1200',
      })
      .expect(201);
    jcb = hired.body.id;
    expect(hired.body).toMatchObject({
      code: 'BH-001',
      status: 'available',
      ownership: 'hired',
      vendor: { id: vendor, name: 'Raj Earthmovers' },
      hire_rate: '120000',
      min_hours: '8',
      operator_rate: '100000',
      mobilisation_charge: '500000',
      meter_reading: '1200',
    });

    const owned = await http()
      .post('/v1/equipment')
      .set(owner)
      .send({
        name: 'Kirloskar 62.5 kVA',
        category: 'generator',
        ownership: 'owned',
        charge_out_basis: 'hour',
        charge_out_rate: '50000',
        meter_type: 'hours',
        meter_reading: '500',
      })
      .expect(201);
    dg = owned.body.id;
    expect(owned.body).toMatchObject({ code: 'DG-001', charge_out_rate: '50000', hire_rate: null, vendor: null });

    await http()
      .post('/v1/equipment')
      .set(owner)
      .send({ code: 'BH-001', name: 'Another', category: 'backhoe', ownership: 'owned' })
      .expect(409);

    // A supervisor sees the register — but not what anything costs.
    const theirs = await http().get('/v1/equipment').set(supervisor).expect(200);
    const row = theirs.body.items.find((item: { id: string }) => item.id === jcb);
    expect(row).toMatchObject({ code: 'BH-001', hire_rate: null, operator_rate: null });
  });

  it('keeps the history of which site each machine was on', async () => {
    await http().post(`/v1/equipment/${jcb}/allocations`).set(supervisor).send({ project_id: site, from_date: d(-13) }).expect(403);
    await http()
      .post(`/v1/equipment/${jcb}/allocations`)
      .set(owner)
      .send({ project_id: site, from_date: d(-13), cost_code_id: earthworks })
      .expect(201);
    await http().post(`/v1/equipment/${jcb}/allocations`).set(owner).send({ project_id: site, from_date: d(-5) }).expect(409);

    await http().post(`/v1/equipment/${dg}/allocations`).set(owner).send({ project_id: otherSite, from_date: d(-20) }).expect(201);
    // Before it arrived where it is: refused.
    await http().post(`/v1/equipment/${dg}/allocations`).set(owner).send({ project_id: site, from_date: d(-25) }).expect(422);
    // Moved: the other site's stay ends the day before.
    await http().post(`/v1/equipment/${dg}/allocations`).set(owner).send({ project_id: site, from_date: d(-7) }).expect(201);

    const detail = await http().get(`/v1/equipment/${dg}`).set(owner).expect(200);
    expect(detail.body.status).toBe('on_site');
    expect(detail.body.current_site.project.id).toBe(site);
    expect(detail.body.allocations.map((a: { project: { id: string }; from_date: string; to_date: string | null }) => [a.project.id, a.from_date, a.to_date])).toEqual([
      [site, d(-7), null],
      [otherSite, d(-20), d(-8)],
    ]);

    const board = await http().get('/v1/equipment/board').set(supervisor).expect(200);
    expect(board.body.sites.map((s: { project_id: string }) => s.project_id)).toEqual([site]);
    expect(board.body.sites[0].machines.map((m: { code: string }) => m.code).sort()).toEqual(['BH-001', 'DG-001']);
  });

  // --- daily logs ---------------------------------------------------------------------------------

  it('logs a machine’s day from the meter, with its fuel, and refuses what cannot be true', async () => {
    const first = await http()
      .post('/v1/equipment/logs')
      .set(supervisor)
      .send({
        equipment_id: jcb,
        log_date: d(-12),
        opening_meter: '1200',
        closing_meter: '1205',
        idle_hours: '2',
        operator_worker_id: operatorWorker,
        work_done: 'Foundation excavation, block A',
        fuel: { litres: '40', amount: '400000', source: 'direct' },
        client_id: '00000000-0000-4000-8000-000000000001',
      })
      .expect(201);
    firstLog = first.body.id;
    expect(first.body).toMatchObject({
      project: { id: site },
      cost_code: { id: earthworks },
      hours_worked: '5',
      idle_hours: '2',
      operator: { worker_id: operatorWorker, name: 'Murugan' },
      fuel_litres: '40',
      fuel_per_hour: 8,
    });
    // The same phone retrying its outbox does not log twice.
    const retried = await http()
      .post('/v1/equipment/logs')
      .set(supervisor)
      .send({ equipment_id: jcb, log_date: d(-12), opening_meter: '1200', closing_meter: '1205', client_id: '00000000-0000-4000-8000-000000000001' })
      .expect(201);
    expect(retried.body.id).toBe(firstLog);

    // Fuel paid on the spot, recorded as an expense — the expense carries the cost.
    const second = await http()
      .post('/v1/equipment/logs')
      .set(supervisor)
      .send({
        equipment_id: jcb,
        log_date: d(-11),
        opening_meter: '1205',
        closing_meter: '1214',
        operator_name: 'Vendor operator',
        fuel: { litres: '50', amount: '500000', source: 'expense', create_expense: true },
      })
      .expect(201);
    expect(second.body.hours_worked).toBe('9');
    const fuel = await http().get('/v1/equipment/fuel').query({ equipment_id: jcb }).set(owner).expect(200);
    fuelExpense = fuel.body.items.find((f: { source: string }) => f.source === 'expense').expense_id;
    const expense = await http().get(`/v1/expenses/${fuelExpense}`).set(owner).expect(200);
    expect(expense.body).toMatchObject({ category: 'fuel', amount: '500000' });

    // From the site's diesel in stock — booked out of stock, never priced again here.
    await http()
      .post('/v1/equipment/logs')
      .set(supervisor)
      .send({
        equipment_id: jcb,
        log_date: d(-10),
        opening_meter: '1214',
        closing_meter: '1222',
        fuel: { litres: '48', source: 'stock', material_id: diesel },
      })
      .expect(201);
    const stock = await http().get('/v1/stock').query({ project_id: site }).set(owner).expect(200);
    expect(JSON.stringify(stock.body)).toContain('152');

    for (const [day, opening, closing, litres, amount] of [
      [-9, '1222', '1230', '45', '450000'],
      // A day that drew far more than usual: the fuel check below should notice.
      [-8, '1230', '1238', '90', '900000'],
    ] as const) {
      await http()
        .post('/v1/equipment/logs')
        .set(supervisor)
        .send({ equipment_id: jcb, log_date: d(day), opening_meter: opening, closing_meter: closing, fuel: { litres, amount, source: 'direct' } })
        .expect(201);
    }

    // Closing below opening.
    await http()
      .post('/v1/equipment/logs')
      .set(supervisor)
      .send({ equipment_id: jcb, log_date: d(-7), opening_meter: '1240', closing_meter: '1239' })
      .expect(422);
    // The same day twice.
    await http()
      .post('/v1/equipment/logs')
      .set(supervisor)
      .send({ equipment_id: jcb, log_date: d(-8), opening_meter: '1238', closing_meter: '1239' })
      .expect(409);
    // Readings that overlap the day before.
    const overlap = await http()
      .post('/v1/equipment/logs')
      .set(supervisor)
      .send({ equipment_id: jcb, log_date: d(-7), opening_meter: '1235', closing_meter: '1240' })
      .expect(422);
    expect(overlap.body.message).toMatch(/overlap/);
    // More than a day's hours.
    await http()
      .post('/v1/equipment/logs')
      .set(supervisor)
      .send({ equipment_id: jcb, log_date: d(-7), opening_meter: '1238', closing_meter: '1263' })
      .expect(422);
    // Not on that site, and not on any site that day.
    await http()
      .post('/v1/equipment/logs')
      .set(owner)
      .send({ equipment_id: jcb, project_id: otherSite, log_date: d(-7), opening_meter: '1238', closing_meter: '1240' })
      .expect(422);
    await http()
      .post('/v1/equipment/logs')
      .set(supervisor)
      .send({ equipment_id: jcb, log_date: d(-15), opening_meter: '1100', closing_meter: '1104' })
      .expect(422);

    // The owned generator's day on the site, charged out at its internal rate.
    await http()
      .post('/v1/equipment/logs')
      .set(supervisor)
      .send({ equipment_id: dg, log_date: d(-6), opening_meter: '500', closing_meter: '506' })
      .expect(201);

    const machine = await http().get(`/v1/equipment/${jcb}`).set(owner).expect(200);
    expect(machine.body.meter_reading).toBe('1238');
    expect(machine.body.logs).toHaveLength(5);
  });

  it('corrects a log for its author, and refuses anybody else who only logs', async () => {
    const other = await invite('site_supervisor', [site]);
    await http().patch(`/v1/equipment/logs/${firstLog}`).set(other).send({ work_done: 'Not mine' }).expect(403);
    const fixed = await http()
      .patch(`/v1/equipment/logs/${firstLog}`)
      .set(supervisor)
      .send({ work_done: 'Foundation excavation, blocks A and B' })
      .expect(200);
    expect(fixed.body).toMatchObject({ hours_worked: '5', work_done: 'Foundation excavation, blocks A and B' });
  });

  it('reads photos only when the AI is switched on, and the person types it otherwise', async () => {
    const meter = await http().post('/v1/equipment/scan/meter').set(supervisor).send({ s3_key: photoKey('meter') }).expect(409);
    expect(meter.body.message).toMatch(/by hand/);
    await http().post('/v1/equipment/scan/fuel-bill').set(supervisor).send({ s3_key: photoKey('slip') }).expect(409);
    await http()
      .post('/v1/equipment/scan/meter')
      .set(supervisor)
      .send({ s3_key: `${beta.tenantId}/equipment_photo/x.jpg` })
      .expect(403);
  });

  // --- maintenance --------------------------------------------------------------------------------

  it('records repairs on the site and a service as an expense', async () => {
    // A breakdown repair, paid by the site and not put through expenses: equipment counts it.
    const repair = await http()
      .post(`/v1/equipment/${jcb}/maintenance`)
      .set(owner)
      .send({ done_on: d(-9), kind: 'breakdown', description: 'Hydraulic hose replaced', cost: '200000', downtime_hours: '3' })
      .expect(201);
    expect(repair.body).toMatchObject({ project: { id: site }, cost: '200000', expense_id: null });

    // The generator's service, recorded as an expense on the site: the expense carries it.
    plan = (
      await http()
        .post(`/v1/equipment/${dg}/service-plans`)
        .set(owner)
        .send({ name: '250 h service', interval_meter: '250', last_done_meter: '300', last_done_on: d(-60) })
        .expect(201)
    ).body.id;
    const service = await http()
      .post(`/v1/equipment/${dg}/maintenance`)
      .set(owner)
      .send({
        done_on: d(-6),
        kind: 'preventive',
        description: '250 h service: oil and filters',
        parts: 'Oil 15W-40 10 L, oil filter, fuel filter',
        cost: '150000',
        meter_reading: '506',
        plan_id: plan,
        create_expense: true,
      })
      .expect(201);
    expect(service.body.expense_id).toBeTruthy();
    const expense = await http().get(`/v1/expenses/${service.body.expense_id}`).set(owner).expect(200);
    expect(expense.body).toMatchObject({ category: 'repairs', amount: '150000' });
    const dgDetail = await http().get(`/v1/equipment/${dg}`).set(owner).expect(200);
    expect(dgDetail.body.service_plans[0]).toMatchObject({ last_done_meter: '506', next_meter: '756', state: 'ok' });

    await http()
      .post(`/v1/equipment/${dg}/maintenance`)
      .set(supervisor)
      .send({ done_on: d(-6), kind: 'preventive', description: 'Not theirs', cost: '0' })
      .expect(403);
  });

  // --- cost ---------------------------------------------------------------------------------------

  it('puts hire with its minimums, operator, mobilisation, fuel and repairs on the site — and nothing twice', async () => {
    const body = await report();
    // Hire at ₹1,200/h: 8 h minimum on the 5 h day, then 9, 8, 8, 8 → 41 h = ₹49,200. Operator 5 × ₹1,000,
    // mobilisation ₹5,000, fuel bought for the machine ₹4,000 + ₹4,500 + ₹9,000, the repair ₹2,000 —
    // all on earthworks — plus the fuel bill recorded as an expense, ₹5,000, counted once as the expense.
    const equipment = 4920000 + 500000 + 500000 + 400000 + 450000 + 900000 + 200000;
    expect(body.lines.find((line) => line.code === '02')!.own.actual).toBe(String(equipment + 500000));
    // The generator: 6 h charged out at ₹500 (uncoded allocation) and its service expense, once.
    expect(body.unallocated.actual).toBe(String(300000 + 150000));

    const costs = await http()
      .get('/v1/equipment/reports/costs')
      .query({ project_id: site, from: d(-30), to: today })
      .set(owner)
      .expect(200);
    expect(costs.body.totals).toMatchObject({
      hire: '4920000',
      operator: '500000',
      mobilisation: '500000',
      charge_out: '300000',
      counted: String(equipment + 300000),
      // On an expense already: the fuel bill and the generator's service.
      not_counted: String(500000 + 150000),
    });
    const jcbRow = costs.body.rows.find((row: { equipment: { id: string } }) => row.equipment.id === jcb);
    expect(jcbRow).toMatchObject({ hours_worked: '38', hours_charged: '41' });
    const byCode = costs.body.cost_codes.find((row: { cost_code: { id: string } | null }) => row.cost_code?.id === earthworks);
    expect(byCode.counted).toBe(String(equipment));

    const csv = await http().get('/v1/equipment/export').query({ kind: 'costs', project_id: site, from: d(-30), to: today }).set(owner).expect(200);
    expect(csv.headers['content-type']).toContain('text/csv');
    expect(csv.text).toContain('BH-001,JCB 3DX,Harbour Point,38,41,49200.00');
  });

  it('builds the vendor’s hire statement and books the checked invoice without counting it twice', async () => {
    const months = [...new Set([d(-13), d(-12), d(-8)].map((day) => day.slice(0, 7)))];
    const statements = await Promise.all(
      months.map(async (month) =>
        (await http().get('/v1/equipment/hire-statement').query({ vendor_id: vendor, month }).set(accounts).expect(200)).body,
      ),
    );
    const rows = statements.flatMap((statement) => statement.rows);
    const sum = (key: string) => rows.reduce((total: number, row: Record<string, string>) => total + Number(row[key]), 0);
    expect(rows.every((row: { equipment: { code: string }; project: { id: string } }) => row.equipment.code === 'BH-001' && row.project.id === site)).toBe(true);
    expect(sum('days')).toBe(5);
    expect(sum('hours_worked')).toBe(38);
    expect(sum('hours_charged')).toBe(41);
    expect(sum('minimum_top_up')).toBe(3);
    expect(sum('hire')).toBe(4920000);
    expect(sum('operator')).toBe(500000);
    expect(sum('mobilisation')).toBe(500000);
    expect(sum('total')).toBe(5920000);

    const before = await earthworksActual();
    await http().post('/v1/equipment/hire-statement/book').set(supervisor).send({ vendor_id: vendor, month: months[0] }).expect(403);
    const booked = [];
    for (const month of months) {
      const result = await http()
        .post('/v1/equipment/hire-statement/book')
        .set(owner)
        .send({ vendor_id: vendor, month, invoice_ref: 'RE/2026/118' })
        .expect(201);
      expect(result.body.rows.every((row: { booked: unknown }) => row.booked)).toBe(true);
      booked.push(...result.body.rows.map((row: { booked: { expense_id: string } }) => row.booked.expense_id));
    }
    await http().post('/v1/equipment/hire-statement/book').set(owner).send({ vendor_id: vendor, month: months[0] }).expect(409);

    // The hire is now the expense's: the site's actual cost does not move.
    expect(await earthworksActual()).toBe(before);
    const hireExpense = await http().get(`/v1/expenses/${booked[0]}`).set(owner).expect(200);
    expect(hireExpense.body.category).toBe('equipment_hire');

    // Rejected, the expense stops counting and the hire worked out here counts again: still the same.
    for (const id of booked) {
      await http().patch(`/v1/expenses/${id}/decision`).set(accounts).send({ status: 'rejected' }).expect(200);
    }
    expect(await earthworksActual()).toBe(before);
  });

  it('flags a day that drew far more fuel than usual, in the report and in the nightly checks', async () => {
    const fuel = await http().get('/v1/equipment/reports/fuel').query({ from: d(-30), to: today }).set(owner).expect(200);
    expect(fuel.body.outliers).toHaveLength(1);
    expect(fuel.body.outliers[0]).toMatchObject({ date: d(-8), litres: '90', hours_worked: '8', fuel_per_hour: 11.25, above_percent: 84 });

    const checks = test.app.get(ChecksService);
    await checks.runTenant(alpha.tenantId);
    const open = await http().get('/v1/checks').set(owner).expect(200);
    const items = Array.isArray(open.body) ? open.body : open.body.items;
    const finding = items.find((item: { kind: string }) => item.kind === 'fuel_outlier');
    expect(finding.title).toContain('BH-001');
    expect(finding.project_id).toBe(site);
    // Raised once: the same day is not raised again.
    expect((await checks.runTenant(alpha.tenantId)).added).toBe(0);

    const utilisation = await http().get('/v1/equipment/reports/utilisation').query({ from: d(-13), to: d(-8) }).set(owner).expect(200);
    const row = utilisation.body.rows.find((r: { equipment: { id: string } }) => r.equipment.id === jcb);
    // Six days on site, five logged: available 8 + 8 + 9 + 8 + 8 + 8 = 49 h (the 5 h day logged 2 h idle).
    expect(row).toMatchObject({ days_on_site: 6, hours_worked: '38', hours_available: '49', utilisation_percent: 78 });
  });

  // --- reminders ----------------------------------------------------------------------------------

  it('reminds when a service falls due by the hour meter, on the company’s clock', async () => {
    const zone = 'Asia/Dubai';
    await test.tenantDb.transaction(alpha.tenantId, (tx) =>
      tx.tenant.update({ where: { id: alpha.tenantId }, data: { timezone: zone } }),
    );
    test.app.get(TenantCache).invalidate(alpha.tenantId);

    const jcbPlan = (
      await http()
        .post(`/v1/equipment/${jcb}/service-plans`)
        .set(pm)
        .send({ name: '250 h service', interval_meter: '250', last_done_meter: '1000' })
        .expect(201)
    ).body;
    // 1,238 on the meter, due at 1,250: soon, not yet.
    expect(jcbPlan).toMatchObject({ next_meter: '1250', remaining_meter: '12', state: 'due_soon' });
    const service = test.app.get(EquipmentMaintenanceService);
    expect((await service.remindTenant(alpha.tenantId)).services).toBe(0);

    await http()
      .post('/v1/equipment/logs')
      .set(supervisor)
      .send({ equipment_id: jcb, log_date: d(-5), opening_meter: '1238', closing_meter: '1251' })
      .expect(201);
    const due = await http().get('/v1/equipment/maintenance/due').set(pm).expect(200);
    expect(due.body.services.find((s: { id: string }) => s.id === jcbPlan.id)).toMatchObject({ state: 'overdue', remaining_meter: '-1' });

    expect((await service.remindTenant(alpha.tenantId)).services).toBe(1);
    expect((await service.remindTenant(alpha.tenantId)).services).toBe(0);
    const inbox = await http().get('/v1/notifications').set(pm).expect(200);
    expect(inbox.body.items.map((n: { type: string }) => n.type)).toContain('equipment.service_due');

    // Doing the service starts the count again.
    await http()
      .post(`/v1/equipment/${jcb}/maintenance`)
      .set(owner)
      .send({ done_on: d(-4), kind: 'preventive', description: '250 h service', meter_reading: '1251', plan_id: jcbPlan.id })
      .expect(201);
    const after = await http().get(`/v1/equipment/${jcb}`).set(owner).expect(200);
    expect(after.body.service_plans[0]).toMatchObject({ next_meter: '1501', state: 'ok' });

    // "7:30 am" is 7:30 in Dubai: the tick that fires there does not fire for India.
    const localToday = todayIn(zone);
    const sevenThirty = new Date(`${localToday}T07:30:00+04:00`);
    const window = tickWindow(new Date(sevenThirty.getTime() + 60_000));
    expect(firesIn(env().EQUIPMENT_REMINDER_CRON, zone, window)).toBe(true);
    expect(firesIn(env().EQUIPMENT_REMINDER_CRON, 'Asia/Kolkata', window)).toBe(false);
  });

  it('warns before a machine’s papers lapse, once, and again after renewal only when due', async () => {
    const zoneToday = todayIn('Asia/Dubai');
    insurance = (
      await http()
        .post(`/v1/equipment/${jcb}/documents`)
        .set(owner)
        .send({ kind: 'insurance', number: 'POL-77812', issued_on: addDays(zoneToday, -355), expires_on: addDays(zoneToday, 10) })
        .expect(201)
    ).body.id;
    const docs = await http().get(`/v1/equipment/${jcb}/documents`).set(owner).expect(200);
    expect(docs.body.items[0]).toMatchObject({ kind: 'insurance', standing: 'expiring' });
    const list = await http().get('/v1/equipment').set(owner).expect(200);
    expect(list.body.items.find((item: { id: string }) => item.id === jcb).documents_state).toBe('expiring');

    const service = test.app.get(EquipmentMaintenanceService);
    expect((await service.remindTenant(alpha.tenantId)).documents).toBe(1);
    expect((await service.remindTenant(alpha.tenantId)).documents).toBe(0);
    const inbox = await http().get('/v1/notifications').set(owner).expect(200);
    expect(inbox.body.items.map((n: { type: string }) => n.type)).toContain('equipment.documents_expiring');

    const renewed = await http()
      .patch(`/v1/equipment/documents/${insurance}`)
      .set(owner)
      .send({ expires_on: addDays(zoneToday, 375) })
      .expect(200);
    expect(renewed.body.standing).toBe('valid');
    expect((await service.remindTenant(alpha.tenantId)).documents).toBe(0);
  });

  // --- permissions, isolation, audit --------------------------------------------------------------

  it('gives each role what it needs and no more', async () => {
    // A supervisor logs but does not see cost.
    await http().get('/v1/equipment/reports/costs').set(supervisor).expect(403);
    await http().get('/v1/equipment/hire-statement').query({ vendor_id: vendor, month: today.slice(0, 7) }).set(supervisor).expect(403);
    const theirs = await http().get(`/v1/equipment/${jcb}`).set(supervisor).expect(200);
    expect(theirs.body).toMatchObject({ hire_rate: null, cost: null });
    // Accounts reads cost but does not log or move machines.
    await http().get('/v1/equipment/reports/costs').set(accounts).expect(200);
    await http()
      .post('/v1/equipment/logs')
      .set(accounts)
      .send({ equipment_id: dg, log_date: d(-3), opening_meter: '506', closing_meter: '510' })
      .expect(403);
    await http().post(`/v1/equipment/${dg}/release`).set(accounts).send({ to_date: d(-1) }).expect(403);
    // A manager releases a machine; an owned one goes back to the yard.
    const released = await http().post(`/v1/equipment/${dg}/release`).set(pm).send({ to_date: d(-1) }).expect(200);
    expect(released.body.status).toBe('available');
  });

  it('keeps one company’s machines from another', async () => {
    await http().get(`/v1/equipment/${jcb}`).set(stranger).expect(404);
    expect((await http().get('/v1/equipment').set(stranger).expect(200)).body.items).toHaveLength(0);
    expect((await http().get('/v1/equipment/logs').set(stranger).expect(200)).body.items).toHaveLength(0);
    await http()
      .post('/v1/equipment/logs')
      .set(stranger)
      .send({ equipment_id: jcb, log_date: d(-2), opening_meter: '1251', closing_meter: '1252' })
      .expect(404);
    await http().patch(`/v1/equipment/logs/${firstLog}`).set(stranger).send({ work_done: 'x' }).expect(404);
    await http().get('/v1/equipment/hire-statement').query({ vendor_id: vendor, month: today.slice(0, 7) }).set(stranger).expect(404);
    await http().patch(`/v1/equipment/documents/${insurance}`).set(stranger).send({ number: 'x' }).expect(404);
    // Codes are per company: the other builder's first backhoe is BH-001 too.
    const theirs = await http().post('/v1/equipment').set(stranger).send({ name: 'Their JCB', category: 'backhoe', ownership: 'owned' }).expect(201);
    expect(theirs.body.code).toBe('BH-001');
  });

  it('records every change in the audit log', async () => {
    const entries = async (query: Record<string, string>) =>
      (await http().get('/v1/audit').query(query).set(owner).expect(200)).body.items as Array<{ action: string; changed_fields: string[] }>;
    const onMachine = await entries({ entity: 'equipment', entity_id: jcb });
    expect(onMachine.map((row) => row.action)).toEqual(expect.arrayContaining(['create', 'update']));
    expect(onMachine.some((row) => row.changed_fields.includes('meter_reading'))).toBe(true);
    const onLog = await entries({ entity: 'equipment_logs', entity_id: firstLog });
    expect(onLog.some((row) => row.changed_fields.includes('work_done'))).toBe(true);
    expect((await entries({ entity: 'equipment_allocations' })).length).toBeGreaterThanOrEqual(3);
    expect((await entries({ entity: 'equipment_fuel' })).length).toBeGreaterThanOrEqual(5);
    expect((await entries({ entity: 'equipment_maintenance' })).length).toBeGreaterThanOrEqual(3);
    expect((await entries({ entity: 'equipment_service_plans' })).length).toBeGreaterThanOrEqual(2);
    expect((await entries({ entity: 'equipment_documents', entity_id: insurance })).length).toBeGreaterThanOrEqual(2);
    expect((await entries({ entity: 'equipment_hire_bookings' })).length).toBeGreaterThanOrEqual(1);
  });
});
