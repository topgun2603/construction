import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { addDays, todayIn } from '@sitebook/shared';
import {
  createTestApp,
  destroyTenant,
  onboardTenant,
  uniquePhone,
  type OnboardedTenant,
  type TestApp,
} from './utils/test-app';

type Auth = { Authorization: string };

interface Task {
  id: string;
  name: string;
  parent_id: string | null;
  kind: string;
  is_summary: boolean;
  start: string;
  finish: string;
  total_float: number;
  critical: boolean;
  status: string;
  percent_complete: number;
  actual_start: string | null;
  actual_finish: string | null;
  constraint_type: string;
  constraint_date: string | null;
  milestone: { id: string; name: string } | null;
  baseline: { start: string; finish: string; finish_variance: number; slipped: boolean } | null;
}

const fixture = (name: string) => readFileSync(join(__dirname, 'fixtures/schedule', name), 'utf8');

/**
 * Scheduling (roadmap Phase 2, module 6): tasks in a breakdown, links of every kind, the critical
 * path worked out through the API, calendars by country and by site, baselines and slippage,
 * progress from site, Microsoft Project and Primavera P6 imports, the look-ahead, and the site
 * milestones the schedule now carries.
 *
 * Dates are fixed in the past (September 2026, a Monday start) so the plan reads the same whichever
 * day the suite runs; status dates are passed where progress would otherwise depend on today.
 *
 *   Sep 2026 on a Monday–Saturday (Indian) week:
 *   Mon 7 · Tue 8 · Wed 9 · Thu 10 · Fri 11 · Sat 12 · Mon 14 · Tue 15 · … · Wed 23
 */
describe('scheduling', () => {
  let test: TestApp;
  let alpha: OnboardedTenant;
  let beta: OnboardedTenant;
  let saudiTenantId: string | undefined;
  let owner: Auth;
  let pm: Auth;
  let supervisor: Auth;
  let accounts: Auth;
  let client: Auth;
  let stranger: Auth;
  let site: string;
  let villa: string;
  let tower: string;
  const ids: Record<string, string> = {};
  let baseline: string;

  const http = () => test.http();
  const schedule = async (projectId = site, query: Record<string, string> = {}, who: Auth = owner) =>
    (await http().get(`/v1/projects/${projectId}/schedule`).query(query).set(who).expect(200)).body as {
      tasks: Task[];
      dependencies: Array<{ id: string; predecessor_id: string; successor_id: string; type: string; lag_days: number }>;
      critical_path: string[];
      finish_date: string | null;
      project_start: string;
      calendar: { scope: string; working_days: number[]; holidays: string[]; name: string };
      baselines: Array<{ id: string; name: string }>;
      baseline: { finish_variance: number; slipped_count: number } | null;
      unlinked_milestones: Array<{ id: string; name: string }>;
      can: { manage: boolean; progress: boolean };
    };
  const byName = (tasks: Task[], name: string) => {
    const found = tasks.find((task) => task.name === name);
    if (!found) throw new Error(`no task called ${name}`);
    return found;
  };

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

  async function addTask(body: Record<string, unknown>, projectId = site): Promise<string> {
    const made = await http().post(`/v1/projects/${projectId}/schedule/tasks`).set(owner).send(body).expect(201);
    ids[body['name'] as string] = made.body.id;
    return made.body.id;
  }

  function link(from: string, to: string, type = 'FS', lag = 0) {
    return http()
      .post(`/v1/projects/${site}/schedule/dependencies`)
      .set(owner)
      .send({ predecessor_id: ids[from], successor_id: ids[to], type, lag_days: lag });
  }

  beforeAll(async () => {
    test = await createTestApp();
    alpha = await onboardTenant(test, { name: 'Programme Builders', phone: uniquePhone() });
    beta = await onboardTenant(test, { name: 'Nosy Builders', phone: uniquePhone() });
    owner = { Authorization: `Bearer ${alpha.accessToken}` };
    stranger = { Authorization: `Bearer ${beta.accessToken}` };

    site = (
      await http()
        .post('/v1/projects')
        .set(owner)
        .send({ name: 'Lake View', status: 'active', start_date: '2026-09-07' })
        .expect(201)
    ).body.id;
    villa = (await http().post('/v1/projects').set(owner).send({ name: 'Villa 12' }).expect(201)).body.id;
    tower = (
      await http().post('/v1/projects').set(owner).send({ name: 'Tower A', start_date: '2026-08-03' }).expect(201)
    ).body.id;

    pm = await invite('project_manager', [site]);
    supervisor = await invite('site_supervisor', [site]);
    accounts = await invite('accounts', []);
    client = await invite('client', [site]);
  });

  afterAll(async () => {
    if (alpha) await destroyTenant(test, alpha.tenantId);
    if (beta) await destroyTenant(test, beta.tenantId);
    if (saudiTenantId) await destroyTenant(test, saudiTenantId);
    await test.close();
  });

  it('starts empty, on the working week of the company’s country', async () => {
    const empty = await schedule();
    expect(empty.tasks).toEqual([]);
    expect(empty.finish_date).toBeNull();
    // India works six days.
    expect(empty.calendar).toMatchObject({ scope: 'default', working_days: [1, 2, 3, 4, 5, 6], holidays: [] });
    expect(empty.can).toEqual({ manage: true, progress: true });
  });

  it('builds a plan in a breakdown and works out the critical path', async () => {
    const sub = await addTask({ name: 'Substructure', wbs_code: '1' });
    await addTask({ name: 'Excavation', parent_id: sub, duration_days: 3 });
    await addTask({ name: 'Footings', parent_id: sub, duration_days: 4 });
    const sup = await addTask({ name: 'Superstructure', wbs_code: '2' });
    await addTask({ name: 'Columns', parent_id: sup, duration_days: 5 });
    await addTask({ name: 'Slab', parent_id: sup, duration_days: 6 });
    await addTask({ name: 'Structure done', parent_id: sup, kind: 'milestone' });
    await addTask({ name: 'Site office', duration_days: 2 });

    await link('Excavation', 'Footings').expect(201);
    await link('Footings', 'Columns').expect(201);
    const ss = await link('Columns', 'Slab', 'SS', 2).expect(201);
    expect(ss.body).toMatchObject({ type: 'SS', lag_days: 2 });
    await link('Slab', 'Structure done').expect(201);

    const plan = await schedule();
    expect(plan.tasks.map((task) => task.name)).toEqual([
      'Substructure',
      'Excavation',
      'Footings',
      'Superstructure',
      'Columns',
      'Slab',
      'Structure done',
      'Site office',
    ]);
    expect(byName(plan.tasks, 'Excavation')).toMatchObject({ start: '2026-09-07', finish: '2026-09-09' });
    // Sunday is skipped.
    expect(byName(plan.tasks, 'Footings')).toMatchObject({ start: '2026-09-10', finish: '2026-09-14' });
    expect(byName(plan.tasks, 'Columns')).toMatchObject({ start: '2026-09-15', finish: '2026-09-19' });
    // Two working days after the columns start.
    expect(byName(plan.tasks, 'Slab')).toMatchObject({ start: '2026-09-17', finish: '2026-09-23' });
    expect(byName(plan.tasks, 'Structure done')).toMatchObject({ kind: 'milestone', start: '2026-09-23' });
    expect(byName(plan.tasks, 'Substructure')).toMatchObject({
      is_summary: true,
      start: '2026-09-07',
      finish: '2026-09-14',
      critical: true,
    });
    expect(byName(plan.tasks, 'Site office')).toMatchObject({ critical: false, total_float: 13 });
    expect(plan.finish_date).toBe('2026-09-23');
    expect(plan.critical_path).toEqual(
      ['Excavation', 'Footings', 'Columns', 'Slab', 'Structure done'].map((name) => ids[name]),
    );
  });

  it('refuses a loop, a link to a summary and the same link twice, saying why', async () => {
    const loop = await link('Slab', 'Excavation').expect(422);
    expect(loop.body.message).toMatch(/loop/);
    expect(loop.body.message).toContain('Excavation → Footings → Columns → Slab → Excavation');
    expect(loop.body.details.cycle).toHaveLength(5);

    const summary = await link('Substructure', 'Site office').expect(422);
    expect(summary.body.message).toMatch(/summary task/);
    await link('Excavation', 'Footings').expect(409);
    await link('Excavation', 'Excavation').expect(422);
    // A task with links of its own cannot have tasks put under it: it would become a summary.
    await http()
      .post(`/v1/projects/${site}/schedule/tasks`)
      .set(owner)
      .send({ name: 'Under footings', parent_id: ids['Footings'] })
      .expect(422);
    // Nothing above changed the plan.
    expect((await schedule()).dependencies).toHaveLength(4);
  });

  it('edits like a Gantt: dragging the finish changes the duration, dragging the start pins it', async () => {
    const longer = await http()
      .patch(`/v1/projects/${site}/schedule/tasks/${ids['Site office']}`)
      .set(owner)
      .send({ finish_date: '2026-09-11' })
      .expect(200);
    expect(longer.body).toMatchObject({ duration_days: 5, start: '2026-09-07', finish: '2026-09-11' });

    const moved = await http()
      .patch(`/v1/projects/${site}/schedule/tasks/${ids['Site office']}`)
      .set(owner)
      .send({ start_date: '2026-09-14' })
      .expect(200);
    expect(moved.body).toMatchObject({
      constraint_type: 'snet',
      constraint_date: '2026-09-14',
      start: '2026-09-14',
      finish: '2026-09-18',
    });
    // A summary's dates are its subtasks'.
    await http()
      .patch(`/v1/projects/${site}/schedule/tasks/${ids['Substructure']}`)
      .set(owner)
      .send({ duration_days: 9 })
      .expect(422);
    await http()
      .patch(`/v1/projects/${site}/schedule/tasks/${ids['Site office']}`)
      .set(owner)
      .send({ finish_date: '2026-09-01' })
      .expect(422);
  });

  it('counts on a Gulf week with holidays when the site has its own calendar, and goes back', async () => {
    const calendar = await http()
      .put(`/v1/projects/${site}/schedule/calendar`)
      .set(owner)
      .send({ name: 'Riyadh week', working_days: [0, 1, 2, 3, 4], holidays: ['2026-09-14'] })
      .expect(200);
    expect(calendar.body).toMatchObject({ scope: 'site', working_days: [0, 1, 2, 3, 4], holidays: ['2026-09-14'] });

    const gulf = await schedule();
    // Thu 10, Sun 13, (Mon 14 holiday), Tue 15, Wed 16.
    expect(byName(gulf.tasks, 'Footings')).toMatchObject({ start: '2026-09-10', finish: '2026-09-16' });

    await http().delete(`/v1/projects/${site}/schedule/calendar`).set(owner).expect(204);
    const india = await schedule();
    expect(india.calendar.scope).toBe('default');
    expect(byName(india.tasks, 'Footings').finish).toBe('2026-09-14');

    // The company calendar is a company setting.
    await http()
      .put('/v1/schedule/calendar')
      .set(pm)
      .send({ working_days: [1, 2, 3, 4, 5] })
      .expect(403);
    const company = await http()
      .put('/v1/schedule/calendar')
      .set(owner)
      .send({ working_days: [1, 2, 3, 4, 5, 6], holidays: ['2026-10-02'] })
      .expect(200);
    expect(company.body).toMatchObject({ scope: 'company', holidays: ['2026-10-02'] });
    expect((await schedule()).calendar.scope).toBe('company');
  });

  it('starts a Saudi company on a Sunday–Thursday week', async () => {
    const exchange = await http()
      .post('/v1/auth/exchange')
      .send({ firebase_token: `dev:+9665${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}` })
      .expect(200);
    const created = await http()
      .post('/v1/tenants')
      .set('X-Onboarding-Token', exchange.body.onboarding_token)
      .send({
        name: 'Riyadh Contracting',
        owner_name: 'Owner',
        country: 'SA',
        currency: 'SAR',
        timezone: 'Asia/Riyadh',
        locale: 'en-SA',
        tax_regime: 'vat_sa',
      })
      .expect(201);
    saudiTenantId = created.body.tenant.id;
    const saudi = { Authorization: `Bearer ${created.body.tokens.access_token}` };
    const project = (
      await http().post('/v1/projects').set(saudi).send({ name: 'Olaya Tower', start_date: '2026-09-06' }).expect(201)
    ).body.id;
    const calendar = await http().get(`/v1/projects/${project}/schedule/calendar`).set(saudi).expect(200);
    expect(calendar.body).toMatchObject({ scope: 'default', working_days: [0, 1, 2, 3, 4] });

    await http()
      .post(`/v1/projects/${project}/schedule/tasks`)
      .set(saudi)
      .send({ name: 'Mobilise', duration_days: 5 })
      .expect(201);
    const plan = (await http().get(`/v1/projects/${project}/schedule`).set(saudi).expect(200)).body;
    // Sunday 6 to Thursday 10: Friday and Saturday are the weekend.
    expect(plan.tasks[0]).toMatchObject({ start: '2026-09-06', finish: '2026-09-10' });
  });

  it('saves a baseline to measure against', async () => {
    const saved = await http()
      .post(`/v1/projects/${site}/schedule/baselines`)
      .set(owner)
      .send({ name: 'Contract programme' })
      .expect(201);
    expect(saved.body).toMatchObject({ name: 'Contract programme', finish_date: '2026-09-23' });
    baseline = saved.body.id;
    expect((await schedule()).baselines.map((row) => row.id)).toEqual([baseline]);
    // Not a supervisor's to take.
    await http().post(`/v1/projects/${site}/schedule/baselines`).set(supervisor).send({ name: 'Mine' }).expect(403);
  });

  it('lets a supervisor report progress, and nothing else', async () => {
    // Excavation took a day longer than planned.
    const done = await http()
      .post(`/v1/projects/${site}/schedule/tasks/${ids['Excavation']}/progress`)
      .set(supervisor)
      .send({ actual_start: '2026-09-07', actual_finish: '2026-09-10' })
      .expect(200);
    expect(done.body).toMatchObject({ percent_complete: 100, status: 'complete', finish: '2026-09-10', critical: false });

    // Half the footings, started the day after.
    const half = await http()
      .post(`/v1/projects/${site}/schedule/tasks/${ids['Footings']}/progress`)
      .set(supervisor)
      .send({ percent_complete: 50 })
      .expect(200);
    expect(half.body).toMatchObject({ status: 'in_progress', actual_start: '2026-09-11', percent_complete: 50 });

    await http()
      .post(`/v1/projects/${site}/schedule/tasks/${ids['Columns']}/progress`)
      .set(supervisor)
      .send({ actual_start: addDays(todayIn('Asia/Kolkata'), 3) })
      .expect(422);
    await http()
      .patch(`/v1/projects/${site}/schedule/tasks/${ids['Columns']}`)
      .set(supervisor)
      .send({ duration_days: 1 })
      .expect(403);
    await http().post(`/v1/projects/${site}/schedule/tasks`).set(supervisor).send({ name: 'Mine' }).expect(403);
    await http()
      .post(`/v1/projects/${site}/schedule/dependencies`)
      .set(supervisor)
      .send({ predecessor_id: ids['Site office'], successor_id: ids['Columns'] })
      .expect(403);

    // Counted to the 14th, the remaining half of the footings runs Mon 14 – Tue 15.
    const reported = await schedule(site, { status_date: '2026-09-14' }, supervisor);
    expect(reported.can).toEqual({ manage: false, progress: true });
    expect(byName(reported.tasks, 'Footings')).toMatchObject({ start: '2026-09-11', finish: '2026-09-15' });
    expect(byName(reported.tasks, 'Columns').start).toBe('2026-09-16');
    expect(reported.critical_path).not.toContain(ids['Excavation']);
  });

  it('shows what has slipped against the baseline', async () => {
    const compared = await schedule(site, { baseline_id: baseline });
    expect(byName(compared.tasks, 'Excavation').baseline).toMatchObject({
      start: '2026-09-07',
      finish: '2026-09-09',
      finish_variance: 1,
      slipped: true,
    });
    expect(compared.baseline!.finish_variance).toBeGreaterThan(0);
    expect(compared.baseline!.slipped_count).toBeGreaterThanOrEqual(4);

    const report = await http()
      .get(`/v1/projects/${site}/schedule/baselines/${baseline}`)
      .set(accounts)
      .expect(200);
    expect(report.body.baseline.name).toBe('Contract programme');
    expect(report.body.slipped).toContain(ids['Excavation']);
    expect(report.body.slipped).toContain(ids['Slab']);
    expect(report.body.slipped).not.toContain(ids['Substructure']);
    const excavation = report.body.tasks.find((row: { name: string }) => row.name === 'Excavation');
    expect(excavation).toMatchObject({ baseline_finish: '2026-09-09', finish: '2026-09-10', finish_variance: 1 });
  });

  it('keeps the site milestones working, and carries them on the schedule', async () => {
    const plinth = await http()
      .post(`/v1/projects/${site}/milestones`)
      .set(owner)
      .send({ name: 'Plinth level', planned_date: '2026-09-30' })
      .expect(201);
    const listed = await http().get(`/v1/projects/${site}/milestones`).set(owner).expect(200);
    expect(listed.body.map((row: { name: string }) => row.name)).toContain('Plinth level');
    expect((await schedule()).unlinked_milestones.map((row) => row.id)).toEqual([plinth.body.id]);

    const added = await http().post(`/v1/projects/${site}/schedule/milestones`).set(owner).expect(200);
    expect(added.body).toEqual({ created: 1 });
    let plan = await schedule();
    expect(plan.unlinked_milestones).toEqual([]);
    const task = plan.tasks.find((row) => row.milestone?.id === plinth.body.id)!;
    expect(task).toMatchObject({ kind: 'milestone', start: '2026-09-30', constraint_type: 'snet' });

    // Reached on the old timeline screen: complete on the schedule.
    await http()
      .patch(`/v1/projects/${site}/milestones/${plinth.body.id}`)
      .set(owner)
      .send({ actual_date: '2026-10-01' })
      .expect(200);
    plan = await schedule();
    expect(plan.tasks.find((row) => row.id === task.id)).toMatchObject({
      status: 'complete',
      actual_finish: '2026-10-01',
      start: '2026-10-01',
    });

    // Not reached after all, said on the schedule: the timeline agrees.
    await http()
      .post(`/v1/projects/${site}/schedule/tasks/${task.id}/progress`)
      .set(supervisor)
      .send({ percent_complete: 0 })
      .expect(200);
    let milestone = (await http().get(`/v1/projects/${site}/milestones`).set(owner).expect(200)).body.find(
      (row: { id: string }) => row.id === plinth.body.id,
    );
    expect(milestone.actual_date).toBeNull();

    // Moved on the schedule: the milestone's planned date follows.
    await http()
      .patch(`/v1/projects/${site}/schedule/tasks/${task.id}`)
      .set(owner)
      .send({ start_date: '2026-10-05' })
      .expect(200);
    milestone = (await http().get(`/v1/projects/${site}/milestones`).set(owner).expect(200)).body.find(
      (row: { id: string }) => row.id === plinth.body.id,
    );
    expect(milestone.planned_date).toBe('2026-10-05');

    // Reorder and rename on the timeline still work with a milestone on the schedule.
    await http()
      .patch(`/v1/projects/${site}/milestones/${plinth.body.id}`)
      .set(owner)
      .send({ name: 'Plinth complete' })
      .expect(200);
    expect(
      (await schedule()).tasks.find((row) => row.id === task.id)!.milestone,
    ).toMatchObject({ name: 'Plinth complete' });
    // Only a milestone can stand for one.
    await http()
      .post(`/v1/projects/${site}/schedule/tasks`)
      .set(owner)
      .send({ name: 'Wrong', milestone_id: plinth.body.id })
      .expect(422);
  });

  describe('imports', () => {
    it('previews a Microsoft Project file before importing it', async () => {
      const preview = await http()
        .post(`/v1/projects/${villa}/schedule/import/preview`)
        .set(owner)
        .send({ xml: fixture('msproject-villa.xml') })
        .expect(200);
      expect(preview.body).toMatchObject({
        format: 'msproject',
        project_name: 'Villa 12, Al Barsha',
        task_count: 6,
        milestone_count: 2,
        summary_count: 2,
        link_count: 7,
        start: '2026-08-02',
        calendar: { working_days: [0, 1, 2, 3, 4], holidays: ['2026-12-02', '2026-12-03'] },
      });
      expect(preview.body.tasks[1]).toMatchObject({ name: 'Excavation', depth: 1, wbs: '1.1' });
      // Nothing was written.
      expect((await schedule(villa)).tasks).toEqual([]);
    });

    it('imports it, with its outline, links, progress and Gulf calendar', async () => {
      const imported = await http()
        .post(`/v1/projects/${villa}/schedule/import`)
        .set(owner)
        .send({ xml: fixture('msproject-villa.xml'), mode: 'replace', use_calendar: true })
        .expect(201);
      expect(imported.body).toMatchObject({ created: 10, links: 7 });

      const plan = await schedule(villa, { status_date: '2026-08-09' });
      expect(plan.project_start).toBe('2026-08-02');
      expect(plan.calendar).toMatchObject({ scope: 'site', name: 'Gulf Standard', working_days: [0, 1, 2, 3, 4] });
      expect(byName(plan.tasks, 'Excavation')).toMatchObject({ status: 'complete', finish: '2026-08-06' });
      expect(byName(plan.tasks, 'Footings & PCC')).toMatchObject({ status: 'in_progress', finish: '2026-08-18' });
      expect(byName(plan.tasks, 'Plinth beam')).toMatchObject({ start: '2026-08-11', finish: '2026-08-18' });
      expect(byName(plan.tasks, 'Ground floor columns')).toMatchObject({ start: '2026-08-19', finish: '2026-08-25' });
      expect(byName(plan.tasks, 'First floor slab').finish).toBe('2026-08-26');
      expect(byName(plan.tasks, 'Handover')).toMatchObject({ kind: 'milestone', start: '2026-08-26' });
      expect(byName(plan.tasks, 'Municipality inspection')).toMatchObject({ start: '2026-08-23', critical: false });
      const critical = plan.critical_path.map((id) => plan.tasks.find((task) => task.id === id)!.name);
      expect(critical).toEqual(
        expect.arrayContaining(['Footings & PCC', 'Plinth beam', 'Ground floor columns', 'First floor slab', 'Handover']),
      );
      expect(critical).not.toContain('Excavation');
      expect(byName(plan.tasks, 'Substructure').is_summary).toBe(true);

      // The site had no start date; it has the plan's now.
      const project = await http().get(`/v1/projects/${villa}`).set(owner).expect(200);
      expect(project.body.start_date).toBe('2026-08-02');
    });

    it('exports to Microsoft Project XML that reads back the same', async () => {
      const exported = await http().get(`/v1/projects/${villa}/schedule/export`).set(owner).expect(200);
      expect(exported.headers['content-type']).toMatch(/application\/xml/);
      expect(exported.text).toContain('<Name>Footings &amp; PCC</Name>');
      const again = await http()
        .post(`/v1/projects/${villa}/schedule/import/preview`)
        .set(owner)
        .send({ xml: exported.text })
        .expect(200);
      expect(again.body).toMatchObject({ task_count: 6, milestone_count: 2, summary_count: 2, link_count: 7 });
    });

    it('imports a Primavera P6 file, breakdown and all', async () => {
      const imported = await http()
        .post(`/v1/projects/${tower}/schedule/import`)
        .set(owner)
        .send({ xml: fixture('p6-tower.xml'), format: 'p6' })
        .expect(201);
      expect(imported.body.created).toBe(7);
      expect(imported.body.links).toBe(4);
      expect(imported.body.warnings.join(' ')).toMatch(/not in the file/);

      const plan = await schedule(tower, { status_date: '2026-08-06' });
      expect(plan.calendar).toMatchObject({ name: 'India 6-day', working_days: [1, 2, 3, 4, 5, 6], holidays: ['2026-08-15'] });
      expect(plan.tasks.map((task) => task.name)).toEqual([
        'Piling',
        'Mobilisation',
        'Bored piles',
        'Raft',
        'Pile caps',
        'Raft concrete',
        'Raft complete',
      ]);
      expect(byName(plan.tasks, 'Bored piles')).toMatchObject({ percent_complete: 40, finish: '2026-08-20' });
      expect(byName(plan.tasks, 'Pile caps')).toMatchObject({ start: '2026-08-11', finish: '2026-08-18' });
      // Held by its start-on-or-after date, which makes it — not the piles — the critical work.
      expect(byName(plan.tasks, 'Raft concrete')).toMatchObject({ start: '2026-08-26', finish: '2026-08-31', critical: true });
      expect(byName(plan.tasks, 'Raft complete').start).toBe('2026-08-31');
      expect(plan.critical_path).toEqual([byName(plan.tasks, 'Raft concrete').id, byName(plan.tasks, 'Raft complete').id]);
    });

    it('appends a second file below the first, and refuses what is not a schedule', async () => {
      const before = (await schedule(tower)).tasks.length;
      await http()
        .post(`/v1/projects/${tower}/schedule/import`)
        .set(owner)
        .send({ xml: fixture('p6-tower.xml'), mode: 'append', use_calendar: false })
        .expect(201);
      const after = await schedule(tower);
      expect(after.tasks).toHaveLength(before * 2);
      expect(after.tasks[before]!.name).toBe('Piling');

      const wrong = await http()
        .post(`/v1/projects/${tower}/schedule/import/preview`)
        .set(owner)
        .send({ xml: '<invoice><total>3</total></invoice>' })
        .expect(422);
      expect(wrong.body.message).toMatch(/neither a Microsoft Project XML nor a Primavera P6/);
      await http()
        .post(`/v1/projects/${tower}/schedule/import`)
        .set(supervisor)
        .send({ xml: fixture('p6-tower.xml') })
        .expect(403);
    });

    it('refuses a file whose links go round in a loop', async () => {
      // The dangling relationship now runs from the last activity back to the first.
      const looped = fixture('p6-tower.xml').replace(
        '<PredecessorActivityObjectId>9999</PredecessorActivityObjectId><SuccessorActivityObjectId>2005</SuccessorActivityObjectId>',
        '<PredecessorActivityObjectId>2005</PredecessorActivityObjectId><SuccessorActivityObjectId>2001</SuccessorActivityObjectId>',
      );
      expect(looped).not.toBe(fixture('p6-tower.xml'));
      const refused = await http()
        .post(`/v1/projects/${villa}/schedule/import`)
        .set(owner)
        .send({ xml: looped })
        .expect(422);
      expect(refused.body.message).toMatch(/loop/);
      // The villa's schedule is untouched.
      expect((await schedule(villa)).tasks).toHaveLength(10);
    });
  });

  it('lists what starts or finishes in the next two weeks, as a sheet too', async () => {
    const today = todayIn('Asia/Kolkata');
    const annex = (
      await http().post('/v1/projects').set(owner).send({ name: 'Annex', start_date: today }).expect(201)
    ).body.id;
    await addTask({ name: 'Annex footings', duration_days: 3, constraint_type: 'snet', constraint_date: addDays(today, 2) }, annex);
    await addTask({ name: 'Annex roof', duration_days: 3, constraint_type: 'snet', constraint_date: addDays(today, 40) }, annex);

    const json = await http()
      .get('/v1/schedule/look-ahead')
      .query({ project_id: annex })
      .set(owner)
      .expect(200);
    expect(json.body.from).toBe(today);
    expect(json.body.to).toBe(addDays(today, 13));
    expect(json.body.items.map((row: { task: string }) => row.task)).toEqual(['Annex footings']);
    expect(json.body.items[0]).toMatchObject({ site: 'Annex', event: 'starts_and_finishes' });

    const csv = await http()
      .get('/v1/schedule/look-ahead')
      .query({ project_id: annex, format: 'csv' })
      .set(owner)
      .expect(200);
    expect(csv.headers['content-type']).toMatch(/text\/csv/);
    expect(csv.text.split('\r\n')[0]).toBe('Site,WBS,Task,Start,Finish,Percent complete,Critical,Responsible,In window');
    expect(csv.text).toContain('Annex footings');

    // Across every site, a supervisor sees only their own.
    const theirs = await http().get('/v1/schedule/look-ahead').set(supervisor).expect(200);
    expect(
      theirs.body.items.every((row: { project_id: string }) => row.project_id === site),
    ).toBe(true);
  });

  it('gives each role what it should have', async () => {
    // Accounts reads the programme; changing it is not theirs.
    await http().get(`/v1/projects/${site}/schedule`).set(accounts).expect(200);
    await http().post(`/v1/projects/${site}/schedule/tasks`).set(accounts).send({ name: 'No' }).expect(403);
    await http()
      .post(`/v1/projects/${site}/schedule/tasks/${ids['Columns']}/progress`)
      .set(accounts)
      .send({ percent_complete: 10 })
      .expect(403);
    // The client is not shown the programme.
    await http().get(`/v1/projects/${site}/schedule`).set(client).expect(403);
    // A project manager plans their own site, and only their own.
    await http().get(`/v1/projects/${site}/schedule`).set(pm).expect(200);
    await http()
      .patch(`/v1/projects/${site}/schedule/tasks/${ids['Site office']}`)
      .set(pm)
      .send({ notes: 'Porta-cabins from the yard' })
      .expect(200);
    await http().get(`/v1/projects/${tower}/schedule`).set(pm).expect(403);
    await http().get(`/v1/projects/${tower}/schedule`).set(supervisor).expect(403);
  });

  it('keeps one company’s schedule from another', async () => {
    await http().get(`/v1/projects/${site}/schedule`).set(stranger).expect(404);
    await http()
      .patch(`/v1/projects/${site}/schedule/tasks/${ids['Columns']}`)
      .set(stranger)
      .send({ duration_days: 1 })
      .expect(404);
    await http()
      .post(`/v1/projects/${site}/schedule/import`)
      .set(stranger)
      .send({ xml: fixture('p6-tower.xml') })
      .expect(404);
    // And their own site cannot borrow ours by id.
    const theirs = (await http().post('/v1/projects').set(stranger).send({ name: 'Their site' }).expect(201)).body.id;
    await http()
      .post(`/v1/projects/${theirs}/schedule/dependencies`)
      .set(stranger)
      .send({ predecessor_id: ids['Columns'], successor_id: ids['Slab'] })
      .expect(404);
    const rows = await test.tenantDb.transaction(beta.tenantId, (tx) => tx.scheduleTask.count());
    expect(rows).toBe(0);
  });

  it('deletes a task with what hangs off it, and the baseline keeps its dates by name', async () => {
    await http().delete(`/v1/projects/${site}/schedule/tasks/${ids['Superstructure']}`).set(owner).expect(204);
    const plan = await schedule();
    expect(plan.tasks.map((task) => task.name)).not.toContain('Slab');
    expect(plan.dependencies.some((row) => row.successor_id === ids['Columns'])).toBe(false);
    const report = await http().get(`/v1/projects/${site}/schedule/baselines/${baseline}`).set(owner).expect(200);
    expect(report.body.tasks.find((row: { name: string }) => row.name === 'Slab')).toMatchObject({
      task_id: null,
      finish: null,
      baseline_finish: '2026-09-23',
    });
  });

  it('writes every change to the audit log', async () => {
    const entries = async (query: Record<string, string>) =>
      (await http().get('/v1/audit').query(query).set(owner).expect(200)).body.items as Array<{
        action: string;
        entity_id: string;
        after: Record<string, unknown> | null;
      }>;
    const onFootings = await entries({ entity: 'schedule_tasks', entity_id: ids['Footings']! });
    expect(onFootings.map((row) => row.action)).toEqual(expect.arrayContaining(['create', 'update']));
    expect((await entries({ entity: 'schedule_dependencies' })).length).toBeGreaterThanOrEqual(4);
    expect((await entries({ entity: 'schedule_calendars' })).length).toBeGreaterThanOrEqual(2);
    expect((await entries({ entity: 'schedule_baselines', entity_id: baseline })).map((row) => row.action)).toContain(
      'create',
    );
    const imported = await entries({ entity: 'projects', entity_id: villa });
    expect(imported.find((row) => row.action === 'schedule.imported')?.after).toMatchObject({
      format: 'msproject',
      tasks: 10,
      links: 7,
    });
  });
});
