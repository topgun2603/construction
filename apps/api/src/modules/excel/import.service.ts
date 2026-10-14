import { Injectable, type Type } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import ExcelJS from 'exceljs';
import {
  currencyMinorDigits,
  excelFileName,
  hasModule,
  importBuildRow,
  importExampleRow,
  importFindDuplicates,
  importFindHeaderRow,
  importIsBlank,
  importIsExampleRow,
  importKindSpec,
  importMatchColumns,
  importOptionLabel,
  importParseInput,
  todayIn,
  type ImportBuiltRow,
  type ImportCell,
  type ImportCommitInput,
  type ImportField,
  type ImportFileInput,
  type ImportIssue,
  type ImportKind,
  type ImportPreview,
  type ImportPreviewRow,
  type ImportReferenceTarget,
  type ImportResult,
} from '@sitebook/shared';
import { can, type RequestUser } from '../../common/auth/request-user';
import { ApiError } from '../../common/errors/api-error';
import { TenantDb } from '../../common/prisma/tenant-db.service';
import { ContractorsService } from '../contractors/contractors.service';
import { CostCodesService } from '../cost-codes/cost-codes.service';
import { EquipmentService } from '../equipment/equipment.service';
import { MaterialsService } from '../materials/materials.service';
import { VendorsService } from '../procurement/vendors.service';
import { ProjectsService } from '../projects/projects.service';
import { StockService } from '../stock/stock.service';
import { TenantsService } from '../tenants/tenants.service';
import { WorkersService } from '../workers/workers.service';
import { cellText, readImportFile } from './import-file';

/** Rows of the preview sent to the screen; every row with an error is listed separately. */
const PREVIEW_ROWS = 200;
/** Errors returned with a refused import; the downloadable report has every one. */
const MAX_ERRORS_RETURNED = 500;
/** An all-or-nothing import of 5,000 workers is one transaction; give it time. */
const COMMIT_TIMEOUT_MS = 5 * 60_000;

/** The table an import writes, for its audit entry. */
const AUDIT_ENTITY: Record<ImportKind, string> = {
  workers: 'workers',
  contractors: 'contractors',
  projects: 'projects',
  materials: 'materials',
  vendors: 'vendors',
  equipment: 'equipment',
  cost_codes: 'cost_codes',
  opening_stock: 'stock_movements',
  team: 'users',
};

type Locate = <T>(type: Type<T>) => T;

/**
 * Creating one row, through the module's own service — never by writing the table here — so its
 * permission-sensitive checks, business rules and audit trail apply to an imported worker exactly
 * as to one added by hand. Cost codes go in as one batch through their existing import.
 */
const CREATE: Record<Exclude<ImportKind, 'cost_codes'>, (get: Locate, actor: RequestUser, input: never) => Promise<unknown>> = {
  workers: (get, actor, input) => get(WorkersService).create(actor, input),
  contractors: (get, actor, input) => get(ContractorsService).create(actor, input),
  projects: (get, actor, input) => get(ProjectsService).create(actor, input),
  materials: (get, actor, input) => get(MaterialsService).create(actor, input),
  vendors: (get, actor, input) => get(VendorsService).create(actor, input),
  equipment: (get, actor, input) => get(EquipmentService).create(actor, input),
  opening_stock: (get, actor, input) => get(StockService).record(actor, input),
  team: (get, actor, input) => get(TenantsService).invite(actor, input),
};

/** One data row of the sheet, read and checked. */
interface AnalysedRow {
  /** The sheet's row number, as Excel shows it. */
  row: number;
  status: 'ok' | 'error' | 'skipped';
  cells: ImportCell[];
  values: Record<string, string>;
  issues: ImportIssue[];
  built: ImportBuiltRow | null;
  /** The create body with real ids, once every check has passed. */
  input: Record<string, unknown> | null;
}

interface Analysis {
  sheets: string[];
  sheet: string | null;
  headerRow: number;
  headers: string[];
  mapping: Record<string, number | null>;
  rows: AnalysedRow[];
}

/** Names compared the way a person would: case, spacing and width do not make two sites different. */
function nameKey(text: string): string {
  return text.normalize('NFKC').trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Spreadsheet import (roadmap Phase 3, item 4): upload → sheet → column mapping → preview with
 * every row's problems → commit, all or nothing or the valid rows only → one audit entry.
 *
 * Runs as the signed-in person with their permissions: the kind's own create permission and plan
 * module are checked up front, and each row then goes through the create service, which checks the
 * rest (a supervisor cannot put a worker on a site they are not on). The IP allow-list and the
 * other company rules apply because this is an ordinary authenticated request.
 */
@Injectable()
export class ImportService {
  constructor(
    private readonly moduleRef: ModuleRef,
    private readonly tenantDb: TenantDb,
  ) {}

  private get: Locate = (type) => this.moduleRef.get(type, { strict: false });

  /** The kind's create permission and module: an import is that many creates. */
  assertAllowed(actor: RequestUser, kind: ImportKind): void {
    const spec = importKindSpec(kind);
    if (spec.module && !hasModule(actor.enabledModules, spec.module)) throw ApiError.moduleNotEnabled(spec.module);
    if (!can(actor, spec.permission)) throw ApiError.forbidden();
  }

  async preview(actor: RequestUser, input: ImportFileInput): Promise<ImportPreview> {
    this.assertAllowed(actor, input.kind);
    const analysis = await this.analyse(actor, input);
    const counts = tally(analysis.rows);
    return {
      kind: input.kind,
      file_name: input.file_name,
      sheets: analysis.sheets,
      sheet: analysis.sheet,
      header_row: analysis.headerRow,
      headers: analysis.headers,
      mapping: analysis.mapping,
      total_rows: analysis.rows.length,
      valid_rows: counts.ok,
      error_rows: counts.error,
      skipped_rows: counts.skipped,
      rows: analysis.rows.slice(0, PREVIEW_ROWS).map(previewRow),
      errors: errorList(analysis.rows),
    };
  }

  async commit(actor: RequestUser, input: ImportCommitInput): Promise<ImportResult> {
    this.assertAllowed(actor, input.kind);
    const analysis = await this.analyse(actor, input);
    const counts = tally(analysis.rows);
    const errors = errorList(analysis.rows);

    if (counts.ok === 0 && counts.error === 0) {
      throw ApiError.validationFailed({ rows: 0 }, 'There are no rows to import in that sheet.');
    }
    if (input.mode === 'all' && counts.error > 0) {
      throw ApiError.validationFailed(
        { errors: errors.slice(0, MAX_ERRORS_RETURNED), error_rows: counts.error, total_rows: analysis.rows.length },
        `${counts.error} ${counts.error === 1 ? 'row has' : 'rows have'} problems, so nothing was imported. Fix them, or import the valid rows only.`,
      );
    }

    const valid = analysis.rows.filter((row) => row.status === 'ok');
    const failed: Array<{ row: number; field: string | null; message: string }> = [];
    let imported = 0;

    if (input.kind === 'cost_codes') {
      // One batch through the cost code import the site screen already uses: atomic by itself.
      try {
        await this.get(CostCodesService).import(actor, input.project_id!, { rows: valid.map((row) => row.input) as never });
        imported = valid.length;
      } catch (error) {
        if (input.mode === 'all') throw error;
        for (const row of valid) failed.push({ row: row.row, field: null, message: messageOf(error) });
      }
    } else if (input.mode === 'all') {
      const create = CREATE[input.kind];
      let current: AnalysedRow | null = null;
      try {
        // Every row's create joins one transaction: the first that fails rolls them all back.
        await this.tenantDb.atomically(
          actor.tenantId,
          async () => {
            for (const row of valid) {
              current = row;
              await create(this.get, actor, row.input as never);
            }
          },
          { timeout: COMMIT_TIMEOUT_MS, maxWait: 10_000 },
        );
        imported = valid.length;
      } catch (error) {
        const at = (current as AnalysedRow | null)?.row ?? null;
        throw ApiError.validationFailed(
          { errors: [{ row: at, field: null, message: messageOf(error) }], error_rows: 1, total_rows: analysis.rows.length },
          `Row ${at}: ${messageOf(error)} Nothing was imported.`,
        );
      }
    } else {
      const create = CREATE[input.kind];
      for (const row of valid) {
        try {
          await create(this.get, actor, row.input as never);
          imported += 1;
        } catch (error) {
          failed.push({ row: row.row, field: null, message: messageOf(error) });
        }
      }
    }

    const result: ImportResult = {
      kind: input.kind,
      mode: input.mode,
      total_rows: analysis.rows.length,
      imported,
      failed: counts.error + failed.length,
      skipped: counts.skipped,
      errors: [...errors, ...failed].sort((a, b) => a.row - b.row),
    };

    // One entry for the import as a whole; each created row has its own from the audit trigger.
    await this.tenantDb.transaction(actor.tenantId, (tx) =>
      tx.auditLog.create({
        data: {
          tenantId: actor.tenantId,
          actorId: actor.userId,
          action: 'import.completed',
          entity: AUDIT_ENTITY[input.kind],
          entityLabel: input.file_name,
          after: {
            kind: input.kind,
            file_name: input.file_name,
            sheet: analysis.sheet,
            mode: input.mode,
            total_rows: result.total_rows,
            imported: result.imported,
            failed: result.failed,
            skipped: result.skipped,
            ...(input.project_id ? { project_id: input.project_id } : {}),
          },
        },
      }),
    );
    return result;
  }

  /** The rows with problems, as they were in the file, with a column saying what is wrong. */
  async errorReport(actor: RequestUser, input: ImportFileInput): Promise<{ fileName: string; body: Buffer }> {
    this.assertAllowed(actor, input.kind);
    const analysis = await this.analyse(actor, input);
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'BUILDR';
    const sheet = workbook.addWorksheet('Errors', { views: [{ state: 'frozen', ySplit: 1 }] });
    const header = sheet.addRow(['Row', 'Problems', ...analysis.headers]);
    header.font = { bold: true };
    sheet.getColumn(1).width = 8;
    sheet.getColumn(2).width = 60;
    for (const row of analysis.rows.filter((candidate) => candidate.status === 'error')) {
      const line = sheet.addRow([row.row, row.issues.map((issue) => issue.message).join('; '), ...row.cells.map((cell) => cell ?? null)]);
      line.getCell(2).alignment = { wrapText: true };
    }
    const today = todayIn(actor.timezone);
    return {
      fileName: excelFileName(`${importKindSpec(input.kind).title} import errors`, 'xlsx', today),
      body: Buffer.from(await workbook.xlsx.writeBuffer()),
    };
  }

  /**
   * A template: the headers, one example row (skipped if it is left in), a dropdown on every column
   * with a fixed list — including the company's own sites, contractors, suppliers and materials for
   * a column that names one — and an Instructions sheet.
   */
  async template(actor: RequestUser, kind: ImportKind): Promise<{ fileName: string; body: Buffer }> {
    this.assertAllowed(actor, kind);
    const spec = importKindSpec(kind);
    const lookups = await this.lookups(actor, kind);
    const example = importExampleRow(kind);

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'BUILDR';
    const data = workbook.addWorksheet(spec.sheetName, { views: [{ state: 'frozen', ySplit: 1 }] });
    const lists = workbook.addWorksheet('Lists');
    lists.state = 'hidden';
    const instructions = workbook.addWorksheet('Instructions');

    data.columns = spec.fields.map((field) => ({
      header: field.required ? `${field.label} *` : field.label,
      key: field.key,
      width: Math.max(14, field.label.length + 4),
      // Text stays text, so a code like 02.10 or a phone number's leading zero survives typing.
      style: { numFmt: field.type === 'date' ? 'yyyy-mm-dd' : ['text', 'phone', 'reference', 'email'].includes(field.type) ? '@' : 'General' },
    }));
    data.getRow(1).font = { bold: true };

    const exampleRow = data.addRow(
      spec.fields.map((field) => {
        const value = example[field.key];
        if (value === undefined || value === '') return null;
        if (field.type === 'enum') return optionLabel(field, value);
        if (field.type === 'money' || field.type === 'integer' || field.type === 'decimal') return Number(value);
        if (field.type === 'date') return new Date(`${value}T00:00:00.000Z`);
        return value;
      }),
    );
    exampleRow.font = { italic: true, color: { argb: 'FF808080' } };

    // Each list on the hidden sheet, one column per field that has one.
    let listColumn = 0;
    spec.fields.forEach((field, index) => {
      const values = listFor(field, lookups);
      if (!values || values.length === 0) return;
      listColumn += 1;
      const letter = columnLetter(listColumn);
      lists.getCell(`${letter}1`).value = field.label;
      values.forEach((value, at) => {
        lists.getCell(`${letter}${at + 2}`).value = value;
      });
      const range = `Lists!$${letter}$2:$${letter}$${values.length + 1}`;
      const dataColumn = columnLetter(index + 1);
      for (let row = 2; row <= 1001; row += 1) {
        data.getCell(`${dataColumn}${row}`).dataValidation = {
          type: 'list',
          // A reference may name something not yet in the list (added later); a fixed option may not.
          allowBlank: true,
          showErrorMessage: field.type !== 'reference',
          errorTitle: field.label,
          error: `Pick one of the ${field.label.toLowerCase()} options.`,
          formulae: [range],
        };
      }
    });

    instructions.columns = [{ width: 24 }, { width: 11 }, { width: 70 }, { width: 50 }];
    instructions.addRow([`${spec.title} import`]).font = { bold: true, size: 14 };
    for (const line of [
      `Fill in the "${spec.sheetName}" sheet, one row per ${spec.title.toLowerCase().replace(/s$/, '')}. Columns marked * are required.`,
      'Keep the header row. Columns can be in any order, and columns this does not know are ignored.',
      'The grey example row is skipped when you import — you can leave it or delete it.',
      "Money in your company's currency, as you would write it (1,250.50). Dates as DD/MM/YYYY or YYYY-MM-DD.",
      "Phone numbers without a country code are read in your company's country.",
      'At most 5,000 rows and 5 MB per file. Nothing is imported until you have checked the preview.',
    ]) {
      instructions.addRow([line]);
    }
    instructions.addRow([]);
    const head = instructions.addRow(['Column', 'Required', 'What to enter', 'Allowed values']);
    head.font = { bold: true };
    for (const field of spec.fields) {
      const allowed = field.type === 'enum' ? (field.options ?? []).map((option) => optionLabel(field, option)).join(', ') : field.type === 'boolean' ? 'Yes, No' : '';
      const line = instructions.addRow([field.label, field.required ? 'Yes' : '', field.help ?? describe(field), allowed]);
      line.getCell(3).alignment = { wrapText: true };
      line.getCell(4).alignment = { wrapText: true };
    }

    return {
      fileName: excelFileName(`${spec.title} import template`, 'xlsx', todayIn(actor.timezone)),
      body: Buffer.from(await workbook.xlsx.writeBuffer()),
    };
  }

  // --- reading and checking ---------------------------------------------------------------------------

  private async analyse(actor: RequestUser, input: ImportFileInput): Promise<Analysis> {
    const spec = importKindSpec(input.kind);
    if (spec.scope === 'project' && !input.project_id) {
      throw ApiError.validationFailed({ project_id: 'required' }, 'Pick the site to import into');
    }
    const grid = await readImportFile(input.file_name, input.content_base64, input.sheet);
    const text = grid.rows.map((row) => row.map(cellText));

    const found = input.header_row ?? importFindHeaderRow(text, spec.fields);
    const headerRow = Math.max(0, found);
    const headers = (text[headerRow] ?? []).map((header) => header.trim());
    const mapping: Record<string, number | null> = input.mapping
      ? Object.fromEntries(spec.fields.map((field) => [field.key, input.mapping?.[field.key] ?? null]))
      : { ...Object.fromEntries(spec.fields.map((field) => [field.key, null])), ...importMatchColumns(headers, spec.fields) };

    const ctx = {
      currencyDigits: currencyMinorDigits(actor.currency),
      country: actor.country,
      timeZone: actor.timezone,
    };
    const rows: AnalysedRow[] = [];
    grid.rows.forEach((cells, index) => {
      if (index <= headerRow && found !== -1) return;
      if (cells.every(importIsBlank)) return;
      const byField: Record<string, ImportCell> = {};
      const values: Record<string, string> = {};
      for (const field of spec.fields) {
        const column = mapping[field.key];
        if (column === null || column === undefined) continue;
        byField[field.key] = cells[column] ?? null;
        values[field.key] = cellText(cells[column] ?? null);
      }
      const row = index + 1;
      if (importIsExampleRow(input.kind, byField)) {
        rows.push({ row, status: 'skipped', cells, values, issues: [{ field: null, message: 'The example row from the template' }], built: null, input: null });
        return;
      }
      const built = importBuildRow(input.kind, byField, ctx);
      rows.push({ row, status: built.issues.length > 0 ? 'error' : 'ok', cells, values, issues: [...built.issues], built, input: null });
    });

    await this.resolve(actor, input, rows);
    return { sheets: grid.sheets, sheet: grid.sheet, headerRow, headers, mapping, rows };
  }

  /**
   * References by name to ids, duplicates within the file and against what the company has, and the
   * final parse with the real ids — the create schema's last word.
   */
  private async resolve(actor: RequestUser, input: ImportFileInput, rows: AnalysedRow[]): Promise<void> {
    const kind = input.kind;
    const spec = importKindSpec(kind);
    const lookups = await this.lookups(actor, kind);

    // A default site for an opening stock sheet with no site column, or for a cost code import.
    if (input.project_id && !lookups.project.ids.has(input.project_id) && spec.scope === 'company') {
      throw ApiError.projectNotAssigned(input.project_id);
    }

    for (const row of rows) {
      if (!row.built) continue;
      if (kind === 'opening_stock' && !row.built.refs.site) {
        if (input.project_id) row.built.keys.site = input.project_id;
        else row.issues.push({ field: 'site', message: 'Site is required — or pick one site for the whole import' });
      }
    }

    for (const [index, message] of importFindDuplicates(kind, rows.map((row) => (row.built && row.status !== 'skipped' ? { keys: row.built.keys, row: row.row } : null)))) {
      rows[index]!.issues.push({ field: null, message: `Duplicate: ${message}` });
    }

    const existing = await this.existing(actor, kind, rows);

    for (const row of rows) {
      if (!row.built) continue;
      const body = { ...row.built.input };

      for (const field of spec.fields) {
        if (field.type !== 'reference' || !row.built.refs[field.key]) continue;
        const list = lookups[field.references!];
        const ids: string[] = [];
        for (const name of row.built.refs[field.key]!) {
          const matches = list.byName.get(nameKey(name)) ?? [];
          if (matches.length === 1) ids.push(matches[0]!);
          else if (matches.length > 1) row.issues.push({ field: field.key, message: `${field.label}: more than one is called "${name}"` });
          else row.issues.push({ field: field.key, message: `${field.label}: no ${referenceNoun(field.references!)} called "${name}"${field.references === 'project' ? ' that you can see' : ''}` });
        }
        body[field.target ?? field.key] = field.many ? ids : ids[0];
      }
      if (kind === 'opening_stock' && !row.built.refs.site && input.project_id) body.project_id = input.project_id;

      const clash = existing(row.built);
      if (clash) row.issues.push({ field: null, message: `Already exists: ${clash}` });

      if (row.issues.length === 0) {
        try {
          row.input = importParseInput<Record<string, unknown>>(kind, body);
        } catch (error) {
          row.issues.push({ field: null, message: messageOf(error) });
        }
      }
      row.status = row.issues.length > 0 ? 'error' : 'ok';
    }
  }

  /** What the company already has that a row would repeat, as a check per row. */
  private async existing(actor: RequestUser, kind: ImportKind, rows: AnalysedRow[]): Promise<(built: ImportBuiltRow) => string | null> {
    const db = this.tenantDb.clientFor(actor.tenantId);
    const phones = rows.map((row) => row.built?.input.phone).filter((phone): phone is string => typeof phone === 'string');
    const byName = (names: Array<{ name: string }>, noun: string) => {
      const taken = new Set(names.map((row) => nameKey(row.name)));
      return (built: ImportBuiltRow) => {
        const name = built.input.name;
        return typeof name === 'string' && taken.has(nameKey(name)) ? `a ${noun} called "${name}"` : null;
      };
    };

    switch (kind) {
      case 'workers': {
        const found = await db.worker.findMany({ where: { deletedAt: null, phone: { in: phones } }, select: { phone: true, name: true } });
        const taken = new Map(found.map((worker) => [worker.phone, worker.name]));
        return (built) => {
          const phone = built.input.phone;
          return typeof phone === 'string' && taken.has(phone) ? `${taken.get(phone)} has this phone number` : null;
        };
      }
      case 'team': {
        const found = await db.user.findMany({ where: { deletedAt: null, phone: { in: phones } }, select: { phone: true, name: true } });
        const taken = new Map(found.map((user) => [user.phone, user.name]));
        return (built) => {
          const phone = built.input.phone;
          return typeof phone === 'string' && taken.has(phone) ? `${taken.get(phone)} has this phone number` : null;
        };
      }
      case 'contractors':
        return byName(await db.contractor.findMany({ where: { deletedAt: null }, select: { name: true } }), 'contractor');
      case 'projects':
        return byName(await db.project.findMany({ where: { deletedAt: null }, select: { name: true } }), 'site');
      case 'materials':
        return byName(await db.material.findMany({ where: { deletedAt: null }, select: { name: true } }), 'material');
      case 'vendors':
        return byName(await db.vendor.findMany({ select: { name: true } }), 'supplier');
      case 'equipment': {
        const found = await db.equipment.findMany({ select: { code: true, registrationNo: true } });
        const codes = new Set(found.map((row) => nameKey(row.code)));
        const registrations = new Set(found.map((row) => row.registrationNo).filter(Boolean).map((value) => nameKey(value!)));
        return (built) => {
          const code = built.input.code;
          const registration = built.input.registration_no;
          if (typeof code === 'string' && codes.has(nameKey(code))) return `a machine with code ${code}`;
          if (typeof registration === 'string' && registrations.has(nameKey(registration))) return `a machine registered ${registration}`;
          return null;
        };
      }
      default:
        // Cost codes are matched on code and updated, which is what their import has always done;
        // opening stock is a movement, and two counts of one material are caught within the file.
        return () => null;
    }
  }

  /** The company's lists a sheet can name things from — sites only the ones this person can see. */
  private async lookups(actor: RequestUser, kind: ImportKind) {
    const spec = importKindSpec(kind);
    const wanted = new Set(spec.fields.filter((field) => field.type === 'reference').map((field) => field.references!));
    const db = this.tenantDb.clientFor(actor.tenantId);
    const empty: Array<{ id: string; name: string }> = [];
    const [project, contractor, vendor, material] = await Promise.all([
      wanted.has('project') || spec.scope === 'project' || kind === 'opening_stock'
        ? db.project.findMany({
            where: { deletedAt: null, ...(actor.seesAllProjects ? {} : { id: { in: actor.projectIds } }) },
            select: { id: true, name: true },
            orderBy: { name: 'asc' },
          })
        : empty,
      wanted.has('contractor') ? db.contractor.findMany({ where: { deletedAt: null }, select: { id: true, name: true }, orderBy: { name: 'asc' } }) : empty,
      wanted.has('vendor') ? db.vendor.findMany({ where: { active: true }, select: { id: true, name: true }, orderBy: { name: 'asc' } }) : empty,
      wanted.has('material') ? db.material.findMany({ where: { deletedAt: null }, select: { id: true, name: true }, orderBy: { name: 'asc' } }) : empty,
    ]);
    const index = (rows: Array<{ id: string; name: string }>) => {
      const byName = new Map<string, string[]>();
      for (const row of rows) byName.set(nameKey(row.name), [...(byName.get(nameKey(row.name)) ?? []), row.id]);
      return { names: rows.map((row) => row.name), ids: new Set(rows.map((row) => row.id)), byName };
    };
    return { project: index(project), contractor: index(contractor), vendor: index(vendor), material: index(material) };
  }
}

type Lookups = Awaited<ReturnType<ImportService['lookups']>>;

function listFor(field: ImportField, lookups: Lookups): string[] | null {
  if (field.type === 'enum') return (field.options ?? []).map((option) => optionLabel(field, option));
  if (field.type === 'boolean') return ['Yes', 'No'];
  if (field.type === 'reference' && !field.many) return lookups[field.references!].names.slice(0, 2000);
  return null;
}

function optionLabel(field: ImportField, option: string): string {
  return field.optionLabels?.[option] ?? importOptionLabel(option);
}

function describe(field: ImportField): string {
  switch (field.type) {
    case 'money':
      return "An amount in your company's currency.";
    case 'date':
      return 'A date: DD/MM/YYYY or YYYY-MM-DD.';
    case 'phone':
      return 'A mobile number.';
    case 'integer':
      return 'A whole number.';
    case 'decimal':
      return `A number, at most ${field.places ?? 2} decimals.`;
    case 'email':
      return 'An email address.';
    default:
      return '';
  }
}

function referenceNoun(target: ImportReferenceTarget): string {
  return { project: 'site', contractor: 'contractor', vendor: 'supplier', material: 'material' }[target];
}

/** A, B, … Z, AA — a column's letter. */
function columnLetter(index: number): string {
  let letters = '';
  let n = index;
  while (n > 0) {
    const rem = (n - 1) % 26;
    letters = String.fromCharCode(65 + rem) + letters;
    n = Math.floor((n - 1) / 26);
  }
  return letters;
}

function tally(rows: AnalysedRow[]) {
  return {
    ok: rows.filter((row) => row.status === 'ok').length,
    error: rows.filter((row) => row.status === 'error').length,
    skipped: rows.filter((row) => row.status === 'skipped').length,
  };
}

function errorList(rows: AnalysedRow[]) {
  return rows
    .filter((row) => row.status === 'error')
    .flatMap((row) => row.issues.map((issue) => ({ row: row.row, field: issue.field, message: issue.message })));
}

function previewRow(row: AnalysedRow): ImportPreviewRow {
  return { row: row.row, status: row.status, values: row.values, issues: row.issues };
}

function messageOf(error: unknown): string {
  if (error instanceof ApiError) {
    const response = error.getResponse() as { message?: string } | string;
    return typeof response === 'string' ? response : (response.message ?? error.message);
  }
  // A unique index caught a duplicate the checks above could not see (two imports at once).
  if (error && typeof error === 'object' && (error as { code?: unknown }).code === 'P2002') return 'Already exists.';
  return error instanceof Error ? error.message : 'Could not be saved';
}
