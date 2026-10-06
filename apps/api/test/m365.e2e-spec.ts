import { addDays, todayIn } from '@sitebook/shared';
import { textOf } from '../src/modules/m365/email-templates';
import { RfiRemindersService } from '../src/modules/rfis/rfi-reminders.service';
import { M365_TEST_REDIRECT, M365_TEST_WEB, listenOnIpv6, restoreM365Env, startM365Env } from './utils/m365-env';
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
 * Microsoft 365 email and calendar (roadmap Phase 3, "Calendar and email"), end to end against a real
 * database and a local stand-in for Microsoft (`MockMicrosoft`): connecting with state and PKCE,
 * token storage and refresh, "send by email" for RFIs, submittals and change orders with the exact
 * Graph payloads, notification emails, the calendar sync's idempotent updates, refusing and falling
 * back when not connected, permissions, tenant isolation and the audit trail with secrets redacted.
 */
describe('Microsoft 365', () => {
  let test: TestApp;
  let microsoft: MockMicrosoft;
  let alpha: OnboardedTenant;
  let beta: OnboardedTenant;
  let owner: Auth;
  let pm: Auth;
  let pmId: string;
  let stranger: Auth;
  let site: string;

  const http = () => test.http();
  const MAILBOX = 'projects@harbour.example';

  async function invite(role: string, projectIds: string[], email?: string): Promise<{ auth: Auth; id: string }> {
    const phone = uniquePhone();
    const made = await http()
      .post('/v1/tenants/current/invite')
      .set(owner)
      .send({ phone, name: `A ${role}`, role, project_ids: projectIds })
      .expect(201);
    if (email) {
      await test.tenantDb.transaction(alpha.tenantId, (tx) => tx.user.update({ where: { id: made.body.id }, data: { email } }));
    }
    const login = await http().post('/v1/auth/exchange').send({ firebase_token: `dev:${phone}` }).expect(200);
    return { auth: { Authorization: `Bearer ${login.body.access_token}` }, id: made.body.id };
  }

  /** The whole connect: our authorize URL → Microsoft's consent → the web callback posting back. */
  async function connect(who: Auth, mailbox = MAILBOX) {
    const started = await http().post('/v1/integrations/m365/connect').set(who).send({ login_hint: mailbox }).expect(200);
    const { code, state } = microsoft.consent(started.body.redirect_url, mailbox);
    return http().post('/v1/integrations/m365/callback').set(who).send({ code, state });
  }

  async function auditRows(tenantId: string, where: Record<string, unknown> = {}) {
    return test.tenantDb.transaction(tenantId, (tx) => tx.auditLog.findMany({ where, orderBy: { createdAt: 'asc' } }));
  }

  async function newRfi(subject: string, extra: Record<string, unknown> = {}): Promise<string> {
    const made = await http()
      .post('/v1/rfis')
      .set(owner)
      .send({
        project_id: site,
        subject,
        question: 'S-201 shows FFL +9.150 at C/4 but A-110 shows +9.200.\nWhich governs?',
        discipline: 'structural',
        addressed_to_name: 'Priya Raman',
        addressed_to_email: 'Priya@Designers.example',
        ...extra,
      })
      .expect(201);
    return made.body.id;
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
    const manager = await invite('project_manager', [site], 'pm@harbour.example');
    pm = manager.auth;
    pmId = manager.id;
    await test.tenantDb.transaction(alpha.tenantId, (tx) =>
      tx.user.update({ where: { id: alpha.ownerId }, data: { email: 'owner@harbour.example' } }),
    );
  });

  afterAll(async () => {
    if (alpha) await destroyTenant(test, alpha.tenantId);
    if (beta) await destroyTenant(test, beta.tenantId);
    await test?.close();
    await microsoft?.stop();
    restoreM365Env();
  });

  // --- not connected ---------------------------------------------------------------------------------

  it('refuses to email while nothing is connected, and touches nothing on the way', async () => {
    const status = await http().get('/v1/integrations/m365/status').set(pm).expect(200);
    expect(status.body).toEqual({ connected: false, mailbox: null });

    const rfi = await newRfi('Lintel over D-04');
    const refused = await http().post(`/v1/rfis/${rfi}/email`).set(owner).send({}).expect(409);
    expect(refused.body.details).toEqual({ reason: 'm365_not_connected' });
    // The fallback is still there, and the refused email neither opened the draft nor minted a link.
    const after = await http().get(`/v1/rfis/${rfi}`).set(owner).expect(200);
    expect(after.body).toMatchObject({ status: 'draft', link_sent_at: null });
    expect(microsoft.graphRequests).toHaveLength(0);
  });

  it('keeps the connection to integrations.manage', async () => {
    await http().get('/v1/integrations/m365').set(pm).expect(403);
    await http().post('/v1/integrations/m365/connect').set(pm).send({}).expect(403);
    await http().delete('/v1/integrations/m365').set(pm).expect(403);
    const overview = await http().get('/v1/integrations/m365').set(owner).expect(200);
    expect(overview.body.deployment).toMatchObject({ configured: true, missing: [], redirect_uri: M365_TEST_REDIRECT });
    expect(overview.body.connection).toBeNull();
  });

  // --- connecting ------------------------------------------------------------------------------------

  it('connects with state and PKCE, asking only for the delegated scopes it needs', async () => {
    const started = await http().post('/v1/integrations/m365/connect').set(owner).send({ login_hint: MAILBOX }).expect(200);
    const url = new URL(started.body.redirect_url);
    expect(`${url.origin}${url.pathname}`).toBe(`${microsoft.baseUrl}/organizations/oauth2/v2.0/authorize`);
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      client_id: microsoft.clientId,
      response_type: 'code',
      redirect_uri: M365_TEST_REDIRECT,
      scope: 'offline_access Mail.Send Calendars.ReadWrite User.Read',
      code_challenge_method: 'S256',
      login_hint: MAILBOX,
    });
    expect(url.searchParams.get('state')!.length).toBeGreaterThanOrEqual(40);
    expect(url.searchParams.get('code_challenge')).toMatch(/^[A-Za-z0-9_-]{43}$/);

    // A state nobody issued is refused before Microsoft is asked anything.
    const { code, state } = microsoft.consent(started.body.redirect_url, MAILBOX);
    await http().post('/v1/integrations/m365/callback').set(owner).send({ code, state: `${state}x` }).expect(401);
    // Another company cannot finish this company's connect (RLS: the state is not theirs to find).
    await http().post('/v1/integrations/m365/callback').set(stranger).send({ code, state }).expect(401);

    const done = await http().post('/v1/integrations/m365/callback').set(owner).send({ code, state }).expect(200);
    expect(done.body.connection).toMatchObject({
      status: 'connected',
      mailbox_email: MAILBOX,
      mailbox_name: 'Projects Mailbox',
      calendar_sync: false,
      connected_by: { id: alpha.ownerId },
    });
    expect(done.body.connection.scopes).toEqual(expect.arrayContaining(['Mail.Send', 'Calendars.ReadWrite']));

    // The code exchange carried the verifier (the mock checks it against the challenge), the exact
    // redirect URI and the secret.
    const exchange = microsoft.tokenRequests.find((form) => form['grant_type'] === 'authorization_code')!;
    expect(exchange).toMatchObject({ redirect_uri: M365_TEST_REDIRECT, client_id: microsoft.clientId, code });
    expect(exchange['code_verifier']).toMatch(/^[A-Za-z0-9_-]{43}$/);

    // Single use: the same state cannot connect again.
    await http().post('/v1/integrations/m365/callback').set(owner).send({ code, state }).expect(401);

    // Tokens are stored encrypted, never in the clear.
    const row = await test.tenantDb.clientFor(alpha.tenantId).integrationM365Connection.findFirstOrThrow({});
    expect(row.refreshTokenCipher.startsWith('v1:')).toBe(true);
    expect(row.refreshTokenCipher).not.toContain('rt-');
    expect(row.accessTokenCipher!.startsWith('v1:')).toBe(true);

    const status = await http().get('/v1/integrations/m365/status').set(pm).expect(200);
    expect(status.body).toEqual({ connected: true, mailbox: MAILBOX });
  });

  it('lets only the person who started a connect finish it', async () => {
    const started = await http().post('/v1/integrations/m365/connect').set(owner).send({}).expect(200);
    const { code, state } = microsoft.consent(started.body.redirect_url, MAILBOX);
    // Somebody else in the same company holding the state (a forwarded link) is refused.
    await test.tenantDb.transaction(alpha.tenantId, (tx) =>
      tx.integrationM365AuthRequest.updateMany({ where: { usedAt: null }, data: { userId: pmId } }),
    );
    const refused = await http().post('/v1/integrations/m365/callback').set(owner).send({ code, state }).expect(403);
    expect(refused.body.message).toMatch(/person who started/);
  });

  it('refuses a mailbox Microsoft did not grant Mail.Send for', async () => {
    const before = microsoft.grantedScope;
    microsoft.grantedScope = 'Calendars.ReadWrite User.Read';
    try {
      const refused = await connect(owner, 'other@harbour.example');
      expect(refused.status).toBe(409);
      expect(refused.body.message).toMatch(/Mail\.Send/);
    } finally {
      microsoft.grantedScope = before;
    }
    // The working connection is untouched.
    const status = await http().get('/v1/integrations/m365/status').set(owner).expect(200);
    expect(status.body.mailbox).toBe(MAILBOX);
  });

  // --- sending ---------------------------------------------------------------------------------------

  let rfi: string;

  it('emails the designer the RFI from the company mailbox, with the answer link', async () => {
    rfi = await newRfi('Slab level at <grid C/4> & "D/5"');
    microsoft.clearRecords();
    const sent = await http()
      .post(`/v1/rfis/${rfi}/email`)
      .set(owner)
      .send({ cc: ['site.office@harbour.example'], note: 'Urgent — pour is Friday' })
      .expect(200);
    expect(sent.body.delivery).toMatchObject({
      kind: 'rfi_sent',
      status: 'sent',
      from: MAILBOX,
      to: ['priya@designers.example'],
      cc: ['site.office@harbour.example'],
    });
    expect(sent.body.delivery.provider_request_id).toMatch(/^req-/);
    // Sending opened the draft and stamped the link, exactly as the WhatsApp path does.
    expect(sent.body.rfi).toMatchObject({ status: 'open', label: 'RFI-002' });
    expect(sent.body.rfi.link_sent_at).not.toBeNull();

    const call = microsoft.requests('POST', '/v1.0/me/sendMail');
    expect(call).toHaveLength(1);
    const { message, saveToSentItems } = microsoft.lastMail();
    expect(saveToSentItems).toBe(true);
    expect(message.toRecipients).toEqual([{ emailAddress: { address: 'priya@designers.example', name: 'Priya Raman' } }]);
    expect(message.ccRecipients).toEqual([{ emailAddress: { address: 'site.office@harbour.example' } }]);
    expect(message.subject).toBe('RFI-002: Slab level at <grid C/4> & "D/5" — Harbour Point');
    expect(message.body.contentType).toBe('HTML');
    expect(message.internetMessageHeaders).toEqual([{ name: 'X-Buildr-Delivery-Id', value: sent.body.delivery.id }]);

    // Everything typed is escaped; the link is the real responder link and it works.
    const html: string = message.body.content;
    expect(html).toContain('Slab level at &lt;grid C/4&gt; &amp; &quot;D/5&quot;');
    expect(html).not.toContain('<grid C/4>');
    expect(html).toContain('Which governs?');
    expect(html).toContain('Urgent — pour is Friday');
    const link = /href="(https:\/\/app\.buildr\.test\/respond\/[^"]+)"/.exec(html)![1]!;
    expect(link.startsWith(`${M365_TEST_WEB}/respond/`)).toBe(true);
    const view = await http().get('/v1/rfi-links/view').query({ token: link.split('/').pop() }).expect(200);
    expect(view.body).toMatchObject({ kind: 'rfi', can_respond: true, rfi: { label: 'RFI-002' } });

    const log = await http().get(`/v1/rfis/${rfi}/emails`).set(pm).expect(200);
    expect(log.body).toEqual([expect.objectContaining({ id: sent.body.delivery.id, status: 'sent' })]);
  });

  it('records a delivery Microsoft refused, and says why', async () => {
    microsoft.failNext = { status: 403, code: 'ErrorAccessDenied', message: 'Access is denied.' };
    const refused = await http().post(`/v1/rfis/${rfi}/email`).set(owner).send({}).expect(409);
    expect(refused.body.message).toMatch(/ErrorAccessDenied/);
    const row = await test.tenantDb
      .clientFor(alpha.tenantId)
      .emailDelivery.findUniqueOrThrow({ where: { id: refused.body.details.delivery_id } });
    expect(row).toMatchObject({ status: 'failed', sentAt: null, providerRequestId: 'req-failed' });
    expect(row.error).toMatch(/ErrorAccessDenied/);
  });

  it('refreshes an expired access token, and retries once on a 401', async () => {
    // Expired at the API's clock: the next send refreshes first.
    await test.tenantDb.transaction(alpha.tenantId, (tx) =>
      tx.integrationM365Connection.updateMany({ data: { accessTokenExpiresAt: new Date(Date.now() - 1000) } }),
    );
    microsoft.clearRecords();
    await http().post(`/v1/rfis/${rfi}/email`).set(owner).send({}).expect(200);
    const refresh = microsoft.tokenRequests.filter((form) => form['grant_type'] === 'refresh_token');
    expect(refresh).toHaveLength(1);
    expect(refresh[0]).toMatchObject({ client_id: microsoft.clientId, scope: 'offline_access Mail.Send Calendars.ReadWrite User.Read' });
    expect(refresh[0]!['refresh_token']).toMatch(/^rt-/);

    // Still "valid" by our clock but dead at Microsoft's: 401, refresh, one retry.
    microsoft.expireAccessTokens();
    microsoft.clearRecords();
    await http().post(`/v1/rfis/${rfi}/email`).set(owner).send({}).expect(200);
    expect(microsoft.requests('POST', '/v1.0/me/sendMail')).toHaveLength(2);
    expect(microsoft.tokenRequests.filter((form) => form['grant_type'] === 'refresh_token')).toHaveLength(1);
  });

  it('emails the submittal reviewer their review link', async () => {
    const made = await http()
      .post('/v1/submittals')
      .set(owner)
      .send({
        project_id: site,
        title: 'Staircase steel shop drawings',
        type: 'shop_drawing',
        reviewer_kind: 'external',
        reviewer_name: 'Arun Mehta',
        reviewer_email: 'arun@mehta.example',
        files: [{ s3_key: `${alpha.tenantId}/submittals/stair-shop-drawings.pdf`, content_type: 'application/pdf', filename: 'stairs.pdf' }],
      })
      .expect(201);
    // Not before it is submitted — the same rule as the link.
    await http().post(`/v1/submittals/${made.body.id}/email`).set(owner).send({}).expect(409);
    await http().post(`/v1/submittals/${made.body.id}/submit`).set(owner).send({}).expect(200);
    microsoft.clearRecords();
    const sent = await http().post(`/v1/submittals/${made.body.id}/email`).set(owner).send({}).expect(200);
    expect(sent.body.delivery).toMatchObject({ kind: 'submittal_review', to: ['arun@mehta.example'] });
    const { message } = microsoft.lastMail();
    expect(message.subject).toBe('For review: SUB-001 Staircase steel shop drawings — Harbour Point');
    expect(message.body.content).toMatch(/href="https:\/\/app\.buildr\.test\/respond\/[^"]+"/);
  });

  it('emails the site’s clients that a change order waits on them, linking to their approvals', async () => {
    const client = await invite('client', [site], 'client@owner.example');
    void client;
    const made = await http()
      .post('/v1/change-orders')
      .set(owner)
      .send({
        project_id: site,
        title: 'Extra partition wall',
        reason: 'client_request',
        time_impact_days: 3,
        lines: [{ description: 'Brick partition', amount: '500000' }],
      })
      .expect(201);
    await http().post(`/v1/change-orders/${made.body.id}/email`).set(owner).send({}).expect(409);
    await http().post(`/v1/change-orders/${made.body.id}/submit`).set(owner).expect(200);
    await http().post(`/v1/change-orders/${made.body.id}/approve`).set(owner).send({}).expect(200);
    microsoft.clearRecords();
    const sent = await http().post(`/v1/change-orders/${made.body.id}/email`).set(owner).send({}).expect(200);
    expect(sent.body.delivery).toMatchObject({ kind: 'change_order_sent', to: ['client@owner.example'] });
    const { message } = microsoft.lastMail();
    expect(message.subject).toBe('Change order CO-001 needs your decision — Harbour Point');
    expect(message.body.content).toContain(`href="${M365_TEST_WEB}/projects/${site}?tab=approvals"`);
    // Margin never reaches the client: the email shows the price, not the cost.
    expect(textOf(message.body.content)).toContain('Price');
    expect(textOf(message.body.content)).not.toMatch(/margin|cost/i);
  });

  it('emails the team when an RFI is answered, and when RFIs go overdue', async () => {
    // Raised by the owner; the PM records the official answer → the owner hears, by email too.
    const answered = await newRfi('Rebar lap at transfer beam');
    await http().post(`/v1/rfis/${answered}/open`).set(owner).expect(200);
    microsoft.clearRecords();
    await http()
      .post(`/v1/rfis/${answered}/responses`)
      .set(pm)
      .send({ body: 'Use 50d lap as per S-301 note 4.', official: true })
      .expect(201);
    const mail = microsoft.lastMail().message;
    expect(mail.toRecipients).toEqual([{ emailAddress: { address: 'owner@harbour.example', name: 'Owner' } }]);
    expect(mail.subject).toMatch(/RFI-\d{3} answered/);
    expect(mail.body.content).toContain(`${M365_TEST_WEB}/rfis/${answered}`);
    const row = await test.tenantDb
      .clientFor(alpha.tenantId)
      .emailDelivery.findFirstOrThrow({ where: { kind: 'rfi_answered' } });
    expect(row).toMatchObject({ entityType: 'rfi', entityId: answered, status: 'sent', sentByUserId: null });

    // Overdue, on the company's clock, to whoever raised it and the site's managers.
    const late = await newRfi('Door schedule clash', { due_on: addDays(todayIn('Asia/Kolkata'), -3) });
    await http().post(`/v1/rfis/${late}/open`).set(owner).expect(200);
    microsoft.clearRecords();
    await test.app.get(RfiRemindersService).remindTenant(alpha.tenantId);
    const overdueMail = microsoft
      .requests('POST', '/v1.0/me/sendMail')
      .map((entry) => (entry.body as { message: { subject: string; toRecipients: Array<{ emailAddress: { address: string } }> } }).message)
      .find((message) => /overdue/.test(message.subject))!;
    expect(overdueMail.toRecipients.map((recipient) => recipient.emailAddress.address).sort()).toEqual([
      'owner@harbour.example',
      'pm@harbour.example',
    ]);
  });

  // --- calendar ----------------------------------------------------------------------------------------

  it('syncs milestones and RFI due dates into the calendar, idempotently', async () => {
    const calendarSite = (await http().post('/v1/projects').set(owner).send({ name: 'Calendar Court', status: 'active' }).expect(201))
      .body.id;
    const milestone = (
      await http().post(`/v1/projects/${calendarSite}/milestones`).set(owner).send({ name: 'Roof slab', planned_date: '2026-12-01' }).expect(201)
    ).body.id;
    const before = await test.tenantDb.clientFor(alpha.tenantId).rfi.count({ where: { status: 'open', dueOn: { not: null } } });

    microsoft.clearRecords();
    const on = await http().put('/v1/integrations/m365/settings').set(owner).send({ calendar_sync: true }).expect(200);
    expect(on.body.connection.calendar_sync).toBe(true);
    expect(on.body.sync).toMatchObject({ created: before + 1, updated: 0, removed: 0, failed: 0 });
    const created = microsoft.requests('POST', '/v1.0/me/events');
    const roof = created.find((entry) => (entry.body as { subject: string }).subject.startsWith('Milestone: Roof slab'))!;
    expect(roof.body).toMatchObject({
      subject: 'Milestone: Roof slab — Calendar Court',
      isAllDay: true,
      showAs: 'free',
      isReminderOn: false,
      start: { dateTime: '2026-12-01T00:00:00', timeZone: 'UTC' },
      end: { dateTime: '2026-12-02T00:00:00', timeZone: 'UTC' },
    });
    expect((roof.body as { transactionId: string }).transactionId).toBeTruthy();
    expect(microsoft.eventCount()).toBe(before + 1);

    // Nothing changed: the second sync makes no Graph calls at all.
    microsoft.clearRecords();
    const again = await http().post('/v1/integrations/m365/calendar/sync').set(owner).expect(200);
    expect(again.body.sync).toMatchObject({ created: 0, updated: 0, removed: 0, unchanged: before + 1 });
    expect(microsoft.graphRequests).toHaveLength(0);

    // The date moves: the same event is updated, not a second one made.
    await http().patch(`/v1/projects/${calendarSite}/milestones/${milestone}`).set(owner).send({ planned_date: '2026-12-08' }).expect(200);
    microsoft.clearRecords();
    const moved = await http().post('/v1/integrations/m365/calendar/sync').set(owner).expect(200);
    expect(moved.body.sync).toMatchObject({ created: 0, updated: 1 });
    expect(microsoft.requests('PATCH', '/v1.0/me/events/')).toHaveLength(1);
    expect(microsoft.requests('PATCH', '/v1.0/me/events/')[0]!.body).toMatchObject({ start: { dateTime: '2026-12-08T00:00:00' } });
    expect(microsoft.eventCount()).toBe(before + 1);

    // Achieved: it leaves the calendar.
    await http().patch(`/v1/projects/${calendarSite}/milestones/${milestone}`).set(owner).send({ actual_date: '2026-10-05' }).expect(200);
    const done = await http().post('/v1/integrations/m365/calendar/sync').set(owner).expect(200);
    expect(done.body.sync).toMatchObject({ removed: 1 });
    expect(microsoft.eventCount()).toBe(before);

    // Off: every synced event is taken out again.
    const off = await http().put('/v1/integrations/m365/settings').set(owner).send({ calendar_sync: false }).expect(200);
    expect(off.body.connection).toMatchObject({ calendar_sync: false, calendar_events: 0 });
    expect(microsoft.eventCount()).toBe(0);
  });

  // --- isolation and audit -------------------------------------------------------------------------------

  it('keeps one company’s mailbox away from every other company', async () => {
    const theirs = await http().get('/v1/integrations/m365').set(stranger).expect(200);
    expect(theirs.body.connection).toBeNull();
    expect(theirs.body.recent_deliveries).toEqual([]);
    expect((await http().get('/v1/integrations/m365/status').set(stranger).expect(200)).body).toEqual({ connected: false, mailbox: null });
    // RLS, not just the service: the rows are invisible from the other company's context.
    const visible = await test.tenantDb.transaction(beta.tenantId, async (tx) => ({
      connections: await tx.integrationM365Connection.count(),
      deliveries: await tx.emailDelivery.count(),
    }));
    expect(visible).toEqual({ connections: 0, deliveries: 0 });
    // And their RFI cannot borrow our mailbox, nor can they read ours.
    await http().get(`/v1/rfis/${rfi}/emails`).set(stranger).expect(404);
    const theirSite = (await http().post('/v1/projects').set(stranger).send({ name: 'Elsewhere' }).expect(201)).body.id;
    const theirRfi = (
      await http()
        .post('/v1/rfis')
        .set(stranger)
        .send({ project_id: theirSite, subject: 'Borrow a mailbox', question: 'Can we?', discipline: 'architectural', addressed_to_email: 'x@y.example' })
        .expect(201)
    ).body.id;
    await http().post(`/v1/rfis/${theirRfi}/email`).set(stranger).send({}).expect(409);
  });

  it('audits connecting, every email and disconnecting, with the tokens redacted', async () => {
    const connected = await auditRows(alpha.tenantId, { action: 'm365.connected' });
    expect(connected.length).toBeGreaterThanOrEqual(1);
    expect(connected[0]).toMatchObject({ actorId: alpha.ownerId, after: expect.objectContaining({ mailbox: MAILBOX }) });

    const created = await auditRows(alpha.tenantId, { entity: 'integration_m365_connections', action: 'create' });
    expect(created).toHaveLength(1);
    expect((created[0]!.after as Record<string, unknown>)['refresh_token_cipher']).toBe('[redacted]');
    // The hourly access token is not in the log at all.
    expect(created[0]!.after).not.toHaveProperty('access_token_cipher');

    const emails = await auditRows(alpha.tenantId, { entity: 'email_deliveries', action: 'create' });
    expect(emails.length).toBeGreaterThanOrEqual(5);
    expect(emails.find((row) => (row.after as { kind?: string }).kind === 'rfi_sent')!.actorId).toBe(alpha.ownerId);

    const removed = await http().delete('/v1/integrations/m365').set(owner).expect(200);
    expect(removed.body.connection).toBeNull();
    expect(await test.tenantDb.clientFor(alpha.tenantId).integrationM365Connection.count()).toBe(0);
    const disconnected = await auditRows(alpha.tenantId, { action: 'm365.disconnected' });
    expect(disconnected).toHaveLength(1);

    // No token, encrypted or not, appears anywhere in the company's log.
    const all = JSON.stringify(await auditRows(alpha.tenantId));
    expect(all).not.toMatch(/"(rt|at)-[0-9a-f-]{36}"/);
    expect(all).not.toMatch(/"v1:[A-Za-z0-9+/=]{20,}"/);

    // Disconnected: "Send by email" falls back again.
    await http().post(`/v1/rfis/${rfi}/email`).set(owner).send({}).expect(409);
  });

  it('marks the connection for reconnecting when Microsoft revokes it', async () => {
    expect((await connect(owner)).status).toBe(200);
    microsoft.revoke(MAILBOX);
    await test.tenantDb.transaction(alpha.tenantId, (tx) =>
      tx.integrationM365Connection.updateMany({ data: { accessTokenExpiresAt: new Date(Date.now() - 1000) } }),
    );
    const refused = await http().post(`/v1/rfis/${rfi}/email`).set(owner).send({}).expect(409);
    expect(refused.body.details).toEqual({ reason: 'm365_needs_reconnect' });
    const overview = await http().get('/v1/integrations/m365').set(owner).expect(200);
    expect(overview.body.connection).toMatchObject({ status: 'needs_reconnect' });
    expect(overview.body.connection.last_error).toMatch(/AADSTS70000/);
    expect((await http().get('/v1/integrations/m365/status').set(pm).expect(200)).body.connected).toBe(false);
    expect(await auditRows(alpha.tenantId, { action: 'm365.reconnect_needed' })).toHaveLength(1);

    // Connecting again puts it right.
    expect((await connect(owner)).status).toBe(200);
    expect((await http().get('/v1/integrations/m365/status').set(pm).expect(200)).body.connected).toBe(true);
  });
});
