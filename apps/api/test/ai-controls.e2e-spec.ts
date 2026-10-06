import { randomUUID } from 'node:crypto';
import type { Job } from 'bullmq';
import {
  createTestApp,
  destroyTenant,
  onboardTenant,
  uniquePhone,
  type OnboardedTenant,
  type TestApp,
} from './utils/test-app';
import { AiGateway, type AiModelClient } from '../src/modules/ai/ai-gateway.service';
import { ForecastExplainer } from '../src/modules/forecasts/forecast-explainer.service';
import { JobQueueService } from '../src/jobs/job-queue.service';
import { MediaProcessor } from '../src/jobs/processors/media.processor';
import type { ObjectStore } from '../src/common/storage/object-store.service';
import type { DocumentTextService } from '../src/modules/portal/document-text.service';

/**
 * Company-level AI controls (roadmap Phase 3, "AI data controls"), end to end against a real
 * database.
 *
 * No real model is ever called. The suite runs with OPENAI_API_KEY empty, which is itself one of
 * the states under test ("not configured" — 409, distinct from "turned off" — 403 AI_DISABLED).
 * Where a test needs the deployment to look configured, the gateway's `configured` is spied true
 * and `createClient` hands back a fake whose calls are counted — so "no call reached the model"
 * is an assertion, not a hope.
 */
describe('Company AI controls', () => {
  let test: TestApp;
  let gateway: AiGateway;
  let alpha: OnboardedTenant;
  let beta: OnboardedTenant;
  let alphaSite: string;
  const tenants: string[] = [];
  const ADMIN_PHONE = '919000000083';
  const originalAllowlist = process.env['PLATFORM_ADMIN_PHONES'];

  /** The fake vendor. Every model call in the product goes through one of these two functions. */
  const chat = jest.fn();
  const transcribe = jest.fn();
  const fakeClient = {
    chat: { completions: { create: chat } },
    audio: { transcriptions: { create: transcribe } },
  } as unknown as AiModelClient;
  const reply = (content: unknown) => ({
    choices: [{ message: { content: typeof content === 'string' ? content : JSON.stringify(content) } }],
  });

  const auth = (who: { accessToken: string }) => ({ Authorization: `Bearer ${who.accessToken}` });
  const http = () => test.http();

  /** As if the deployment had a key, with the fake vendor behind it. */
  function configured(): void {
    jest.spyOn(gateway, 'configured', 'get').mockReturnValue(true);
    jest
      .spyOn(gateway as unknown as { createClient: () => AiModelClient }, 'createClient')
      .mockReturnValue(fakeClient);
    // The gateway keeps a client per endpoint once made; start each test from the fake.
    (gateway as unknown as { clients: Map<string, AiModelClient> }).clients.clear();
  }

  async function save(owner: OnboardedTenant, body: Record<string, unknown>) {
    return http().put('/v1/ai/settings').set(auth(owner)).send({ region: 'default', ...body }).expect(200);
  }

  async function usageOf(tenantId: string) {
    return test.tenantDb.clientFor(tenantId).aiUsageDaily.findMany();
  }

  /** A document with readable pages, written directly: the index is what is under test, not parsing. */
  async function documentWithChunks(owner: OnboardedTenant, pages: string[]) {
    const familyId = randomUUID();
    return test.tenantDb.transaction(owner.tenantId, async (tx) => {
      const document = await tx.document.create({
        data: {
          tenantId: owner.tenantId,
          familyId,
          title: 'Structural set',
          category: 'drawing',
          s3Key: `${owner.tenantId}/document/${randomUUID()}.pdf`,
          contentType: 'application/pdf',
          sizeBytes: 4000,
          uploadedBy: owner.ownerId,
          textExtractedAt: new Date(),
          textPages: pages.length,
        },
      });
      await tx.documentChunk.createMany({
        data: pages.map((content, index) => ({
          tenantId: owner.tenantId,
          documentId: document.id,
          page: index + 1,
          content,
        })),
      });
      return document.id;
    });
  }

  beforeAll(async () => {
    process.env['PLATFORM_ADMIN_PHONES'] = ADMIN_PHONE;
    test = await createTestApp();
    gateway = test.app.get(AiGateway);
    alpha = await onboardTenant(test, { name: 'Alpha AI Builders', phone: uniquePhone() });
    beta = await onboardTenant(test, { name: 'Beta AI Builders', phone: uniquePhone() });
    tenants.push(alpha.tenantId, beta.tenantId);
    const site = await http().post('/v1/projects').set(auth(alpha)).send({ name: 'Lakeview', code: 'LV-1' }).expect(201);
    alphaSite = site.body.id;
  });

  afterAll(async () => {
    for (const id of tenants) await destroyTenant(test, id);
    await test.close();
    if (originalAllowlist === undefined) delete process.env['PLATFORM_ADMIN_PHONES'];
    else process.env['PLATFORM_ADMIN_PHONES'] = originalAllowlist;
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    chat.mockReset();
    transcribe.mockReset();
    // Back to the defaults, so each test states the settings it relies on.
    for (const owner of [alpha, beta]) {
      await test.tenantDb.transaction(owner.tenantId, (tx) => tx.aiSettings.deleteMany({}));
      gateway.invalidate(owner.tenantId);
    }
  });

  describe('defaults and the settings screen', () => {
    it('leaves a company that never saved anything exactly as it was: everything on', async () => {
      configured();
      const me = await http().get('/v1/me').set(auth(alpha)).expect(200);
      expect(me.body.ai_features).toEqual({
        assistant: 'on',
        documents: 'on',
        reading: 'on',
        voice: 'on',
        translation: 'on',
        suggestions: 'on',
      });

      const settings = await http().get('/v1/ai/settings').set(auth(alpha)).expect(200);
      expect(settings.body.settings).toEqual({
        enabled: true,
        features: { assistant: true, documents: true, reading: true, voice: true, translation: true, suggestions: true },
        region: 'default',
      });
      expect(settings.body.deployment.provider).toBe('OpenAI');
      expect(settings.body.deployment.models.reading).toEqual([expect.any(String)]);
    });

    it('tells "not configured on this server" apart from "turned off by the company"', async () => {
      // No spy: the suite's real state, with no key.
      const me = await http().get('/v1/me').set(auth(alpha)).expect(200);
      expect(me.body.ai_features.translation).toBe('not_configured');
      const refused = await http().post('/v1/translate').set(auth(alpha)).send({ text: 'hello', to: 'ta' }).expect(409);
      expect(refused.body.code).toBe('CONFLICT');
      expect(refused.body.details).toMatchObject({ ai: 'not_configured', feature: 'translation' });

      configured();
      await save(alpha, { enabled: false });
      const off = await http().post('/v1/translate').set(auth(alpha)).send({ text: 'hello', to: 'ta' }).expect(403);
      expect(off.body.code).toBe('AI_DISABLED');
      expect(off.body.details).toEqual({ feature: 'translation', reason: 'off_company' });
      expect((await http().get('/v1/me').set(auth(alpha)).expect(200)).body.ai_features.translation).toBe('off_company');
    });

    it('is the owner’s alone', async () => {
      const invited = await http()
        .post('/v1/tenants/current/invite')
        .set(auth(alpha))
        .send({ phone: uniquePhone(), name: 'Site PM', role: 'project_manager' })
        .expect(201);
      const session = await http().post('/v1/auth/exchange').send({ firebase_token: `dev:${invited.body.phone}` }).expect(200);
      const pm = { accessToken: session.body.access_token as string };
      await http().get('/v1/ai/settings').set(auth(pm)).expect(403);
      await http().put('/v1/ai/settings').set(auth(pm)).send({ enabled: false }).expect(403);
      await http().post('/v1/ai/data/delete').set(auth(pm)).send({ confirm: 'DELETE' }).expect(403);
    });

    it('refuses a region this server has no endpoint for, and does not invent one', async () => {
      const settings = await http().get('/v1/ai/settings').set(auth(alpha)).expect(200);
      expect(settings.body.deployment.regions).toEqual({ default: true, eu: false, us: false });
      await http().put('/v1/ai/settings').set(auth(alpha)).send({ enabled: true, region: 'eu' }).expect(409);
    });

    it('records every change in the audit log', async () => {
      await save(alpha, { enabled: true, features: { voice: false } });
      const entries = await test.tenantDb.clientFor(alpha.tenantId).auditLog.findMany({
        where: { entity: 'ai_settings' },
      });
      expect(entries.length).toBeGreaterThan(0);
    });
  });

  describe('master switch off', () => {
    beforeEach(() => configured());

    it('refuses every AI endpoint with AI_DISABLED, and calls no model', async () => {
      await save(alpha, { enabled: false });
      const a = auth(alpha);
      // Thunks, sent one at a time: a supertest request starts its own listener when it is made.
      const refusals = [
        () => http().post('/v1/ask').set(a).send({ question: 'how many people today' }),
        () => http().post('/v1/documents/ask').set(a).send({ question: 'what is the slab thickness' }),
        () => http().post('/v1/expenses/scan').set(a).send({ s3_key: `${alpha.tenantId}/bill/tenant/202610/bill.jpg` }),
        () =>
          http().post('/v1/dpr/voice').set(a).send({ s3_key: `${alpha.tenantId}/dpr_voice/note.webm`, project_id: alphaSite }),
        () => http().post('/v1/translate').set(a).send({ text: 'hello', to: 'ta' }),
        () =>
          http().post('/v1/rfis/draft-ai').set(a).send({ project_id: alphaSite, question: 'Which slab thickness applies here?' }),
        () => http().post('/v1/equipment/scan/meter').set(a).send({ s3_key: `${alpha.tenantId}/equipment_photo/meter.jpg` }),
        () => http().post('/v1/equipment/scan/fuel-bill').set(a).send({ s3_key: `${alpha.tenantId}/equipment_photo/slip.jpg` }),
      ];
      for (const send of refusals) {
        const response = await send();
        expect({ status: response.status, code: response.body.code }).toEqual({ status: 403, code: 'AI_DISABLED' });
      }
      expect(chat).not.toHaveBeenCalled();
      expect(transcribe).not.toHaveBeenCalled();
      expect(await usageOf(alpha.tenantId)).toEqual([]);
    });

    it('keeps the manual and keyword paths working', async () => {
      await save(alpha, { enabled: false });
      const a = auth(alpha);

      // Typing an expense by hand.
      await http()
        .post('/v1/expenses')
        .set(a)
        .send({ project_id: alphaSite, amount: '1200', category: 'fuel', spent_on: '2026-10-01', note: 'Diesel' })
        .expect(201);

      // Quick-capture snag: the keyword rules make the guess.
      const snag = await http()
        .post('/v1/quality/snags/quick')
        .set(a)
        .send({ project_id: alphaSite, note: 'Water leaking through the ceiling of flat 204' })
        .expect(201);
      expect(snag.body.ai_suggested).toBe(false);

      // Safety suggestion: the rules answer.
      const safety = await http()
        .post('/v1/safety/observations/suggest')
        .set(a)
        .send({ note: 'Worker on the scaffold with no harness' })
        .expect(200);
      expect(safety.body.source).toBe('rules');

      // The RFI screen hides "Draft with AI" and says why.
      const rfi = await http().get('/v1/rfis/settings').set(a).expect(200);
      expect(rfi.body).toMatchObject({ ai_enabled: false, ai_state: 'off_company' });

      expect(chat).not.toHaveBeenCalled();
    });
  });

  describe('one feature off', () => {
    beforeEach(() => configured());

    it('blocks only that feature', async () => {
      await save(alpha, { enabled: true, features: { translation: false } });
      const a = auth(alpha);

      const off = await http().post('/v1/translate').set(a).send({ text: 'hello', to: 'ta' }).expect(403);
      expect(off.body.details.feature).toBe('translation');

      chat.mockResolvedValueOnce(reply({ metric: 'headcount', project: null, subject: null, period: 'today' }));
      await http().post('/v1/ask').set(a).send({ question: 'how many people today' }).expect(200);
      expect(chat).toHaveBeenCalledTimes(1);

      const me = await http().get('/v1/me').set(a).expect(200);
      expect(me.body.ai_features).toMatchObject({ translation: 'off_company', assistant: 'on' });
    });

    it('with suggestions off, quick capture uses the keyword rules and asks no model', async () => {
      await save(alpha, { enabled: true, features: { suggestions: false } });
      const snag = await http()
        .post('/v1/quality/snags/quick')
        .set(auth(alpha))
        .send({ project_id: alphaSite, note: 'Crack in the plaster beside the lift' })
        .expect(201);
      expect(snag.body.ai_suggested).toBe(false);
      expect(chat).not.toHaveBeenCalled();
    });

    it('with suggestions on, quick capture asks the model once and counts it', async () => {
      chat.mockResolvedValueOnce(reply({ title: 'Ceiling leak at 204', priority: 'high', trade: null, description: null }));
      const snag = await http()
        .post('/v1/quality/snags/quick')
        .set(auth(alpha))
        .send({ project_id: alphaSite, note: 'Water coming through the ceiling of 204' })
        .expect(201);
      expect(snag.body.ai_suggested).toBe(true);
      expect(chat).toHaveBeenCalledTimes(1);
      const usage = await usageOf(alpha.tenantId);
      expect(usage.find((row) => row.feature === 'suggestions')?.calls).toBeGreaterThanOrEqual(1);
    });
  });

  describe('the operator’s kill switch', () => {
    it('turns a feature off for every company, ahead of the company’s own setting', async () => {
      configured();
      jest.spyOn(gateway, 'platformDisabled').mockReturnValue(['voice']);
      const me = await http().get('/v1/me').set(auth(beta)).expect(200);
      expect(me.body.ai_features).toMatchObject({ voice: 'off_platform', translation: 'on' });
      const refused = await http()
        .post('/v1/dpr/voice')
        .set(auth(alpha))
        .send({ s3_key: `${alpha.tenantId}/dpr_voice/note.webm`, project_id: alphaSite })
        .expect(403);
      expect(refused.body.details).toEqual({ feature: 'voice', reason: 'off_platform' });
    });
  });

  describe('usage', () => {
    it('counts each model call per feature per day, for that company only', async () => {
      configured();
      chat.mockResolvedValue(reply('வணக்கம்'));
      // Different text each time: identical text is served from the translation cache.
      await http().post('/v1/translate').set(auth(alpha)).send({ text: 'good morning', to: 'ta' }).expect(200);
      await http().post('/v1/translate').set(auth(alpha)).send({ text: 'good evening', to: 'ta' }).expect(200);

      const today = new Date().toISOString().slice(0, 10);
      const settings = await http().get('/v1/ai/settings').set(auth(alpha)).expect(200);
      expect(settings.body.usage.totals.translation).toBeGreaterThanOrEqual(2);
      expect(settings.body.usage.rows).toContainEqual({ day: today, feature: 'translation', calls: expect.any(Number) });

      // Beta made no calls and sees none of Alpha's.
      const other = await http().get('/v1/ai/settings').set(auth(beta)).expect(200);
      expect(other.body.usage.totals.translation).toBe(0);
      expect(await usageOf(beta.tenantId)).toEqual([]);
    });
  });

  describe('background work', () => {
    it('the forecast explainer skips a company with suggestions off — no call at all', async () => {
      configured();
      await save(alpha, { enabled: true, features: { suggestions: false } });
      const explainer = test.app.get(ForecastExplainer);
      await expect(explainer.reword(alpha.tenantId, 'Lakeview', 'On course to finish 9% over budget.')).resolves.toBeNull();
      expect(chat).not.toHaveBeenCalled();

      // Beta has not switched anything off, so the same job for Beta does ask.
      chat.mockResolvedValueOnce(reply('Lakeview is heading 9% over budget.'));
      await expect(explainer.reword(beta.tenantId, 'Lakeview', 'On course to finish 9% over budget.')).resolves.toBe(
        'Lakeview is heading 9% over budget.',
      );
      expect(chat).toHaveBeenCalledTimes(1);
    });

    it('document indexing skips a company with Documents off, and uploads queue nothing', async () => {
      await save(alpha, { enabled: true, features: { documents: false } });

      // The worker's job: returns without fetching the file or writing a page.
      const store = { get: jest.fn() };
      const text = { chunksOf: jest.fn() };
      const processor = new MediaProcessor(
        test.tenantDb,
        store as unknown as ObjectStore,
        text as unknown as DocumentTextService,
        gateway,
      );
      const result = await processor.process({
        name: 'document-text',
        data: { tenantId: alpha.tenantId, documentId: randomUUID(), s3Key: 'x', contentType: 'application/pdf' },
      } as unknown as Job);
      expect(result).toMatchObject({ skipped: 'documents AI off' });
      expect(store.get).not.toHaveBeenCalled();

      // A new upload is stored but not queued for reading.
      const queued = jest.spyOn(test.app.get(JobQueueService), 'extractDocumentText');
      const presigned = await http()
        .post('/v1/uploads/presign')
        .set(auth(alpha))
        .send({ kind: 'document', content_type: 'application/pdf', content_length: 4000, project_id: alphaSite })
        .expect(200);
      await http()
        .post('/v1/documents')
        .set(auth(alpha))
        .send({
          project_id: alphaSite,
          title: 'Drawing while off',
          category: 'drawing',
          s3_key: presigned.body.s3_key,
          content_type: 'application/pdf',
          size_bytes: 4000,
        })
        .expect(201);
      expect(queued).not.toHaveBeenCalled();

      // Back on: "re-index documents" queues what was missed.
      await save(alpha, { enabled: true, features: { documents: true } });
      const reindex = await http().post('/v1/ai/documents/reindex').set(auth(alpha)).expect(200);
      expect(reindex.body.queued).toBeGreaterThanOrEqual(1);
      expect(queued).toHaveBeenCalled();
    });

    it('refuses to re-index while Documents is off', async () => {
      configured();
      await save(alpha, { enabled: true, features: { documents: false } });
      const refused = await http().post('/v1/ai/documents/reindex').set(auth(alpha)).expect(403);
      expect(refused.body.code).toBe('AI_DISABLED');
    });
  });

  describe('deleting stored AI data', () => {
    it('removes the page index only — documents stay — and is audited, for that company only', async () => {
      const alphaDoc = await documentWithChunks(alpha, ['Slab thickness 150mm', 'Column C7 ties']);
      const betaDoc = await documentWithChunks(beta, ['Beta footing detail']);

      await http().post('/v1/ai/data/delete').set(auth(alpha)).send({}).expect(422);
      const deleted = await http().post('/v1/ai/data/delete').set(auth(alpha)).send({ confirm: 'DELETE' }).expect(200);
      expect(deleted.body.deleted_chunks).toBeGreaterThanOrEqual(2);

      const alphaDb = test.tenantDb.clientFor(alpha.tenantId);
      expect(await alphaDb.documentChunk.count()).toBe(0);
      const kept = await alphaDb.document.findUniqueOrThrow({ where: { id: alphaDoc } });
      expect(kept.deletedAt).toBeNull();
      expect(kept.textExtractedAt).toBeNull();

      const betaDb = test.tenantDb.clientFor(beta.tenantId);
      expect(await betaDb.documentChunk.count({ where: { documentId: betaDoc } })).toBe(1);

      const audit = await alphaDb.auditLog.findFirst({ where: { action: 'ai.data_deleted' } });
      expect(audit?.after).toMatchObject({ document_chunks: deleted.body.deleted_chunks });
    });
  });

  describe('tenant isolation', () => {
    it('one company’s switch never reaches another', async () => {
      configured();
      await save(alpha, { enabled: false });
      const betaMe = await http().get('/v1/me').set(auth(beta)).expect(200);
      expect(betaMe.body.ai_features.assistant).toBe('on');
      const betaSettings = await http().get('/v1/ai/settings').set(auth(beta)).expect(200);
      expect(betaSettings.body.settings.enabled).toBe(true);
      // Beta cannot see Alpha's row even by asking the database directly under its own tenant.
      expect(await test.tenantDb.clientFor(beta.tenantId).aiSettings.findMany()).toEqual([]);
    });
  });

  describe('the platform console', () => {
    it('reads a company’s AI settings and usage, read-only', async () => {
      await save(alpha, { enabled: true, features: { voice: false } });
      const login = await http().post('/v1/admin/auth/login').send({ firebase_token: `dev:${ADMIN_PHONE}` }).expect(201);
      const consoleAuth = { Authorization: `Bearer ${login.body.access_token}` };
      const view = await http().get(`/v1/admin/tenants/${alpha.tenantId}/ai`).set(consoleAuth).expect(200);
      expect(view.body.settings).toMatchObject({ enabled: true, disabled_features: ['voice'], region: 'default' });
      expect(view.body.usage.days).toBe(30);
      // No tenant token reaches it.
      const refused = await http().get(`/v1/admin/tenants/${alpha.tenantId}/ai`).set(auth(alpha));
      expect([401, 403]).toContain(refused.status);
    });
  });
});
