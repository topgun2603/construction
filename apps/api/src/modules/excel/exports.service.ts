import { Injectable, type Type } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { excelExportQuerySchema, excelFileName, hasModule, todayIn } from '@sitebook/shared';
import { can, type RequestUser } from '../../common/auth/request-user';
import { ApiError } from '../../common/errors/api-error';
import { TenantDb } from '../../common/prisma/tenant-db.service';
import { ExcelExportService } from './excel-export.service';
import { exportSource } from './export-sources';

export interface ExportFile {
  fileName: string;
  contentType: string;
  body: Buffer;
}

/** Filters that name a record by id, shown on the About sheet by the record's name. */
const NAMED_FILTERS: Record<string, { label: string; model: 'project' | 'contractor' | 'vendor' | 'worker' | 'equipment' }> = {
  project_id: { label: 'Site', model: 'project' },
  contractor_id: { label: 'Contractor', model: 'contractor' },
  vendor_id: { label: 'Supplier', model: 'vendor' },
  worker_id: { label: 'Worker', model: 'worker' },
  equipment_id: { label: 'Machine', model: 'equipment' },
};

/**
 * `GET /exports/:kind` — any table as .xlsx (or CSV), with the screen's filters (roadmap Phase 3,
 * item 4). The gate is the list endpoint's own: its plan module and any one of its permissions,
 * checked here because one route serves every table and a decorator cannot vary by `:kind`.
 */
@Injectable()
export class ExportsService {
  constructor(
    private readonly moduleRef: ModuleRef,
    private readonly tenantDb: TenantDb,
    private readonly excel: ExcelExportService,
  ) {}

  async export(actor: RequestUser, kind: string, raw: Record<string, unknown>): Promise<ExportFile> {
    const source = exportSource(kind);
    if (!source) throw ApiError.notFound('Export');
    if (source.module && !hasModule(actor.enabledModules, source.module)) throw ApiError.moduleNotEnabled(source.module);
    if (!source.permissions.some((permission) => can(actor, permission))) throw ApiError.forbidden();

    const { format, lang, ...filters } = excelExportQuerySchema.parse(raw);
    const query = source.query.safeParse(filters);
    if (!query.success) throw ApiError.validationFailed(query.error.flatten(), 'Those filters are not valid');

    /*
     * Services are found through the module graph rather than injected: one exporter serves thirty
     * tables in fifteen modules, most of which export nothing, and making each of them export its
     * list service just for this would widen every module's public surface for one consumer.
     * `strict: false` resolves the app's single instance, so the export runs the very same code.
     */
    const get = <T>(type: Type<T>): T => this.moduleRef.get(type, { strict: false });
    const rows = await source.load(get, actor, query.data);
    ExcelExportService.assertWithinCap(rows.length);

    const table = {
      title: source.title,
      columns: [...source.columns, ...(source.extraColumns?.(query.data) ?? [])].filter(
        (column) => !column.when || column.when(actor),
      ),
      rows,
      filters: await this.describeFilters(actor, filters),
    };

    if (kind === 'audit') {
      // Taking a copy of the company's history out of the building is itself worth a line in it —
      // as the audit log's CSV export already records.
      await this.tenantDb.transaction(actor.tenantId, (tx) =>
        tx.auditLog.create({
          data: {
            tenantId: actor.tenantId,
            actorId: actor.userId,
            action: 'audit.exported',
            entity: 'audit_logs',
            after: { rows: rows.length, format, filters } as object,
          },
        }),
      );
    }

    const today = todayIn(actor.timezone);
    if (format === 'csv') {
      return {
        fileName: excelFileName(source.title, 'csv', today),
        contentType: 'text/csv; charset=utf-8',
        body: Buffer.from(this.excel.csv(actor, table), 'utf8'),
      };
    }
    return {
      fileName: excelFileName(source.title, 'xlsx', today),
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      body: await this.excel.xlsx(actor, table, { lang }),
    };
  }

  /** The filters as a person reads them: a site's name, not its id. */
  private async describeFilters(actor: RequestUser, filters: Record<string, unknown>): Promise<Record<string, string>> {
    const db = this.tenantDb.clientFor(actor.tenantId);
    const out: Record<string, string> = {};
    for (const [key, value] of Object.entries(filters)) {
      if (value === undefined || value === null || value === '' || key === 'limit' || key === 'cursor') continue;
      const named = NAMED_FILTERS[key];
      if (named && typeof value === 'string' && /^[0-9a-f-]{36}$/i.test(value)) {
        const where = { where: { id: value }, select: { name: true } };
        const row =
          named.model === 'project'
            ? await db.project.findFirst(where)
            : named.model === 'contractor'
              ? await db.contractor.findFirst(where)
              : named.model === 'vendor'
                ? await db.vendor.findFirst(where)
                : named.model === 'worker'
                  ? await db.worker.findFirst(where)
                  : await db.equipment.findFirst(where);
        out[named.label] = row?.name ?? value;
        continue;
      }
      out[key.replace(/_/g, ' ')] = String(value);
    }
    return out;
  }
}
