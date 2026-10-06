import { textOf } from '../src/modules/m365/email-templates';
import { M365_TEST_WEB, listenOnIpv6, restoreM365Env, startM365Env } from './utils/m365-env';
import type { MockMicrosoft } from './utils/m365-mocks';
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
 * Site meetings (roadmap Phase 3, "Calendar and email: Microsoft 365 for meeting minutes"): booking
 * one with team members and outside addresses, the Outlook invite (and its update, not a second
 * one), the minutes and action items emailed afterwards, cancelling, permissions, site access,
 * tenant isolation and the audit trail — against a local stand-in for Microsoft Graph.
 */
describe('Site meetings', () => {
  let test: TestApp;
  let microsoft: MockMicrosoft;
  let alpha: OnboardedTenant;
  let beta: OnboardedTenant;
  let owner: Auth;
  let pm: Auth;
  let pmId: string;
  let supervisor: Auth;
  let supervisorId: string;
  let outsider: Auth;
  let client: Auth;
  let stranger: Auth;
  let site: string;
  let meeting: string;

  const http = () => test.http();

  async function invite(role: string, projectIds: string[], email?: string): Promise<{ auth: Auth; id: string }> {
    const phone = uniquePhone();
    const made = await http()
      .post('/v1/tenants/current/invite')
      .set(owner)
      .send({ phone, name: role === 'site_supervisor' ? 'Suresh Kumar' : `A ${role}`, role, project_ids: projectIds })
      .expect(201);
    if (email) {
      await test.tenantDb.transaction(alpha.tenantId, (tx) => tx.user.update({ where: { id: made.body.id }, data: { email } }));
    }
    const login = await http().post('/v1/auth/exchange').send({ firebase_token: `dev:${phone}` }).expect(200);
    return { auth: { Authorization: `Bearer ${login.body.access_token}` }, id: made.body.id };
  }

  beforeAll(async () => {
    microsoft = await startM365Env();
    test = await createTestApp();
    await listenOnIpv6(test);
    alpha = await onboardTenant(test, { name: 'Harbour Builders', phone: uniquePhone() });
    beta = await onboardTenant(test, { name: 'Prying Builders', phone: uniquePhone() });
    owner = { Authorization: `Bearer ${alpha.accessToken}` };
    stranger = { Authorization: `Bearer ${beta.accessToken}` };
    site = (await http().post('/v1/projects').set(owner).send({ name: 'Harbour Point', status: 'active' }).expect(201)).body.id;
    const otherSite = (await http().post('/v1/projects').set(owner).send({ name: 'Quiet Meadows', status: 'active' }).expect(201))
      .body.id;
    const manager = await invite('project_manager', [site], 'pm@harbour.example');
    pm = manager.auth;
    pmId = manager.id;
    // A supervisor on the site with no email on their profile: invited, but skipped by Outlook.
    const sup = await invite('site_supervisor', [site]);
    supervisor = sup.auth;
    supervisorId = sup.id;
    outsider = (await invite('site_supervisor', [otherSite])).auth;
    client = (await invite('client', [site], 'client@owner.example')).auth;
  });

  afterAll(async () => {
    if (alpha) await destroyTenant(test, alpha.tenantId);
    if (beta) await destroyTenant(test, beta.tenantId);
    await test?.close();
    await microsoft?.stop();
    restoreM365Env();
  });

  it('books a meeting with team members and outside addresses', async () => {
    // Booking is a manager's; a supervisor reads.
    const body = {
      project_id: site,
      title: 'Weekly coordination <MEP>',
      starts_at: '2026-10-12T10:00:00+05:30',
      ends_at: '2026-10-12T11:30:00+05:30',
      location: 'Site office, Block A',
      agenda: '1. Slab pour sequence\n2. MEP sleeves',
      attendees: [
        { user_id: pmId },
        { user_id: supervisorId },
        { email: 'Priya@Designers.example', name: 'Priya Raman' },
        { email: 'priya@designers.example' }, // the same person typed twice
        { user_id: pmId },
      ],
    };
    await http().post('/v1/meetings').set(supervisor).send(body).expect(403);
    await http().post('/v1/meetings').set(pm).send({ ...body, ends_at: '2026-10-12T09:00:00+05:30' }).expect(422);

    const made = await http().post('/v1/meetings').set(pm).send(body).expect(201);
    meeting = made.body.id;
    expect(made.body).toMatchObject({
      title: 'Weekly coordination <MEP>',
      status: 'scheduled',
      starts_at: '2026-10-12T04:30:00.000Z',
      ends_at: '2026-10-12T06:00:00.000Z',
      in_calendar: false,
      project: { id: site, name: 'Harbour Point' },
    });
    expect(made.body.attendees).toEqual([
      expect.objectContaining({ user_id: pmId, email: 'pm@harbour.example', external: false }),
      expect.objectContaining({ user_id: supervisorId, name: 'Suresh Kumar', email: null }),
      expect.objectContaining({ user_id: null, email: 'priya@designers.example', name: 'Priya Raman', external: true }),
    ]);

    const list = await http().get('/v1/meetings').query({ project_id: site }).set(supervisor).expect(200);
    expect(list.body).toEqual([expect.objectContaining({ id: meeting, attendee_count: 3, open_actions: 0 })]);
  });

  it('keeps meetings to the people who can see the site', async () => {
    await http().get(`/v1/meetings/${meeting}`).set(supervisor).expect(200);
    await http().get(`/v1/meetings/${meeting}`).set(outsider).expect(403);
    // A client is not given meetings by default.
    await http().get(`/v1/meetings/${meeting}`).set(client).expect(403);
    // Another company sees nothing at all.
    await http().get(`/v1/meetings/${meeting}`).set(stranger).expect(404);
    const theirs = await http().get('/v1/meetings').set(stranger).expect(200);
    expect(theirs.body).toEqual([]);
    expect(await test.tenantDb.clientFor(beta.tenantId).meeting.count()).toBe(0);
  });

  it('will not send an invite while Microsoft 365 is not connected', async () => {
    const refused = await http().post(`/v1/meetings/${meeting}/invite`).set(pm).expect(409);
    expect(refused.body.details).toEqual({ reason: 'm365_not_connected' });
    expect(microsoft.graphRequests).toHaveLength(0);
  });

  it('sends the Outlook invite from the connected calendar, and updates the same event after a change', async () => {
    const started = await http().post('/v1/integrations/m365/connect').set(owner).send({}).expect(200);
    const { code, state } = microsoft.consent(started.body.redirect_url, 'projects@harbour.example');
    await http().post('/v1/integrations/m365/callback').set(owner).send({ code, state }).expect(200);

    microsoft.clearRecords();
    const sent = await http().post(`/v1/meetings/${meeting}/invite`).set(pm).expect(200);
    expect(sent.body.invited).toEqual(['pm@harbour.example', 'priya@designers.example']);
    expect(sent.body.skipped).toEqual(['Suresh Kumar']);
    expect(sent.body.meeting).toMatchObject({ in_calendar: true });
    expect(sent.body.meeting.invite_sent_at).not.toBeNull();

    const created = microsoft.requests('POST', '/v1.0/me/events');
    expect(created).toHaveLength(1);
    expect(created[0]!.body).toMatchObject({
      subject: 'Weekly coordination <MEP> — Harbour Point',
      start: { dateTime: '2026-10-12T04:30:00', timeZone: 'UTC' },
      end: { dateTime: '2026-10-12T06:00:00', timeZone: 'UTC' },
      location: { displayName: 'Site office, Block A' },
      attendees: [
        { emailAddress: { address: 'pm@harbour.example', name: 'A project_manager' }, type: 'required' },
        { emailAddress: { address: 'priya@designers.example', name: 'Priya Raman' }, type: 'required' },
      ],
    });
    const event = created[0]!.body as { body: { contentType: string; content: string }; transactionId: string };
    expect(event.transactionId).toBeTruthy();
    expect(event.body.contentType).toBe('HTML');
    expect(event.body.content).toContain('1. Slab pour sequence<br>2. MEP sleeves');
    expect(event.body.content).toContain(`href="${M365_TEST_WEB}/meetings/${meeting}"`);

    // Moved by half an hour: the same event is updated (Outlook tells the attendees), not a new one.
    await http()
      .patch(`/v1/meetings/${meeting}`)
      .set(pm)
      .send({ starts_at: '2026-10-12T10:30:00+05:30', ends_at: '2026-10-12T12:00:00+05:30' })
      .expect(200);
    microsoft.clearRecords();
    await http().post(`/v1/meetings/${meeting}/invite`).set(pm).expect(200);
    expect(microsoft.requests('POST', '/v1.0/me/events')).toHaveLength(0);
    const patched = microsoft.requests('PATCH', '/v1.0/me/events/');
    expect(patched).toHaveLength(1);
    expect(patched[0]!.body).toMatchObject({ start: { dateTime: '2026-10-12T05:00:00', timeZone: 'UTC' } });
    expect(patched[0]!.body).not.toHaveProperty('transactionId');
    expect(microsoft.eventCount()).toBe(1);
  });

  it('keeps minutes and action items, and emails them to the attendees', async () => {
    await http().post(`/v1/meetings/${meeting}/minutes/send`).set(pm).send({}).expect(422);

    const written = await http()
      .patch(`/v1/meetings/${meeting}`)
      .set(pm)
      .send({ minutes: 'Pour moved to Friday.\nSleeves <confirmed> by MEP.' })
      .expect(200);
    expect(written.body.status).toBe('held');

    await http().post(`/v1/meetings/${meeting}/action-items`).set(supervisor).send({ description: 'x' }).expect(403);
    const withOwner = await http()
      .post(`/v1/meetings/${meeting}/action-items`)
      .set(pm)
      .send({ description: 'Mark sleeve positions on L3', owner_user_id: supervisorId, due_on: '2026-10-14' })
      .expect(201);
    const withName = await http()
      .post(`/v1/meetings/${meeting}/action-items`)
      .set(pm)
      .send({ description: 'Issue revised S-201', owner_name: 'Priya Raman', due_on: '2000-01-01' })
      .expect(201);
    expect(withName.body.action_items).toEqual([
      expect.objectContaining({ description: 'Mark sleeve positions on L3', owner: { user_id: supervisorId, name: 'Suresh Kumar' }, status: 'open' }),
      expect.objectContaining({ description: 'Issue revised S-201', owner: { user_id: null, name: 'Priya Raman' }, overdue: true }),
    ]);
    const item = withOwner.body.action_items[0].id;
    const done = await http().patch(`/v1/meetings/${meeting}/action-items/${item}`).set(pm).send({ status: 'done' }).expect(200);
    expect(done.body.action_items[0]).toMatchObject({ status: 'done', overdue: false });
    expect(done.body.action_items[0].completed_at).not.toBeNull();

    microsoft.clearRecords();
    const sent = await http().post(`/v1/meetings/${meeting}/minutes/send`).set(pm).send({ note: 'Please check your actions' }).expect(200);
    expect(sent.body.delivery).toMatchObject({
      kind: 'meeting_minutes',
      status: 'sent',
      from: 'projects@harbour.example',
      to: ['pm@harbour.example', 'priya@designers.example'],
    });
    expect(sent.body.skipped).toEqual(['Suresh Kumar']);
    expect(sent.body.meeting.minutes_sent_at).not.toBeNull();
    expect(sent.body.meeting.emails).toEqual([expect.objectContaining({ id: sent.body.delivery.id })]);

    const { message } = microsoft.lastMail();
    expect(message.subject).toBe('Minutes: Weekly coordination <MEP> — Harbour Point');
    const html: string = message.body.content;
    expect(html).toContain('Sleeves &lt;confirmed&gt; by MEP.');
    expect(html).not.toContain('<confirmed>');
    const text = textOf(html);
    expect(text).toContain('Mark sleeve positions on L3 (done)');
    expect(text).toContain('Suresh Kumar');
    expect(text).toContain('Issue revised S-201');
    expect(text).toContain('Please check your actions');
    expect(text).toContain(`${M365_TEST_WEB}/meetings/${meeting}`);
  });

  it('cancels the meeting and its Outlook invite, and will not erase one people were sent', async () => {
    await http().delete(`/v1/meetings/${meeting}`).set(pm).expect(409);
    microsoft.clearRecords();
    const cancelled = await http().post(`/v1/meetings/${meeting}/cancel`).set(pm).expect(200);
    expect(cancelled.body.status).toBe('cancelled');
    const cancel = microsoft.requests('POST', '/v1.0/me/events/');
    expect(cancel).toHaveLength(1);
    expect(cancel[0]!.path).toMatch(/\/cancel$/);
    expect(microsoft.eventCount()).toBe(0);
    await http().post(`/v1/meetings/${meeting}/invite`).set(pm).expect(409);

    // A meeting nobody heard about can simply be deleted.
    const draft = await http()
      .post('/v1/meetings')
      .set(pm)
      .send({ project_id: site, title: 'Snag walk', starts_at: '2026-10-20T09:00:00Z', ends_at: '2026-10-20T10:00:00Z' })
      .expect(201);
    await http().delete(`/v1/meetings/${draft.body.id}`).set(pm).expect(204);
    await http().get(`/v1/meetings/${draft.body.id}`).set(pm).expect(404);
  });

  it('audits the meeting, its invite and its minutes', async () => {
    const rows = await test.tenantDb.transaction(alpha.tenantId, (tx) =>
      tx.auditLog.findMany({ where: { entityId: meeting }, orderBy: { createdAt: 'asc' } }),
    );
    const actions = rows.map((row) => `${row.entity}:${row.action}`);
    expect(actions).toEqual(
      expect.arrayContaining([
        'meetings:create',
        'meetings:update',
        'meetings:meeting.invite_sent',
        'meetings:meeting.minutes_sent',
        'meetings:meeting.cancelled',
      ]),
    );
    const invited = rows.find((row) => row.action === 'meeting.invite_sent')!;
    expect(invited.actorId).toBe(pmId);
    const items = await test.tenantDb.transaction(alpha.tenantId, (tx) =>
      tx.auditLog.count({ where: { entity: 'meeting_action_items' } }),
    );
    expect(items).toBeGreaterThanOrEqual(3);
  });
});
