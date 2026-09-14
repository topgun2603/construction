/* eslint-disable no-console */
import 'dotenv/config';
import { PrismaClient, type Prisma } from '@prisma/client';
import {
  addDays,
  defaultModulesForPlan,
  isoDateToUtcDate,
  expiryAfterMonths,
  todayInIst,
} from '@sitebook/shared';

/**
 * Demo data for local development (spec §14): one tenant, two projects, a user for
 * every role, two contractors with workers, a week of attendance, a DPR and an
 * indent awaiting approval.
 *
 * Fixed ids make the seed rerunnable — it deletes the demo tenant and rebuilds it,
 * so `pnpm db:seed` is always safe and the same phone numbers always work.
 *
 * Every write runs with `app.tenant_id` set, because tenant tables are created with
 * FORCE ROW LEVEL SECURITY and an unscoped insert would be rejected by the policy.
 */

const DEMO_TENANT_ID = '11111111-1111-4111-8111-111111111111';

/** Sign in locally with: { "firebase_token": "dev:<phone>" } */
const PHONES = {
  owner: '919000000001',
  projectManager: '919000000002',
  supervisor: '919000000003',
  accounts: '919000000004',
  client: '919000000005',
} as const;

const prisma = new PrismaClient();

/** Rupees → paise, as the bigint the schema stores. */
const rupees = (amount: number): bigint => BigInt(Math.round(amount * 100));

async function main(): Promise<void> {
  await withTenant(DEMO_TENANT_ID, async (tx) => {
    await tx.tenant.deleteMany({ where: { id: DEMO_TENANT_ID } });
  });

  await withTenant(DEMO_TENANT_ID, async (tx) => {
    const tenant = await tx.tenant.create({
      data: {
        id: DEMO_TENANT_ID,
        name: 'ARK Constructions',
        plan: 'one_year',
        planStartedOn: new Date(),
        // Twelve months, matching the `one_year` row the migration seeds into the catalogue.
        // The seed does not read the catalogue back: it is building the world, and a fixture that
        // depended on a row it had not written yet would be a chicken-and-egg problem.
        planExpiresOn: expiryAfterMonths(12, new Date()),
        enabledModules: defaultModulesForPlan('one_year'),
        status: 'active',
      },
    });

    const users = await createUsers(tx);
    const projects = await createProjects(tx);

    await assignMembers(tx, users, projects);
    const { contractors, workers } = await createLabour(tx, projects);
    await createAttendance(tx, { projects, workers, recordedBy: users.supervisor.id });
    await createDpr(tx, { project: projects.tower, submittedBy: users.supervisor.id });
    await createMaterialsAndIndent(tx, {
      project: projects.tower,
      requestedBy: users.supervisor.id,
    });
    await createExpenses(tx, {
      projects,
      submittedBy: users.supervisor.id,
      approvedBy: users.projectManager.id,
    });

    console.log(`\nSeeded tenant "${tenant.name}" (${tenant.id})`);
    console.log(`  ${projects.tower.name} + ${projects.villas.name}`);
    console.log(`  ${contractors.length} contractors, ${workers.length} workers`);
    console.log('\nSign in with DEV_AUTH_BYPASS=true and any of:');
    for (const [role, phone] of Object.entries(PHONES)) {
      console.log(`  ${role.padEnd(15)} dev:${phone}`);
    }
  });
}

async function createUsers(tx: Prisma.TransactionClient) {
  const make = (phone: string, name: string, role: Prisma.UserCreateInput['role']) =>
    tx.user.create({
      data: { tenantId: DEMO_TENANT_ID, phone, name, role, status: 'active' },
    });

  const [owner, projectManager, supervisor, accounts, client] = await Promise.all([
    make(PHONES.owner, 'Gowtham Kumar', 'owner'),
    make(PHONES.projectManager, 'Priya Raman', 'project_manager'),
    make(PHONES.supervisor, 'Suresh Babu', 'site_supervisor'),
    make(PHONES.accounts, 'Anita Desai', 'accounts'),
    make(PHONES.client, 'Vikram Shah', 'client'),
  ]);

  return { owner, projectManager, supervisor, accounts, client };
}

async function createProjects(tx: Prisma.TransactionClient) {
  const today = todayInIst();

  const tower = await tx.project.create({
    data: {
      tenantId: DEMO_TENANT_ID,
      name: 'Lakeview Tower',
      clientName: 'Vikram Shah',
      address: '14 Lake Road, Coimbatore',
      lat: 11.0168,
      lng: 76.9558,
      startDate: isoDateToUtcDate(addDays(today, -120)),
      targetEndDate: isoDateToUtcDate(addDays(today, 240)),
      budgetAmount: rupees(42_000_000),
      status: 'active',
    },
  });

  const villas = await tx.project.create({
    data: {
      tenantId: DEMO_TENANT_ID,
      name: 'Green Acres Villas',
      clientName: 'Green Acres LLP',
      address: 'Survey 88, Thudiyalur',
      lat: 11.0721,
      lng: 76.9326,
      startDate: isoDateToUtcDate(addDays(today, -30)),
      targetEndDate: isoDateToUtcDate(addDays(today, 400)),
      budgetAmount: rupees(18_500_000),
      status: 'active',
    },
  });

  await tx.milestone.createMany({
    data: [
      { tenantId: DEMO_TENANT_ID, projectId: tower.id, name: 'Foundation', sortOrder: 1, plannedDate: isoDateToUtcDate(addDays(today, -90)), actualDate: isoDateToUtcDate(addDays(today, -85)) },
      { tenantId: DEMO_TENANT_ID, projectId: tower.id, name: 'Ground floor slab', sortOrder: 2, plannedDate: isoDateToUtcDate(addDays(today, -30)), actualDate: isoDateToUtcDate(addDays(today, -26)) },
      { tenantId: DEMO_TENANT_ID, projectId: tower.id, name: 'First floor slab', sortOrder: 3, plannedDate: isoDateToUtcDate(addDays(today, 20)) },
      { tenantId: DEMO_TENANT_ID, projectId: villas.id, name: 'Site levelling', sortOrder: 1, plannedDate: isoDateToUtcDate(addDays(today, -10)), actualDate: isoDateToUtcDate(addDays(today, -8)) },
      { tenantId: DEMO_TENANT_ID, projectId: villas.id, name: 'Villa 1 foundation', sortOrder: 2, plannedDate: isoDateToUtcDate(addDays(today, 15)) },
    ],
  });

  return { tower, villas };
}

async function assignMembers(
  tx: Prisma.TransactionClient,
  users: Awaited<ReturnType<typeof createUsers>>,
  projects: Awaited<ReturnType<typeof createProjects>>,
): Promise<void> {
  await tx.projectMember.createMany({
    data: [
      { tenantId: DEMO_TENANT_ID, projectId: projects.tower.id, userId: users.projectManager.id, roleOnProject: 'project_manager' },
      { tenantId: DEMO_TENANT_ID, projectId: projects.villas.id, userId: users.projectManager.id, roleOnProject: 'project_manager' },
      // The supervisor is on one site only — that is what makes the project-scoping
      // visible in the demo.
      { tenantId: DEMO_TENANT_ID, projectId: projects.tower.id, userId: users.supervisor.id, roleOnProject: 'site_supervisor' },
      { tenantId: DEMO_TENANT_ID, projectId: projects.tower.id, userId: users.client.id, roleOnProject: 'client' },
    ],
    skipDuplicates: true,
  });
}

async function createLabour(
  tx: Prisma.TransactionClient,
  projects: Awaited<ReturnType<typeof createProjects>>,
) {
  const today = todayInIst();

  const masonGang = await tx.contractor.create({
    data: {
      tenantId: DEMO_TENANT_ID,
      name: 'Murugan Masonry',
      trade: 'Masonry',
      phone: '919000001001',
      paymentTerms: 'weekly',
    },
  });

  const steelGang = await tx.contractor.create({
    data: {
      tenantId: DEMO_TENANT_ID,
      name: 'Kannan Steel Works',
      trade: 'Reinforcement',
      phone: '919000001002',
      paymentTerms: 'fortnightly',
    },
  });

  const roster: Array<{
    name: string;
    trade: string;
    skillLevel: Prisma.WorkerCreateInput['skillLevel'];
    wage: number;
    otRate: number;
    contractorId: string | null;
    projectId: string;
  }> = [
    { name: 'Raju M', trade: 'Mason', skillLevel: 'skilled', wage: 850, otRate: 110, contractorId: masonGang.id, projectId: projects.tower.id },
    { name: 'Selvam P', trade: 'Mason', skillLevel: 'skilled', wage: 850, otRate: 110, contractorId: masonGang.id, projectId: projects.tower.id },
    { name: 'Karthik R', trade: 'Helper', skillLevel: 'unskilled', wage: 550, otRate: 70, contractorId: masonGang.id, projectId: projects.tower.id },
    { name: 'Mani S', trade: 'Bar bender', skillLevel: 'semi', wage: 700, otRate: 90, contractorId: steelGang.id, projectId: projects.tower.id },
    { name: 'Arun V', trade: 'Bar bender', skillLevel: 'semi', wage: 700, otRate: 90, contractorId: steelGang.id, projectId: projects.tower.id },
    // Direct labour: no contractor, paid by the builder.
    { name: 'Lakshmi A', trade: 'Helper', skillLevel: 'unskilled', wage: 520, otRate: 65, contractorId: null, projectId: projects.tower.id },
    { name: 'Ganesh T', trade: 'Carpenter', skillLevel: 'skilled', wage: 900, otRate: 120, contractorId: null, projectId: projects.villas.id },
  ];

  const workers = [];
  for (const entry of roster) {
    const worker = await tx.worker.create({
      data: {
        tenantId: DEMO_TENANT_ID,
        contractorId: entry.contractorId,
        name: entry.name,
        trade: entry.trade,
        skillLevel: entry.skillLevel,
        dailyWage: rupees(entry.wage),
        overtimeRatePerHour: rupees(entry.otRate),
        status: 'active',
      },
    });
    await tx.workerProject.create({
      data: {
        tenantId: DEMO_TENANT_ID,
        workerId: worker.id,
        projectId: entry.projectId,
        fromDate: isoDateToUtcDate(addDays(today, -60)),
      },
    });
    workers.push({ ...worker, projectId: entry.projectId });
  }

  return { contractors: [masonGang, steelGang], workers };
}

async function createAttendance(
  tx: Prisma.TransactionClient,
  input: {
    projects: Awaited<ReturnType<typeof createProjects>>;
    workers: Array<{ id: string; dailyWage: bigint; overtimeRatePerHour: bigint; projectId: string }>;
    recordedBy: string;
  },
): Promise<void> {
  const today = todayInIst();
  const rows: Prisma.AttendanceCreateManyInput[] = [];

  // Six working days back from yesterday; Sunday is a holiday, so it is skipped.
  for (let offset = 1; offset <= 7; offset += 1) {
    const date = addDays(today, -offset);
    if (isoDateToUtcDate(date).getUTCDay() === 0) continue;

    for (const [index, worker] of input.workers.entries()) {
      // A deterministic sprinkling of half days and absences, so the demo wage
      // sheet is not a wall of identical full days.
      const bucket = (offset + index) % 7;
      const status = bucket === 5 ? 'half_day' : bucket === 6 ? 'absent' : 'present';
      const overtimeHours = status === 'present' && bucket % 3 === 0 ? '1.5' : '0';

      rows.push({
        tenantId: DEMO_TENANT_ID,
        projectId: worker.projectId,
        workerId: worker.id,
        attendanceDate: isoDateToUtcDate(date),
        status,
        overtimeHours,
        // Frozen at record time so a later wage revision cannot rewrite history.
        wageSnapshot: worker.dailyWage,
        overtimeRateSnapshot: worker.overtimeRatePerHour,
        recordedBy: input.recordedBy,
      });
    }
  }

  await tx.attendance.createMany({ data: rows, skipDuplicates: true });
}

async function createDpr(
  tx: Prisma.TransactionClient,
  input: { project: { id: string }; submittedBy: string },
): Promise<void> {
  const yesterday = addDays(todayInIst(), -1);

  const report = await tx.dailyReport.create({
    data: {
      tenantId: DEMO_TENANT_ID,
      projectId: input.project.id,
      reportDate: isoDateToUtcDate(yesterday),
      submittedBy: input.submittedBy,
      weather: 'Cloudy, light drizzle after 4pm',
      workDone: 'First floor column reinforcement 80% complete. Shuttering started on grid A-C.',
      issues: 'Drizzle stopped concreting for about an hour. Need 2 more bar benders tomorrow.',
      status: 'submitted',
      submittedAt: new Date(),
    },
  });

  await tx.dprActivity.createMany({
    data: [
      { tenantId: DEMO_TENANT_ID, dailyReportId: report.id, activity: 'Column reinforcement', quantity: '1.85', unit: 'MT' },
      { tenantId: DEMO_TENANT_ID, dailyReportId: report.id, activity: 'Shuttering', quantity: '120', unit: 'sqm' },
      { tenantId: DEMO_TENANT_ID, dailyReportId: report.id, activity: 'Block work', quantity: '45', unit: 'sqm' },
    ],
  });

  await tx.dprManpower.createMany({
    data: [
      { tenantId: DEMO_TENANT_ID, dailyReportId: report.id, trade: 'Mason', count: 3 },
      { tenantId: DEMO_TENANT_ID, dailyReportId: report.id, trade: 'Bar bender', count: 2 },
      { tenantId: DEMO_TENANT_ID, dailyReportId: report.id, trade: 'Helper', count: 4 },
    ],
  });
}

async function createMaterialsAndIndent(
  tx: Prisma.TransactionClient,
  input: { project: { id: string }; requestedBy: string },
): Promise<void> {
  const catalogue = [
    { name: 'OPC 53 Grade Cement', unit: 'bag', category: 'Cement' },
    { name: 'River Sand', unit: 'unit', category: 'Aggregate' },
    { name: '20mm Jelly', unit: 'unit', category: 'Aggregate' },
    { name: 'TMT Bar 12mm', unit: 'MT', category: 'Steel' },
    { name: 'TMT Bar 16mm', unit: 'MT', category: 'Steel' },
    { name: 'Solid Block 8in', unit: 'nos', category: 'Masonry' },
    { name: 'Binding Wire', unit: 'kg', category: 'Steel' },
  ];

  const materials = [];
  for (const item of catalogue) {
    materials.push(await tx.material.create({ data: { tenantId: DEMO_TENANT_ID, ...item } }));
  }

  const indent = await tx.materialIndent.create({
    data: {
      tenantId: DEMO_TENANT_ID,
      projectId: input.project.id,
      requestedBy: input.requestedBy,
      status: 'requested',
      urgency: 'high',
      notes: 'Needed before the slab pour on Friday.',
      requiredBy: isoDateToUtcDate(addDays(todayInIst(), 2)),
    },
  });

  const cement = materials.find((m) => m.name.startsWith('OPC'));
  const tmt12 = materials.find((m) => m.name === 'TMT Bar 12mm');
  const wire = materials.find((m) => m.name === 'Binding Wire');

  await tx.indentItem.createMany({
    data: [
      { tenantId: DEMO_TENANT_ID, indentId: indent.id, materialId: cement!.id, quantity: '200' },
      { tenantId: DEMO_TENANT_ID, indentId: indent.id, materialId: tmt12!.id, quantity: '2.5' },
      { tenantId: DEMO_TENANT_ID, indentId: indent.id, materialId: wire!.id, quantity: '50' },
    ],
  });
}

async function createExpenses(
  tx: Prisma.TransactionClient,
  input: {
    projects: Awaited<ReturnType<typeof createProjects>>;
    submittedBy: string;
    approvedBy: string;
  },
): Promise<void> {
  const today = todayInIst();

  // A believable month of petty cash: mostly settled, a couple still waiting on
  // the project manager so the approval queue is not empty in the demo.
  const rows: Array<{
    project: string;
    amount: number;
    category: string;
    daysAgo: number;
    note: string;
    approved: boolean;
  }> = [
    { project: input.projects.tower.id, amount: 18_500, category: 'materials', daysAgo: 2, note: 'Binding wire and nails', approved: true },
    { project: input.projects.tower.id, amount: 42_000, category: 'transport', daysAgo: 3, note: 'Lorry hire for jelly', approved: true },
    { project: input.projects.tower.id, amount: 6_400, category: 'fuel', daysAgo: 4, note: 'Diesel for the mixer', approved: true },
    { project: input.projects.tower.id, amount: 12_000, category: 'equipment_hire', daysAgo: 5, note: 'Vibrator hire, 2 days', approved: true },
    { project: input.projects.tower.id, amount: 3_200, category: 'food', daysAgo: 1, note: 'Tea and lunch, slab pour day', approved: false },
    { project: input.projects.tower.id, amount: 27_500, category: 'repairs', daysAgo: 1, note: 'Shuttering plate repair', approved: false },
    { project: input.projects.villas.id, amount: 9_800, category: 'materials', daysAgo: 6, note: 'Cement for levelling', approved: true },
    { project: input.projects.villas.id, amount: 5_500, category: 'safety', daysAgo: 7, note: 'Helmets and gloves', approved: true },
  ];

  for (const row of rows) {
    await tx.expense.create({
      data: {
        tenantId: DEMO_TENANT_ID,
        projectId: row.project,
        amount: rupees(row.amount),
        category: row.category,
        spentOn: isoDateToUtcDate(addDays(today, -row.daysAgo)),
        note: row.note,
        submittedBy: input.submittedBy,
        status: row.approved ? 'approved' : 'pending',
        ...(row.approved ? { approvedBy: input.approvedBy, approvedAt: new Date() } : {}),
      },
    });
  }
}

/**
 * Runs a callback inside a transaction with the tenant context set, exactly as
 * TenantDb does for API requests.
 */
async function withTenant<T>(
  tenantId: string,
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  return prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}::text, TRUE)`;
      return fn(tx);
    },
    { timeout: 60_000 },
  );
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error: unknown) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
