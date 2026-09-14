import {
  disableModule,
  createTestApp,
  destroyTenant,
  onboardTenant,
  uniquePhone,
  type OnboardedTenant,
  type TestApp,
} from './utils/test-app';

/**
 * The client portal and documents (spec §3 items 13 and 14).
 *
 * Almost every test here is about the client seeing exactly what was meant for them and nothing
 * else. That is the whole product risk: a builder will put their costings, their supplier prices
 * and their opinion of the client into this system, and one leak of any of it ends the account.
 */
describe('client portal', () => {
  let test: TestApp;
  let tenant: OnboardedTenant;
  let owner: Record<string, string>;
  let client: Record<string, string>;
  let clientUserId: string;
  let projectId: string;
  let otherProjectId: string;

  beforeAll(async () => {
    test = await createTestApp();
    // Both modules are Pro.
    tenant = await onboardTenant(test, {
      name: 'Portal Builders',
      phone: uniquePhone(),
      plan: 'one_year',
    });
    owner = { Authorization: `Bearer ${tenant.accessToken}` };

    const project = await test
      .http()
      .post('/v1/projects')
      .set(owner)
      .send({ name: 'Client Tower' })
      .expect(201);
    projectId = project.body.id;

    const other = await test
      .http()
      .post('/v1/projects')
      .set(owner)
      .send({ name: 'Not Their Job' })
      .expect(201);
    otherProjectId = other.body.id;

    const phone = uniquePhone();
    const invited = await test
      .http()
      .post('/v1/tenants/current/invite')
      .set(owner)
      .send({ name: 'Vikram Shah', phone, role: 'client', project_ids: [projectId] })
      .expect(201);
    clientUserId = invited.body.id;

    const session = await test
      .http()
      .post('/v1/auth/exchange')
      .send({ firebase_token: `dev:${phone}` })
      .expect(200);
    client = { Authorization: `Bearer ${session.body.access_token}` };
  });

  afterAll(async () => {
    if (tenant) await destroyTenant(test, tenant.tenantId);
    await test.close();
  });

  describe('the conversation', () => {
    it('lets the client ask and the builder answer, in one thread', async () => {
      const asked = await test
        .http()
        .post(`/v1/projects/${projectId}/messages`)
        .set(client)
        .send({ body: 'Is the bathroom tile the one we chose?' })
        .expect(201);
      expect(asked.body.author.name).toBe('Vikram Shah');
      expect(asked.body.audience).toBe('everyone');

      await test
        .http()
        .post(`/v1/projects/${projectId}/messages`)
        .set(owner)
        .send({ body: 'Yes — the samples went up this morning.' })
        .expect(201);

      const thread = await test
        .http()
        .get(`/v1/projects/${projectId}/messages`)
        .set(client)
        .expect(200);
      expect(thread.body.items).toHaveLength(2);
      // `mine` is what lets the UI put your own words on the right without comparing ids itself.
      expect(thread.body.items.map((row: { mine: boolean }) => row.mine)).toEqual([false, true]);
    });

    it('never shows the client a team note', async () => {
      await test
        .http()
        .post(`/v1/projects/${projectId}/messages`)
        .set(owner)
        .send({ body: 'They have changed the tile twice. Quote the variation.', audience: 'team' })
        .expect(201);

      const asClient = await test
        .http()
        .get(`/v1/projects/${projectId}/messages`)
        .set(client)
        .expect(200);
      const bodies = asClient.body.items.map((row: { body: string }) => row.body);
      expect(bodies.some((body: string) => body.includes('variation'))).toBe(false);

      // The team sees both.
      const asOwner = await test
        .http()
        .get(`/v1/projects/${projectId}/messages`)
        .set(owner)
        .expect(200);
      expect(asOwner.body.items.length).toBeGreaterThan(asClient.body.items.length);
    });

    it('refuses to let a client write a team note rather than quietly downgrading it', async () => {
      // Silently turning this into a public message would deliver something written in confidence.
      const refused = await test
        .http()
        .post(`/v1/projects/${projectId}/messages`)
        .set(client)
        .send({ body: 'trying it on', audience: 'team' })
        .expect(403);
      expect(refused.body.message).toMatch(/team-only/i);
    });

    it('keeps a client out of a site they are not on', async () => {
      await test
        .http()
        .get(`/v1/projects/${otherProjectId}/messages`)
        .set(client)
        .expect(403);
      await test
        .http()
        .post(`/v1/projects/${otherProjectId}/messages`)
        .set(client)
        .send({ body: 'hello?' })
        .expect(403);
    });

    it('refuses an empty message but allows one that is only a photo', async () => {
      await test
        .http()
        .post(`/v1/projects/${projectId}/messages`)
        .set(client)
        .send({ body: '   ' })
        .expect(422);

      const presigned = await test
        .http()
        .post('/v1/uploads/presign')
        .set(client)
        .send({
          kind: 'message_attachment',
          content_type: 'image/jpeg',
          content_length: 2000,
          project_id: projectId,
        })
        .expect(200);

      const posted = await test
        .http()
        .post(`/v1/projects/${projectId}/messages`)
        .set(client)
        .send({
          body: '',
          attachments: [
            { s3_key: presigned.body.s3_key, content_type: 'image/jpeg', size_bytes: 2000 },
          ],
        })
        .expect(201);
      expect(posted.body.attachments).toHaveLength(1);
      // Signed, never a raw key: the objects stay private.
      expect(posted.body.attachments[0].url).toContain('http');
    });

    it('does not post the same message twice when a phone retries', async () => {
      const body = {
        body: 'Sent once, answered never',
        client_id: '33333333-4444-4555-8666-777777777777',
      };
      const first = await test
        .http()
        .post(`/v1/projects/${projectId}/messages`)
        .set(client)
        .send(body)
        .expect(201);
      const second = await test
        .http()
        .post(`/v1/projects/${projectId}/messages`)
        .set(client)
        .send(body)
        .expect(201);
      expect(second.body.id).toBe(first.body.id);
    });

    it('closes the door on taking a message back after half an hour', async () => {
      const sent = await test
        .http()
        .post(`/v1/projects/${projectId}/messages`)
        .set(client)
        .send({ body: 'Said in haste, regretted at leisure' })
        .expect(201);

      // While it is fresh the control is offered.
      const fresh = await test
        .http()
        .get(`/v1/projects/${projectId}/messages`)
        .set(client)
        .expect(200);
      expect(
        fresh.body.items.find((row: { id: string }) => row.id === sent.body.id).can_delete,
      ).toBe(true);

      // Age it past the window. Nothing else can move the clock, and a test that waited thirty
      // minutes is a test nobody runs.
      await test.tenantDb
        .clientFor(tenant.tenantId)
        .siteMessage.update({
          where: { id: sent.body.id },
          data: { createdAt: new Date(Date.now() - 31 * 60 * 1000) },
        });

      const refused = await test
        .http()
        .delete(`/v1/messages/${sent.body.id}`)
        .set(client)
        .expect(403);
      expect(refused.body.message).toMatch(/30 minutes/);

      // And the UI is told not to offer it, rather than finding out by being refused.
      const stale = await test
        .http()
        .get(`/v1/projects/${projectId}/messages`)
        .set(client)
        .expect(200);
      const row = stale.body.items.find((item: { id: string }) => item.id === sent.body.id);
      expect(row.can_delete).toBe(false);
      // Still there, still readable: the window closed, the record did not move.
      expect(row.body).toBe('Said in haste, regretted at leisure');
    });

    it('closes the door on the owner too, not just on the author', async () => {
      /*
       * The window binds everybody, and this is the test that says so.
       *
       * `projects.manage` decides *whose* message somebody may take down; it does not buy them more
       * time. A record the most senior person in the account can still edit a week later is not a
       * record — and the client on the other side of the thread would have no way of knowing it had
       * happened.
       */
      const old = await test
        .http()
        .post(`/v1/projects/${projectId}/messages`)
        .set(client)
        .send({ body: 'Something the builder might wish away tomorrow' })
        .expect(201);

      // Fresh, the owner may moderate it.
      const fresh = await test
        .http()
        .get(`/v1/projects/${projectId}/messages`)
        .set(owner)
        .expect(200);
      expect(
        fresh.body.items.find((row: { id: string }) => row.id === old.body.id).can_delete,
      ).toBe(true);

      await test.tenantDb
        .clientFor(tenant.tenantId)
        .siteMessage.update({
          where: { id: old.body.id },
          data: { createdAt: new Date(Date.now() - 26 * 60 * 60 * 1000) },
        });

      const refused = await test
        .http()
        .delete(`/v1/messages/${old.body.id}`)
        .set(owner)
        .expect(403);
      expect(refused.body.message).toMatch(/30 minutes/);

      const stale = await test
        .http()
        .get(`/v1/projects/${projectId}/messages`)
        .set(owner)
        .expect(200);
      const row = stale.body.items.find((item: { id: string }) => item.id === old.body.id);
      expect(row.can_delete).toBe(false);
      expect(row.body).toBe('Something the builder might wish away tomorrow');
    });

    it('lets somebody take back their own words and nobody else s', async () => {
      const mine = await test
        .http()
        .post(`/v1/projects/${projectId}/messages`)
        .set(client)
        .send({ body: 'ignore this' })
        .expect(201);

      // The owner may moderate; a client may not touch the builder's message.
      const theirs = await test
        .http()
        .post(`/v1/projects/${projectId}/messages`)
        .set(owner)
        .send({ body: 'a message the client did not write' })
        .expect(201);

      await test.http().delete(`/v1/messages/${theirs.body.id}`).set(client).expect(403);
      await test.http().delete(`/v1/messages/${mine.body.id}`).set(client).expect(204);

      const thread = await test
        .http()
        .get(`/v1/projects/${projectId}/messages`)
        .set(client)
        .expect(200);
      expect(
        thread.body.items.some((row: { id: string }) => row.id === mine.body.id),
      ).toBe(false);
    });
  });

  describe('read receipts', () => {
    it('starts unread, and stays unread until somebody says otherwise', async () => {
      const before = await test
        .http()
        .get(`/v1/projects/${projectId}/messages`)
        .set(client)
        .expect(200);
      // The client has never marked anything read, so everything the team said counts.
      expect(before.body.unread_count).toBeGreaterThan(0);
      expect(before.body.last_read_at).toBeNull();

      const marked = await test
        .http()
        .post(`/v1/projects/${projectId}/messages/read`)
        .set(client)
        .send({})
        .expect(201);
      expect(marked.body.unread_count).toBe(0);

      const after = await test
        .http()
        .get(`/v1/projects/${projectId}/messages`)
        .set(client)
        .expect(200);
      expect(after.body.unread_count).toBe(0);
      expect(after.body.last_read_at).not.toBeNull();
    });

    it('tells the writer their message has been seen, and by whom', async () => {
      const sent = await test
        .http()
        .post(`/v1/projects/${projectId}/messages`)
        .set(owner)
        .send({ body: 'Tiles are going up on the second floor.' })
        .expect(201);
      // Nobody has read it yet.
      expect(sent.body.read_by).toEqual([]);

      await test
        .http()
        .post(`/v1/projects/${projectId}/messages/read`)
        .set(client)
        .send({})
        .expect(201);

      const asOwner = await test
        .http()
        .get(`/v1/projects/${projectId}/messages`)
        .set(owner)
        .expect(200);
      const mine = asOwner.body.items.find((row: { id: string }) => row.id === sent.body.id);
      expect(mine.read_by.map((row: { name: string }) => row.name)).toContain('Vikram Shah');
    });

    it('does not show one person who else has read somebody else s message', async () => {
      // A receipt answers "has my message landed". Turning it into who-read-what for the whole
      // thread would make a team's reading habits visible to each other.
      const asClient = await test
        .http()
        .get(`/v1/projects/${projectId}/messages`)
        .set(client)
        .expect(200);
      const theirs = asClient.body.items.filter((row: { mine: boolean }) => !row.mine);
      expect(theirs.length).toBeGreaterThan(0);
      expect(theirs.every((row: { read_by: unknown[] }) => row.read_by.length === 0)).toBe(true);
    });

    it('never moves the watermark backwards', async () => {
      // A phone replaying a queue out of order must not resurrect a morning of read messages.
      const old = new Date(Date.now() - 60 * 60 * 1000).toISOString();
      const replayed = await test
        .http()
        .post(`/v1/projects/${projectId}/messages/read`)
        .set(client)
        .send({ up_to: old })
        .expect(201);
      expect(new Date(replayed.body.last_read_at).getTime()).toBeGreaterThan(
        new Date(old).getTime(),
      );
    });

    it('refuses to mark a site the caller is not on', async () => {
      await test
        .http()
        .post(`/v1/projects/${otherProjectId}/messages/read`)
        .set(client)
        .send({})
        .expect(403);
    });
  });

  describe('a message to one person', () => {
    it('reaches its recipient and nobody else — not even the rest of the team', async () => {
      const supervisorPhone = uniquePhone();
      await test
        .http()
        .post('/v1/tenants/current/invite')
        .set(owner)
        .send({
          name: 'Ramesh Iyer',
          phone: supervisorPhone,
          role: 'site_supervisor',
          project_ids: [projectId],
        })
        .expect(201);
      const session = await test
        .http()
        .post('/v1/auth/exchange')
        .send({ firebase_token: `dev:${supervisorPhone}` })
        .expect(200);
      const supervisor = { Authorization: `Bearer ${session.body.access_token}` };

      const people = await test
        .http()
        .get(`/v1/projects/${projectId}/messages/recipients`)
        .set(client)
        .expect(200);
      const target = people.body.items.find(
        (row: { name: string }) => row.name === 'Ramesh Iyer',
      );
      expect(target).toBeTruthy();

      const sent = await test
        .http()
        .post(`/v1/projects/${projectId}/messages`)
        .set(client)
        .send({
          body: 'Can you check the bathroom slope before they tile it?',
          audience: 'direct',
          recipient_id: target.id,
        })
        .expect(201);
      expect(sent.body.audience).toBe('direct');
      expect(sent.body.recipient.name).toBe('Ramesh Iyer');

      // The person it was for sees it.
      const theirs = await test
        .http()
        .get(`/v1/projects/${projectId}/messages`)
        .set(supervisor)
        .expect(200);
      expect(theirs.body.items.some((row: { id: string }) => row.id === sent.body.id)).toBe(true);

      /*
       * The owner does not — and this is the test that matters.
       *
       * An owner holds every permission there is, including `messages.internal`. If "private"
       * quietly meant "private unless you are senior enough", the feature would be a lie told to
       * whoever used it.
       */
      const ownersView = await test
        .http()
        .get(`/v1/projects/${projectId}/messages`)
        .set(owner)
        .expect(200);
      expect(ownersView.body.items.some((row: { id: string }) => row.id === sent.body.id)).toBe(
        false,
      );
    });

    it('refuses a recipient who cannot see the site, without confirming they exist', async () => {
      const outsiderPhone = uniquePhone();
      const outsider = await test
        .http()
        .post('/v1/tenants/current/invite')
        .set(owner)
        .send({
          name: 'Not On This Job',
          phone: outsiderPhone,
          role: 'site_supervisor',
          project_ids: [otherProjectId],
        })
        .expect(201);

      await test
        .http()
        .post(`/v1/projects/${projectId}/messages`)
        .set(client)
        .send({ body: 'hello', audience: 'direct', recipient_id: outsider.body.id })
        .expect(404);
    });

    it('will not let a broadcast smuggle in a recipient, or a direct message go nowhere', async () => {
      await test
        .http()
        .post(`/v1/projects/${projectId}/messages`)
        .set(owner)
        .send({ body: 'meant for one person', audience: 'everyone', recipient_id: clientUserId })
        .expect(422);

      await test
        .http()
        .post(`/v1/projects/${projectId}/messages`)
        .set(owner)
        .send({ body: 'to nobody', audience: 'direct' })
        .expect(422);
    });

    it('lets a client write privately to the builder without holding messages.internal', async () => {
      const me = await test.http().get('/v1/me').set(client).expect(200);
      expect(me.body.permissions).not.toContain('messages.internal');

      const people = await test
        .http()
        .get(`/v1/projects/${projectId}/messages/recipients`)
        .set(client)
        .expect(200);
      const builder = people.body.items.find((row: { role: string }) => row.role === 'owner');

      await test
        .http()
        .post(`/v1/projects/${projectId}/messages`)
        .set(client)
        .send({ body: 'A word about the payment, privately.', audience: 'direct', recipient_id: builder.id })
        .expect(201);
    });
  });

  describe('files on a message', () => {
    it('carries a PDF with the name it had, and says it is not a picture', async () => {
      const presigned = await test
        .http()
        .post('/v1/uploads/presign')
        .set(owner)
        .send({
          kind: 'message_attachment',
          content_type: 'application/pdf',
          content_length: 9000,
          project_id: projectId,
        })
        .expect(200);

      const posted = await test
        .http()
        .post(`/v1/projects/${projectId}/messages`)
        .set(owner)
        .send({
          body: 'The revised quote.',
          attachments: [
            {
              s3_key: presigned.body.s3_key,
              content_type: 'application/pdf',
              size_bytes: 9000,
              filename: 'quote-revised-2.pdf',
            },
          ],
        })
        .expect(201);

      const attachment = posted.body.attachments[0];
      // Without the name, five PDFs in a thread are five identical rows.
      expect(attachment.filename).toBe('quote-revised-2.pdf');
      expect(attachment.is_image).toBe(false);
      expect(attachment.url).toContain('http');
    });
  });

  describe('documents', () => {
    let drawingId: string;
    let familyId: string;

    async function upload(title: string, extra: Record<string, unknown> = {}) {
      const presigned = await test
        .http()
        .post('/v1/uploads/presign')
        .set(owner)
        .send({
          kind: 'document',
          content_type: 'application/pdf',
          content_length: 4000,
          project_id: projectId,
        })
        .expect(200);

      const created = await test
        .http()
        .post('/v1/documents')
        .set(owner)
        .send({
          project_id: projectId,
          title,
          category: 'drawing',
          s3_key: presigned.body.s3_key,
          content_type: 'application/pdf',
          size_bytes: 4000,
          ...extra,
        })
        .expect(201);
      return created.body;
    }

    it('starts hidden from the client', async () => {
      const drawing = await upload('Slab layout');
      drawingId = drawing.id;
      familyId = drawing.family_id;
      expect(drawing.visible_to_client).toBe(false);
      expect(drawing.version).toBe(1);

      const asClient = await test.http().get('/v1/documents').set(client).expect(200);
      expect(asClient.body.items).toHaveLength(0);
    });

    it('reaches the client only when somebody shares it', async () => {
      await test
        .http()
        .patch(`/v1/documents/${drawingId}`)
        .set(owner)
        .send({ visible_to_client: true })
        .expect(200);

      const asClient = await test.http().get('/v1/documents').set(client).expect(200);
      expect(asClient.body.items).toHaveLength(1);
      expect(asClient.body.items[0].title).toBe('Slab layout');
      expect(asClient.body.items[0].url).toContain('http');
    });

    it('supersedes rather than duplicating, and lists only what is current', async () => {
      const revision = await upload('ignored — the title comes from what it replaces', {
        supersedes_id: drawingId,
      });
      expect(revision.version).toBe(2);
      expect(revision.family_id).toBe(familyId);
      // A revision cannot rename or recategorise the thing it replaces.
      expect(revision.title).toBe('Slab layout');
      // And it stays as shared as the drawing it replaces, or the client silently loses it.
      expect(revision.visible_to_client).toBe(true);

      const current = await test.http().get('/v1/documents').set(owner).expect(200);
      const slabs = current.body.items.filter(
        (row: { family_id: string }) => row.family_id === familyId,
      );
      expect(slabs).toHaveLength(1);
      expect(slabs[0].version).toBe(2);

      const history = await test
        .http()
        .get(`/v1/documents/${familyId}/history`)
        .set(owner)
        .expect(200);
      expect(history.body.items.map((row: { version: number }) => row.version)).toEqual([2, 1]);
    });

    it('does not let a client upload or share anything', async () => {
      await test
        .http()
        .post('/v1/documents')
        .set(client)
        .send({
          project_id: projectId,
          title: 'Mine now',
          s3_key: `${tenant.tenantId}/document/x.pdf`,
          content_type: 'application/pdf',
          size_bytes: 10,
        })
        .expect(403);

      await test
        .http()
        .patch(`/v1/documents/${drawingId}`)
        .set(client)
        .send({ visible_to_client: true })
        .expect(403);
    });

    it('refuses a key belonging to another account', async () => {
      const forged = `99999999-9999-4999-8999-999999999999/document/stolen.pdf`;
      await test
        .http()
        .post('/v1/documents')
        .set(owner)
        .send({
          project_id: projectId,
          title: 'Forged',
          s3_key: forged,
          content_type: 'application/pdf',
          size_bytes: 10,
        })
        .expect(403);
    });
  });

  it('is refused when the module is withdrawn from the account', async () => {
    const starter = await onboardTenant(test, { name: 'Documents Off', phone: uniquePhone() });
    // The route under test is `/documents`, which is gated on `documents` rather than on
    // `client_portal` — the two used to arrive together with the tier, and no longer do.
    await disableModule(test, starter.tenantId, 'documents');

    try {
      const refused = await test
        .http()
        .get('/v1/documents')
        .set({ Authorization: `Bearer ${starter.accessToken}` })
        .expect(403);
      expect(refused.body.code).toBe('MODULE_NOT_ENABLED');
    } finally {
      await destroyTenant(test, starter.tenantId);
    }
  });

  it('never hands the client the builder’s numbers for their own site', async () => {
    /*
     * The overview is scoped to the sites you are on — and the client is on this one. Without a
     * permission gate they would read the labour cost and the month's spend on the house they are
     * paying a fixed price for, which is the margin on the job.
     */
    await test.http().get('/v1/dashboard/overview').set(client).expect(403);
    await test.http().get('/v1/dashboard/today').set(client).expect(403);

    // The team still has it.
    await test.http().get('/v1/dashboard/overview').set(owner).expect(200);
  });

  it('gives the client the permissions the portal needs and no more', async () => {
    const me = await test.http().get('/v1/me').set(client).expect(200);
    expect(me.body.permissions).toEqual(
      expect.arrayContaining(['projects.view', 'dpr.view', 'messages.post', 'documents.view']),
    );
    // The two that would turn a portal into a leak.
    expect(me.body.permissions).not.toContain('messages.internal');
    expect(me.body.permissions).not.toContain('documents.manage');
    expect(clientUserId).toBeTruthy();
  });
});
