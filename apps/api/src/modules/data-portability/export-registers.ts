import ExcelJS from 'exceljs';
import type { Writable } from 'node:stream';
import { currencyMinorDigits, minorToDecimal } from '@sitebook/shared';
import type { TenantTx } from '../../common/prisma/tenant-db.service';
import { eachRowBatch, uuidLiteral } from './tenant-tables';

type Kind = 'text' | 'date' | 'money' | 'number';

interface Register {
  sheet: string;
  /** Header, the column it reads from the query below, and how to show it. */
  columns: Array<[header: string, key: string, kind: Kind]>;
  /** `$T` is replaced by the company's id as a proven-uuid literal. */
  sql: string;
}

/**
 * The workbook in a full export: the registers a builder's accountant or lawyer would ask for first,
 * one sheet each, with readable headings, names instead of ids and money in the company's currency.
 *
 * Deliberately the main registers only. The JSON Lines files beside it hold every table in full; this
 * is the part somebody opens in Excel, and a workbook with a hundred and forty sheets is not that.
 *
 * Each query runs in the company's RLS context and also names the company, so it reads one company
 * however it is called.
 */
const REGISTERS: Register[] = [
  {
    sheet: 'Sites',
    columns: [
      ['Site', 'name', 'text'],
      ['Client', 'client_name', 'text'],
      ['Address', 'address', 'text'],
      ['Status', 'status', 'text'],
      ['Start', 'start_date', 'date'],
      ['Target end', 'target_end_date', 'date'],
      ['Budget', 'budget_amount', 'money'],
      ['Contract value', 'contract_value', 'money'],
      ['Deleted', 'deleted_at', 'date'],
    ],
    sql: `SELECT p.name, p.client_name, p.address, p.status::text AS status, p.start_date, p.target_end_date,
                 p.budget_amount, p.contract_value, p.deleted_at
            FROM projects p WHERE p.tenant_id = $T ORDER BY p.name`,
  },
  {
    sheet: 'Workers',
    columns: [
      ['Worker', 'name', 'text'],
      ['Phone', 'phone', 'text'],
      ['Contractor', 'contractor', 'text'],
      ['Trade', 'trade', 'text'],
      ['Skill', 'skill_level', 'text'],
      ['Pay basis', 'pay_basis', 'text'],
      ['Daily wage', 'daily_wage', 'money'],
      ['Overtime rate / hour', 'overtime_rate_per_hour', 'money'],
      ['Basic salary', 'basic_salary', 'money'],
      ['Status', 'status', 'text'],
      ['Added', 'created_at', 'date'],
    ],
    sql: `SELECT w.name, w.phone, c.name AS contractor, w.trade, w.skill_level::text AS skill_level, w.pay_basis,
                 w.daily_wage, w.overtime_rate_per_hour, w.basic_salary, w.status::text AS status, w.created_at
            FROM workers w LEFT JOIN contractors c ON c.id = w.contractor_id
           WHERE w.tenant_id = $T AND w.deleted_at IS NULL ORDER BY w.name`,
  },
  {
    sheet: 'Attendance',
    columns: [
      ['Date', 'attendance_date', 'date'],
      ['Site', 'site', 'text'],
      ['Worker', 'worker', 'text'],
      ['Status', 'status', 'text'],
      ['Overtime hours', 'overtime_hours', 'number'],
      ['Day wage', 'wage_snapshot', 'money'],
    ],
    sql: `SELECT a.attendance_date, p.name AS site, w.name AS worker, a.status::text AS status, a.overtime_hours,
                 a.wage_snapshot
            FROM attendance a JOIN projects p ON p.id = a.project_id JOIN workers w ON w.id = a.worker_id
           WHERE a.tenant_id = $T ORDER BY a.attendance_date, p.name, w.name`,
  },
  {
    sheet: 'Wages',
    columns: [
      ['Period start', 'period_start', 'date'],
      ['Period end', 'period_end', 'date'],
      ['Period status', 'period_status', 'text'],
      ['Contractor', 'contractor', 'text'],
      ['Worker', 'worker', 'text'],
      ['Days present', 'days_present', 'number'],
      ['Overtime hours', 'overtime_hours', 'number'],
      ['Gross', 'gross_amount', 'money'],
      ['Advances deducted', 'advances_deducted', 'money'],
      ['Net payable', 'net_payable', 'money'],
      ['Paid', 'paid_amount', 'money'],
    ],
    sql: `SELECT wp.period_start, wp.period_end, wp.status::text AS period_status, c.name AS contractor, w.name AS worker,
                 l.days_present, l.overtime_hours, l.gross_amount, l.advances_deducted, l.net_payable, l.paid_amount
            FROM wage_lines l JOIN wage_periods wp ON wp.id = l.wage_period_id JOIN workers w ON w.id = l.worker_id
            LEFT JOIN contractors c ON c.id = wp.contractor_id
           WHERE l.tenant_id = $T ORDER BY wp.period_start, w.name`,
  },
  {
    sheet: 'Labour payments',
    columns: [
      ['Paid on', 'paid_on', 'date'],
      ['Site', 'site', 'text'],
      ['Worker', 'worker', 'text'],
      ['Contractor', 'contractor', 'text'],
      ['Type', 'type', 'text'],
      ['Mode', 'mode', 'text'],
      ['Amount', 'amount', 'money'],
      ['Reference', 'reference', 'text'],
    ],
    sql: `SELECT lp.paid_on, p.name AS site, w.name AS worker, c.name AS contractor, lp.type::text AS type,
                 lp.mode::text AS mode, lp.amount, lp.reference
            FROM labour_payments lp LEFT JOIN projects p ON p.id = lp.project_id
            LEFT JOIN workers w ON w.id = lp.worker_id LEFT JOIN contractors c ON c.id = lp.contractor_id
           WHERE lp.tenant_id = $T AND lp.deleted_at IS NULL ORDER BY lp.paid_on`,
  },
  {
    sheet: 'Expenses',
    columns: [
      ['Spent on', 'spent_on', 'date'],
      ['Site', 'site', 'text'],
      ['Category', 'category', 'text'],
      ['Amount', 'amount', 'money'],
      ['Tax', 'tax_amount', 'money'],
      ['Status', 'status', 'text'],
      ['Note', 'note', 'text'],
    ],
    sql: `SELECT e.spent_on, p.name AS site, e.category, e.amount, e.tax_amount, e.status::text AS status, e.note
            FROM expenses e JOIN projects p ON p.id = e.project_id
           WHERE e.tenant_id = $T AND e.deleted_at IS NULL ORDER BY e.spent_on`,
  },
  {
    sheet: 'Purchase orders',
    columns: [
      ['Number', 'number', 'text'],
      ['Site', 'site', 'text'],
      ['Vendor', 'vendor', 'text'],
      ['Status', 'status', 'text'],
      ['Expected', 'expected_on', 'date'],
      ['Subtotal', 'subtotal', 'money'],
      ['Tax', 'tax_total', 'money'],
      ['Total', 'total', 'money'],
      ['Created', 'created_at', 'date'],
    ],
    sql: `SELECT po.number, p.name AS site, v.name AS vendor, po.status::text AS status, po.expected_on, po.subtotal,
                 po.tax_total, po.total, po.created_at
            FROM purchase_orders po JOIN projects p ON p.id = po.project_id LEFT JOIN vendors v ON v.id = po.vendor_id
           WHERE po.tenant_id = $T ORDER BY po.created_at`,
  },
  {
    sheet: 'Subcontracts',
    columns: [
      ['Number', 'number', 'text'],
      ['Title', 'title', 'text'],
      ['Site', 'site', 'text'],
      ['Subcontractor', 'contractor', 'text'],
      ['Status', 'status', 'text'],
      ['Start', 'start_date', 'date'],
      ['End', 'end_date', 'date'],
      ['Advance', 'advance_amount', 'money'],
    ],
    sql: `SELECT s.number, s.title, p.name AS site, c.name AS contractor, s.status::text AS status, s.start_date,
                 s.end_date, s.advance_amount
            FROM subcontracts s JOIN projects p ON p.id = s.project_id LEFT JOIN contractors c ON c.id = s.contractor_id
           WHERE s.tenant_id = $T ORDER BY s.number`,
  },
  {
    sheet: 'Change orders',
    columns: [
      ['Number', 'number', 'number'],
      ['Revision', 'revision', 'number'],
      ['Title', 'title', 'text'],
      ['Site', 'site', 'text'],
      ['Status', 'status', 'text'],
      ['Raised on', 'raised_on', 'date'],
      ['Cost impact', 'cost_impact', 'money'],
      ['Client price', 'client_price', 'money'],
      ['Client total', 'client_total', 'money'],
      ['Time impact (days)', 'time_impact_days', 'number'],
    ],
    sql: `SELECT co.number, co.revision, co.title, p.name AS site, co.status::text AS status, co.raised_on,
                 co.cost_impact, co.client_price, co.client_total, co.time_impact_days
            FROM change_orders co JOIN projects p ON p.id = co.project_id
           WHERE co.tenant_id = $T ORDER BY co.number, co.revision`,
  },
];

/** Rows written per register, for the manifest. */
export type RegisterCounts = Record<string, number>;

/**
 * Writes the workbook to `output` with exceljs's streaming writer: each row is committed as it is
 * read, so the attendance sheet of a large company never sits in memory as a whole.
 *
 * A register whose query fails (a module whose tables changed shape since this list was written) is
 * left as a sheet saying so rather than failing the whole export — the JSON Lines files hold the
 * full data regardless, and the workbook is the convenience copy.
 */
export async function writeRegisters(
  tx: TenantTx,
  tenantId: string,
  currency: string,
  output: Writable,
): Promise<RegisterCounts> {
  const digits = currencyMinorDigits(currency);
  const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({ stream: output, useStyles: true });
  const counts: RegisterCounts = {};

  for (const register of REGISTERS) {
    const sheet = workbook.addWorksheet(register.sheet);
    sheet.columns = register.columns.map(([header, key, kind]) => ({
      header: kind === 'money' ? `${header} (${currency})` : header,
      key,
      width: kind === 'text' ? 24 : 14,
    }));
    sheet.getRow(1).font = { bold: true };
    sheet.getRow(1).commit();

    const sql = `SELECT row_to_json(r)::text AS j FROM (${register.sql.replace(/\$T/g, uuidLiteral(tenantId))}) r`;
    try {
      // A savepoint, so a register that fails rolls back only itself and the transaction carries on.
      await tx.$executeRawUnsafe('SAVEPOINT data_export_register');
      counts[register.sheet] = await eachRowBatch(tx, sql, async (rows) => {
        for (const text of rows) {
          const row = JSON.parse(text) as Record<string, unknown>;
          const values: Record<string, unknown> = {};
          for (const [, key, kind] of register.columns) values[key] = present(row[key], kind, digits);
          sheet.addRow(values).commit();
        }
      });
      await tx.$executeRawUnsafe('RELEASE SAVEPOINT data_export_register');
    } catch (error) {
      await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT data_export_register');
      sheet.addRow({ [register.columns[0]?.[1] ?? 'a']: `Could not be listed: ${(error as Error).message}` }).commit();
      counts[register.sheet] = 0;
    }
    sheet.commit();
  }

  await workbook.commit();
  return counts;
}

function present(value: unknown, kind: Kind, digits: number): unknown {
  if (value === null || value === undefined) return null;
  switch (kind) {
    case 'money':
      // Minor units to a number of the currency: paise to rupees, fils to dirhams.
      return Number(minorToDecimal(BigInt(String(value)), digits));
    case 'number':
      return Number(value);
    case 'date':
      return typeof value === 'string' ? value.slice(0, 10) : value;
    default:
      return String(value);
  }
}
