import { Injectable } from '@nestjs/common';
import ExcelJS from 'exceljs';
import {
  CSV_BOM,
  currencyMinorDigits,
  EXCEL_EXPORT_MAX_ROWS,
  excelColumnWidth,
  excelDateValue,
  excelMoneyFormat,
  excelMoneyValue,
  excelSheetName,
  excelWallClock,
  minorToDecimal,
  type ExcelColumnSpec,
} from '@sitebook/shared';
import type { RequestUser } from '../../common/auth/request-user';
import { ApiError } from '../../common/errors/api-error';
import { TenantDb } from '../../common/prisma/tenant-db.service';

/**
 * A column of an export: the shared spec plus how to read it off one row.
 *
 * `value` returns the row's own representation — minor units for money, `YYYY-MM-DD` for a date, an
 * ISO instant for a datetime, 0–100 for a percentage — and this service decides what a cell holds,
 * so every table's money is written the same way and no source formats a number as text.
 */
export interface ExcelExportColumn<Row> extends ExcelColumnSpec {
  value: (row: Row) => unknown;
}

export interface ExcelTable<Row> {
  /** The sheet's and the file's name: "Workers". */
  title: string;
  columns: ReadonlyArray<ExcelExportColumn<Row>>;
  rows: readonly Row[];
  /** What the screen was filtered by, for the About sheet: `{ Site: 'Harbour Point' }`. */
  filters?: Record<string, string>;
}

export interface ExcelRenderOptions {
  /** The reader's interface language; `ar` turns the sheet right to left. */
  lang?: string;
}

/**
 * Turns a table — rows and a column spec — into an .xlsx or a CSV (roadmap Phase 3, item 4).
 *
 * One renderer for every export, so a money column is a number with the company currency's format in
 * the workers sheet exactly as in the purchase orders, a date is a real date Excel can sort and
 * filter, and the header row is bold, frozen and filterable everywhere. Sources only say what the
 * columns are and fetch the rows through their module's own service, which is what keeps an export
 * to precisely what the person can see on the screen.
 */
@Injectable()
export class ExcelExportService {
  /** Overridable so the e2e suite can prove the cap without writing fifty thousand rows. */
  static maxRows = EXCEL_EXPORT_MAX_ROWS;

  constructor(private readonly tenantDb: TenantDb) {}

  /** Refuses an export over the cap with a message that says what to do instead. */
  static assertWithinCap(count: number): void {
    if (count > ExcelExportService.maxRows) {
      throw ApiError.validationFailed(
        { max_rows: ExcelExportService.maxRows },
        `More than ${ExcelExportService.maxRows.toLocaleString('en')} rows match. Narrow the filters — one site or a shorter date range — and export again.`,
      );
    }
  }

  async xlsx<Row>(actor: RequestUser, table: ExcelTable<Row>, options: ExcelRenderOptions = {}): Promise<Buffer> {
    ExcelExportService.assertWithinCap(table.rows.length);
    const digits = currencyMinorDigits(actor.currency);
    const rightToLeft = options.lang === 'ar';

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'BUILDR';
    workbook.created = new Date();

    const sheet = workbook.addWorksheet(excelSheetName(table.title), {
      // Frozen header so it stays in view down a long register; right to left for an Arabic reader.
      views: [{ state: 'frozen', ySplit: 1, rightToLeft }],
    });
    sheet.columns = table.columns.map((column) => ({
      key: column.key,
      header: column.header,
      width: excelColumnWidth(column),
      style: { numFmt: numberFormat(column, actor.currency, digits) },
    }));
    const header = sheet.getRow(1);
    header.font = { bold: true };
    header.alignment = { vertical: 'middle' };
    header.eachCell((cell) => {
      // A header keeps the General format: a money format on "Daily wage" would be meaningless.
      cell.numFmt = 'General';
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEFEFEF' } };
    });

    for (const row of table.rows) {
      sheet.addRow(table.columns.map((column) => cellValue(column, column.value(row), digits, actor.timezone)));
    }
    if (table.columns.length > 0) {
      sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: Math.max(1, table.rows.length + 1), column: table.columns.length } };
    }

    await this.aboutSheet(workbook, actor, table, rightToLeft);
    return Buffer.from(await workbook.xlsx.writeBuffer());
  }

  /**
   * The same table as CSV, for the tables that had none: a BOM so Excel reads Tamil and Arabic as
   * UTF-8, money in major units with the currency's decimals, and a leading formula character
   * defused — a worker named `=HYPERLINK(...)` must not become a live link in somebody's Excel.
   */
  csv<Row>(actor: RequestUser, table: ExcelTable<Row>): string {
    ExcelExportService.assertWithinCap(table.rows.length);
    const digits = currencyMinorDigits(actor.currency);
    const lines = [table.columns.map((column) => csvCell(column.header))];
    for (const row of table.rows) {
      lines.push(table.columns.map((column) => csvCell(csvText(column, column.value(row), digits, actor.timezone))));
    }
    return `${CSV_BOM}${lines.map((line) => line.join(',')).join('\r\n')}\r\n`;
  }

  /**
   * Who took this copy, when, of which company and with which filters — on its own sheet, so the
   * data sheet stays a clean table that sorts and pivots, and a file found in a shared drive months
   * later still says where it came from.
   */
  private async aboutSheet<Row>(workbook: ExcelJS.Workbook, actor: RequestUser, table: ExcelTable<Row>, rightToLeft: boolean) {
    const db = this.tenantDb.clientFor(actor.tenantId);
    const [user, tenant] = await Promise.all([
      db.user.findFirst({ where: { id: actor.userId }, select: { name: true } }),
      db.tenant.findFirst({ where: { id: actor.tenantId }, select: { name: true } }),
    ]);
    const about = workbook.addWorksheet('About', { views: [{ rightToLeft }] });
    about.columns = [{ width: 18 }, { width: 60 }];
    const filters = Object.entries(table.filters ?? {}).filter(([, value]) => value !== '');
    const lines: Array<[string, ExcelJS.CellValue]> = [
      ['Export', table.title],
      ['Company', tenant?.name ?? ''],
      ['Exported by', user?.name ?? ''],
      ['Exported on', excelWallClock(new Date(), actor.timezone)],
      ['Time zone', actor.timezone],
      ['Currency', actor.currency],
      ['Rows', table.rows.length],
      ['Filters', filters.length === 0 ? 'None' : filters.map(([key, value]) => `${key}: ${value}`).join('; ')],
    ];
    for (const [label, value] of lines) {
      const row = about.addRow([label, value]);
      row.getCell(1).font = { bold: true };
      if (value instanceof Date) row.getCell(2).numFmt = 'dd-mmm-yyyy hh:mm';
      row.getCell(2).alignment = { horizontal: rightToLeft ? 'right' : 'left' };
    }
  }
}

function numberFormat(column: ExcelColumnSpec, currency: string, digits: number): string {
  switch (column.type) {
    case 'money':
      return excelMoneyFormat(currency, digits);
    case 'date':
      return 'dd-mmm-yyyy';
    case 'datetime':
      return 'dd-mmm-yyyy hh:mm';
    case 'percent':
      return '0.0%';
    case 'integer':
      return '0';
    case 'number':
      return '#,##0.###';
    default:
      // Text stays text: a phone number or an item number "02.10" must not become a number.
      return '@';
  }
}

function cellValue(column: ExcelColumnSpec, raw: unknown, digits: number, timeZone: string): ExcelJS.CellValue {
  if (raw === null || raw === undefined || raw === '') return null;
  switch (column.type) {
    case 'money':
      return excelMoneyValue(raw as bigint | string | number, digits);
    case 'date':
      return excelDateValue(String(raw instanceof Date ? raw.toISOString() : raw));
    case 'datetime':
      return excelWallClock(raw instanceof Date ? raw : String(raw), timeZone);
    case 'percent':
      return Number(raw) / 100;
    case 'integer':
    case 'number': {
      const value = typeof raw === 'number' ? raw : Number(String(raw));
      return Number.isFinite(value) ? value : String(raw);
    }
    case 'boolean':
      return Boolean(raw);
    default:
      return String(raw);
  }
}

function csvText(column: ExcelColumnSpec, raw: unknown, digits: number, timeZone: string): string {
  if (raw === null || raw === undefined) return '';
  switch (column.type) {
    case 'money':
      return minorToDecimal(BigInt(raw as string | bigint | number), digits);
    case 'date':
      return String(raw instanceof Date ? raw.toISOString() : raw).slice(0, 10);
    case 'datetime':
      return excelWallClock(raw instanceof Date ? raw : String(raw), timeZone).toISOString().slice(0, 16).replace('T', ' ');
    case 'boolean':
      return raw ? 'Yes' : 'No';
    default:
      return String(raw);
  }
}

function csvCell(value: string): string {
  const text = /^[=+\-@\t\r]/.test(value) && !/^-?\d/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}
