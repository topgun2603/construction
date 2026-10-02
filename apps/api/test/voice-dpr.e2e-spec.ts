import {
  createTestApp,
  destroyTenant,
  onboardTenant,
  uniquePhone,
  type OnboardedTenant,
  type TestApp,
} from './utils/test-app';
import { MAX_UPLOAD_BYTES } from '@sitebook/shared';

/**
 * Speaking a daily report.
 *
 * What cannot be tested here is the listening. It is two vendor calls, and a test that spends money
 * to assert a sentence about a slab is a test nobody runs — the round trip was checked by hand
 * against a synthesised Tamil note, and the transcript and draft are in the commit that added it.
 *
 * What *can* be tested is everything guarding those calls, which is where the bugs would be: who
 * may reach the endpoint, what it accepts as a recording, and whether a voice note can be used to
 * read a file belonging to somebody else. All three are deterministic, and all three matter more
 * than the model's word choice.
 */
describe('speaking a daily report', () => {
  let test: TestApp;
  let tenant: OnboardedTenant;
  let projectId: string;

  beforeAll(async () => {
    test = await createTestApp();
    tenant = await onboardTenant(test, { name: 'Voice Builders', phone: uniquePhone() });

    const project = await test
      .http()
      .post('/v1/projects')
      .set({ Authorization: `Bearer ${tenant.accessToken}` })
      .send({ name: 'Voice Tower', code: 'VT-1' })
      .expect(201);
    projectId = project.body.id;
  });

  afterAll(async () => {
    if (tenant) await destroyTenant(test, tenant.tenantId);
    await test.close();
  });

  const auth = () => ({ Authorization: `Bearer ${tenant.accessToken}` });

  it('refuses a note from nobody', async () => {
    await test
      .http()
      .post('/v1/dpr/voice')
      .send({ s3_key: 'x/y.webm', project_id: projectId })
      .expect(401);
  });

  it('refuses a site the caller has no access to', async () => {
    // A supervisor is scoped to their own sites, and a voice note must not be the way around that
    // — the key and the site are checked separately, and this is the site half.
    await test
      .http()
      .post('/v1/dpr/voice')
      .set(auth())
      .send({ s3_key: `${tenant.tenantId}/dpr_voice/x.webm`, project_id: crypto.randomUUID() })
      .expect(404);
  });

  it('refuses a key belonging to another tenant', async () => {
    /*
     * The key is not a credential.
     *
     * Everything in the bucket is prefixed with the tenant that owns it, and knowing somebody
     * else's prefix must not be enough to have the API fetch their file and read it aloud. This
     * is the check that makes a guessed key worthless.
     */
    await test
      .http()
      .post('/v1/dpr/voice')
      .set(auth())
      .send({ s3_key: `${crypto.randomUUID()}/dpr_voice/note.webm`, project_id: projectId })
      .expect(403);
  });

  it('refuses a key that climbs out of its own prefix', async () => {
    await test
      .http()
      .post('/v1/dpr/voice')
      .set(auth())
      .send({ s3_key: `${tenant.tenantId}/../other/note.webm`, project_id: projectId })
      .expect(403);
  });

  describe('what counts as a recording', () => {
    it('presigns an upload for a voice note', async () => {
      const response = await test
        .http()
        .post('/v1/uploads/presign')
        .set(auth())
        .send({
          kind: 'dpr_voice',
          content_type: 'audio/webm',
          content_length: 240_000,
          project_id: projectId,
        })
        .expect(200);

      // The extension matters: the transcriber picks a decoder from the filename, and a note
      // stored as `.bin` is one it declines to open.
      expect(response.body.s3_key).toMatch(/\/dpr_voice\/.+\.webm$/);
    });

    it('holds audio to its own size ceiling, not the one photos get', async () => {
      // Audio's limit is below an image's, so a request that a photo would pass must still fail.
      expect(MAX_UPLOAD_BYTES.audio).toBeLessThan(MAX_UPLOAD_BYTES.image);
      await test
        .http()
        .post('/v1/uploads/presign')
        .set(auth())
        .send({
          kind: 'dpr_voice',
          content_type: 'audio/webm',
          content_length: MAX_UPLOAD_BYTES.audio + 1,
          project_id: projectId,
        })
        .expect(422);
    });

    it('rejects a recording uploaded as something else entirely', async () => {
      await test
        .http()
        .post('/v1/dpr/voice')
        .set(auth())
        .send({ s3_key: `${tenant.tenantId}/dpr_voice/note`, project_id: 'not-a-uuid' })
        .expect(422);
    });
  });
});
