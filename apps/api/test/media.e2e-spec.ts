import {
  createTestApp,
  destroyTenant,
  onboardTenant,
  uniquePhone,
  type OnboardedTenant,
  type TestApp,
} from './utils/test-app';

/**
 * Site photos and videos (spec §3 item 2, §8).
 *
 * The tests that matter are about keys. A presigned key is not a capability — knowing one must not be
 * enough to read it back or to attach it to a project, or one builder's site photographs become
 * readable by anybody who ever saw a key.
 */
describe('site media', () => {
  let test: TestApp;
  let tenant: OnboardedTenant;
  let other: OnboardedTenant;
  let owner: Record<string, string>;
  let projectId: string;

  beforeAll(async () => {
    test = await createTestApp();
    tenant = await onboardTenant(test, { name: 'Media Builders', phone: uniquePhone() });
    other = await onboardTenant(test, { name: 'Other Builders', phone: uniquePhone() });
    owner = { Authorization: `Bearer ${tenant.accessToken}` };

    const project = await test
      .http()
      .post('/v1/projects')
      .set(owner)
      .send({ name: 'Photogenic Site' })
      .expect(201);
    projectId = project.body.id;
  });

  afterAll(async () => {
    if (tenant) await destroyTenant(test, tenant.tenantId);
    if (other) await destroyTenant(test, other.tenantId);
    await test.close();
  });

  /** Not `async`: supertest's chainable object is thenable, and a promise would lose `.expect()`. */
  function presign(contentType: string, length: number) {
    return test
      .http()
      .post('/v1/uploads/presign')
      .set(owner)
      .send({
        kind: 'site_media',
        content_type: contentType,
        content_length: length,
        project_id: projectId,
      });
  }

  it('issues a key inside the tenant prefix', async () => {
    const response = await presign('image/jpeg', 2_000_000).expect(200);
    // The client never chooses where its bytes land.
    expect(response.body.s3_key.startsWith(`${tenant.tenantId}/`)).toBe(true);
    expect(response.body.s3_key).toContain('site_media');
    expect(response.body.s3_key).toContain(projectId);
  });

  it('allows a large video but not a large photo', async () => {
    // A minute of phone video is tens of megabytes; a single cap generous enough for it would also
    // let somebody push a 200 MB "photo".
    await presign('video/mp4', 150 * 1024 * 1024).expect(200);
    await presign('image/jpeg', 150 * 1024 * 1024).expect(422);
    await presign('video/mp4', 300 * 1024 * 1024).expect(422);
  });

  it('attaches a photo and lists it', async () => {
    const key = (await presign('image/jpeg', 1_500_000).expect(200)).body.s3_key;

    const created = await test
      .http()
      .post(`/v1/projects/${projectId}/media`)
      .set(owner)
      .send({
        kind: 'photo',
        s3_key: key,
        content_type: 'image/jpeg',
        size_bytes: 1_500_000,
        caption: 'Approach road',
      })
      .expect(201);
    expect(created.body.caption).toBe('Approach road');
    expect(created.body.uploaded_by.name).toBeTruthy();

    const list = await test.http().get(`/v1/projects/${projectId}/media`).set(owner).expect(200);
    expect(list.body.some((row: { id: string }) => row.id === created.body.id)).toBe(true);
  });

  it('refuses a key belonging to another tenant', async () => {
    // The exact attack: a key is a string, and knowing one must not be enough to use it.
    const forged = `${other.tenantId}/site_media/p/${projectId}/202609/stolen.jpg`;

    await test
      .http()
      .post(`/v1/projects/${projectId}/media`)
      .set(owner)
      .send({ kind: 'photo', s3_key: forged, content_type: 'image/jpeg', size_bytes: 1000 })
      .expect(403);

    await test
      .http()
      .post('/v1/uploads/view')
      .set(owner)
      .send({ s3_key: forged })
      .expect(403);
  });

  it('signs a view URL for a key the tenant owns', async () => {
    const key = (await presign('image/jpeg', 1000).expect(200)).body.s3_key;
    const response = await test
      .http()
      .post('/v1/uploads/view')
      .set(owner)
      .send({ s3_key: key })
      .expect(200);

    expect(response.body.url).toContain(key.split('/').pop());
    // Longer than an upload URL: a gallery left open over lunch should not fill with broken images.
    expect(response.body.expires_in).toBeGreaterThan(600);
  });

  it('refuses a key with traversal segments', async () => {
    await test
      .http()
      .post('/v1/uploads/view')
      .set(owner)
      .send({ s3_key: `${tenant.tenantId}/../${other.tenantId}/site_media/x.jpg` })
      .expect(403);
  });

  it('captions and removes media', async () => {
    const key = (await presign('image/jpeg', 1000).expect(200)).body.s3_key;
    const created = await test
      .http()
      .post(`/v1/projects/${projectId}/media`)
      .set(owner)
      .send({ kind: 'photo', s3_key: key, content_type: 'image/jpeg', size_bytes: 1000 })
      .expect(201);

    const captioned = await test
      .http()
      .patch(`/v1/projects/${projectId}/media/${created.body.id}`)
      .set(owner)
      .send({ caption: 'Second floor slab' })
      .expect(200);
    expect(captioned.body.caption).toBe('Second floor slab');

    await test
      .http()
      .delete(`/v1/projects/${projectId}/media/${created.body.id}`)
      .set(owner)
      .expect(204);

    const list = await test.http().get(`/v1/projects/${projectId}/media`).set(owner).expect(200);
    expect(list.body.some((row: { id: string }) => row.id === created.body.id)).toBe(false);
  });

  it('does not attach the same file twice when a sync retries', async () => {
    const key = (await presign('image/jpeg', 1000).expect(200)).body.s3_key;
    const clientId = '11111111-2222-4333-8444-555555555555';
    const body = {
      kind: 'photo',
      s3_key: key,
      content_type: 'image/jpeg',
      size_bytes: 1000,
      client_id: clientId,
    };

    const first = await test
      .http()
      .post(`/v1/projects/${projectId}/media`)
      .set(owner)
      .send(body)
      .expect(201);
    const second = await test
      .http()
      .post(`/v1/projects/${projectId}/media`)
      .set(owner)
      .send(body)
      .expect(201);

    // Same row, not a duplicate: a phone that uploaded and lost the response retries.
    expect(second.body.id).toBe(first.body.id);
  });

  /**
   * Order, and with it the main image.
   *
   * The sites list leads each card with a photograph, so which one it is, is a decision the builder
   * makes — not "whatever was uploaded last". There is one mechanism for it: the order of the
   * gallery. A fresh project, because the tests above leave photos behind and what leads the card
   * depends on exactly what is attached.
   */
  describe('order', () => {
    let siteId: string;
    let first: string;
    let second: string;
    let third: string;

    /** Presigns, then records — the bytes never go anywhere in a test, only the row matters here. */
    async function attach(kind: 'photo' | 'video') {
      const contentType = kind === 'video' ? 'video/mp4' : 'image/jpeg';
      const presigned = await test
        .http()
        .post('/v1/uploads/presign')
        .set(owner)
        .send({
          kind: 'site_media',
          content_type: contentType,
          content_length: 1000,
          project_id: siteId,
        })
        .expect(200);
      const created = await test
        .http()
        .post(`/v1/projects/${siteId}/media`)
        .set(owner)
        .send({ kind, s3_key: presigned.body.s3_key, content_type: contentType, size_bytes: 1000 })
        .expect(201);
      return created.body.id as string;
    }

    /** The site as the cards list sees it. */
    async function card() {
      const list = await test.http().get('/v1/projects?limit=100').set(owner).expect(200);
      return list.body.items.find((row: { id: string }) => row.id === siteId);
    }

    async function gallery(): Promise<string[]> {
      const list = await test.http().get(`/v1/projects/${siteId}/media`).set(owner).expect(200);
      return list.body.map((row: { id: string }) => row.id);
    }

    beforeAll(async () => {
      const project = await test
        .http()
        .post('/v1/projects')
        .set(owner)
        .send({ name: 'Ordered Site' })
        .expect(201);
      siteId = project.body.id;
      first = await attach('photo');
      second = await attach('photo');
      third = await attach('photo');
    });

    it('puts a new file at the front until somebody rearranges', async () => {
      // Newest first, which is what the gallery did before it could be ordered by hand.
      expect(await gallery()).toEqual([third, second, first]);

      const row = await card();
      expect(row.covers.map((cover: { id: string }) => cover.id)).toEqual([third, second, first]);
      expect(row.photo_count).toBe(3);
      // Signed, not a raw key: the objects are private.
      expect(row.covers[0].url).toContain('http');
    });

    it('makes a photo the main image by moving it to the front', async () => {
      // What the star button sends: one id, not the whole album.
      const reordered = await test
        .http()
        .put(`/v1/projects/${siteId}/media/order`)
        .set(owner)
        .send({ media_ids: [first] })
        .expect(200);
      expect(reordered.body.map((row: { id: string }) => row.id)).toEqual([first, third, second]);
      // Dense positions, so the next drag has somewhere to land.
      expect(reordered.body.map((row: { position: number }) => row.position)).toEqual([0, 1, 2]);

      const row = await card();
      expect(row.covers[0].id).toBe(first);
      // The gallery and the card agree — that is the point of having one mechanism.
      expect(row.covers.map((cover: { id: string }) => cover.id)).toEqual(await gallery());
    });

    it('applies a full drag order exactly as given', async () => {
      await test
        .http()
        .put(`/v1/projects/${siteId}/media/order`)
        .set(owner)
        .send({ media_ids: [second, first, third] })
        .expect(200);
      expect(await gallery()).toEqual([second, first, third]);

      // Sending it again changes nothing: a drag whose response was lost can be retried.
      await test
        .http()
        .put(`/v1/projects/${siteId}/media/order`)
        .set(owner)
        .send({ media_ids: [second, first, third] })
        .expect(200);
      expect(await gallery()).toEqual([second, first, third]);
    });

    it('never leads the card with a video', async () => {
      const videoId = await attach('video');
      await test
        .http()
        .put(`/v1/projects/${siteId}/media/order`)
        .set(owner)
        .send({ media_ids: [videoId] })
        .expect(200);
      // The builder can put the walkthrough first in the gallery — that is their call.
      expect((await gallery())[0]).toBe(videoId);

      const row = await card();
      // The card cannot show a video, so it leads with the first photo instead of an empty frame.
      expect(row.covers[0].id).toBe(second);
      expect(row.covers.map((cover: { id: string }) => cover.id)).not.toContain(videoId);
      // It still counts as a file on the site.
      expect(row.photo_count).toBe(4);
    });

    it('refuses an order naming a file that has gone', async () => {
      const stale = '99999999-8888-4777-8666-555555555555';
      const refused = await test
        .http()
        .put(`/v1/projects/${siteId}/media/order`)
        .set(owner)
        .send({ media_ids: [first, stale] })
        .expect(409);
      // Names them: the client is holding a stale list and needs to know which entries went.
      expect(refused.body.details.media_ids).toEqual([stale]);

      // And the arrangement is untouched by the refusal.
      expect((await gallery())[1]).toBe(second);
    });

    it('falls back to the next photo when the first one is removed', async () => {
      await test.http().delete(`/v1/projects/${siteId}/media/${second}`).set(owner).expect(204);

      const row = await card();
      // Not an empty frame: a site with photographs always shows one.
      expect(row.covers[0].id).toBe(first);
      expect(row.photo_count).toBe(3);
    });
  });
});
