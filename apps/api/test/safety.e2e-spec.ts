import { addDays, safetyInstantToLocal, todayIn } from '@sitebook/shared';
import { SafetyPermitsService } from '../src/modules/safety/safety-permits.service';
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
 * Safety (HSE), roadmap Phase 2, module 8: incidents through their lifecycle and the serious-incident
 * alert, corrective actions, permits to work with two signatures and the expiry alert on the
 * company's clock, toolbox talks from the roll call, observations by quick capture with no AI key,
 * the KPI figures, permissions, tenant isolation and the audit trail.
 *
 * Runs with OPENAI_API_KEY empty: every suggestion below comes from the keyword rules.
 */
describe('safety (HSE)', () => {
  let test: TestApp;
  let alpha: OnboardedTenant;
  let beta: OnboardedTenant;
  let owner: Auth;
  let pm: Auth;
  let supervisor: Auth;
  let accounts: Auth;
  let stranger: Auth;
  let supervisorId: string;
  let site: string;
  let otherSite: string;
  let raju: string;
  let selvam: string;
  let absentee: string;
  let nearMiss: string;
  let lti: string;
  let action: string;
  let permit: string;
  let permitValidTo: string;
  let talk: string;
  let observation: string;

  const tz = 'Asia/Kolkata';
  const today = todayIn(tz);
  const yesterday = addDays(today, -1);
  const http = () => test.http();
  const photoKey = (name: string) => `${alpha.tenantId}/safety_photo/p/${site}/202610/${name}.jpg`;

  async function invite(role: string, projectIds: string[]): Promise<{ auth: Auth; id: string }> {
    const phone = uniquePhone();
    const invited = await http()
      .post('/v1/tenants/current/invite')
      .set(owner)
      .send({ phone, name: `A ${role}`, role, project_ids: projectIds })
      .expect(201);
    const login = await http().post('/v1/auth/exchange').send({ firebase_token: `dev:${phone}` }).expect(200);
    return { auth: { Authorization: `Bearer ${login.body.access_token}` }, id: invited.body.id ?? invited.body.user?.id };
  }

  async function notifications(who: Auth) {
    return (await http().get('/v1/notifications').query({ limit: 50 }).set(who).expect(200)).body.items as Array<{
      type: string;
      payload: Record<string, unknown>;
    }>;
  }

  async function worker(name: string): Promise<string> {
    return (
      await http()
        .post('/v1/workers')
        .set(owner)
        .send({ name, trade: 'Mason', daily_wage: '80000', overtime_rate_per_hour: '10000', project_id: site, from_date: yesterday })
        .expect(201)
    ).body.id;
  }

  beforeAll(async () => {
    test = await createTestApp();
    alpha = await onboardTenant(test, { name: 'Safe Hands Builders', phone: uniquePhone() });
    beta = await onboardTenant(test, { name: 'Prying Builders', phone: uniquePhone() });
    owner = { Authorization: `Bearer ${alpha.accessToken}` };
    stranger = { Authorization: `Bearer ${beta.accessToken}` };

    site = (await http().post('/v1/projects').set(owner).send({ name: 'Harbour Point', status: 'active' }).expect(201)).body.id;
    otherSite = (await http().post('/v1/projects').set(owner).send({ name: 'Quiet Meadows', status: 'active' }).expect(201))
      .body.id;

    pm = (await invite('project_manager', [site])).auth;
    const sup = await invite('site_supervisor', [site]);
    supervisor = sup.auth;
    supervisorId = (await http().get('/v1/me').set(supervisor).expect(200)).body.user.id;
    accounts = (await invite('accounts', [])).auth;

    raju = await worker('Raju');
    selvam = await worker('Selvam');
    absentee = await worker('Absent Arun');

    // The roll: 8 + (8 + 2 overtime) yesterday, 8 + 4 (half day) today = 30 man-hours.
    await http()
      .post('/v1/attendance')
      .set(owner)
      .send({
        project_id: site,
        attendance_date: yesterday,
        rows: [
          { worker_id: raju, status: 'present', overtime_hours: '0' },
          { worker_id: selvam, status: 'present', overtime_hours: '2' },
          { worker_id: absentee, status: 'absent' },
        ],
      })
      .expect(201);
    await http()
      .post('/v1/attendance')
      .set(owner)
      .send({
        project_id: site,
        attendance_date: today,
        rows: [
          { worker_id: raju, status: 'present' },
          { worker_id: selvam, status: 'half_day' },
          { worker_id: absentee, status: 'absent' },
        ],
      })
      .expect(201);
  });

  afterAll(async () => {
    if (alpha) await destroyTenant(test, alpha.tenantId);
    if (beta) await destroyTenant(test, beta.tenantId);
    await test.close();
  });

  // --- incidents -------------------------------------------------------------------------------

  it('lets anyone on site report a near miss, without alerting the owners', async () => {
    const made = await http()
      .post('/v1/safety/incidents')
      .set(supervisor)
      .send({
        project_id: site,
        occurred_at: `${yesterday}T09:30`,
        type: 'near_miss',
        title: 'Brick fell from level 3',
        location: 'Block A, north face',
        immediate_action: 'Area barricaded',
      })
      .expect(201);
    expect(made.body).toMatchObject({
      number: 'INC-0001',
      status: 'reported',
      severity: 'low',
      occurred_on: yesterday,
      occurred_local: `${yesterday}T09:30`,
      recordable: false,
      serious: false,
      serious_notified_at: null,
    });
    nearMiss = made.body.id;
    expect((await notifications(owner)).some((n) => n.type === 'safety_incident.serious')).toBe(false);
  });

  it('files a report once when a phone retries it', async () => {
    const body = {
      project_id: site,
      occurred_at: `${yesterday}T08:00`,
      type: 'medical_treatment',
      title: 'Cut hand on rebar',
      client_id: '7d1c8d0e-1b2c-4c3d-8e4f-5a6b7c8d9e0f',
      people: [{ worker_id: selvam, role: 'injured', body_part: 'Left hand', injury_nature: 'Laceration' }],
    };
    const first = await http().post('/v1/safety/incidents').set(supervisor).send(body).expect(201);
    const second = await http().post('/v1/safety/incidents').set(supervisor).send(body).expect(201);
    expect(second.body.id).toBe(first.body.id);
    expect(first.body.people[0]).toMatchObject({ worker_id: selvam, name: 'Selvam', role: 'injured' });
  });

  it('alerts every owner and the site managers at once about a lost-time injury', async () => {
    const made = await http()
      .post('/v1/safety/incidents')
      .set(supervisor)
      .send({
        project_id: site,
        occurred_at: `${yesterday}T15:45`,
        type: 'lost_time_injury',
        title: 'Fall from scaffold',
        location: 'Block B',
        people: [
          { worker_id: raju, role: 'injured', body_part: 'Right ankle', injury_nature: 'Fracture' },
          { name: 'Delivery driver', role: 'witness', statement: 'Saw the board give way' },
        ],
        photo_keys: [photoKey('scene')],
      })
      .expect(201);
    lti = made.body.id;
    expect(made.body).toMatchObject({ type: 'lost_time_injury', severity: 'high', serious: true, recordable: true });
    expect(made.body.serious_notified_at).not.toBeNull();
    expect(made.body.people).toHaveLength(2);
    expect(made.body.photos).toHaveLength(1);

    const ownerAlerts = (await notifications(owner)).filter((n) => n.type === 'safety_incident.serious');
    expect(ownerAlerts).toHaveLength(1);
    expect(ownerAlerts[0]!.payload).toMatchObject({ incident_id: lti, number: made.body.number });
    expect((await notifications(pm)).filter((n) => n.type === 'safety_incident.serious')).toHaveLength(1);
    // Whoever reported it already knows.
    expect((await notifications(supervisor)).filter((n) => n.type === 'safety_incident.serious')).toHaveLength(0);

    // An edit never alerts again.
    await http().patch(`/v1/safety/incidents/${lti}`).set(supervisor).send({ lost_days: 14 }).expect(200);
    expect((await notifications(owner)).filter((n) => n.type === 'safety_incident.serious')).toHaveLength(1);
  });

  it('refuses a photo that is not this company’s safety evidence', async () => {
    await http()
      .post('/v1/safety/incidents')
      .set(supervisor)
      .send({
        project_id: site,
        occurred_at: `${yesterday}T07:00`,
        type: 'first_aid',
        title: 'Dust in eye',
        photo_keys: [`${beta.tenantId}/safety_photo/x.jpg`],
      })
      .expect(403);
  });

  it('runs an incident from reported to closed, with its actions', async () => {
    await http().post(`/v1/safety/incidents/${lti}/status`).set(supervisor).send({ status: 'investigating' }).expect(403);
    const investigating = await http()
      .post(`/v1/safety/incidents/${lti}/status`)
      .set(owner)
      .send({ status: 'investigating' })
      .expect(200);
    expect(investigating.body.status).toBe('investigating');
    expect(investigating.body.investigated_by).not.toBeNull();

    // Once it is being investigated, the reporter can no longer rewrite it.
    await http().patch(`/v1/safety/incidents/${lti}`).set(supervisor).send({ title: 'Slipped' }).expect(403);
    // An injury is not closed without saying why it happened.
    await http().post(`/v1/safety/incidents/${lti}/status`).set(owner).send({ status: 'closed' }).expect(409);
    await http().post(`/v1/safety/incidents/${lti}/status`).set(owner).send({ status: 'actions_open' }).expect(409);

    const raised = await http()
      .post(`/v1/safety/incidents/${lti}/actions`)
      .set(owner)
      .send({ kind: 'corrective', description: 'Replace damaged scaffold boards', assignee_id: supervisorId, due_on: today })
      .expect(201);
    action = raised.body.id;
    expect(raised.body).toMatchObject({ status: 'open', assignee: { id: supervisorId }, raised_on: today });
    await http()
      .post(`/v1/safety/incidents/${lti}/actions`)
      .set(supervisor)
      .send({ description: 'Not mine to raise' })
      .expect(403);

    await http().post(`/v1/safety/incidents/${lti}/status`).set(owner).send({ status: 'actions_open' }).expect(200);
    await http()
      .patch(`/v1/safety/incidents/${lti}`)
      .set(owner)
      .send({
        root_cause_whys: ['Board snapped', 'Board was split', 'Not inspected', 'No weekly scaffold inspection', ''],
        root_cause: 'No scaffold inspection regime',
      })
      .expect(200);
    await http().post(`/v1/safety/incidents/${lti}/status`).set(owner).send({ status: 'closed' }).expect(409);

    // The person it is assigned to can mark it done, but not cancel it or rewrite it.
    await http().patch(`/v1/safety/actions/${action}`).set(supervisor).send({ status: 'cancelled' }).expect(403);
    await http().patch(`/v1/safety/actions/${action}`).set(supervisor).send({ description: 'Easier' }).expect(403);
    const done = await http()
      .patch(`/v1/safety/actions/${action}`)
      .set(supervisor)
      .send({ status: 'done', note: 'Boards replaced and tagged' })
      .expect(200);
    expect(done.body).toMatchObject({ status: 'done', done_by: { id: supervisorId } });

    const closed = await http()
      .post(`/v1/safety/incidents/${lti}/status`)
      .set(owner)
      .send({ status: 'closed', note: 'Inspection regime in place' })
      .expect(200);
    expect(closed.body).toMatchObject({ status: 'closed', closure_note: 'Inspection regime in place' });
    expect(closed.body.root_cause_whys).toHaveLength(4);
    await http().patch(`/v1/safety/incidents/${lti}`).set(owner).send({ lost_days: 15 }).expect(409);

    // A closed incident can be reopened when something new comes to light.
    await http().post(`/v1/safety/incidents/${lti}/status`).set(owner).send({ status: 'investigating' }).expect(200);
    await http().post(`/v1/safety/incidents/${lti}/status`).set(owner).send({ status: 'closed' }).expect(200);
  });

  it('lets the reporter correct a report before the investigation starts', async () => {
    const fixed = await http()
      .patch(`/v1/safety/incidents/${nearMiss}`)
      .set(supervisor)
      .send({ description: 'Unsecured brick on the edge of the slab' })
      .expect(200);
    expect(fixed.body.description).toBe('Unsecured brick on the edge of the slab');
  });

  it('keeps safety away from roles without it', async () => {
    await http().get('/v1/safety/incidents').set(accounts).expect(403);
    await http()
      .post('/v1/safety/incidents')
      .set(accounts)
      .send({ project_id: site, occurred_at: `${yesterday}T07:00`, type: 'near_miss', title: 'x' })
      .expect(403);
    const listed = await http().get('/v1/safety/incidents').query({ project_id: site }).set(supervisor).expect(200);
    expect(listed.body.items.length).toBeGreaterThanOrEqual(3);
    // A supervisor on one site cannot report on another.
    await http()
      .post('/v1/safety/incidents')
      .set(supervisor)
      .send({ project_id: otherSite, occurred_at: `${yesterday}T07:00`, type: 'near_miss', title: 'x' })
      .expect(403);
  });

  // --- permits to work -------------------------------------------------------------------------

  it('needs a ticked checklist and two different signatures before a permit is active', async () => {
    const now = new Date();
    const from = safetyInstantToLocal(new Date(now.getTime() - 30 * 60_000), tz);
    permitValidTo = safetyInstantToLocal(new Date(now.getTime() + 4 * 3_600_000), tz);

    await http()
      .post('/v1/safety/permits')
      .set(supervisor)
      .send({
        project_id: site,
        type: 'hot_work',
        description: 'Welding handrail brackets',
        area: 'Level 4 stair core',
        valid_from: from,
        valid_to: safetyInstantToLocal(new Date(now.getTime() + 30 * 3_600_000), tz),
      })
      .expect(422);

    const made = await http()
      .post('/v1/safety/permits')
      .set(supervisor)
      .send({
        project_id: site,
        type: 'hot_work',
        description: 'Welding handrail brackets',
        area: 'Level 4 stair core',
        valid_from: from,
        valid_to: permitValidTo,
        crew: [raju, selvam],
      })
      .expect(201);
    permit = made.body.id;
    expect(made.body).toMatchObject({ number: 'PTW-0001', status: 'requested', checklist_complete: false });
    expect(made.body.checklist.length).toBeGreaterThan(3);
    expect(made.body.crew).toHaveLength(2);

    // A supervisor cannot sign, and nobody signs an unticked permit.
    await http().post(`/v1/safety/permits/${permit}/approve`).set(supervisor).send({ as: 'issuer' }).expect(403);
    await http().post(`/v1/safety/permits/${permit}/approve`).set(owner).send({ as: 'issuer' }).expect(409);

    const checklist = made.body.checklist.map((item: { item: string }) => ({ item: item.item, checked: true }));
    await http().patch(`/v1/safety/permits/${permit}`).set(supervisor).send({ checklist }).expect(200);

    const issued = await http().post(`/v1/safety/permits/${permit}/approve`).set(owner).send({ as: 'issuer' }).expect(200);
    expect(issued.body).toMatchObject({ status: 'requested', checklist_complete: true });
    expect(issued.body.issuer).not.toBeNull();
    // The same person cannot be both signatures.
    await http().post(`/v1/safety/permits/${permit}/approve`).set(owner).send({ as: 'area_authority' }).expect(409);
    const active = await http()
      .post(`/v1/safety/permits/${permit}/approve`)
      .set(pm)
      .send({ as: 'area_authority' })
      .expect(200);
    expect(active.body).toMatchObject({ status: 'active', expired: false });

    await http().patch(`/v1/safety/permits/${permit}`).set(supervisor).send({ area: 'Elsewhere' }).expect(409);
  });

  it('suspends and resumes a permit', async () => {
    const suspended = await http()
      .post(`/v1/safety/permits/${permit}/suspend`)
      .set(pm)
      .send({ note: 'Gas smell reported' })
      .expect(200);
    expect(suspended.body).toMatchObject({ status: 'suspended', suspended_reason: 'Gas smell reported' });
    await http().post(`/v1/safety/permits/${permit}/resume`).set(pm).expect(200);
  });

  it('alerts the signatories once when an open permit runs out, on the company clock', async () => {
    const service = test.app.get(SafetyPermitsService);
    // Before it runs out, nothing.
    expect((await service.alertExpired(alpha.tenantId)).alerted).toBe(0);

    const lapsed = new Date(new Date(`${permitValidTo}:00+05:30`).getTime() + 60_000);
    expect((await service.alertExpired(alpha.tenantId, lapsed)).alerted).toBe(1);
    expect((await service.alertExpired(alpha.tenantId, lapsed)).alerted).toBe(0);

    const alerts = (await notifications(supervisor)).filter((n) => n.type === 'safety_permit.expired');
    expect(alerts).toHaveLength(1);
    expect(alerts[0]!.payload).toMatchObject({ permit_id: permit, number: 'PTW-0001' });
    expect((await notifications(pm)).filter((n) => n.type === 'safety_permit.expired')).toHaveLength(1);

    const closed = await http().post(`/v1/safety/permits/${permit}/close`).set(supervisor).send({ note: 'Work done' }).expect(200);
    expect(closed.body).toMatchObject({ status: 'closed', close_note: 'Work done' });
    expect(closed.body.expiry_alerted_at).not.toBeNull();
  });

  // --- toolbox talks ---------------------------------------------------------------------------

  it('takes toolbox-talk attendees only from that day’s roll call', async () => {
    const roll = await http().get('/v1/safety/toolbox-talks/roll').query({ project_id: site, date: today }).set(supervisor).expect(200);
    expect(roll.body.items.map((row: { worker_id: string }) => row.worker_id).sort()).toEqual([raju, selvam].sort());

    await http()
      .post('/v1/safety/toolbox-talks')
      .set(supervisor)
      .send({ project_id: site, talk_date: today, topic_key: 'harness', attendees: [{ worker_id: absentee }] })
      .expect(422);
    await http()
      .post('/v1/safety/toolbox-talks')
      .set(supervisor)
      .send({ project_id: site, talk_date: today, topic_key: 'not_a_topic' })
      .expect(422);

    const made = await http()
      .post('/v1/safety/toolbox-talks')
      .set(supervisor)
      .send({
        project_id: site,
        talk_date: today,
        topic_key: 'harness',
        duration_minutes: 10,
        attendees: [
          { worker_id: raju, signed: true },
          { worker_id: selvam, signed: false },
        ],
        photo_keys: [photoKey('talk')],
      })
      .expect(201);
    talk = made.body.id;
    expect(made.body.topic).toBe('Using and inspecting a full-body harness');
    expect(made.body.attendees.filter((a: { signed_at: string | null }) => a.signed_at)).toHaveLength(1);

    const signed = await http().post(`/v1/safety/toolbox-talks/${talk}/attendees/${selvam}/sign`).set(supervisor).expect(200);
    expect(signed.body.attendees.every((a: { signed_at: string | null }) => a.signed_at)).toBe(true);

    const coverage = await http().get('/v1/safety/toolbox-talks/coverage').query({ week_of: today }).set(owner).expect(200);
    const harbour = coverage.body.sites.find((row: { project_id: string }) => row.project_id === site);
    expect(harbour).toMatchObject({ talks: 1, attendees: 2, on_roll: 2, coverage_percent: 100, last_talk_on: today });
    const quiet = coverage.body.sites.find((row: { project_id: string }) => row.project_id === otherSite);
    expect(quiet).toMatchObject({ talks: 0, on_roll: 0, coverage_percent: null });
  });

  // --- observations ----------------------------------------------------------------------------

  it('captures an observation from a photo and a few words with no AI key', async () => {
    const suggested = await http()
      .post('/v1/safety/observations/suggest')
      .set(supervisor)
      .send({ note: 'Trench 2m deep, sides not shored' })
      .expect(200);
    expect(suggested.body).toMatchObject({ source: 'rules', category: 'excavation', type: 'unsafe_condition' });

    const quick = await http()
      .post('/v1/safety/observations/quick')
      .set(supervisor)
      .send({ project_id: site, note: 'Worker on the slab edge without harness', photo_key: photoKey('edge') })
      .expect(201);
    observation = quick.body.observation.id;
    expect(quick.body.suggestion).toMatchObject({ source: 'rules', type: 'unsafe_act', category: 'work_at_height', severity: 'high' });
    expect(quick.body.observation).toMatchObject({
      number: 'OBS-0001',
      status: 'open',
      category: 'work_at_height',
      suggested_by: 'rules',
      description: 'Worker on the slab edge without harness',
    });
    expect(quick.body.observation.photos).toHaveLength(1);

    // A voice note needs the voice pipeline, which needs a key.
    await http()
      .post('/v1/safety/observations/quick')
      .set(supervisor)
      .send({ project_id: site, voice_s3_key: `${alpha.tenantId}/dpr_voice/p/${site}/x.webm` })
      .expect(409);

    // Good practice is recorded and done.
    const positive = await http()
      .post('/v1/safety/observations/quick')
      .set(supervisor)
      .send({ project_id: site, note: 'Good housekeeping on level 3, well done' })
      .expect(201);
    expect(positive.body.observation).toMatchObject({ type: 'positive', status: 'closed' });

    // Typed fields win over the guess.
    const typed = await http()
      .post('/v1/safety/observations/quick')
      .set(supervisor)
      .send({ project_id: site, note: 'Grinder guard missing', category: 'tools_equipment', type: 'unsafe_condition', severity: 'medium' })
      .expect(201);
    expect(typed.body.suggestion).toBeNull();
    expect(typed.body.observation.suggested_by).toBeNull();
  });

  it('closes an observation with its corrective action and a close-out photo', async () => {
    await http().post(`/v1/safety/observations/${observation}/close`).set(supervisor).send({}).expect(403);
    await http()
      .post(`/v1/safety/observations/${observation}/actions`)
      .set(owner)
      .send({ description: 'Install edge protection', assignee_id: supervisorId, due_on: addDays(today, 2) })
      .expect(201);
    const closed = await http()
      .post(`/v1/safety/observations/${observation}/close`)
      .set(supervisor)
      .send({ note: 'Guard rails fitted', closeout_photo_key: photoKey('fixed') })
      .expect(200);
    expect(closed.body).toMatchObject({ status: 'closed', close_note: 'Guard rails fitted' });
    expect(closed.body.actions[0]).toMatchObject({ status: 'done' });
    expect(closed.body.photos.map((p: { purpose: string }) => p.purpose)).toEqual(['evidence', 'closeout']);
  });

  // --- figures ---------------------------------------------------------------------------------

  it('works out man-hours, LTIFR, TRIR and days since the last LTI', async () => {
    const figures = (
      await http().get('/v1/safety/kpis').query({ from: yesterday, to: today }).set(owner).expect(200)
    ).body;
    expect(figures).toMatchObject({
      man_hours: 30,
      lti_count: 1,
      // The lost-time injury and the medical treatment case; first aid and near misses are not.
      recordable_count: 2,
      // 1 × 1,000,000 ÷ 30 and 2 × 200,000 ÷ 30.
      ltifr: 33333.33,
      trir: 13333.33,
      last_lti_on: yesterday,
      days_since_lti: 1,
    });
    expect(figures.incidents_by_type).toMatchObject({ near_miss: 1, medical_treatment: 1, lost_time_injury: 1 });
    expect(figures.observations.by_category).toMatchObject({ work_at_height: 1, housekeeping: 1, tools_equipment: 1 });
    expect(figures.observations.by_type.positive).toBe(1);
    expect(figures.permits.active).toBe(0);
    expect(figures.toolbox_talks).toBe(1);

    const harbour = figures.sites.find((row: { project_id: string }) => row.project_id === site);
    expect(harbour).toMatchObject({ man_hours: 30, lti_count: 1, has_lti: true, days_since_lti: 1 });
    const quiet = figures.sites.find((row: { project_id: string }) => row.project_id === otherSite);
    expect(quiet).toMatchObject({ man_hours: 0, ltifr: null, has_lti: false, days_since_lti: 0 });

    // A supervisor sees only their own site's figures.
    const theirs = (await http().get('/v1/safety/kpis').set(supervisor).expect(200)).body;
    expect(theirs.sites.map((row: { project_id: string }) => row.project_id)).toEqual([site]);
  });

  it('exports the registers as CSV', async () => {
    const incidents = await http().get('/v1/safety/export').query({ kind: 'incidents' }).set(owner).expect(200);
    expect(incidents.headers['content-type']).toContain('text/csv');
    expect(incidents.text).toContain('INC-0001');
    expect(incidents.text).toContain('Lost-time injury');
    const sites = await http().get('/v1/safety/export').query({ kind: 'sites', from: yesterday, to: today }).set(owner).expect(200);
    expect(sites.text).toContain('Harbour Point,30,1,2,33333.33,13333.33,1');
    const actions = await http().get('/v1/safety/export').query({ kind: 'actions' }).set(owner).expect(200);
    expect(actions.text).toContain('Replace damaged scaffold boards');
    await http().get('/v1/safety/export').query({ kind: 'everything' }).set(owner).expect(422);
  });

  // --- isolation and audit ---------------------------------------------------------------------

  it('keeps one company’s safety records from another', async () => {
    await http().get(`/v1/safety/incidents/${lti}`).set(stranger).expect(404);
    await http().get(`/v1/safety/permits/${permit}`).set(stranger).expect(404);
    await http().get(`/v1/safety/toolbox-talks/${talk}`).set(stranger).expect(404);
    await http().get(`/v1/safety/observations/${observation}`).set(stranger).expect(404);
    expect((await http().get('/v1/safety/incidents').set(stranger).expect(200)).body.items).toHaveLength(0);
    await http().patch(`/v1/safety/actions/${action}`).set(stranger).send({ status: 'open' }).expect(404);
    // Numbering is per company: the other builder's first incident is INC-0001 too.
    const theirs = await http()
      .post('/v1/projects')
      .set(stranger)
      .send({ name: 'Their site', status: 'active' })
      .expect(201);
    const report = await http()
      .post('/v1/safety/incidents')
      .set(stranger)
      .send({ project_id: theirs.body.id, occurred_at: `${yesterday}T06:00`, type: 'near_miss', title: 'Theirs' })
      .expect(201);
    expect(report.body.number).toBe('INC-0001');
  });

  it('records every change in the audit log', async () => {
    const entries = async (query: Record<string, string>) =>
      (await http().get('/v1/audit').query(query).set(owner).expect(200)).body.items as Array<{
        action: string;
        changed_fields: string[];
        actor: { id: string } | null;
      }>;
    const onIncident = await entries({ entity: 'safety_incidents', entity_id: lti });
    expect(onIncident.map((row) => row.action)).toEqual(expect.arrayContaining(['create', 'update']));
    expect(onIncident.some((row) => row.changed_fields.includes('root_cause'))).toBe(true);
    expect((await entries({ entity: 'safety_permits', entity_id: permit })).length).toBeGreaterThanOrEqual(4);
    expect((await entries({ entity: 'safety_actions', entity_id: action })).length).toBeGreaterThanOrEqual(2);
    expect((await entries({ entity: 'safety_toolbox_attendees' })).length).toBeGreaterThanOrEqual(2);
    expect((await entries({ entity: 'safety_observations', entity_id: observation })).length).toBeGreaterThanOrEqual(2);
    expect((await entries({ entity: 'safety_photos' })).length).toBeGreaterThanOrEqual(3);
  });
});
