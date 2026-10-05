import { addDays, todayIn } from '@sitebook/shared';
import { TenantCache } from '../src/common/auth/tenant-cache.service';
import { env } from '../src/config/env';
import { firesIn, tickWindow } from '../src/jobs/tenant-clock';
import { QualityTestsService } from '../src/modules/quality/quality-tests.service';
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
 * QA/QC (roadmap Phase 2, module 7): the checklist library, inspections whose failed lines become
 * snags, sign-off by the inspector and the client, cube tests with their reminders on the
 * company's own clock, the snag lifecycle including a reopen, quick capture with no AI key, the
 * client's punch list, who may do what, and that none of it leaks between companies or escapes
 * the audit log.
 */
describe('QA/QC', () => {
  let test: TestApp;
  let alpha: OnboardedTenant;
  let beta: OnboardedTenant;
  let owner: Auth;
  let pm: Auth;
  let supervisor: Auth;
  let accounts: Auth;
  let client: Auth;
  let stranger: Auth;
  let supervisorId: string;
  let site: string;
  let otherSite: string;
  let contractor: string;
  let rebarTemplate: string;
  let inspection: string;
  let failedSnag: string;
  const http = () => test.http();

  /** A key shaped like one `/uploads/presign` issues; nothing is uploaded — only signed. */
  const photo = (tenantId: string, kind = 'quality_photo') =>
    `${tenantId}/${kind}/p/${site}/202610/${Math.random().toString(16).slice(2)}.jpg`;

  async function invite(role: string, projectIds: string[]): Promise<{ auth: Auth; id: string }> {
    const phone = uniquePhone();
    const invited = await http()
      .post('/v1/tenants/current/invite')
      .set(owner)
      .send({ phone, name: `A ${role}`, role, project_ids: projectIds })
      .expect(201);
    const login = await http().post('/v1/auth/exchange').send({ firebase_token: `dev:${phone}` }).expect(200);
    return { auth: { Authorization: `Bearer ${login.body.access_token}` }, id: invited.body.id };
  }

  beforeAll(async () => {
    test = await createTestApp();
    alpha = await onboardTenant(test, { name: 'Pour Card Builders', phone: uniquePhone() });
    beta = await onboardTenant(test, { name: 'Peeking Builders', phone: uniquePhone() });
    owner = { Authorization: `Bearer ${alpha.accessToken}` };
    stranger = { Authorization: `Bearer ${beta.accessToken}` };

    site = (await http().post('/v1/projects').set(owner).send({ name: 'Lake View', status: 'active' }).expect(201)).body.id;
    otherSite = (await http().post('/v1/projects').set(owner).send({ name: 'Hill View', status: 'active' }).expect(201)).body.id;
    contractor = (
      await http().post('/v1/contractors').set(owner).send({ name: 'Rao Tiling Works', trade: 'Tiling' }).expect(201)
    ).body.id;

    pm = (await invite('project_manager', [site])).auth;
    const sup = await invite('site_supervisor', [site]);
    supervisor = sup.auth;
    supervisorId = sup.id;
    accounts = (await invite('accounts', [])).auth;
    client = (await invite('client', [site])).auth;
  });

  afterAll(async () => {
    if (alpha) await destroyTenant(test, alpha.tenantId);
    if (beta) await destroyTenant(test, beta.tenantId);
    await test.close();
  });

  // --- the library -------------------------------------------------------------------------------

  it('starts every company with the standard checklists, and lets a manager edit its own', async () => {
    const library = await http().get('/v1/quality/templates').set(supervisor).expect(200);
    const names = library.body.map((t: { name: string }) => t.name);
    for (const expected of [
      'Pre-pour concrete check',
      'Reinforcement inspection',
      'Formwork / shuttering',
      'Brickwork / blockwork',
      'Plastering',
      'Waterproofing',
      'Tiling',
      'Electrical first fix',
      'Plumbing pressure test',
    ]) {
      expect(names).toContain(expected);
    }
    // Opening it again does not copy it twice.
    expect((await http().get('/v1/quality/templates').set(owner).expect(200)).body).toHaveLength(names.length);

    // A supervisor runs checklists; writing them is the quality manager's.
    const draft = {
      name: 'Slab rebar — Block A',
      trade: 'Concrete',
      items: [
        { label: 'Bar diameters as per BBS', kind: 'pass_fail' },
        { label: 'Clear cover', kind: 'number', unit: 'mm', target_value: '25', tolerance_minus: '0', tolerance_plus: '10' },
        { label: 'Cover blocks fixed', kind: 'photo' },
        { label: 'Steel batch / heat number', kind: 'text', required: false },
        { label: 'Chairs at 1 m centres', kind: 'pass_fail' },
      ],
    };
    await http().post('/v1/quality/templates').set(supervisor).send(draft).expect(403);
    // A tolerance on a pass/fail line means nothing and is refused.
    await http()
      .post('/v1/quality/templates')
      .set(pm)
      .send({ ...draft, items: [{ label: 'x', kind: 'pass_fail', target_value: '3' }] })
      .expect(422);
    const made = await http().post('/v1/quality/templates').set(pm).send(draft).expect(201);
    expect(made.body).toMatchObject({ name: draft.name, item_count: 5, standard: false });
    expect(made.body.items[2]).toMatchObject({ kind: 'photo', photo_required: true });
    rebarTemplate = made.body.id;
    await http().post('/v1/quality/templates').set(pm).send(draft).expect(409);
  });

  // --- an inspection -----------------------------------------------------------------------------

  it('runs a checklist on a site and judges a reading against its tolerance', async () => {
    // Not a site the supervisor is on.
    await http()
      .post('/v1/quality/inspections')
      .set(supervisor)
      .send({ project_id: otherSite, template_id: rebarTemplate, location: 'Block B' })
      .expect(403);

    const started = await http()
      .post('/v1/quality/inspections')
      .set(supervisor)
      .send({ project_id: site, template_id: rebarTemplate, location: 'Block A, 3rd floor slab', share_with_client: true })
      .expect(201);
    inspection = started.body.id;
    expect(started.body).toMatchObject({
      status: 'in_progress',
      result: null,
      location: 'Block A, 3rd floor slab',
      inspector: { id: supervisorId },
      counts: { total: 5, answered: 0, failed: 0 },
    });
    expect(started.body.number).toBeGreaterThan(0);
    expect(started.body.problems.length).toBeGreaterThan(0);

    // Editing the library afterwards never reaches an inspection already started.
    await http()
      .patch(`/v1/quality/templates/${rebarTemplate}`)
      .set(owner)
      .send({ items: [{ label: 'Only line', kind: 'pass_fail' }] })
      .expect(200);
    expect((await http().get(`/v1/quality/inspections/${inspection}`).set(pm).expect(200)).body.items).toHaveLength(5);

    const items = started.body.items as Array<{ id: string; label: string }>;
    const line = (label: string) => items.find((item) => item.label === label)!.id;
    const cover = line('Clear cover');

    // 38 mm against 25 +10/−0 is out, whatever was tapped.
    const answered = await http()
      .put(`/v1/quality/inspections/${inspection}/items`)
      .set(supervisor)
      .send({
        items: [
          { id: line('Bar diameters as per BBS'), outcome: 'pass' },
          { id: cover, number_value: '38', outcome: 'pass', comment: 'Cover blocks missing near column C4', photo_keys: [photo(alpha.tenantId)] },
          { id: line('Cover blocks fixed'), outcome: 'pass' },
        ],
      })
      .expect(200);
    expect(answered.body.items.find((i: { id: string }) => i.id === cover)).toMatchObject({
      outcome: 'fail',
      number_value: '38',
    });
    // A photo line with no photo, and an unanswered required line, block the signature.
    const blocked = await http()
      .post(`/v1/quality/inspections/${inspection}/complete`)
      .set(supervisor)
      .send({ signature_name: 'Suresh Kumar' })
      .expect(409);
    expect(blocked.body.details.problems).toEqual(
      expect.arrayContaining(['“Cover blocks fixed” needs a photo', '“Chairs at 1 m centres” has not been answered']),
    );

    // Another company's photo is not one this inspection can hold.
    await http()
      .put(`/v1/quality/inspections/${inspection}/items`)
      .set(supervisor)
      .send({ items: [{ id: line('Cover blocks fixed'), photo_keys: [photo(beta.tenantId)] }] })
      .expect(403);

    await http()
      .put(`/v1/quality/inspections/${inspection}/items`)
      .set(supervisor)
      .send({
        items: [
          { id: line('Cover blocks fixed'), photo_keys: [photo(alpha.tenantId)] },
          { id: line('Chairs at 1 m centres'), outcome: 'na' },
        ],
      })
      .expect(200);
  });

  it('signs it as failed and raises a snag for the failed line, with its photo', async () => {
    // A failed line cannot be signed off as a pass with comments.
    const signed = await http()
      .post(`/v1/quality/inspections/${inspection}/complete`)
      .set(supervisor)
      .send({ signature_name: 'Suresh Kumar', result: 'pass_with_comments' })
      .expect(200);
    expect(signed.body).toMatchObject({
      status: 'completed',
      result: 'fail',
      snag_count: 1,
      signed_by: ['inspector'],
      problems: [],
    });
    expect(signed.body.signoffs[0]).toMatchObject({ party: 'inspector', signature_name: 'Suresh Kumar' });
    const failed = signed.body.items.find((i: { outcome: string }) => i.outcome === 'fail');
    expect(failed.snag).toMatchObject({ status: 'open' });
    failedSnag = failed.snag.id;

    const snag = await http().get(`/v1/quality/snags/${failedSnag}`).set(pm).expect(200);
    expect(snag.body).toMatchObject({
      title: 'Clear cover',
      source: 'inspection',
      status: 'open',
      priority: 'high',
      location: 'Block A, 3rd floor slab',
      trade: 'Concrete',
      inspection: { id: inspection },
    });
    expect(snag.body.description).toContain('Measured 38 mm');
    expect(snag.body.photos).toHaveLength(1);
    expect(snag.body.photos[0].stage).toBe('before');
    expect(snag.body.photos[0].url).toEqual(expect.any(String));

    // Signed is signed.
    await http()
      .put(`/v1/quality/inspections/${inspection}/items`)
      .set(supervisor)
      .send({ items: [{ id: failed.id, outcome: 'pass' }] })
      .expect(409);
    await http().delete(`/v1/quality/inspections/${inspection}`).set(owner).expect(409);

    // The site's manager was told.
    const inbox = await http().get('/v1/notifications').set(pm).expect(200);
    expect(inbox.body.items.map((n: { type: string }) => n.type)).toContain('quality.inspection_failed');
  });

  it('lets the client countersign what was shared with them, once', async () => {
    const shared = await http().get(`/v1/projects/${site}/quality/shared-inspections`).set(client).expect(200);
    expect(shared.body.items.map((i: { id: string }) => i.id)).toEqual([inspection]);
    await http().get(`/v1/quality/inspections/${inspection}`).set(client).expect(200);

    // The client is not the quality team: the registers themselves are not theirs.
    await http().get('/v1/quality/inspections').set(client).expect(403);
    await http().get('/v1/quality/snags').set(client).expect(403);

    const countersigned = await http()
      .post(`/v1/quality/inspections/${inspection}/sign`)
      .set(client)
      .send({ signature_name: 'Vikram Shah', accepted: false, note: 'Fix the cover before the pour' })
      .expect(200);
    expect(countersigned.body.signed_by).toEqual(['inspector', 'client']);
    expect(countersigned.body.signoffs[1]).toMatchObject({ party: 'client', accepted: false });
    await http()
      .post(`/v1/quality/inspections/${inspection}/sign`)
      .set(client)
      .send({ signature_name: 'Vikram Shah' })
      .expect(409);

    // A consultant (anyone with `quality.verify` who is not the client) signs as such; a
    // supervisor cannot.
    await http().post(`/v1/quality/inspections/${inspection}/sign`).set(supervisor).send({ signature_name: 'S K' }).expect(403);
    const consultant = await http()
      .post(`/v1/quality/inspections/${inspection}/sign`)
      .set(pm)
      .send({ signature_name: 'Anita Rao, PMC' })
      .expect(200);
    expect(consultant.body.signed_by).toEqual(['inspector', 'client', 'consultant']);

    // An unshared inspection stays out of the client's sight.
    const hidden = await http()
      .post('/v1/quality/inspections')
      .set(pm)
      .send({ project_id: site, template_id: rebarTemplate, location: 'Block A, 4th floor' })
      .expect(201);
    await http().get(`/v1/quality/inspections/${hidden.body.id}`).set(client).expect(404);
    await http().delete(`/v1/quality/inspections/${hidden.body.id}`).set(pm).expect(204);
  });

  // --- the snag lifecycle ------------------------------------------------------------------------

  it('takes a snag from open to fixed to closed, and back when the fix does not hold', async () => {
    await http()
      .patch(`/v1/quality/snags/${failedSnag}`)
      .set(pm)
      .send({ assigned_user_id: supervisorId, assigned_contractor_id: contractor, due_on: addDays(todayIn('Asia/Kolkata'), -1), client_visible: true })
      .expect(200);
    const overdue = await http().get('/v1/quality/snags').query({ overdue: 'true' }).set(pm).expect(200);
    expect(overdue.body.items.map((s: { id: string }) => s.id)).toContain(failedSnag);
    expect((await http().get('/v1/notifications').set(supervisor).expect(200)).body.items.map((n: { type: string }) => n.type)).toContain(
      'snag.assigned',
    );

    // Fixed needs the "after" photo, and only an open snag can be fixed or a fixed one closed.
    await http().post(`/v1/quality/snags/${failedSnag}/fix`).set(supervisor).send({ photo_keys: [] }).expect(422);
    await http().post(`/v1/quality/snags/${failedSnag}/verify`).set(pm).send({}).expect(409);
    const fixed = await http()
      .post(`/v1/quality/snags/${failedSnag}/fix`)
      .set(supervisor)
      .send({ note: 'Cover blocks added', photo_keys: [photo(alpha.tenantId)] })
      .expect(200);
    expect(fixed.body.status).toBe('fixed');
    expect(fixed.body.overdue).toBe(false);
    expect(fixed.body.photos.map((p: { stage: string }) => p.stage)).toEqual(['before', 'after']);

    // Whoever fixed it does not get to close it.
    await http().post(`/v1/quality/snags/${failedSnag}/verify`).set(supervisor).send({}).expect(403);
    await http().post(`/v1/quality/snags/${failedSnag}/reopen`).set(pm).send({}).expect(422);
    const reopened = await http()
      .post(`/v1/quality/snags/${failedSnag}/reopen`)
      .set(pm)
      .send({ reason: 'Two blocks still missing at C4' })
      .expect(200);
    expect(reopened.body).toMatchObject({ status: 'open', reopen_count: 1, fixed_at: null });

    await http().post(`/v1/quality/snags/${failedSnag}/fix`).set(supervisor).send({ photo_keys: [photo(alpha.tenantId)] }).expect(200);
    const closed = await http().post(`/v1/quality/snags/${failedSnag}/verify`).set(pm).send({ note: 'Checked' }).expect(200);
    expect(closed.body.status).toBe('closed');
    expect(closed.body.closed_at).toEqual(expect.any(String));
    await http().patch(`/v1/quality/snags/${failedSnag}`).set(pm).send({ title: 'x' }).expect(409);
    await http().delete(`/v1/quality/snags/${failedSnag}`).set(owner).expect(409);

    const timeline = (await http().get(`/v1/quality/snags/${failedSnag}`).set(pm).expect(200)).body.events;
    expect(timeline.map((e: { action: string }) => e.action)).toEqual(['raised', 'fixed', 'reopened', 'fixed', 'closed']);
    expect(timeline[2].note).toBe('Two blocks still missing at C4');
  });

  it('turns a photo and a few words into a draft snag without any AI key', async () => {
    const draft = await http()
      .post('/v1/quality/snags/quick')
      .set(supervisor)
      .send({
        project_id: site,
        note: 'water leaking from the pipe joint under the basin in flat 204',
        photo_keys: [photo(alpha.tenantId)],
        location: 'Flat 204, master bath',
      })
      .expect(201);
    expect(draft.body).toMatchObject({
      status: 'draft',
      source: 'quick_capture',
      trade: 'Plumbing',
      priority: 'high',
      ai_suggested: false,
      location: 'Flat 204, master bath',
    });
    expect(draft.body.title).toMatch(/^Water leaking from the pipe joint/);
    expect(draft.body.photos).toHaveLength(1);

    // A voice note with nothing to transcribe it is kept for somebody to listen to.
    const spoken = await http()
      .post('/v1/quality/snags/quick')
      .set(supervisor)
      .send({ project_id: site, voice_s3_key: photo(alpha.tenantId, 'dpr_voice').replace('.jpg', '.webm') })
      .expect(201);
    expect(spoken.body).toMatchObject({ status: 'draft', title: 'Voice note snag', transcript: null });
    await http().delete(`/v1/quality/snags/${spoken.body.id}`).set(supervisor).expect(204);

    // Nothing at all is not a snag; a worker's passport scan is not a snag photo.
    await http().post('/v1/quality/snags/quick').set(supervisor).send({ project_id: site }).expect(422);
    await http()
      .post('/v1/quality/snags/quick')
      .set(supervisor)
      .send({ project_id: site, photo_keys: [photo(alpha.tenantId, 'worker_document')] })
      .expect(403);

    // A draft is nobody's job until it is confirmed, and never on the client's punch list.
    await http().patch(`/v1/quality/snags/${draft.body.id}`).set(supervisor).send({ client_visible: true }).expect(200);
    let punch = await http().get(`/v1/projects/${site}/punch-list`).set(client).expect(200);
    expect(punch.body.items.map((s: { id: string }) => s.id)).not.toContain(draft.body.id);
    await http().post(`/v1/quality/snags/${draft.body.id}/fix`).set(supervisor).send({ photo_keys: [photo(alpha.tenantId)] }).expect(409);
    const confirmed = await http().post(`/v1/quality/snags/${draft.body.id}/open`).set(supervisor).expect(200);
    expect(confirmed.body.status).toBe('open');
    punch = await http().get(`/v1/projects/${site}/punch-list`).set(client).expect(200);
    expect(punch.body.items.map((s: { id: string }) => s.id)).toContain(draft.body.id);
  });

  it('shows the client the handover punch list — client-visible snags only, no internals', async () => {
    await http()
      .post('/v1/quality/snags')
      .set(pm)
      .send({ project_id: site, title: 'Internal: rework shuttering yard', assigned_user_id: supervisorId })
      .expect(201);
    const visible = await http()
      .post('/v1/quality/snags')
      .set(pm)
      .send({
        project_id: site,
        title: 'Chipped tile at the lobby entrance',
        trade: 'Tiling',
        priority: 'low',
        assigned_contractor_id: contractor,
        client_visible: true,
        photo_keys: [photo(alpha.tenantId)],
      })
      .expect(201);

    const punch = await http().get(`/v1/projects/${site}/punch-list`).set(client).expect(200);
    const titles = punch.body.items.map((s: { title: string }) => s.title);
    expect(titles).toContain('Chipped tile at the lobby entrance');
    expect(titles).toContain('Clear cover');
    expect(titles).not.toContain('Internal: rework shuttering yard');
    const tile = punch.body.items.find((s: { id: string }) => s.id === visible.body.id);
    expect(tile.photos[0]).toMatchObject({ stage: 'before', url: expect.any(String) });
    // Who inside the company was told to fix it is not part of what the client is shown.
    expect(tile).not.toHaveProperty('assigned_contractor');
    expect(tile).not.toHaveProperty('assigned_user');

    // A client on another site sees nothing of this one.
    await http().get(`/v1/projects/${otherSite}/punch-list`).set(client).expect(403);
  });

  // --- material tests ----------------------------------------------------------------------------

  it('logs a cube set as one test per age, due on the company’s calendar, and reminds once', async () => {
    // A company far east of India: its "today" is often India's tomorrow.
    const zone = 'Pacific/Kiritimati';
    await test.tenantDb.transaction(alpha.tenantId, (tx) =>
      tx.tenant.update({ where: { id: alpha.tenantId }, data: { timezone: zone } }),
    );
    test.app.get(TenantCache).invalidate(alpha.tenantId);
    const today = todayIn(zone);

    // A cube set needs its cast date.
    await http()
      .post('/v1/quality/tests')
      .set(supervisor)
      .send({ project_id: site, test_type: 'concrete_cube', sample_ref: 'C-14' })
      .expect(422);
    const cubes = await http()
      .post('/v1/quality/tests')
      .set(supervisor)
      .send({
        project_id: site,
        test_type: 'concrete_cube',
        sample_ref: 'C-14',
        grade: 'M25',
        location: 'Block A, 3rd floor slab',
        cast_on: addDays(today, -7),
        spec_min: '25',
      })
      .expect(201);
    expect(cubes.body.items).toHaveLength(2);
    const [early, late] = cubes.body.items;
    expect(early).toMatchObject({ age_days: 7, due_on: today, spec_min: '16.2', unit: 'N/mm²', state: 'due' });
    expect(late).toMatchObject({ age_days: 28, due_on: addDays(today, 21), spec_min: '25', state: 'scheduled' });

    const due = await http().get('/v1/quality/tests').query({ state: 'due', project_id: site }).set(pm).expect(200);
    expect(due.body.items.map((t: { id: string }) => t.id)).toEqual([early.id]);

    // The morning job runs this for each company whose clock just reached the configured time.
    const service = test.app.get(QualityTestsService);
    expect((await service.remindTenant(alpha.tenantId)).reminded).toBe(1);
    expect((await service.remindTenant(alpha.tenantId)).reminded).toBe(0);
    const inbox = await http().get('/v1/notifications').set(supervisor).expect(200);
    expect(inbox.body.items.map((n: { type: string }) => n.type)).toContain('quality.tests_due');

    // "7 am" is 7 am where the company is: the tick that fires for Kiritimati does not for India.
    const sevenThere = new Date(`${today}T07:00:00+14:00`);
    const window = tickWindow(new Date(sevenThere.getTime() + 60_000));
    expect(firesIn(env().QUALITY_TEST_DUE_CRON, zone, window)).toBe(true);
    expect(firesIn(env().QUALITY_TEST_DUE_CRON, 'Asia/Kolkata', window)).toBe(false);
  });

  it('judges a lab result against the specification and raises a snag on a failure', async () => {
    const listed = await http().get('/v1/quality/tests').query({ sample_ref: 'C-14' }).set(pm).expect(200);
    const [early, late] = listed.body.items;

    const passed = await http()
      .post(`/v1/quality/tests/${early.id}/result`)
      .set(supervisor)
      .send({ result_value: '17.4', lab_name: 'City Materials Lab', report_s3_key: photo(alpha.tenantId, 'quality_report').replace('.jpg', '.pdf') })
      .expect(200);
    expect(passed.body).toMatchObject({ result: 'pass', state: 'pass', snag: null, lab_name: 'City Materials Lab' });
    expect(passed.body.report.url).toEqual(expect.any(String));

    const failed = await http().post(`/v1/quality/tests/${late.id}/result`).set(supervisor).send({ result_value: '22.1' }).expect(200);
    expect(failed.body).toMatchObject({ result: 'fail', state: 'fail', snag: { status: 'open' } });
    const snag = await http().get(`/v1/quality/snags/${failed.body.snag.id}`).set(pm).expect(200);
    expect(snag.body).toMatchObject({ source: 'test', priority: 'high', trade: 'Concrete', test: { id: late.id } });
    expect(snag.body.description).toContain('22.1 N/mm² against ≥ 25 N/mm²');

    // A recorded figure is evidence.
    await http().delete(`/v1/quality/tests/${late.id}`).set(owner).expect(409);

    // A slump is a range; out of it either way is a fail.
    const slump = await http()
      .post('/v1/quality/tests')
      .set(supervisor)
      .send({ project_id: site, test_type: 'concrete_slump', sample_ref: 'S-3', spec_min: '75', spec_max: '100' })
      .expect(201);
    const judged = await http()
      .post(`/v1/quality/tests/${slump.body.items[0].id}/result`)
      .set(supervisor)
      .send({ result_value: '120', raise_snag: false })
      .expect(200);
    expect(judged.body).toMatchObject({ result: 'fail', snag: null, unit: 'mm' });
  });

  // --- reports -----------------------------------------------------------------------------------

  it('reports open snags by site, trade, assignee and age, the pass rate, and test failures', async () => {
    const report = await http().get('/v1/quality/reports/summary').query({ project_id: site }).set(pm).expect(200);
    expect(report.body.inspections).toMatchObject({ completed: 1, failed: 1, pass_rate_bp: 0 });
    expect(report.body.snags.open).toBeGreaterThanOrEqual(3);
    expect(report.body.snags.by_trade.map((r: { trade: string }) => r.trade)).toEqual(
      expect.arrayContaining(['Plumbing', 'Tiling', 'Concrete']),
    );
    expect(report.body.snags.by_assignee.map((r: { name: string }) => r.name)).toEqual(
      expect.arrayContaining(['Rao Tiling Works', 'A site_supervisor']),
    );
    expect(report.body.snags.by_age[0]).toMatchObject({ bucket: '0-7' });
    expect(report.body.tests).toMatchObject({ failed: 2, passed: 1 });
    expect(report.body.tests.failures.map((t: { sample_ref: string }) => t.sample_ref)).toEqual(
      expect.arrayContaining(['C-14', 'S-3']),
    );

    const csv = await http().get('/v1/quality/export/snags').query({ project_id: site }).set(pm).expect(200);
    expect(csv.headers['content-type']).toContain('text/csv');
    const lines = csv.text.replace(String.fromCharCode(0xfeff), '').trim().split('\r\n');
    expect(lines[0]).toContain('"Number","Site","Title"');
    expect(csv.text).toContain('Chipped tile at the lobby entrance');
    expect((await http().get('/v1/quality/export/tests').set(owner).expect(200)).text).toContain('"C-14"');
    expect((await http().get('/v1/quality/export/inspections').set(owner).expect(200)).text).toContain('"Fail"');
    await http().get('/v1/quality/export/other').set(owner).expect(404);
  });

  // --- who may do what ---------------------------------------------------------------------------

  it('keeps quality to those who hold it', async () => {
    // Accounts has nothing to do with it; a client only the punch list.
    await http().get('/v1/quality/snags').set(accounts).expect(403);
    await http().get('/v1/quality/reports/summary').set(accounts).expect(403);
    await http().post('/v1/quality/snags').set(client).send({ project_id: site, title: 'x' }).expect(403);
    // A supervisor reads and raises, but does not write the library or close their own fixes.
    await http().get('/v1/quality/snags').set(supervisor).expect(200);
    await http().delete(`/v1/quality/templates/${rebarTemplate}`).set(supervisor).expect(403);
    // A supervisor sees only their own sites' snags.
    await http()
      .post('/v1/quality/snags')
      .set(owner)
      .send({ project_id: otherSite, title: 'Hill View handrail loose' })
      .expect(201);
    const mine = await http().get('/v1/quality/snags').set(supervisor).expect(200);
    expect(mine.body.items.every((s: { project: { id: string } }) => s.project.id === site)).toBe(true);
    // …and so do the reports they read.
    const theirReport = await http().get('/v1/quality/reports/summary').set(supervisor).expect(200);
    expect(theirReport.body.snags.by_site.map((r: { project: { id: string } }) => r.project.id)).toEqual([site]);
    await http().get('/v1/quality/reports/summary').query({ project_id: otherSite }).set(supervisor).expect(403);

    // A used checklist is archived rather than deleted.
    await http().delete(`/v1/quality/templates/${rebarTemplate}`).set(pm).expect(204);
    const archived = await http().get('/v1/quality/templates').query({ include_archived: 'true' }).set(pm).expect(200);
    expect(archived.body.find((t: { id: string }) => t.id === rebarTemplate)).toMatchObject({ active: false });
    await http()
      .post('/v1/quality/inspections')
      .set(pm)
      .send({ project_id: site, template_id: rebarTemplate, location: 'x' })
      .expect(409);
  });

  it('never shows one company another’s quality record', async () => {
    await http().get(`/v1/quality/snags/${failedSnag}`).set(stranger).expect(404);
    await http().get(`/v1/quality/inspections/${inspection}`).set(stranger).expect(404);
    await http().post(`/v1/quality/snags/${failedSnag}/reopen`).set(stranger).send({ reason: 'peeking in' }).expect(404);
    await http().get(`/v1/projects/${site}/punch-list`).set(stranger).expect(404);
    const theirs = await http().get('/v1/quality/snags').set(stranger).expect(200);
    expect(theirs.body.items).toEqual([]);
    const theirTests = await http().get('/v1/quality/tests').set(stranger).expect(200);
    expect(theirTests.body.items).toEqual([]);
    // Their library is their own copy.
    const library = await http().get('/v1/quality/templates').set(stranger).expect(200);
    expect(library.body.map((t: { id: string }) => t.id)).not.toContain(rebarTemplate);
  });

  it('records every change in the audit log, with who made it', async () => {
    const entries = async (entity: string, entityId?: string) =>
      (
        await http()
          .get('/v1/audit')
          .query({ entity, ...(entityId ? { entity_id: entityId } : {}), limit: 200 })
          .set(owner)
          .expect(200)
      ).body.items as Array<{ action: string; actor: { id: string } | null; changed_fields: string[] }>;

    const snag = await entries('snags', failedSnag);
    expect(snag.length).toBeGreaterThanOrEqual(5);
    expect(snag.some((e) => e.changed_fields?.includes('status'))).toBe(true);
    expect(snag.map((e) => e.actor?.id).filter(Boolean)).toContain(supervisorId);

    for (const table of [
      'quality_checklist_templates',
      'quality_checklist_items',
      'quality_inspections',
      'quality_inspection_items',
      'quality_inspection_signoffs',
      'quality_tests',
      'snag_photos',
      'snag_events',
    ]) {
      expect((await entries(table)).length).toBeGreaterThan(0);
    }
  });
});
