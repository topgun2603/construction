import ExcelJS from 'exceljs';
import { ExcelExportService } from '../src/modules/excel/excel-export.service';
import {
  createTestApp,
  destroyTenant,
  onboardTenant,
  uniquePhone,
  type OnboardedTenant,
  type TestApp,
} from './utils/test-app';

type Auth = { Authorization: string };

/** Collects a binary body, which supertest would otherwise try to read as text. */
function binary(res: NodeJS.ReadableStream, done: (error: Error | null, body: unknown) => void): void {
  const chunks: Buffer[] = [];
  res.on('data', (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
  res.on('end', () => done(null, Buffer.concat(chunks)));
}

async function workbookOf(bytes: Buffer): Promise<ExcelJS.Workbook> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(bytes as unknown as ArrayBuffer);
  return workbook;
}

async function xlsxBase64(rows: unknown[][], sheetName = 'Sheet1'): Promise<string> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(sheetName);
  for (const row of rows) sheet.addRow(row);
  return Buffer.from(await workbook.xlsx.writeBuffer()).toString('base64');
}

const csvBase64 = (text: string) => Buffer.from(text, 'utf8').toString('base64');

/** Header → column number, for reading a sheet by name rather than position. */
function columns(sheet: ExcelJS.Worksheet): Record<string, number> {
  const out: Record<string, number> = {};
  sheet.getRow(1).eachCell((cell, column) => {
    out[String(cell.value)] = column;
  });
  return out;
}

/**
 * Excel export on every table and Excel import with templates (roadmap Phase 3, item 4): typed cells
 * that parse back, permission-hidden columns staying hidden, the import pipeline from header matching
 * through all-or-nothing and valid-only commits to the audit entry, templates with dropdowns, tenant
 * isolation, and the size and row caps.
 */
describe('Excel export and import', () => {
  let test: TestApp;
  let alpha: OnboardedTenant;
  let beta: OnboardedTenant;
  let owner: Auth;
  let supervisor: Auth;
  let stranger: Auth;
  let site: string;
  let contractor: string;
  let vendor: string;

  const http = () => test.http();

  async function invite(role: string, projectIds: string[]): Promise<Auth> {
    const phone = uniquePhone();
    await http().post('/v1/tenants/current/invite').set(owner).send({ phone, name: `A ${role}`, role, project_ids: projectIds }).expect(201);
    const login = await http().post('/v1/auth/exchange').send({ firebase_token: `dev:${phone}` }).expect(200);
    return { Authorization: `Bearer ${login.body.access_token}` };
  }

  async function download(path: string, auth: Auth): Promise<ExcelJS.Workbook> {
    const response = await http().get(path).set(auth).buffer(true).parse(binary as never).expect(200);
    expect(response.headers['content-type']).toContain('spreadsheetml');
    expect(response.headers['cache-control']).toBe('no-store');
    return workbookOf(response.body as Buffer);
  }

  beforeAll(async () => {
    test = await createTestApp();
    alpha =await onboardTenant(test, { name: 'Ledger Builders', phone: uniquePhone() });
    beta = await onboardTenant(test, { name: 'Other Builders', phone: uniquePhone() });
    owner = { Authorization: `Bearer ${alpha.accessToken}` };
    stranger = { Authorization: `Bearer ${beta.accessToken}` };

    site = (await http().post('/v1/projects').set(owner).send({ name: 'Harbour Point', status: 'active' }).expect(201)).body.id;
    contractor = (await http().post('/v1/contractors').set(owner).send({ name: 'Selvam Masonry', trade: 'Masonry' }).expect(201)).body.id;
    vendor = (await http().post('/v1/vendors').set(owner).send({ name: 'Raj Earthmovers' }).expect(201)).body.id;
    supervisor = await invite('site_supervisor', [site]);

    await http()
      .post('/v1/workers')
      .set(owner)
      .send({ name: 'Ravi', phone: '9876500001', trade: 'Mason', contractor_id: contractor, daily_wage: '85050', overtime_rate_per_hour: '12000', project_id: site })
      .expect(201);
    await http().post('/v1/workers').set(stranger).send({ name: 'Beta Worker', daily_wage: '50000' }).expect(201);
  });

  afterAll(async () => {
    ExcelExportService.maxRows = 50_000;
    await destroyTenant(test, alpha.tenantId);
    await destroyTenant(test, beta.tenantId);
    await test.close();
  });

  // --- export ----------------------------------------------------------------------------------------

  describe('export', () => {
    it('writes workers with typed cells, a frozen filtered header and an About sheet', async () => {
      const book = await download('/v1/exports/workers', owner);
      const sheet = book.getWorksheet('Workers')!;
      const at = columns(sheet);
      expect(sheet.getRow(1).font?.bold).toBe(true);
      expect(sheet.views[0]).toMatchObject({ state: 'frozen', ySplit: 1 });
      expect(sheet.autoFilter).toBeTruthy();
      expect(sheet.rowCount).toBe(2);

      const ravi = sheet.getRow(2);
      expect(ravi.getCell(at['Name']!).value).toBe('Ravi');
      expect(ravi.getCell(at['Phone']!).value).toBe('+91 9876500001');
      expect(ravi.getCell(at['Contractor']!).value).toBe('Selvam Masonry');
      // Money is a number in major units with the company currency's format, not text.
      expect(ravi.getCell(at['Daily wage']!).value).toBe(850.5);
      expect(ravi.getCell(at['Daily wage']!).numFmt).toContain('[$INR]');
      expect(ravi.getCell(at['Daily wage']!).numFmt).toContain('#,##0.00');

      const about = book.getWorksheet('About')!;
      const lines = new Map<string, unknown>();
      about.eachRow((row) => lines.set(String(row.getCell(1).value), row.getCell(2).value));
      expect(lines.get('Company')).toBe('Ledger Builders');
      expect(lines.get('Exported by')).toBe('Owner');
      expect(lines.get('Exported on')).toBeInstanceOf(Date);
      expect(lines.get('Rows')).toBe(1);
    });

    it('keeps the screen filters and names them', async () => {
      const book = await download(`/v1/exports/workers?project_id=${site}&status=inactive`, owner);
      expect(book.getWorksheet('Workers')!.rowCount).toBe(1);
      const about = book.getWorksheet('About')!;
      let filters = '';
      about.eachRow((row) => {
        if (row.getCell(1).value === 'Filters') filters = String(row.getCell(2).value);
      });
      expect(filters).toContain('Site: Harbour Point');
      expect(filters).toContain('status: inactive');
    });

    it('turns the sheet right to left for an Arabic reader, and still offers CSV', async () => {
      const book = await download('/v1/exports/workers?lang=ar', owner);
      expect(book.getWorksheet('Workers')!.views[0]?.rightToLeft).toBe(true);

      const csv = await http().get('/v1/exports/workers?format=csv').set(owner).expect(200);
      expect(csv.headers['content-type']).toContain('text/csv');
      expect(csv.text).toContain('Ravi');
      expect(csv.text).toContain('850.50');
    });

    it('writes expenses with real dates and money', async () => {
      await http().post('/v1/expenses').set(owner).send({ project_id: site, amount: '640000', category: 'fuel', spent_on: '2026-03-03', note: '=HYPERLINK("x")' }).expect(201);
      const sheet = (await download(`/v1/exports/expenses?project_id=${site}`, owner)).getWorksheet('Expenses')!;
      const at = columns(sheet);
      const row = sheet.getRow(2);
      expect(row.getCell(at['Date']!).value).toEqual(new Date('2026-03-03T00:00:00.000Z'));
      expect(row.getCell(at['Date']!).numFmt).toBe('dd-mmm-yyyy');
      expect(row.getCell(at['Amount']!).value).toBe(6400);
      expect(row.getCell(at['Site']!).value).toBe('Harbour Point');
      // A formula typed into a note stays text in the workbook — a string cell, never a formula.
      expect(row.getCell(at['Note']!).value).toBe('=HYPERLINK("x")');
      expect(row.getCell(at['Note']!).formula).toBeUndefined();
    });

    it("leaves out purchase order money for someone the screen hides it from", async () => {
      const cement = (await http().post('/v1/materials').set(owner).send({ name: 'Cement', unit: 'bag' }).expect(201)).body.id;
      await http()
        .post('/v1/purchase-orders')
        .set(owner)
        .send({ project_id: site, vendor_id: vendor, lines: [{ material_id: cement, quantity: '10', unit_rate: '40000', tax_rate_bp: 1800 }] })
        .expect(201);

      const full = (await download('/v1/exports/purchase_orders', owner)).getWorksheet('Purchase orders')!;
      expect(columns(full)['Total']).toBeDefined();
      expect(full.getRow(2).getCell(columns(full)['Total']!).value).toBe(4720);

      // A supervisor receives goods but does not see what they cost.
      const store = (await download('/v1/exports/purchase_orders', supervisor)).getWorksheet('Purchase orders')!;
      expect(store.rowCount).toBe(2);
      expect(columns(store)['Total']).toBeUndefined();
      expect(columns(store)['Subtotal']).toBeUndefined();
    });

    it('exports the audit log with real timestamps, and records that it did', async () => {
      const sheet = (await download('/v1/exports/audit?entity=workers', owner)).getWorksheet('Audit log')!;
      const at = columns(sheet);
      expect(sheet.rowCount).toBeGreaterThan(1);
      expect(sheet.getRow(2).getCell(at['When']!).value).toBeInstanceOf(Date);
      expect(sheet.getRow(2).getCell(at['Entity']!).value).toBe('workers');

      const log = await http().get('/v1/audit?action=audit.exported').set(owner).expect(200);
      expect(log.body.items[0].after).toMatchObject({ format: 'xlsx' });
    });

    it('checks the permission and module of the table asked for', async () => {
      await http().get('/v1/exports/audit').set(supervisor).expect(403);
      await http().get('/v1/exports/wage_periods').set(supervisor).expect(403);
      await http().get('/v1/exports/nothing_here').set(owner).expect(404);
      // The list's own validation: attendance needs a site and a day.
      await http().get('/v1/exports/attendance').set(owner).expect(422);
    });

    it("never shows another company's rows", async () => {
      const book = await download('/v1/exports/workers', stranger);
      const sheet = book.getWorksheet('Workers')!;
      expect(sheet.rowCount).toBe(2);
      expect(sheet.getRow(2).getCell(1).value).toBe('Beta Worker');
      // Filtering by another company's site finds nothing to scope to.
      await http().get(`/v1/exports/workers?project_id=${site}`).set(stranger).expect((res) => expect([403, 404]).toContain(res.status));
    });

    it('refuses an export over the cap with a clear message', async () => {
      ExcelExportService.maxRows = 0;
      try {
        const refused = await http().get('/v1/exports/workers').set(owner).expect(422);
        expect(refused.body.message).toMatch(/Narrow the filters/);
      } finally {
        ExcelExportService.maxRows = 50_000;
      }
    });
  });

  // --- templates -------------------------------------------------------------------------------------

  describe('templates', () => {
    it('ship headers, an example row, dropdowns and instructions', async () => {
      const book = await download('/v1/imports/workers/template', owner);
      const data = book.getWorksheet('Workers')!;
      const at: Record<string, number> = {};
      data.getRow(1).eachCell((cell, column) => {
        at[String(cell.value).replace(/ \*$/, '')] = column;
      });
      expect(data.getRow(1).getCell(at['Name']!).value).toBe('Name *');
      expect(data.getRow(2).getCell(at['Name']!).value).toBe('Murugan K');

      const skill = data.getRow(2).getCell(at['Skill level']!).dataValidation;
      expect(skill?.type).toBe('list');
      expect(skill?.formulae?.[0]).toMatch(/^Lists!/);
      // A reference column offers the company's own contractors.
      expect(data.getRow(5).getCell(at['Contractor']!).dataValidation?.type).toBe('list');
      const lists = book.getWorksheet('Lists')!;
      const values: unknown[] = [];
      lists.eachRow((row) => row.eachCell((cell) => values.push(cell.value)));
      expect(values).toEqual(expect.arrayContaining(['Semi-skilled', 'Selvam Masonry', 'Harbour Point']));

      expect(book.getWorksheet('Instructions')!.getRow(1).getCell(1).value).toBe('Workers import');
    });

    it('are behind the create permission', async () => {
      await http().get('/v1/imports/workers/template').set(supervisor).expect(403);
      await http().get('/v1/imports/rocks/template').set(owner).expect(404);
    });
  });

  // --- import ----------------------------------------------------------------------------------------

  describe('import', () => {
    const workerRows = async () =>
      xlsxBase64([
        ['Workers — Harbour Point'],
        [],
        ['Mobile', 'பெயர்', 'Daily wage (₹)', 'Contractor', 'Skill', 'Site', 'Notes nobody asked for'],
        ['98765 00002', 'Kumar', '1,250.50', 'Selvam Masonry', 'Semi-skilled', 'Harbour Point', 'x'],
        ['9876500003', 'Arul', 900, '', 'skilled', '', ''],
        ['12345', '', 'lots', 'Nobody & Sons', 'expert', 'Nowhere', ''],
        ['9876500001', 'Ravi again', 800, '', '', '', ''],
        ['9876500003', 'Arul twin', 900, '', '', '', ''],
        [],
      ]);

    it('previews: finds the header, maps Tamil and odd headers, and reports each row by number', async () => {
      const preview = await http()
        .post('/v1/imports/preview')
        .set(owner)
        .send({ kind: 'workers', file_name: 'crew.xlsx', content_base64: await workerRows() })
        .expect(200);
      const body = preview.body;
      expect(body.sheets).toEqual(['Sheet1']);
      expect(body.header_row).toBe(2);
      expect(body.mapping).toMatchObject({ phone: 0, name: 1, daily_wage: 2, contractor: 3, skill_level: 4, site: 5 });
      expect(body.total_rows).toBe(5);
      expect(body.valid_rows).toBe(2);
      expect(body.error_rows).toBe(3);

      const byRow = (row: number) => body.errors.filter((error: { row: number }) => error.row === row).map((error: { message: string }) => error.message);
      expect(body.rows[0]).toMatchObject({ row: 4, status: 'ok' });
      expect(byRow(6)).toEqual(
        expect.arrayContaining([
          'Name is required',
          expect.stringMatching(/^Phone is not a mobile number/),
          expect.stringMatching(/^Daily wage is not an amount/),
          expect.stringMatching(/^Skill level must be one of/),
        ]),
      );
      // Already on the books, and repeated within the file.
      expect(byRow(7)).toEqual([expect.stringMatching(/^Already exists: Ravi has this phone number/)]);
      expect(byRow(8)).toEqual(['Duplicate: same phone as row 5']);
    });

    it('imports nothing when any row is wrong, all or nothing', async () => {
      const refused = await http()
        .post('/v1/imports')
        .set(owner)
        .send({ kind: 'workers', file_name: 'crew.xlsx', content_base64: await workerRows(), mode: 'all' })
        .expect(422);
      expect(refused.body.message).toMatch(/3 rows have problems, so nothing was imported/);
      expect(refused.body.details.errors[0].row).toBe(6);
      const workers = await http().get('/v1/workers?q=Kumar').set(owner).expect(200);
      expect(workers.body.items).toHaveLength(0);
    });

    it('offers the problem rows as a workbook', async () => {
      const response = await http()
        .post('/v1/imports/error-report')
        .set(owner)
        .send({ kind: 'workers', file_name: 'crew.xlsx', content_base64: await workerRows() })
        .buffer(true)
        .parse(binary as never)
        .expect(200);
      const sheet = (await workbookOf(response.body as Buffer)).getWorksheet('Errors')!;
      expect(sheet.getRow(1).getCell(1).value).toBe('Row');
      expect(sheet.rowCount).toBe(4);
      expect(sheet.getRow(2).getCell(1).value).toBe(6);
      expect(String(sheet.getRow(2).getCell(2).value)).toContain('Name is required');
    });

    it('imports the valid rows only, through the workers service, and audits the import', async () => {
      const result = await http()
        .post('/v1/imports')
        .set(owner)
        .send({ kind: 'workers', file_name: 'crew.xlsx', content_base64: await workerRows(), mode: 'valid_only' })
        .expect(201);
      expect(result.body).toMatchObject({ imported: 2, failed: 3, skipped: 0, total_rows: 5 });

      const kumar = (await http().get('/v1/workers?q=Kumar').set(owner).expect(200)).body.items[0];
      expect(kumar).toMatchObject({ phone: '919876500002', daily_wage: '125050', skill_level: 'semi', contractor_name: 'Selvam Masonry' });
      // Put on the site named in the sheet, as the create endpoint does with a project_id.
      const onSite = await http().get(`/v1/workers?project_id=${site}`).set(owner).expect(200);
      expect(onSite.body.items.map((worker: { name: string }) => worker.name)).toContain('Kumar');

      const log = await http().get('/v1/audit?action=import.completed').set(owner).expect(200);
      expect(log.body.items[0]).toMatchObject({
        entity: 'workers',
        entity_label: 'crew.xlsx',
        after: { kind: 'workers', mode: 'valid_only', imported: 2, failed: 3 },
      });
      // Each worker has its own entry from the audit trigger, by the person who imported.
      const created = await http().get(`/v1/audit?entity=workers&entity_id=${kumar.id}`).set(owner).expect(200);
      expect(created.body.items[0]).toMatchObject({ action: 'create', actor: { name: 'Owner' } });
    });

    it('rolls every row back when the service refuses one at commit time', async () => {
      // The GSTIN is checked by the suppliers service, not by the sheet's schema: the first row is
      // created, the second is refused, and the first must not survive.
      const csv = 'Name,GSTIN\nFirst Good Traders,\nSecond Bad Traders,NOT-A-GSTIN\n';
      const preview = await http().post('/v1/imports/preview').set(owner).send({ kind: 'vendors', file_name: 'v.csv', content_base64: csvBase64(csv) }).expect(200);
      expect(preview.body.valid_rows).toBe(2);
      const refused = await http().post('/v1/imports').set(owner).send({ kind: 'vendors', file_name: 'v.csv', content_base64: csvBase64(csv) }).expect(422);
      expect(refused.body.message).toMatch(/^Row 3: That is not a valid GSTIN.*Nothing was imported/);
      const vendors = await http().get('/v1/vendors?q=Good').set(owner).expect(200);
      expect(vendors.body.items ?? vendors.body).toHaveLength(0);
    });

    it('spots a sheet that repeats what the company already has', async () => {
      const csv = 'Name,Unit\nSteel bar,kg\nSand,m3\n';
      const done = await http().post('/v1/imports').set(owner).send({ kind: 'materials', file_name: 'materials.csv', content_base64: csvBase64(csv) }).expect(201);
      expect(done.body.imported).toBe(2);
      // The same file again: every row is now a duplicate.
      const again = await http().post('/v1/imports/preview').set(owner).send({ kind: 'materials', file_name: 'materials.csv', content_base64: csvBase64(csv) }).expect(200);
      expect(again.body.errors.map((error: { message: string }) => error.message)).toEqual([
        'Already exists: a material called "Steel bar"',
        'Already exists: a material called "Sand"',
      ]);
    });

    it('imports suppliers from CSV with the header row matched by alias', async () => {
      const csv = [
        'Supplier,Contact,Mobile,E-mail,GSTIN,Credit days',
        'Sri Murugan Traders,Murugan,9840012399,Sales@Murugan.Example,,30',
        'Raj Earthmovers,,,,,',
        'Kaveri Steels,,,not-an-email,,thirty',
      ].join('\r\n');
      const preview = await http().post('/v1/imports/preview').set(owner).send({ kind: 'vendors', file_name: 'suppliers.csv', content_base64: csvBase64(csv) }).expect(200);
      expect(preview.body.sheets).toEqual([]);
      expect(preview.body.valid_rows).toBe(1);
      expect(preview.body.errors).toEqual(
        expect.arrayContaining([
          { row: 3, field: null, message: 'Already exists: a supplier called "Raj Earthmovers"' },
          { row: 4, field: 'email', message: 'Email is not an email address' },
        ]),
      );
      const result = await http()
        .post('/v1/imports')
        .set(owner)
        .send({ kind: 'vendors', file_name: 'suppliers.csv', content_base64: csvBase64(csv), mode: 'valid_only' })
        .expect(201);
      expect(result.body.imported).toBe(1);
      const vendors = await http().get('/v1/vendors?q=Murugan').set(owner).expect(200);
      expect(vendors.body[0] ?? vendors.body.items?.[0]).toMatchObject({ email: 'sales@murugan.example', payment_terms_days: 30, phone: '919840012399' });
    });

    it('imports equipment, resolving the vendor by name and skipping the template example', async () => {
      const template = await download('/v1/imports/equipment/template', owner);
      const sheet = template.getWorksheet('Equipment')!;
      const headers: string[] = [];
      sheet.getRow(1).eachCell((cell) => headers.push(String(cell.value)));
      const example: unknown[] = [];
      sheet.getRow(2).eachCell({ includeEmpty: true }, (cell) => example.push(cell.value));
      const row = (values: Record<string, unknown>) => headers.map((header) => values[header.replace(/ \*$/, '')] ?? null);

      const file = await xlsxBase64(
        [
          headers,
          example,
          row({ Name: 'Excavator 20T', Category: 'Excavator', Ownership: 'Hired', 'Hired from': 'raj earthmovers', 'Hire basis': 'per day', 'Hire rate': 12000, Code: 'EX-900' }),
          row({ Name: 'DG 62kVA', Category: 'Generator (DG set)', Ownership: 'owned', 'Fuel included': 'No', Year: 2020 }),
          row({ Name: 'Crane', Category: 'crane', Ownership: 'hired' }),
        ],
        'Equipment',
      );
      const preview = await http().post('/v1/imports/preview').set(owner).send({ kind: 'equipment', file_name: 'plant.xlsx', content_base64: file }).expect(200);
      expect(preview.body.skipped_rows).toBe(1);
      expect(preview.body.valid_rows).toBe(2);
      expect(preview.body.errors.map((error: { field: string }) => error.field).sort()).toEqual(['hire_basis', 'vendor']);

      const result = await http().post('/v1/imports').set(owner).send({ kind: 'equipment', file_name: 'plant.xlsx', content_base64: file, mode: 'valid_only' }).expect(201);
      expect(result.body).toMatchObject({ imported: 2, skipped: 1 });
      const machines = await http().get('/v1/equipment?q=Excavator').set(owner).expect(200);
      expect(machines.body.items[0]).toMatchObject({ code: 'EX-900', hire_basis: 'day', hire_rate: '1200000', vendor: { id: vendor } });

      // The same code again is a duplicate of what the company has.
      const again = await http().post('/v1/imports/preview').set(owner).send({ kind: 'equipment', file_name: 'plant.xlsx', content_base64: file }).expect(200);
      expect(again.body.errors).toEqual(expect.arrayContaining([expect.objectContaining({ message: 'Already exists: a machine with code EX-900' })]));
    });

    it('imports sites from CSV, dates day first, all or nothing', async () => {
      const csv = 'Site,Client,Start date,Target end date,Budget,Status\nRiver View,Mr. Rao,01/11/2026,30/06/2027,"45,00,000",Ongoing\nHill Top,,2026-12-01,,,planning\n';
      const result = await http().post('/v1/imports').set(owner).send({ kind: 'projects', file_name: 'sites.csv', content_base64: csvBase64(csv) }).expect(201);
      expect(result.body).toMatchObject({ imported: 2, failed: 0 });
      const sites = await http().get('/v1/projects?q=River').set(owner).expect(200);
      expect(sites.body.items[0]).toMatchObject({ start_date: '2026-11-01', target_end_date: '2027-06-30', budget_amount: '450000000', status: 'active' });

      const bad = 'Site,Start date,Target end date\nValley,10/10/2026,01/10/2026\n';
      const refused = await http().post('/v1/imports').set(owner).send({ kind: 'projects', file_name: 'sites.csv', content_base64: csvBase64(bad) }).expect(422);
      expect(refused.body.details.errors[0]).toMatchObject({ row: 2, field: 'target_end_date' });
    });

    it('imports cost codes from .xlsx into one site', async () => {
      const file = await xlsxBase64([
        ['Code', 'Name', 'Budget', 'Unit'],
        ['02', 'Earthworks', 500000, ''],
        ['02.01', 'Excavation', '1,25,000.50', 'm3'],
      ]);
      await http().post('/v1/imports/preview').set(owner).send({ kind: 'cost_codes', file_name: 'codes.xlsx', content_base64: file }).expect(422);
      const result = await http()
        .post('/v1/imports')
        .set(owner)
        .send({ kind: 'cost_codes', file_name: 'codes.xlsx', content_base64: file, project_id: site })
        .expect(201);
      expect(result.body.imported).toBe(2);
      const codes = await http().get(`/v1/projects/${site}/cost-codes`).set(owner).expect(200);
      expect(codes.body.find((code: { code: string }) => code.code === '02.01')).toMatchObject({ budget: '12500050', unit: 'm3' });

      // Cost code budgets are hidden from someone without cost_codes.view — and so is the column.
      const sheet = (await download(`/v1/exports/cost_codes?project_id=${site}`, supervisor)).getWorksheet('Cost codes')!;
      expect(columns(sheet)['Budget']).toBeUndefined();
      const full = (await download(`/v1/exports/cost_codes?project_id=${site}`, owner)).getWorksheet('Cost codes')!;
      expect(full.getRow(3).getCell(columns(full)['Budget']!).value).toBe(125000.5);
    });

    it('imports as the signed-in person: their permission, their sites', async () => {
      const csv = 'Name,Phone\nPriya,9876512345\n';
      await http().post('/v1/imports/preview').set(supervisor).send({ kind: 'contractors', file_name: 'c.csv', content_base64: csvBase64(csv) }).expect(403);
      await http().post('/v1/imports').set(supervisor).send({ kind: 'team', file_name: 't.csv', content_base64: csvBase64(csv) }).expect(403);
    });

    it("cannot reach another company's records by name", async () => {
      const csv = 'Name,Daily wage,Contractor,Site\nOutsider,500,Selvam Masonry,Harbour Point\n';
      const preview = await http().post('/v1/imports/preview').set(stranger).send({ kind: 'workers', file_name: 'w.csv', content_base64: csvBase64(csv) }).expect(200);
      expect(preview.body.errors.map((error: { message: string }) => error.message)).toEqual([
        'Contractor: no contractor called "Selvam Masonry"',
        'Site: no site called "Harbour Point" that you can see',
      ]);
    });

    it('caps rows and file size', async () => {
      const many = ['Name,Unit', ...Array.from({ length: 5001 }, (_, i) => `Item ${i},kg`)].join('\n');
      const rows = await http().post('/v1/imports/preview').set(owner).send({ kind: 'materials', file_name: 'm.csv', content_base64: csvBase64(many) }).expect(422);
      expect(rows.body.message).toMatch(/at most 5,000 rows/);

      const big = Buffer.alloc(5 * 1024 * 1024 + 10, 65).toString('base64');
      const size = await http().post('/v1/imports/preview').set(owner).send({ kind: 'materials', file_name: 'm.csv', content_base64: big }).expect(422);
      expect(JSON.stringify(size.body)).toMatch(/larger than 5 MB/);
    });

    it('refuses what is not a spreadsheet', async () => {
      await http().post('/v1/imports/preview').set(owner).send({ kind: 'materials', file_name: 'm.pdf', content_base64: csvBase64('x') }).expect(422);
      const garbage = await http().post('/v1/imports/preview').set(owner).send({ kind: 'materials', file_name: 'm.xlsx', content_base64: csvBase64('not a zip') }).expect(422);
      expect(garbage.body.message).toMatch(/could not be read as an Excel workbook/);
    });
  });
});
