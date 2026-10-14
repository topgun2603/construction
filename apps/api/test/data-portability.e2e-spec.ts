import { createHash, randomUUID } from 'node:crypto';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { DELETION_GRACE_DAYS, dataExportIsSecretColumn } from '@sitebook/shared';
import {
  createTestApp,
  destroyTenant,
  onboardTenant,
  uniquePhone,
  type OnboardedTenant,
  type TestApp,
} from './utils/test-app';
import { readZip } from './utils/zip-reader';
import { ObjectStore } from '../src/common/storage/object-store.service';
import { CompanyDeletionService } from '../src/modules/data-portability/company-deletion.service';
import { DataExportService } from '../src/modules/data-portability/data-export.service';
import { PortabilityStorage } from '../src/modules/data-portability/portability-storage.service';
import { tenantTables } from '../src/modules/data-portability/tenant-tables';

/**
 * Data export and deletion per company (roadmap Phase 3, compliance), end to end against a real
 * database and the MinIO bucket from the environment — under fresh, random company ids, so the
 * storage prefixes it writes and deletes are its own.
 *
 * The background worker is not running (JOBS_ENABLED=false under test): the export job and the
 * deletion sweep are called directly, the sweep with a clock moved past the grace period.
 */
describe('Data portability', () => {
  let test: TestApp;
  let alpha: OnboardedTenant;
  let beta: OnboardedTenant;
  let admin: PrismaClient | null = null;
  const created: string[] = [];
  const ADMIN_PHONE = '919000000087';
  const originalAllowlist = process.env['PLATFORM_ADMIN_PHONES'];
  let adminAuth: Record<string, string>;

  const store = new ObjectStore();
  const auth = (who: { accessToken: string }) => ({ Authorization: `Bearer ${who.accessToken}` });
  const http = () => test.http();

  // Alpha's fixture.
  let site: string;
  let contractor: string;
  let worker: string;
  let otherWorker: string;
  let photoKey: string;
  let documentKey: string;
  let billKey: string;
  let member: { id: string; phone: string; accessToken: string; refreshToken: string };
  let betaKey: string;

  /** Signs in again as somebody already in a company: a fresh session, so a fresh re-auth clock. */
  async function signIn(phone: string): Promise<{ accessToken: string; refreshToken: string }> {
    const response = await http().post('/v1/auth/exchange').send({ firebase_token: `dev:${phone}` }).expect(200);
    return { accessToken: response.body.access_token, refreshToken: response.body.refresh_token };
  }

  async function invite(owner: OnboardedTenant, role: string, projectIds: string[] = []) {
    const phone = uniquePhone();
    const response = await http()
      .post('/v1/tenants/current/invite')
      .set(auth(owner))
      .send({ phone, name: 'Priya Member', role, project_ids: projectIds })
      .expect(201);
    const session = await signIn(phone);
    return { id: response.body.id as string, phone, ...session };
  }

  async function put(key: string, text: string) {
    await store.put(key, Buffer.from(text), 'image/jpeg');
  }

  async function keysUnder(tenantId: string): Promise<string[]> {
    const out: string[] = [];
    for await (const item of test.app.get(PortabilityStorage).list(tenantId)) out.push(item.key);
    return out;
  }

  /** Rows a company has in a table, read with the company's own RLS context (or the admin role). */
  async function rowsIn(table: string, tenantId: string): Promise<number> {
    const sql = `SELECT count(*) AS n FROM "${table}" WHERE ${table === 'tenants' ? 'id' : 'tenant_id'} = '${tenantId}'::uuid`;
    if (admin) {
      const [row] = await admin.$queryRawUnsafe<Array<{ n: bigint }>>(sql);
      return Number(row?.n ?? 0);
    }
    const [row] = await test.tenantDb.transaction(tenantId, (tx) => tx.$queryRawUnsafe<Array<{ n: bigint }>>(sql));
    return Number(row?.n ?? 0);
  }

  /** Every table with a tenant_id column, straight from the catalogue — not from the code under test. */
  async function allTenantTables(): Promise<string[]> {
    const rows = await test.prisma.$queryRaw<Array<{ table_name: string }>>`
      SELECT c.table_name::text AS table_name FROM information_schema.columns c
        JOIN information_schema.tables t ON t.table_schema = c.table_schema AND t.table_name = c.table_name
       WHERE c.table_schema = 'public' AND c.column_name = 'tenant_id' AND t.table_type = 'BASE TABLE'
       ORDER BY 1`;
    return rows.map((row) => row.table_name);
  }

  async function downloadExport(owner: OnboardedTenant, exportId: string): Promise<Map<string, Buffer>> {
    const link = await http().get(`/v1/data-exports/${exportId}/download`).set(auth(owner)).expect(200);
    const response = await fetch(link.body.url);
    expect(response.status).toBe(200);
    return readZip(Buffer.from(await response.arrayBuffer()));
  }

  beforeAll(async () => {
    process.env['PLATFORM_ADMIN_PHONES'] = ADMIN_PHONE;
    test = await createTestApp();
    // Listening once, so every request reuses one port and a kept-alive connection instead of
    // supertest opening a fresh server per request — this suite makes a few hundred. createTestApp
    // may already have done it (it listens once for every suite now), so only if it has not.
    if (!test.app.getHttpServer().listening) await test.app.listen(0, '127.0.0.1');
    if (process.env['ADMIN_DATABASE_URL']) {
      admin = new PrismaClient({ datasources: { db: { url: process.env['ADMIN_DATABASE_URL'] } } });
    }

    alpha = await onboardTenant(test, { name: 'Alpha Portability Builders', phone: uniquePhone() });
    beta = await onboardTenant(test, { name: 'Beta Portability Builders', phone: uniquePhone() });
    created.push(alpha.tenantId, beta.tenantId);

    site = (await http().post('/v1/projects').set(auth(alpha)).send({ name: 'Harbour View' }).expect(201)).body.id;
    contractor = (
      await http()
        .post('/v1/contractors')
        .set(auth(alpha))
        .send({ name: 'Murugan Masonry', trade: 'Masonry', payment_terms: 'weekly' })
        .expect(201)
    ).body.id;
    const addWorker = async (name: string, phone: string) =>
      (
        await http()
          .post('/v1/workers')
          .set(auth(alpha))
          .send({
            name,
            phone,
            trade: 'Mason',
            skill_level: 'skilled',
            contractor_id: contractor,
            daily_wage: '85000',
            overtime_rate_per_hour: '11000',
            project_id: site,
            from_date: '2026-09-01',
          })
          .expect(201)
      ).body.id as string;
    worker = await addWorker('Raju Mason', '9876500011');
    otherWorker = await addWorker('Selvam Helper', '9876500012');

    await http()
      .post('/v1/attendance')
      .set(auth(alpha))
      .send({
        project_id: site,
        attendance_date: '2026-09-02',
        rows: [
          { worker_id: worker, status: 'present', overtime_hours: '2' },
          { worker_id: otherWorker, status: 'present' },
        ],
      })
      .expect(201);
    await http()
      .post('/v1/attendance')
      .set(auth(alpha))
      .send({ project_id: site, attendance_date: '2026-09-03', rows: [{ worker_id: worker, status: 'half_day' }] })
      .expect(201);
    await http()
      .post('/v1/wage-periods/generate')
      .set(auth(alpha))
      .send({ contractor_id: contractor, period_start: '2026-09-01', period_end: '2026-09-07' })
      .expect(201);

    // Uploaded files, written straight to storage under the company's prefix, and rows naming them.
    photoKey = `${alpha.tenantId}/worker_photo/tenant/202609/${randomUUID()}.jpg`;
    documentKey = `${alpha.tenantId}/worker_document/tenant/202609/${randomUUID()}.jpg`;
    billKey = `${alpha.tenantId}/bill/p/${site}/202609/${randomUUID()}.jpg`;
    await put(photoKey, 'photo of raju');
    await put(documentKey, 'scan of an id card');
    await put(billKey, 'a diesel bill');
    await test.tenantDb.transaction(alpha.tenantId, (tx) =>
      tx.worker.update({ where: { id: worker }, data: { photoS3Key: photoKey } }),
    );
    const document = await http()
      .post(`/v1/workers/${worker}/documents`)
      .set(auth(alpha))
      .send({ kind: 'emirates_id', number: '784-1990-1234567-1', expires_on: '2027-01-01', s3_key: documentKey })
      .expect(201);
    expect(document.body.id).toBeTruthy();
    await http()
      .post('/v1/expenses')
      .set(auth(alpha))
      .send({ project_id: site, amount: '420000', category: 'fuel', spent_on: '2026-09-02', bill_s3_key: billKey })
      .expect(201);

    member = await invite(alpha, 'project_manager', [site]);

    // Beta: one site and one file, which nothing done to Alpha may touch.
    await http().post('/v1/projects').set(auth(beta)).send({ name: 'Beta Tower' }).expect(201);
    betaKey = `${beta.tenantId}/site_photo/tenant/202609/${randomUUID()}.jpg`;
    await put(betaKey, 'beta photo');

    const login = await http().post('/v1/admin/auth/login').send({ firebase_token: `dev:${ADMIN_PHONE}` }).expect(201);
    adminAuth = { Authorization: `Bearer ${login.body.access_token}` };
  });

  afterAll(async () => {
    for (const tenantId of created) {
      // Whatever a failed run left behind, and its files.
      await destroyTenant(test, tenantId).catch(() => undefined);
      await test.app.get(PortabilityStorage).removePrefix(tenantId).catch(() => undefined);
    }
    await admin?.$disconnect();
    await test.close();
    if (originalAllowlist === undefined) delete process.env['PLATFORM_ADMIN_PHONES'];
    else process.env['PLATFORM_ADMIN_PHONES'] = originalAllowlist;
  });

  describe('every company table is deleted with the company', () => {
    /**
     * The hard delete removes the `tenants` row and relies on everything else going with it. This is
     * what makes that safe for modules not written yet: a table with a `tenant_id` must either
     * cascade from `tenants`, or be listed here with how it goes (or why it stays).
     */
    const HANDLED_OTHERWISE: Record<string, string> = {
      auth_identities: 'removed by the trigger on users when the users rows cascade',
      company_group_admins: 'cascades from company_group_members, which cascades from tenants',
      platform_audit_log: 'the console’s own trail; kept by design and holds no company data',
    };

    it('has a cascading foreign key to tenants on every tenant_id', async () => {
      const rows = await test.prisma.$queryRaw<Array<{ table_name: string; cascades: boolean }>>`
        SELECT c.table_name::text AS table_name,
               EXISTS (
                 SELECT 1 FROM pg_constraint con
                   JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = ANY (con.conkey)
                  WHERE con.contype = 'f' AND con.conrelid = ('public.' || quote_ident(c.table_name))::regclass
                    AND a.attname = 'tenant_id' AND con.confrelid = 'public.tenants'::regclass
                    AND con.confdeltype = 'c'
               ) AS cascades
          FROM information_schema.columns c
          JOIN information_schema.tables t ON t.table_schema = c.table_schema AND t.table_name = c.table_name
         WHERE c.table_schema = 'public' AND c.column_name = 'tenant_id' AND t.table_type = 'BASE TABLE'`;
      expect(rows.length).toBeGreaterThan(100);
      const unhandled = rows.filter((row) => !row.cascades && !(row.table_name in HANDLED_OTHERWISE));
      expect(unhandled.map((row) => row.table_name)).toEqual([]);
    });

    it('keeps the deletion certificate out of reach of anything keyed on tenant_id', async () => {
      const columns = await test.prisma.$queryRaw<Array<{ column_name: string }>>`
        SELECT column_name::text AS column_name FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'deletion_certificates'`;
      expect(columns.map((c) => c.column_name)).not.toContain('tenant_id');
    });
  });

  describe('full company export', () => {
    let exportId: string;

    it('is for owners only', async () => {
      const refused = await http().post('/v1/data-exports').set(auth(member)).expect(403);
      expect(refused.body.code).toBe('FORBIDDEN');
    });

    it('queues one export at a time', async () => {
      const queued = await http().post('/v1/data-exports').set(auth(alpha)).expect(201);
      expect(queued.body.status).toBe('queued');
      exportId = queued.body.id;
      const again = await http().post('/v1/data-exports').set(auth(alpha)).expect(409);
      expect(again.body.code).toBe('CONFLICT');
    });

    it('builds a ZIP with every company table, the registers and every uploaded file', async () => {
      const manifest = await test.app.get(DataExportService).run(alpha.tenantId, exportId);
      expect(manifest).not.toBeNull();

      const list = await http().get('/v1/data-exports').set(auth(alpha)).expect(200);
      const row = list.body.items.find((item: { id: string }) => item.id === exportId);
      expect(row).toMatchObject({ status: 'ready', files: 3 });
      expect(new Date(row.expires_at).getTime() - Date.now()).toBeGreaterThan(6.9 * 86_400_000);

      const zip = await downloadExport(alpha, exportId);
      expect(zip.has('manifest.json')).toBe(true);
      expect(zip.has('README.txt')).toBe(true);
      expect(zip.get('registers.xlsx')?.subarray(0, 2).toString()).toBe('PK');

      // Every table with a tenant_id is in the ZIP — read from the catalogue, not from the exporter.
      const tables = (await allTenantTables()).filter((name) => name !== 'platform_audit_log');
      for (const table of [...tables, 'tenants']) {
        expect(zip.has(`tables/${table}.jsonl`)).toBe(true);
      }

      // Manifest counts are the lines in each file, and the rows in the database.
      const written = JSON.parse(zip.get('manifest.json')!.toString());
      expect(written.company.id).toBe(alpha.tenantId);
      // The newest migration, whatever it is — a fixed name here breaks every time one is added.
      const latest = readdirSync(join(__dirname, '..', 'prisma', 'migrations'))
        .filter((name) => /^\d{14}_/.test(name))
        .sort()
        .pop();
      expect(written.schema_version).toBe(latest);
      for (const [table, count] of Object.entries(written.tables as Record<string, number>)) {
        const text = zip.get(`tables/${table}.jsonl`)!.toString();
        const lines = text.split('\n').filter(Boolean);
        expect(lines).toHaveLength(count);
      }
      expect(written.tables.workers).toBe(2);
      expect(written.tables.attendance).toBe(await rowsIn('attendance', alpha.tenantId));
      expect(written.tables.tenants).toBe(1);

      // Secrets are left out — by column, so not even the key is there.
      const users = zip.get('tables/users.jsonl')!.toString().split('\n').filter(Boolean).map((line) => JSON.parse(line));
      expect(users.length).toBeGreaterThanOrEqual(2);
      expect(users[0]).toHaveProperty('phone');
      expect(users[0]).not.toHaveProperty('fcm_tokens');
      const docs = zip.get('tables/worker_documents.jsonl')!.toString().split('\n').filter(Boolean).map((line) => JSON.parse(line));
      expect(docs[0]).toHaveProperty('number_hint');
      expect(docs[0]).not.toHaveProperty('number_cipher');
      for (const name of [...zip.keys()].filter((key) => key.startsWith('tables/'))) {
        const first = zip.get(name)!.toString().split('\n').find(Boolean);
        if (!first) continue;
        for (const column of Object.keys(JSON.parse(first))) {
          expect(dataExportIsSecretColumn(column)).toBe(false);
        }
      }
      expect(written.omitted_columns.users).toContain('fcm_tokens');
      expect(written.omitted_columns.refresh_tokens).toContain('token_hash');

      // The uploads, under their own keys.
      expect(zip.get(`files/${photoKey}`)?.toString()).toBe('photo of raju');
      expect(zip.get(`files/${documentKey}`)?.toString()).toBe('scan of an id card');
      expect(zip.get(`files/${billKey}`)?.toString()).toBe('a diesel bill');

      // And nothing of anybody else's.
      for (const [name, content] of zip) {
        if (name.endsWith('.xlsx')) continue;
        expect(content.toString()).not.toContain(beta.tenantId);
      }
    });

    it('tells the owner it is ready', async () => {
      const notes = await test.tenantDb.clientFor(alpha.tenantId).notification.findMany({
        where: { userId: alpha.ownerId, type: 'data_export.ready' },
      });
      expect(notes).toHaveLength(1);
    });

    it('allows one export a day', async () => {
      const refused = await http().post('/v1/data-exports').set(auth(alpha)).expect(429);
      expect(refused.body.code).toBe('RATE_LIMITED');
      const list = await http().get('/v1/data-exports').set(auth(alpha)).expect(200);
      expect(list.body.can_request).toBe(false);
      expect(list.body.blocked_reason).toBe('cooldown');
    });

    it('writes the export and the download to the audit log', async () => {
      const entries = await test.tenantDb.clientFor(alpha.tenantId).auditLog.findMany({
        where: { OR: [{ entity: 'data_exports', entityId: exportId }, { action: 'data_export.downloaded' }] },
      });
      const actions = entries.map((entry) => entry.action);
      expect(actions).toContain('create');
      expect(actions).toContain('data_export.downloaded');
    });

    it('removes the file when the week is up', async () => {
      const sweep = test.app.get(CompanyDeletionService);
      // Exports are expired by the same hourly sweep, which finds companies through auth_identities.
      await sweep.sweep(new Date(Date.now() + 8 * 86_400_000));
      const list = await http().get('/v1/data-exports').set(auth(alpha)).expect(200);
      expect(list.body.items.find((item: { id: string }) => item.id === exportId).status).toBe('expired');
      expect((await keysUnder(alpha.tenantId)).some((key) => key.includes('/exports/'))).toBe(false);
      await http().get(`/v1/data-exports/${exportId}/download`).set(auth(alpha)).expect(409);
    });
  });

  describe('the data processing agreement', () => {
    it('records which version the owner accepted', async () => {
      const before = await http().get('/v1/legal').set(auth(alpha)).expect(200);
      expect(before.body.dpa.accepted).toBeNull();
      const version = before.body.dpa.version as string;

      await http().post('/v1/legal/accept').set(auth(alpha)).send({ version: 'not-this-one' }).expect(409);
      await http().post('/v1/legal/accept').set(auth(member)).send({ version }).expect(403);
      const accepted = await http().post('/v1/legal/accept').set(auth(alpha)).send({ version }).expect(200);
      expect(accepted.body.dpa.accepted).toMatchObject({ version, accepted_by_name: 'Owner' });

      const audit = await test.tenantDb.clientFor(alpha.tenantId).auditLog.findFirst({
        where: { entity: 'legal_acceptances', action: 'create' },
      });
      expect(audit).not.toBeNull();
    });
  });

  describe('one person’s data', () => {
    async function wageTotals(workerId: string) {
      return test.tenantDb.transaction(alpha.tenantId, async (tx) => {
        const lines = await tx.wageLine.findMany({ where: { workerId } });
        const attendance = await tx.attendance.count({ where: { workerId } });
        return {
          gross: lines.reduce((sum, line) => sum + line.grossAmount, 0n),
          net: lines.reduce((sum, line) => sum + line.netPayable, 0n),
          attendance,
        };
      });
    }

    it('exports everything about one worker, with their files', async () => {
      const response = await http()
        .get(`/v1/people-data/workers/${worker}/export`)
        .set(auth(alpha))
        .buffer(true)
        .parse((res, done) => {
          const chunks: Buffer[] = [];
          res.on('data', (chunk: Buffer) => chunks.push(chunk));
          res.on('end', () => done(null, Buffer.concat(chunks)));
        })
        .expect(200);
      expect(response.headers['content-type']).toBe('application/zip');
      const zip = readZip(response.body as Buffer);
      expect(JSON.parse(zip.get('person.json')!.toString()).name).toBe('Raju Mason');
      expect(JSON.parse(zip.get('related/attendance.worker_id.json')!.toString())).toHaveLength(2);
      expect(JSON.parse(zip.get('related/wage_lines.worker_id.json')!.toString())).toHaveLength(1);
      const documents = JSON.parse(zip.get('related/worker_documents.worker_id.json')!.toString());
      expect(documents[0]).not.toHaveProperty('number_cipher');
      expect(zip.get(`files/${photoKey}`)?.toString()).toBe('photo of raju');
      expect(zip.get(`files/${documentKey}`)?.toString()).toBe('scan of an id card');
      // Only this worker's rows.
      expect(zip.get('related/attendance.worker_id.json')!.toString()).not.toContain(otherWorker);

      const audit = await test.tenantDb.clientFor(alpha.tenantId).auditLog.findFirst({
        where: { action: 'person.exported', entityId: worker },
      });
      expect(audit).not.toBeNull();
    });

    it('is for owners only', async () => {
      await http().get(`/v1/people-data/workers/${worker}/export`).set(auth(member)).expect(403);
      await http()
        .post(`/v1/people-data/workers/${worker}/anonymise`)
        .set(auth(member))
        .send({ confirm: 'ANONYMISE' })
        .expect(403);
    });

    it('anonymises a former worker and keeps their wage records', async () => {
      // Somebody still on the books cannot be anonymised.
      await http()
        .post(`/v1/people-data/workers/${worker}/anonymise`)
        .set(auth(alpha))
        .send({ confirm: 'ANONYMISE' })
        .expect(409);

      const before = await wageTotals(worker);
      expect(before.gross).toBeGreaterThan(0n);
      await test.tenantDb.transaction(alpha.tenantId, (tx) =>
        tx.worker.update({ where: { id: worker }, data: { status: 'inactive' } }),
      );

      const result = await http()
        .post(`/v1/people-data/workers/${worker}/anonymise`)
        .set(auth(alpha))
        .send({ confirm: 'ANONYMISE' })
        .expect(200);
      expect(result.body).toMatchObject({ anonymised: true, documents_deleted: 1, files_deleted: 2 });

      const row = await test.tenantDb.clientFor(alpha.tenantId).worker.findUniqueOrThrow({ where: { id: worker } });
      expect(row.name).toMatch(/^Former worker /);
      expect(row.phone).toBeNull();
      expect(row.photoS3Key).toBeNull();
      expect(await test.tenantDb.clientFor(alpha.tenantId).workerDocument.count({ where: { workerId: worker } })).toBe(0);
      const keys = await keysUnder(alpha.tenantId);
      expect(keys).not.toContain(photoKey);
      expect(keys).not.toContain(documentKey);
      expect(keys).toContain(billKey);

      // The money is untouched.
      expect(await wageTotals(worker)).toEqual(before);

      const audit = await test.tenantDb.clientFor(alpha.tenantId).auditLog.findFirst({
        where: { action: 'person.anonymised', entityId: worker },
      });
      expect(audit).not.toBeNull();
    });

    it('anonymises a former team member, who can then no longer sign in', async () => {
      const leaver = await invite(alpha, 'accounts');
      await http()
        .post(`/v1/people-data/users/${leaver.id}/anonymise`)
        .set(auth(alpha))
        .send({ confirm: 'ANONYMISE' })
        .expect(409);
      await http().delete(`/v1/tenants/current/team/${leaver.id}`).set(auth(alpha)).expect(204);

      await http()
        .post(`/v1/people-data/users/${leaver.id}/anonymise`)
        .set(auth(alpha))
        .send({ confirm: 'ANONYMISE' })
        .expect(200);
      const row = await test.tenantDb.clientFor(alpha.tenantId).user.findUniqueOrThrow({ where: { id: leaver.id } });
      expect(row.name).toMatch(/^Former user /);
      expect(row.phone).not.toBe(leaver.phone);
      expect(row.phone.startsWith('anonymised-')).toBe(true);

      const search = await http().get('/v1/people-data/search?q=Former').set(auth(alpha)).expect(200);
      expect(search.body.items.some((item: { id: string; anonymised: boolean }) => item.id === leaver.id && item.anonymised)).toBe(true);
    });
  });

  describe('deleting a company', () => {
    it('is for owners only, and wants the name typed', async () => {
      await http().post('/v1/company-deletion').set(auth(member)).send({ confirm_name: 'Alpha Portability Builders' }).expect(403);
      const wrong = await http().post('/v1/company-deletion').set(auth(alpha)).send({ confirm_name: 'Alpha' }).expect(409);
      expect(wrong.body.code).toBe('CONFLICT');
    });

    it('wants a sign-in from the last ten minutes', async () => {
      await test.tenantDb.transaction(alpha.tenantId, (tx) =>
        tx.userSession.updateMany({
          where: { userId: alpha.ownerId },
          data: { startedAt: new Date(Date.now() - 20 * 60_000) },
        }),
      );
      const stale = await http()
        .post('/v1/company-deletion')
        .set(auth(alpha))
        .send({ confirm_name: 'Alpha Portability Builders' })
        .expect(403);
      expect(stale.body.code).toBe('REAUTH_REQUIRED');
      const status = await http().get('/v1/company-deletion').set(auth(alpha)).expect(200);
      expect(status.body.reauth.fresh).toBe(false);
    });

    it('schedules the deletion, signs everybody out and refuses sign-in with the date', async () => {
      const fresh = await signIn(alpha.phone);
      alpha = { ...alpha, ...fresh };
      const response = await http()
        .post('/v1/company-deletion')
        .set(auth(alpha))
        .send({ confirm_name: '  Alpha Portability Builders ' })
        .expect(200);
      const purgeAfter = new Date(response.body.purge_after);
      expect(Math.round((purgeAfter.getTime() - Date.now()) / 86_400_000)).toBe(DELETION_GRACE_DAYS);

      // Every session ended: the member's refresh token is dead, their access token refused.
      await http().post('/v1/auth/refresh').send({ refresh_token: member.refreshToken }).expect(401);
      const blocked = await http().get('/v1/me').set(auth(member)).expect(403);
      expect(blocked.body.code).toBe('TENANT_PENDING_DELETION');

      // Signing in tells them when, and that the owner can cancel.
      const refused = await http().post('/v1/auth/exchange').send({ firebase_token: `dev:${member.phone}` }).expect(403);
      expect(refused.body.code).toBe('TENANT_PENDING_DELETION');
      expect(refused.body.message).toContain(purgeAfter.toISOString().slice(0, 10));
      expect(refused.body.message).toContain('owner');

      const audit = await test.tenantDb.clientFor(alpha.tenantId).auditLog.findFirst({
        where: { action: 'company.deletion_requested' },
      });
      expect(audit).not.toBeNull();
    });

    it('lets the owner in only to see the date and cancel', async () => {
      const owner = await signIn(alpha.phone);
      const blocked = await http().get('/v1/me').set(auth(owner)).expect(403);
      expect(blocked.body.code).toBe('TENANT_PENDING_DELETION');
      const status = await http().get('/v1/company-deletion').set(auth(owner)).expect(200);
      expect(status.body.pending).not.toBeNull();
      expect(status.body.status).toBe('pending_deletion');

      await http().post('/v1/company-deletion/cancel').set(auth(owner)).expect(200);
      await http().get('/v1/me').set(auth(owner)).expect(200);
      // And everybody else can come back.
      const back = await signIn(member.phone);
      member = { ...member, ...back };
      await http().get('/v1/me').set(auth(member)).expect(200);
      alpha = { ...alpha, ...owner };

      const audit = await test.tenantDb.clientFor(alpha.tenantId).auditLog.findFirst({
        where: { action: 'company.deletion_cancelled' },
      });
      expect(audit).not.toBeNull();
    });

    it('deletes every row and file once the grace period is over, and keeps a certificate', async () => {
      const fresh = await signIn(alpha.phone);
      alpha = { ...alpha, ...fresh };
      await http()
        .post('/v1/company-deletion')
        .set(auth(alpha))
        .send({ confirm_name: 'Alpha Portability Builders' })
        .expect(200);

      const sweep = test.app.get(CompanyDeletionService);
      // A day before the end, nothing happens.
      const early = await sweep.sweep(new Date(Date.now() + (DELETION_GRACE_DAYS - 1) * 86_400_000));
      expect(early.deleted).not.toContain(alpha.tenantId);
      expect(await rowsIn('workers', alpha.tenantId)).toBe(2);

      const before = await test.tenantDb.transaction(alpha.tenantId, (tx) => tenantTables(tx));
      expect(before.length).toBeGreaterThan(100);

      const late = await sweep.sweep(new Date(Date.now() + (DELETION_GRACE_DAYS + 1) * 86_400_000));
      expect(late.deleted).toContain(alpha.tenantId);

      // No row left in any table with a tenant_id — the platform's own trail aside.
      for (const table of await allTenantTables()) {
        if (table === 'platform_audit_log') continue;
        expect([table, await rowsIn(table, alpha.tenantId)]).toEqual([table, 0]);
      }
      expect(await rowsIn('tenants', alpha.tenantId)).toBe(0);
      const identities = await test.prisma.authIdentity.count({ where: { tenantId: alpha.tenantId } });
      expect(identities).toBe(0);

      // No file left under its prefix.
      expect(await keysUnder(alpha.tenantId)).toEqual([]);

      // The certificate: counts, no name — only its hash.
      const certificate = await test.prisma.deletionCertificate.findFirstOrThrow({ where: { companyId: alpha.tenantId } });
      expect(certificate.trigger).toBe('grace_period');
      expect(certificate.nameHash).toBe(
        createHash('sha256').update('alpha portability builders').digest('hex'),
      );
      expect((certificate.tableCounts as Record<string, number>)['workers']).toBe(2);
      expect(certificate.objectCount).toBeGreaterThanOrEqual(1);
      expect(JSON.stringify(certificate)).not.toContain('Alpha');
      // And it cannot be edited or removed.
      await expect(
        test.prisma.deletionCertificate.update({ where: { id: certificate.id }, data: { objectCount: 0 } }),
      ).rejects.toThrow();

      // The old tokens no longer get anywhere.
      await http().get('/v1/me').set(auth(alpha)).expect(401);

      // Beta is untouched.
      expect(await rowsIn('projects', beta.tenantId)).toBe(1);
      expect(await keysUnder(beta.tenantId)).toContain(betaKey);
      await http().get('/v1/me').set(auth(beta)).expect(200);
    });
  });

  describe('the platform console', () => {
    let gamma: OnboardedTenant;

    beforeAll(async () => {
      gamma = await onboardTenant(test, { name: 'Gamma Portability Builders', phone: uniquePhone() });
      created.push(gamma.tenantId);
      await put(`${gamma.tenantId}/site_photo/tenant/202609/${randomUUID()}.jpg`, 'gamma photo');
      await http().post('/v1/company-deletion').set(auth(gamma)).send({ confirm_name: 'Gamma Portability Builders' }).expect(200);
    });

    it('lists pending deletions, and can cancel one', async () => {
      const overview = await http().get('/v1/admin/deletions').set(adminAuth).expect(200);
      expect(overview.body.pending.some((row: { tenant_id: string }) => row.tenant_id === gamma.tenantId)).toBe(true);
      expect(overview.body.certificates.some((row: { company_id: string }) => row.company_id === alpha.tenantId)).toBe(true);

      // Not through a status edit: that would skip the request and the audit.
      await http().patch(`/v1/admin/tenants/${gamma.tenantId}`).set(adminAuth).send({ status: 'active' }).expect(409);

      await http().post(`/v1/admin/tenants/${gamma.tenantId}/deletion/cancel`).set(adminAuth).expect(200);
      const back = await signIn(gamma.phone);
      await http().get('/v1/me').set(auth(back)).expect(200);
      gamma = { ...gamma, ...back };
    });

    it('can carry one out at once, with the name typed back', async () => {
      await http().post('/v1/company-deletion').set(auth(gamma)).send({ confirm_name: 'Gamma Portability Builders' }).expect(200);
      await http()
        .post(`/v1/admin/tenants/${gamma.tenantId}/deletion/expedite`)
        .set(adminAuth)
        .send({ confirm_name: 'Gamma' })
        .expect(409);
      const done = await http()
        .post(`/v1/admin/tenants/${gamma.tenantId}/deletion/expedite`)
        .set(adminAuth)
        .send({ confirm_name: 'Gamma Portability Builders' })
        .expect(200);
      expect(done.body.company_id).toBe(gamma.tenantId);

      expect(await rowsIn('tenants', gamma.tenantId)).toBe(0);
      expect(await keysUnder(gamma.tenantId)).toEqual([]);
      const certificate = await test.prisma.deletionCertificate.findFirstOrThrow({ where: { companyId: gamma.tenantId } });
      expect(certificate.trigger).toBe('platform');

      const trail = await http().get('/v1/admin/audit').set(adminAuth).expect(200);
      const actions = trail.body.entries
        .filter((entry: { tenant_id: string }) => entry.tenant_id === gamma.tenantId)
        .map((entry: { action: string }) => entry.action);
      expect(actions).toEqual(expect.arrayContaining(['tenant.deletion_cancelled', 'tenant.deletion_expedited']));
    });

    it('cannot start a deletion nobody asked for', async () => {
      await http()
        .post(`/v1/admin/tenants/${beta.tenantId}/deletion/expedite`)
        .set(adminAuth)
        .send({ confirm_name: 'Beta Portability Builders' })
        .expect(409);
      await http().post(`/v1/admin/tenants/${beta.tenantId}/deletion/cancel`).set(adminAuth).expect(409);
    });
  });
});
