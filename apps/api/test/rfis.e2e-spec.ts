import jwt from 'jsonwebtoken';
import { addDays, todayIn } from '@sitebook/shared';
import { TenantCache } from '../src/common/auth/tenant-cache.service';
import { RfiRemindersService } from '../src/modules/rfis/rfi-reminders.service';
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
 * RFIs (roadmap Phase 2, module 9): the lifecycle from draft to closed, overdue and reminders on the
 * company's clock, the designer answering through a signed link with no account (and that link
 * seeing nothing else, and dying when expired, withdrawn or voided), raising a draft change order
 * from an RFI, permissions, tenant isolation and the audit trail.
 *
 * Runs with OPENAI_API_KEY empty: "draft with AI" is off and says so.
 */
describe('RFIs', () => {
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
  let drawing: string;
  let rfi: string;
  let token: string;
  let second: string;

  // A company far east of India: its "today" is often the server's tomorrow.
  const zone = 'Pacific/Kiritimati';
  const http = () => test.http();
  const tokenOf = (path: string) => path.split('/').pop()!;

  async function invite(role: string, projectIds: string[]): Promise<{ auth: Auth; id: string }> {
    const phone = uniquePhone();
    await http()
      .post('/v1/tenants/current/invite')
      .set(owner)
      .send({ phone, name: `A ${role}`, role, project_ids: projectIds })
      .expect(201);
    const login = await http().post('/v1/auth/exchange').send({ firebase_token: `dev:${phone}` }).expect(200);
    const auth = { Authorization: `Bearer ${login.body.access_token}` };
    const me = await http().get('/v1/me').set(auth).expect(200);
    return { auth, id: me.body.user.id };
  }

  async function document(projectId: string, title: string): Promise<string> {
    const presigned = await http()
      .post('/v1/uploads/presign')
      .set(owner)
      .send({ kind: 'document', content_type: 'application/pdf', content_length: 4000, project_id: projectId })
      .expect(200);
    const made = await http()
      .post('/v1/documents')
      .set(owner)
      .send({
        project_id: projectId,
        title,
        category: 'drawing',
        s3_key: presigned.body.s3_key,
        content_type: 'application/pdf',
        size_bytes: 4000,
      })
      .expect(201);
    return made.body.id;
  }

  beforeAll(async () => {
    test = await createTestApp();
    alpha = await onboardTenant(test, { name: 'Clear Questions Builders', phone: uniquePhone() });
    beta = await onboardTenant(test, { name: 'Prying Builders', phone: uniquePhone() });
    owner = { Authorization: `Bearer ${alpha.accessToken}` };
    stranger = { Authorization: `Bearer ${beta.accessToken}` };
    await test.tenantDb.transaction(alpha.tenantId, (tx) =>
      tx.tenant.update({ where: { id: alpha.tenantId }, data: { timezone: zone } }),
    );
    test.app.get(TenantCache).invalidate(alpha.tenantId);

    site = (await http().post('/v1/projects').set(owner).send({ name: 'Harbour Point', status: 'active' }).expect(201)).body.id;
    otherSite = (await http().post('/v1/projects').set(owner).send({ name: 'Quiet Meadows', status: 'active' }).expect(201))
      .body.id;
    pm = (await invite('project_manager', [site])).auth;
    const sup = await invite('site_supervisor', [site]);
    supervisor = sup.auth;
    supervisorId = sup.id;
    accounts = (await invite('accounts', [])).auth;
    drawing = await document(site, 'S-201 Level 3 slab');
  });

  afterAll(async () => {
    if (alpha) await destroyTenant(test, alpha.tenantId);
    if (beta) await destroyTenant(test, beta.tenantId);
    await test.close();
  });

  // --- raising -----------------------------------------------------------------------------------

  it('lets a supervisor raise a draft, numbered per site, against a drawing', async () => {
    const made = await http()
      .post('/v1/rfis')
      .set(supervisor)
      .send({
        project_id: site,
        subject: 'Slab level at grid C/4',
        question: 'S-201 shows FFL +9.150 at C/4 but A-110 shows +9.200. Which governs?',
        discipline: 'structural',
        priority: 'high',
        location: 'Level 3, grid C/4',
        addressed_to_name: 'Priya Raman',
        addressed_to_email: 'priya@designers.example',
        addressed_to_company: 'Raman Structural Consultants',
        addressed_to_phone: '+91 98450 12345',
        document_ids: [drawing],
      })
      .expect(201);
    rfi = made.body.id;
    expect(made.body).toMatchObject({
      label: 'RFI-001',
      status: 'draft',
      overdue: false,
      due_on: null,
      discipline: 'structural',
      addressed_to: { company: 'Raman Structural Consultants', phone: '919845012345' },
      raised_by: { id: supervisorId },
    });
    expect(made.body.documents).toEqual([expect.objectContaining({ id: drawing, title: 'S-201 Level 3 slab' })]);

    // Per site: the other site's first RFI is RFI-001 too.
    const elsewhere = await http()
      .post('/v1/rfis')
      .set(owner)
      .send({ project_id: otherSite, subject: 'Gate width', question: 'What is the clear gate width?' })
      .expect(201);
    expect(elsewhere.body.label).toBe('RFI-001');

    // A drawing from another site cannot be referenced.
    const foreign = await document(otherSite, 'Q-1');
    await http()
      .post('/v1/rfis')
      .set(owner)
      .send({ project_id: site, subject: 'X', question: 'Y?', document_ids: [foreign] })
      .expect(422);
  });

  it('opens with the company’s default due date, counted on the company’s calendar', async () => {
    await http()
      .put('/v1/rfis/settings')
      .set(owner)
      .send({ rfi_due_days: 5, submittal_review_days: 10, reminder_days_before: 2 })
      .expect(200);
    const settings = await http().get('/v1/rfis/settings').set(supervisor).expect(200);
    expect(settings.body).toMatchObject({ rfi_due_days: 5, ai_enabled: false });

    const opened = await http().post(`/v1/rfis/${rfi}/open`).set(supervisor).expect(200);
    const today = todayIn(zone);
    expect(opened.body).toMatchObject({ status: 'open', due_on: addDays(today, 5), overdue: false });
    expect(opened.body.sent_at).toBeTruthy();
  });

  it('is overdue the day after its due date on the company’s clock, and reminds once', async () => {
    const today = todayIn(zone);
    const late = await http()
      .post('/v1/rfis')
      .set(owner)
      .send({
        project_id: site,
        subject: 'Lintel over D3',
        question: 'Is the lintel over D3 precast or cast in situ?',
        open: true,
        due_on: addDays(today, -1),
        assignee_id: supervisorId,
      })
      .expect(201);
    second = late.body.id;
    expect(late.body).toMatchObject({ label: 'RFI-002', status: 'open', overdue: true });

    // Due today is not overdue: the designer has until the end of the day they were given.
    await http().patch(`/v1/rfis/${rfi}`).set(supervisor).send({ due_on: today }).expect(200);
    const log = await http().get('/v1/rfis').query({ project_id: site, overdue: 'true' }).set(pm).expect(200);
    expect(log.body.items.map((row: { id: string }) => row.id)).toEqual([second]);
    expect(log.body.stats).toMatchObject({ overdue: 1 });

    const reminders = test.app.get(RfiRemindersService);
    // RFI-002 overdue, RFI-001 due today (inside the two-day window).
    expect((await reminders.remindTenant(alpha.tenantId)).reminded).toBe(2);
    expect((await reminders.remindTenant(alpha.tenantId)).reminded).toBe(0);
    const inbox = await http().get('/v1/notifications').set(supervisor).expect(200);
    const types = inbox.body.items.map((n: { type: string }) => n.type);
    expect(types).toEqual(expect.arrayContaining(['rfi.overdue', 'rfi.due_soon']));
  });

  it('keeps "draft with AI" off without a key', async () => {
    await http()
      .post('/v1/rfis/draft-ai')
      .set(supervisor)
      .send({ project_id: site, question: 'slab level C4 dont match arch dwg which one' })
      .expect(409);
  });

  // --- the designer's link -----------------------------------------------------------------------

  it('sends the designer a link and a message, without an account', async () => {
    const sent = await http().post(`/v1/rfis/${rfi}/link`).set(supervisor).expect(200);
    expect(sent.body.path).toMatch(/^\/respond\/.+/);
    expect(sent.body.message).toContain('RFI-001');
    expect(sent.body.message).toContain('{url}');
    expect(sent.body.phone).toBe('919845012345');
    expect(sent.body.email).toBe('priya@designers.example');
    token = tokenOf(sent.body.path);

    const view = await http().get('/v1/rfi-links/view').query({ token }).expect(200);
    expect(view.body).toMatchObject({
      kind: 'rfi',
      company: { name: 'Clear Questions Builders' },
      site: { name: 'Harbour Point' },
      can_respond: true,
      rfi: { label: 'RFI-001', subject: 'Slab level at grid C/4', status: 'open' },
    });
    expect(view.body.rfi.documents).toEqual([expect.objectContaining({ title: 'S-201 Level 3 slab', version: 1 })]);
    // One record only: no other RFI, no team, no money.
    const text = JSON.stringify(view.body);
    expect(text).not.toContain('Lintel over D3');
    expect(text).not.toContain('Gate width');
    expect(text).not.toMatch(/budget|phone|email|"id":/i);
  });

  it('takes the designer’s answer with files uploaded through the link only', async () => {
    const presigned = await http()
      .post('/v1/rfi-links/presign')
      .send({ token, content_type: 'application/pdf', content_length: 2000, filename: 'SK-07.pdf' })
      .expect(200);
    expect(presigned.body.s3_key.startsWith(`${alpha.tenantId}/rfi_external/rfi/${rfi}/`)).toBe(true);

    // A key from anywhere else in the company's storage is refused.
    await http()
      .post('/v1/rfi-links/answer')
      .send({
        token,
        name: 'Priya Raman',
        body: 'See attached',
        attachments: [{ s3_key: `${alpha.tenantId}/document/p/${site}/202610/other.pdf` }],
      })
      .expect(403);

    const answered = await http()
      .post('/v1/rfi-links/answer')
      .send({
        token,
        name: 'Priya Raman',
        email: 'priya@designers.example',
        body: 'Architectural level +9.200 governs. Revised S-201 rev B to follow.',
        attachments: [{ s3_key: presigned.body.s3_key, content_type: 'application/pdf', filename: 'SK-07.pdf' }],
      })
      .expect(200);
    expect(answered.body.rfi.status).toBe('answered');
    expect(answered.body.rfi.responses).toEqual([
      expect.objectContaining({ author_name: 'Priya Raman', external: true, is_official: true }),
    ]);

    const detail = await http().get(`/v1/rfis/${rfi}`).set(pm).expect(200);
    expect(detail.body).toMatchObject({ status: 'answered', overdue: false });
    expect(detail.body.answered_at).toBeTruthy();
    expect(detail.body.responses[0].attachments).toEqual([expect.objectContaining({ filename: 'SK-07.pdf' })]);
    const inbox = await http().get('/v1/notifications').set(supervisor).expect(200);
    expect(inbox.body.items.map((n: { type: string }) => n.type)).toContain('rfi.answered');
  });

  it('refuses an expired, withdrawn or foreign link, and one used for the wrong thing', async () => {
    const expired = jwt.sign(
      { tenantId: alpha.tenantId, kind: 'rfi', recordId: rfi, version: 0, purpose: 'rfi_link' },
      process.env['JWT_SECRET']!,
      { issuer: 'sitebook', audience: 'rfi_link', expiresIn: -10 },
    );
    await http().get('/v1/rfi-links/view').query({ token: expired }).expect(404);
    // A worker link or a session is not an RFI link, even though they share a signing key.
    await http().get('/v1/rfi-links/view').query({ token: alpha.accessToken }).expect(404);
    // An RFI link is not a submittal review.
    await http()
      .post('/v1/rfi-links/review')
      .send({ token, name: 'Priya', outcome: 'approved' })
      .expect(404);

    // Withdrawn: every link sent so far stops working, and a new one works.
    await http().post(`/v1/rfis/${rfi}/link/revoke`).set(supervisor).expect(200);
    await http().get('/v1/rfi-links/view').query({ token }).expect(404);
    const again = await http().post(`/v1/rfis/${rfi}/link`).set(supervisor).expect(200);
    token = tokenOf(again.body.path);
    await http().get('/v1/rfi-links/view').query({ token }).expect(200);
  });

  // --- the workflow ------------------------------------------------------------------------------

  it('records a reply, moves the official answer, reopens and closes', async () => {
    // Closing needs an official answer — it has one (the designer's).
    const reply = await http()
      .post(`/v1/rfis/${rfi}/responses`)
      .set(supervisor)
      .send({ body: 'Confirmed on the call: +9.200 throughout bay C.', on_behalf_of: 'Priya Raman', official: true })
      .expect(201);
    const official = reply.body.responses.filter((r: { is_official: boolean }) => r.is_official);
    expect(official).toHaveLength(1);
    expect(official[0].author.name).toBe('Priya Raman (recorded by A site_supervisor)');

    const reopened = await http().post(`/v1/rfis/${rfi}/reopen`).set(pm).send({ note: 'Bay D not covered' }).expect(200);
    expect(reopened.body).toMatchObject({ status: 'open', answered_at: null });
    await http().post(`/v1/rfis/${rfi}/close`).set(pm).send({}).expect(409);

    const marked = await http()
      .post(`/v1/rfis/${rfi}/responses/${reply.body.responses[1].id}/official`)
      .set(pm)
      .expect(200);
    expect(marked.body.status).toBe('answered');
    const closed = await http().post(`/v1/rfis/${rfi}/close`).set(pm).send({ note: 'Built to +9.200' }).expect(200);
    expect(closed.body).toMatchObject({ status: 'closed', close_note: 'Built to +9.200' });
    expect(closed.body.closed_by).toBeTruthy();

    // A closed RFI is the record: no edits, no answers, and its link reads but takes no answer.
    await http().patch(`/v1/rfis/${rfi}`).set(pm).send({ subject: 'Changed' }).expect(409);
    const view = await http().get('/v1/rfi-links/view').query({ token }).expect(200);
    expect(view.body.can_respond).toBe(false);
    await http().post('/v1/rfi-links/answer').send({ token, name: 'Priya', body: 'More' }).expect(409);
    await http()
      .post('/v1/rfi-links/presign')
      .send({ token, content_type: 'image/jpeg', content_length: 10 })
      .expect(409);
  });

  it('raises a draft change order from an RFI, with its drawings attached', async () => {
    await http().post(`/v1/rfis/${second}/change-order`).set(supervisor).expect(403);
    const raised = await http().post(`/v1/rfis/${rfi}/change-order`).set(pm).expect(201);
    expect(raised.body.change_order.label).toBe('CO-001');
    expect(raised.body.rfi).toMatchObject({ cost_impact: true, change_order: { label: 'CO-001', status: 'draft' } });

    const changeOrder = await http().get(`/v1/change-orders/${raised.body.change_order.id}`).set(pm).expect(200);
    expect(changeOrder.body).toMatchObject({ status: 'draft', reason: 'design_change', title: 'RFI-001: Slab level at grid C/4' });
    expect(changeOrder.body.description).toContain('Confirmed on the call');
    expect(changeOrder.body.attachments).toHaveLength(1);

    await http().post(`/v1/rfis/${rfi}/change-order`).set(pm).expect(409);
  });

  it('voids, kills the link, and only deletes a draft never sent', async () => {
    const sent = await http().post(`/v1/rfis/${second}/link`).set(owner).expect(200);
    const secondToken = tokenOf(sent.body.path);
    await http().post(`/v1/rfis/${second}/void`).set(owner).send({}).expect(422);
    const voided = await http().post(`/v1/rfis/${second}/void`).set(owner).send({ reason: 'Answered on drawing A-112' }).expect(200);
    expect(voided.body).toMatchObject({ status: 'void', overdue: false, void_reason: 'Answered on drawing A-112' });
    await http().get('/v1/rfi-links/view').query({ token: secondToken }).expect(404);
    await http().delete(`/v1/rfis/${second}`).set(owner).expect(409);

    const draft = await http().post('/v1/rfis').set(owner).send({ project_id: site, subject: 'Temp', question: 'Temp?' }).expect(201);
    await http().delete(`/v1/rfis/${draft.body.id}`).set(owner).expect(204);
  });

  // --- registers ---------------------------------------------------------------------------------

  it('filters the log, works out the response time, and exports CSV', async () => {
    const log = await http().get('/v1/rfis').query({ project_id: site }).set(pm).expect(200);
    expect(log.body.stats).toMatchObject({ closed: 1, overdue: 0 });
    expect(typeof log.body.stats.avg_response_days).toBe('number');
    const byParty = await http().get('/v1/rfis').query({ party: 'raman' }).set(owner).expect(200);
    expect(byParty.body.items.map((row: { label: string }) => row.label)).toEqual(['RFI-001']);
    const structural = await http().get('/v1/rfis').query({ discipline: 'structural' }).set(owner).expect(200);
    expect(structural.body.items).toHaveLength(1);

    const exported = await http().get('/v1/rfis/export').query({ project_id: site }).set(pm).expect(200);
    expect(exported.headers['content-type']).toContain('text/csv');
    expect(exported.text).toContain('RFI-001,Harbour Point,Slab level at grid C/4,Structural,High,Closed');
  });

  // --- permissions, isolation, audit -------------------------------------------------------------

  it('keeps RFIs to the people allowed to see them', async () => {
    await http().get('/v1/rfis').set(accounts).expect(403);
    await http().post('/v1/rfis').set(accounts).send({ project_id: site, subject: 'X', question: 'Y?' }).expect(403);
    // A supervisor sees their own site's log, not a site they are not on.
    await http().get('/v1/rfis').query({ project_id: otherSite }).set(supervisor).expect(403);
    const mine = await http().get('/v1/rfis').set(supervisor).expect(200);
    expect(mine.body.items.every((row: { project: { id: string } }) => row.project.id === site)).toBe(true);
    // The company defaults are the account's administrators' to set.
    await http()
      .put('/v1/rfis/settings')
      .set(pm)
      .send({ rfi_due_days: 1, submittal_review_days: 1, reminder_days_before: 0 })
      .expect(403);
  });

  it('keeps one company’s RFIs from another', async () => {
    await http().get(`/v1/rfis/${rfi}`).set(stranger).expect(404);
    expect((await http().get('/v1/rfis').set(stranger).expect(200)).body.items).toHaveLength(0);
    await http().post(`/v1/rfis/${rfi}/link`).set(stranger).expect(404);
    await http().post(`/v1/rfis/${rfi}/responses`).set(stranger).send({ body: 'Mine' }).expect(404);
  });

  it('records every change in the audit log', async () => {
    const entries = async (query: Record<string, string>) =>
      (await http().get('/v1/audit').query(query).set(owner).expect(200)).body.items as Array<{
        action: string;
        changed_fields: string[];
      }>;
    const onRfi = await entries({ entity: 'rfis', entity_id: rfi });
    expect(onRfi.map((row) => row.action)).toEqual(expect.arrayContaining(['create', 'update']));
    expect(onRfi.some((row) => row.changed_fields.includes('status'))).toBe(true);
    expect((await entries({ entity: 'rfi_responses' })).length).toBeGreaterThanOrEqual(2);
    expect((await entries({ entity: 'rfi_documents' })).length).toBeGreaterThanOrEqual(1);
    expect((await entries({ entity: 'rfi_attachments' })).length).toBeGreaterThanOrEqual(1);
    expect((await entries({ entity: 'rfi_settings' })).length).toBeGreaterThanOrEqual(1);
  });
});
