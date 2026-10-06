import type { Type } from '@nestjs/common';
import { z } from 'zod';
import {
  attendanceRegisterQuerySchema,
  eachDate,
  labourCostQuerySchema,
  personLedgerQuerySchema,
  attendanceQuerySchema,
  auditQuerySchema,
  campDayQuerySchema,
  displayPhone,
  listChangeOrdersQuerySchema,
  listEquipmentLogsQuerySchema,
  listEquipmentQuerySchema,
  listExpensesQuerySchema,
  listIndentsQuerySchema,
  listLabourPaymentsQuerySchema,
  listMaterialsQuerySchema,
  listProjectsQuerySchema,
  listPurchaseInvoicesQuerySchema,
  listPurchaseOrdersQuerySchema,
  listQualityInspectionsQuerySchema,
  listQualityTestsQuerySchema,
  listRfisQuerySchema,
  listRfqsQuerySchema,
  listSafetyIncidentsQuerySchema,
  listSafetyObservationsQuerySchema,
  listSafetyPermitsQuerySchema,
  listSafetyToolboxTalksQuerySchema,
  listSnagsQuerySchema,
  listStockMovementsQuerySchema,
  listSubcontractsQuerySchema,
  listSubmittalsQuerySchema,
  listVendorsQuerySchema,
  listWagePeriodsQuerySchema,
  listWorkersQuerySchema,
  scheduleQuerySchema,
  stockOnHandQuerySchema,
  uuidSchema,
  type ExcelCellType,
  type ModuleName,
  type Page,
  type Permission,
} from '@sitebook/shared';
import { can, type RequestUser } from '../../common/auth/request-user';
import { AttendanceService } from '../attendance/attendance.service';
import { AuditService } from '../audit/audit.service';
import { CampsService } from '../camps/camps.service';
import { ChangeOrdersService } from '../change-orders/change-orders.service';
import { ContractorsService } from '../contractors/contractors.service';
import { CostCodesService } from '../cost-codes/cost-codes.service';
import { EquipmentLogsService } from '../equipment/equipment-logs.service';
import { EquipmentService } from '../equipment/equipment.service';
import { ExpensesService } from '../expenses/expenses.service';
import { IndentsService } from '../indents/indents.service';
import { LabourPaymentsService } from '../labour-payments/labour-payments.service';
import { MaterialsService } from '../materials/materials.service';
import { PurchaseInvoicesService } from '../procurement/purchase-invoices.service';
import { PurchaseOrdersService } from '../procurement/purchase-orders.service';
import { RfqsService } from '../procurement/rfqs.service';
import { VendorsService } from '../procurement/vendors.service';
import { ProjectsService } from '../projects/projects.service';
import { QualityInspectionsService } from '../quality/quality-inspections.service';
import { QualityTestsService } from '../quality/quality-tests.service';
import { SnagsService } from '../quality/snags.service';
import { RfisService } from '../rfis/rfis.service';
import { SubmittalsService } from '../rfis/submittals.service';
import { SafetyIncidentsService } from '../safety/safety-incidents.service';
import { SafetyObservationsService } from '../safety/safety-observations.service';
import { SafetyPermitsService } from '../safety/safety-permits.service';
import { SafetyTalksService } from '../safety/safety-talks.service';
import { SchedulingService } from '../scheduling/scheduling.service';
import { StockService } from '../stock/stock.service';
import { SubcontractsService } from '../subcontracts/subcontracts.service';
import { TenantsService } from '../tenants/tenants.service';
import { WagePeriodsService } from '../wage-periods/wage-periods.service';
import { WorkersService } from '../workers/workers.service';
import { ReportsService } from '../reports/reports.service';
import { ExcelExportService, type ExcelExportColumn } from './excel-export.service';

/**
 * Every table that exports to Excel (roadmap Phase 3, item 4), as data.
 *
 * Each source names the permission and plan module its screen's list endpoint asks for, and loads its
 * rows by calling that module's own list method — the method behind the screen — with the screen's
 * filters. Nothing here reads a table directly. That is the whole of how an export respects
 * permissions: a supervisor's export goes through the same site scoping, and a list that blanks
 * rates for someone without the money permission blanks them here too. Where a screen hides a money
 * column outright for such a person, the source drops the column as well (`when`), rather than
 * shipping a column of blanks that reads as "zero".
 */

/** Looks up another module's service. See `ExcelModule` for why this is not constructor injection. */
export type ServiceLocator = <T>(type: Type<T>) => T;

export interface ExportColumn<Row> extends ExcelExportColumn<Row> {
  /** Shown only when this holds for the person exporting. */
  when?: (actor: RequestUser) => boolean;
}

export interface ExportSource<Q = unknown, Row = unknown> {
  kind: string;
  title: string;
  /** Any one of these lets a person export — the list endpoint's own `@RequiresPermission`. */
  permissions: readonly Permission[];
  module?: ModuleName;
  /** The list endpoint's query schema: the same filters, validated the same way. */
  query: z.ZodType<Q, z.ZodTypeDef, unknown>;
  columns: ReadonlyArray<ExportColumn<Row>>;
  /** Columns that depend on the filters — one per day of a register. Added after `columns`. */
  extraColumns?: (query: Q) => Array<ExportColumn<Row>>;
  load: (get: ServiceLocator, actor: RequestUser, query: Q) => Promise<Row[]>;
}

function source<Q, Row>(definition: ExportSource<Q, Row>): ExportSource<Q, Row> {
  return definition;
}

function col<Row>(
  key: string,
  header: string,
  type: ExcelCellType,
  value: (row: Row) => unknown,
  extra: Partial<Pick<ExportColumn<Row>, 'width' | 'when'>> = {},
): ExportColumn<Row> {
  return { key, header, type, value, ...extra };
}

/** Columns for one row type, so every getter is checked against the service's own view. */
function columnsOf<Row>(build: (column: typeof col<Row>) => Array<ExportColumn<Row>>): Array<ExportColumn<Row>> {
  return build(col<Row>);
}

type Named = { name: string | null } | null | undefined;
const nameOf = (value: Named): string | null => value?.name ?? null;
const phone = (value: string | null | undefined): string | null => (value ? displayPhone(value) : null);
const label = (value: string | null | undefined): string | null =>
  value ? value.charAt(0).toUpperCase() + value.slice(1).replace(/_/g, ' ') : null;

/**
 * Every page of a keyset-paged list, at the endpoint's largest page size. Stops one row past the cap
 * so an export that is too big is refused before it is built rather than after.
 */
async function allPages<T>(fetch: (cursor: string | undefined) => Promise<Page<T>>): Promise<T[]> {
  const rows: T[] = [];
  let cursor: string | undefined;
  do {
    const page = await fetch(cursor);
    rows.push(...page.items);
    cursor = page.next_cursor ?? undefined;
  } while (cursor && rows.length <= ExcelExportService.maxRows);
  return rows;
}

const projectScoped = z.object({ project_id: uuidSchema });

// Row types, read off the services so a renamed field fails the build instead of exporting blanks.
type ListItem<S, M extends keyof S> = S[M] extends (...args: never[]) => Promise<infer R>
  ? R extends { items: Array<infer I> }
    ? I
    : R extends Array<infer I>
      ? I
      : never
  : never;

const moneyPerm = (permission: Permission) => (actor: RequestUser) => can(actor, permission);

export const EXPORT_SOURCES: ReadonlyArray<ExportSource<never, never>> = [
  // --- sites -------------------------------------------------------------------------------------
  source({
    kind: 'projects',
    title: 'Sites',
    permissions: ['projects.view'],
    module: 'projects',
    query: listProjectsQuerySchema,
    columns: columnsOf<ListItem<ProjectsService, 'list'>>((col) => [
      col('name', 'Site', 'text', (r) => r.name, { width: 28 }),
      col('client_name', 'Client', 'text', (r) => r.client_name),
      col('address', 'Address', 'text', (r) => r.address, { width: 36 }),
      col('status', 'Status', 'text', (r) => label(r.status)),
      col('start_date', 'Start date', 'date', (r) => r.start_date),
      col('target_end_date', 'Target end date', 'date', (r) => r.target_end_date),
      col('budget_amount', 'Budget', 'money', (r) => r.budget_amount),
      col('photo_count', 'Photos', 'integer', (r) => r.photo_count),
    ]),
    load: (get, actor, query) =>
      allPages((cursor) => get(ProjectsService).list(actor, { ...query, limit: 200, cursor })),
  }),

  // --- labour ------------------------------------------------------------------------------------
  source({
    kind: 'workers',
    title: 'Workers',
    permissions: ['workers.view'],
    module: 'labour',
    query: listWorkersQuerySchema,
    columns: columnsOf<ListItem<WorkersService, 'list'>>((col) => [
      col('name', 'Name', 'text', (r) => r.name, { width: 26 }),
      col('phone', 'Phone', 'text', (r) => phone(r.phone)),
      col('trade', 'Trade', 'text', (r) => r.trade),
      col('contractor_name', 'Contractor', 'text', (r) => r.contractor_name ?? 'Direct labour', { width: 22 }),
      col('skill_level', 'Skill level', 'text', (r) => label(r.skill_level)),
      col('pay_basis', 'Pay basis', 'text', (r) => label(r.pay_basis)),
      col('daily_wage', 'Daily wage', 'money', (r) => r.daily_wage),
      col('overtime_rate_per_hour', 'Overtime per hour', 'money', (r) => r.overtime_rate_per_hour),
      col('basic_salary', 'Basic salary', 'money', (r) => r.basic_salary),
      col('housing_allowance', 'Housing allowance', 'money', (r) => r.housing_allowance),
      col('transport_allowance', 'Transport allowance', 'money', (r) => r.transport_allowance),
      col('food_allowance', 'Food allowance', 'money', (r) => r.food_allowance),
      col('status', 'Status', 'text', (r) => label(r.status)),
      col('wps_person_id', 'WPS person ID', 'text', (r) => r.wps_person_id),
    ]),
    load: (get, actor, query) =>
      allPages((cursor) => get(WorkersService).list(actor, { ...query, limit: 500, cursor })),
  }),
  source({
    kind: 'contractors',
    title: 'Contractors',
    permissions: ['contractors.manage', 'workers.view'],
    module: 'labour',
    query: z.object({}),
    columns: columnsOf<ListItem<ContractorsService, 'list'>>((col) => [
      col('name', 'Name', 'text', (r) => r.name, { width: 26 }),
      col('trade', 'Trade', 'text', (r) => r.trade),
      col('phone', 'Phone', 'text', (r) => phone(r.phone)),
      col('payment_terms', 'Payment terms', 'text', (r) => label(r.payment_terms)),
      col('tax_id', 'Tax ID', 'text', (r) => r.tax_id),
      col('address', 'Address', 'text', (r) => r.address, { width: 36 }),
      col('worker_count', 'Workers', 'integer', (r) => r.worker_count),
    ]),
    load: (get, actor) => allPages((cursor) => get(ContractorsService).list(actor, { limit: 200, cursor })),
  }),
  source({
    kind: 'attendance',
    title: 'Attendance',
    permissions: ['attendance.view'],
    module: 'attendance',
    query: attendanceQuerySchema,
    columns: columnsOf<Awaited<ReturnType<AttendanceService['forDate']>>['items'][number]>((col) => [
      col('worker_name', 'Worker', 'text', (r) => r.worker_name, { width: 26 }),
      col('contractor_name', 'Contractor', 'text', (r) => r.contractor_name ?? 'Direct labour'),
      col('trade', 'Trade', 'text', (r) => r.trade),
      col('status', 'Status', 'text', (r) => label(r.status)),
      col('overtime_hours', 'Overtime hours', 'number', (r) => r.overtime_hours),
      col('wage_snapshot', 'Day wage', 'money', (r) => r.wage_snapshot),
      col('overtime_rate_snapshot', 'Overtime per hour', 'money', (r) => r.overtime_rate_snapshot),
      col('earned', 'Earned', 'money', (r) => r.earned),
    ]),
    load: async (get, actor, query) => (await get(AttendanceService).forDate(actor, query.project_id, query.date)).items,
  }),
  source({
    kind: 'wage_periods',
    title: 'Wage periods',
    permissions: ['wages.view'],
    module: 'labour',
    query: listWagePeriodsQuerySchema,
    columns: columnsOf<ListItem<WagePeriodsService, 'list'>>((col) => [
      col('contractor_name', 'Contractor', 'text', (r) => r.contractor_name ?? 'Direct labour', { width: 24 }),
      col('period_start', 'From', 'date', (r) => r.period_start),
      col('period_end', 'To', 'date', (r) => r.period_end),
      col('status', 'Status', 'text', (r) => label(r.status)),
      col('line_count', 'Workers', 'integer', (r) => r.line_count),
      col('total_earned', 'Earned', 'money', (r) => r.total_earned),
      col('total_advances', 'Advances', 'money', (r) => r.total_advances),
      col('total_paid', 'Paid', 'money', (r) => r.total_paid),
    ]),
    load: (get, actor, query) =>
      allPages((cursor) => get(WagePeriodsService).list(actor, { ...query, limit: 200, cursor })),
  }),
  source({
    kind: 'labour_payments',
    title: 'Labour payments',
    permissions: ['payments.view'],
    module: 'labour',
    query: listLabourPaymentsQuerySchema,
    columns: columnsOf<ListItem<LabourPaymentsService, 'list'>>((col) => [
      col('paid_on', 'Paid on', 'date', (r) => r.paid_on),
      col('type', 'Type', 'text', (r) => label(r.type)),
      col('worker_name', 'Worker', 'text', (r) => r.worker_name, { width: 24 }),
      col('contractor_name', 'Contractor', 'text', (r) => r.contractor_name, { width: 22 }),
      col('amount', 'Amount', 'money', (r) => r.amount),
      col('mode', 'Mode', 'text', (r) => label(r.mode)),
      col('reference', 'Reference', 'text', (r) => r.reference),
      col('note', 'Note', 'text', (r) => r.note, { width: 30 }),
    ]),
    load: (get, actor, query) =>
      allPages((cursor) => get(LabourPaymentsService).list(actor, { ...query, limit: 200, cursor })),
  }),

  // --- money out ---------------------------------------------------------------------------------
  source({
    kind: 'expenses',
    title: 'Expenses',
    permissions: ['expenses.view'],
    module: 'expenses',
    query: listExpensesQuerySchema,
    columns: columnsOf<ListItem<ExpensesService, 'list'>>((col) => [
      col('spent_on', 'Date', 'date', (r) => r.spent_on),
      col('project_name', 'Site', 'text', (r) => r.project_name, { width: 22 }),
      col('category', 'Category', 'text', (r) => label(r.category)),
      col('cost_code', 'Cost code', 'text', (r) => (r.cost_code ? `${r.cost_code.code} ${r.cost_code.name}` : null)),
      col('amount', 'Amount', 'money', (r) => r.amount),
      col('tax_amount', 'Tax', 'money', (r) => r.tax_amount),
      col('status', 'Status', 'text', (r) => label(r.status)),
      col('submitted_by', 'Recorded by', 'text', (r) => nameOf(r.submitted_by)),
      col('approved_by', 'Approved by', 'text', (r) => nameOf(r.approved_by)),
      col('approved_at', 'Approved at', 'datetime', (r) => r.approved_at),
      col('supplier_tax_id', 'Supplier tax ID', 'text', (r) => r.supplier_tax_id),
      col('note', 'Note', 'text', (r) => r.note, { width: 30 }),
    ]),
    load: (get, actor, query) =>
      allPages((cursor) => get(ExpensesService).list(actor, { ...query, limit: 200, cursor }) as Promise<Page<ListItem<ExpensesService, 'list'>>>),
  }),

  // --- materials ---------------------------------------------------------------------------------
  source({
    kind: 'materials',
    title: 'Materials',
    permissions: ['materials.manage', 'indents.raise'],
    module: 'materials',
    query: listMaterialsQuerySchema,
    columns: columnsOf<ListItem<MaterialsService, 'list'>>((col) => [
      col('name', 'Name', 'text', (r) => r.name, { width: 30 }),
      col('unit', 'Unit', 'text', (r) => r.unit),
      col('category', 'Category', 'text', (r) => r.category),
    ]),
    load: (get, actor, query) =>
      allPages((cursor) => get(MaterialsService).list(actor, { ...query, limit: 500, cursor })),
  }),
  source({
    kind: 'stock',
    title: 'Stock on hand',
    permissions: ['stock.view'],
    module: 'stock',
    query: stockOnHandQuerySchema,
    columns: columnsOf<Awaited<ReturnType<StockService['onHand']>>['items'][number]>((col) => [
      col('material_name', 'Material', 'text', (r) => r.material_name, { width: 30 }),
      col('category', 'Category', 'text', (r) => r.category),
      col('unit', 'Unit', 'text', (r) => r.unit),
      col('received', 'Received', 'number', (r) => r.received),
      col('used', 'Used', 'number', (r) => r.used),
      col('on_hand', 'On hand', 'number', (r) => r.on_hand),
    ]),
    load: async (get, actor, query) => (await get(StockService).onHand(actor, query)).items,
  }),
  source({
    kind: 'stock_movements',
    title: 'Stock movements',
    permissions: ['stock.view'],
    module: 'stock',
    query: listStockMovementsQuerySchema,
    columns: columnsOf<ListItem<StockService, 'list'>>((col) => [
      col('moved_on', 'Date', 'date', (r) => r.moved_on),
      col('project_name', 'Site', 'text', (r) => r.project_name, { width: 22 }),
      col('material_name', 'Material', 'text', (r) => r.material_name, { width: 26 }),
      col('type', 'In / out', 'text', (r) => (r.type === 'in' ? 'In' : 'Out')),
      col('quantity', 'Quantity', 'number', (r) => r.quantity),
      col('unit', 'Unit', 'text', (r) => r.unit),
      col('ref', 'Reference', 'text', (r) => r.ref),
      col('note', 'Note', 'text', (r) => r.note, { width: 30 }),
      col('recorded_by', 'Recorded by', 'text', (r) => nameOf(r.recorded_by)),
    ]),
    load: (get, actor, query) =>
      allPages((cursor) => get(StockService).list(actor, { ...query, limit: 200, cursor }) as Promise<Page<ListItem<StockService, 'list'>>>),
  }),
  source({
    kind: 'indents',
    title: 'Indents',
    permissions: ['indents.raise', 'indents.approve'],
    module: 'indents',
    query: listIndentsQuerySchema,
    columns: columnsOf<ListItem<IndentsService, 'list'>>((col) => [
      col('created_at', 'Raised', 'datetime', (r) => r.created_at),
      col('project_name', 'Site', 'text', (r) => r.project_name, { width: 22 }),
      col('status', 'Status', 'text', (r) => label(r.status)),
      col('urgency', 'Urgency', 'text', (r) => label(r.urgency)),
      col('required_by', 'Required by', 'date', (r) => r.required_by),
      col('items', 'Items', 'text', (r) => r.items.map((item) => `${item.material_name} ${item.quantity} ${item.unit}`).join('; '), { width: 50 }),
      col('requested_by', 'Raised by', 'text', (r) => nameOf(r.requested_by)),
      col('approved_by', 'Approved by', 'text', (r) => nameOf(r.approved_by)),
      col('notes', 'Notes', 'text', (r) => r.notes, { width: 30 }),
    ]),
    load: (get, actor, query) =>
      allPages((cursor) => get(IndentsService).list(actor, { ...query, limit: 200, cursor }) as Promise<Page<ListItem<IndentsService, 'list'>>>),
  }),
  source({
    kind: 'cost_codes',
    title: 'Cost codes',
    permissions: ['cost_codes.view', 'expenses.record'],
    module: 'projects',
    query: projectScoped,
    columns: columnsOf<ListItem<CostCodesService, 'list'>>((col) => [
      col('code', 'Code', 'text', (r) => r.code),
      col('name', 'Name', 'text', (r) => `${'  '.repeat(r.depth)}${r.name}`, { width: 40 }),
      col('unit', 'Unit', 'text', (r) => r.unit),
      // The budget is the builder's margin: the list blanks it without `cost_codes.view`, and the
      // export leaves the column out rather than shipping a column of blanks.
      col('budget', 'Budget', 'money', (r) => r.budget, { when: moneyPerm('cost_codes.view') }),
      col('labour_default', 'Labour default', 'boolean', (r) => r.labour_default),
    ]),
    load: (get, actor, query) => get(CostCodesService).list(actor, query.project_id),
  }),

  // --- procurement -------------------------------------------------------------------------------
  source({
    kind: 'vendors',
    title: 'Suppliers',
    permissions: ['procurement.view', 'procurement.manage', 'vendors.manage', 'procurement.invoices'],
    module: 'materials',
    query: listVendorsQuerySchema,
    columns: columnsOf<ListItem<VendorsService, 'list'>>((col) => [
      col('name', 'Name', 'text', (r) => r.name, { width: 28 }),
      col('contact_name', 'Contact person', 'text', (r) => r.contact_name),
      col('phone', 'Phone', 'text', (r) => phone(r.phone)),
      col('email', 'Email', 'text', (r) => r.email, { width: 26 }),
      col('address', 'Address', 'text', (r) => r.address, { width: 36 }),
      col('tax_id', 'Tax ID', 'text', (r) => r.tax_id),
      col('payment_terms_days', 'Payment terms (days)', 'integer', (r) => r.payment_terms_days),
      col('active', 'Active', 'boolean', (r) => r.active),
      col('notes', 'Notes', 'text', (r) => r.notes, { width: 30 }),
    ]),
    load: (get, actor, query) => get(VendorsService).list(actor, query),
  }),
  source({
    kind: 'purchase_orders',
    title: 'Purchase orders',
    permissions: ['procurement.view', 'procurement.manage', 'procurement.receive'],
    module: 'materials',
    query: listPurchaseOrdersQuerySchema,
    columns: columnsOf<ListItem<PurchaseOrdersService, 'list'>>((col) => [
      col('number', 'PO number', 'text', (r) => r.number),
      col('project_name', 'Site', 'text', (r) => r.project_name, { width: 22 }),
      col('vendor_name', 'Supplier', 'text', (r) => r.vendor_name, { width: 24 }),
      col('status', 'Status', 'text', (r) => label(r.status)),
      col('expected_on', 'Expected on', 'date', (r) => r.expected_on),
      // A store keeper who receives goods does not see what they cost — on screen or here.
      col('subtotal', 'Subtotal', 'money', (r) => r.subtotal, { when: moneyPerm('procurement.view') }),
      col('tax_total', 'Tax', 'money', (r) => r.tax_total, { when: moneyPerm('procurement.view') }),
      col('total', 'Total', 'money', (r) => r.total, { when: moneyPerm('procurement.view') }),
      col('line_count', 'Lines', 'integer', (r) => r.line_count),
      col('created_at', 'Raised', 'datetime', (r) => r.created_at),
      col('created_by', 'Raised by', 'text', (r) => nameOf(r.created_by)),
      col('approved_at', 'Approved at', 'datetime', (r) => r.approved_at),
      col('approved_by', 'Approved by', 'text', (r) => nameOf(r.approved_by)),
    ]),
    load: (get, actor, query) => get(PurchaseOrdersService).list(actor, query),
  }),
  source({
    kind: 'purchase_invoices',
    title: 'Supplier invoices',
    permissions: ['procurement.view', 'procurement.invoices'],
    module: 'materials',
    query: listPurchaseInvoicesQuerySchema,
    columns: columnsOf<ListItem<PurchaseInvoicesService, 'list'>>((col) => [
      col('invoice_number', 'Invoice number', 'text', (r) => r.invoice_number),
      col('vendor', 'Supplier', 'text', (r) => nameOf(r.vendor), { width: 24 }),
      col('purchase_order_number', 'PO number', 'text', (r) => r.purchase_order_number),
      col('project_name', 'Site', 'text', (r) => r.project_name, { width: 22 }),
      col('invoice_date', 'Invoice date', 'date', (r) => r.invoice_date),
      col('due_date', 'Due date', 'date', (r) => r.due_date),
      col('subtotal', 'Subtotal', 'money', (r) => r.subtotal),
      col('tax_total', 'Tax', 'money', (r) => r.tax_total),
      col('total', 'Total', 'money', (r) => r.total),
      col('status', 'Status', 'text', (r) => label(r.status)),
      col('flags', 'Flags', 'text', (r) => r.flags.join(', ')),
    ]),
    load: (get, actor, query) => get(PurchaseInvoicesService).list(actor, query),
  }),
  source({
    kind: 'rfqs',
    title: 'Requests for quotation',
    permissions: ['procurement.view', 'procurement.manage'],
    module: 'materials',
    query: listRfqsQuerySchema,
    columns: columnsOf<ListItem<RfqsService, 'list'>>((col) => [
      col('number', 'RFQ number', 'text', (r) => r.number),
      col('title', 'Title', 'text', (r) => r.title, { width: 30 }),
      col('project_name', 'Site', 'text', (r) => r.project_name, { width: 22 }),
      col('status', 'Status', 'text', (r) => label(r.status)),
      col('required_by', 'Required by', 'date', (r) => r.required_by),
      col('item_count', 'Items', 'integer', (r) => r.item_count),
      col('quote_count', 'Quotes', 'integer', (r) => r.quote_count),
      col('created_at', 'Created', 'datetime', (r) => r.created_at),
    ]),
    load: (get, actor, query) => get(RfqsService).list(actor, query),
  }),
  source({
    kind: 'subcontracts',
    title: 'Subcontracts',
    permissions: ['subcontracts.view', 'subcontracts.measure'],
    module: 'projects',
    query: listSubcontractsQuerySchema,
    columns: columnsOf<ListItem<SubcontractsService, 'list'>>((col) => [
      col('number', 'Number', 'text', (r) => r.number),
      col('title', 'Title', 'text', (r) => r.title, { width: 30 }),
      col('project', 'Site', 'text', (r) => nameOf(r.project), { width: 22 }),
      col('contractor', 'Contractor', 'text', (r) => nameOf(r.contractor), { width: 24 }),
      col('status', 'Status', 'text', (r) => label(r.status)),
      col('start_date', 'Start', 'date', (r) => r.start_date),
      col('end_date', 'End', 'date', (r) => r.end_date),
      // Someone who only measures sees no money on the screen; the columns go with it.
      col('current_value', 'Value', 'money', (r) => r.current_value, { when: moneyPerm('subcontracts.view') }),
      col('certified', 'Certified', 'money', (r) => r.certified, { when: moneyPerm('subcontracts.view') }),
      col('paid', 'Paid', 'money', (r) => r.paid, { when: moneyPerm('subcontracts.view') }),
      col('balance_due', 'Balance due', 'money', (r) => r.balance_due, { when: moneyPerm('subcontracts.view') }),
      col('retention_held', 'Retention held', 'money', (r) => r.retention_held, { when: moneyPerm('subcontracts.view') }),
    ]),
    load: async (get, actor, query) => (await get(SubcontractsService).list(actor, query)).items,
  }),
  source({
    kind: 'change_orders',
    title: 'Change orders',
    permissions: ['change_orders.view'],
    module: 'projects',
    query: listChangeOrdersQuerySchema,
    columns: columnsOf<ListItem<ChangeOrdersService, 'list'>>((col) => [
      col('label', 'Number', 'text', (r) => r.label),
      col('project', 'Site', 'text', (r) => nameOf(r.project), { width: 22 }),
      col('title', 'Title', 'text', (r) => r.title, { width: 30 }),
      col('reason', 'Reason', 'text', (r) => label(r.reason)),
      col('status', 'Status', 'text', (r) => label(r.status)),
      col('raised_on', 'Raised on', 'date', (r) => r.raised_on),
      col('cost_impact', 'Cost', 'money', (r) => r.cost_impact),
      col('client_price', 'Price to client', 'money', (r) => r.client_price),
      col('margin', 'Margin', 'money', (r) => r.margin),
      col('tax', 'Tax', 'money', (r) => r.tax),
      col('client_total', 'Client total', 'money', (r) => r.client_total),
      col('time_impact_days', 'Days', 'integer', (r) => r.time_impact_days),
    ]),
    load: async (get, actor, query) => (await get(ChangeOrdersService).list(actor, query)).items,
  }),

  // --- programme ---------------------------------------------------------------------------------
  source({
    kind: 'schedule_tasks',
    title: 'Schedule',
    permissions: ['schedule.view'],
    module: 'projects',
    query: projectScoped.merge(scheduleQuerySchema),
    columns: columnsOf<Awaited<ReturnType<SchedulingService['get']>>['tasks'][number]>((col) => [
      col('wbs', 'WBS', 'text', (r) => r.wbs),
      col('name', 'Task', 'text', (r) => `${'  '.repeat(r.depth)}${r.name}`, { width: 40 }),
      col('start', 'Start', 'date', (r) => r.start),
      col('finish', 'Finish', 'date', (r) => r.finish),
      col('duration_days', 'Duration (days)', 'integer', (r) => r.duration_days),
      col('percent_complete', 'Complete', 'percent', (r) => r.percent_complete),
      col('status', 'Status', 'text', (r) => label(r.status)),
      col('critical', 'Critical', 'boolean', (r) => r.critical),
      col('total_float', 'Total float (days)', 'integer', (r) => r.total_float),
      col('actual_start', 'Actual start', 'date', (r) => r.actual_start),
      col('actual_finish', 'Actual finish', 'date', (r) => r.actual_finish),
    ]),
    load: async (get, actor, query) => {
      const { project_id: projectId, ...rest } = query;
      return (await get(SchedulingService).get(actor, projectId, rest)).tasks;
    },
  }),

  // --- quality -----------------------------------------------------------------------------------
  source({
    kind: 'snags',
    title: 'Snags',
    permissions: ['quality.view', 'quality.inspect'],
    module: 'projects',
    query: listSnagsQuerySchema,
    columns: columnsOf<ListItem<SnagsService, 'list'>>((col) => [
      col('number', 'Number', 'integer', (r) => r.number),
      col('project', 'Site', 'text', (r) => nameOf(r.project), { width: 22 }),
      col('title', 'Title', 'text', (r) => r.title, { width: 32 }),
      col('location', 'Location', 'text', (r) => r.location),
      col('trade', 'Trade', 'text', (r) => r.trade),
      col('priority', 'Priority', 'text', (r) => label(r.priority)),
      col('status', 'Status', 'text', (r) => label(r.status)),
      col('assigned', 'Assigned to', 'text', (r) => nameOf(r.assigned_user) ?? nameOf(r.assigned_contractor)),
      col('due_on', 'Due', 'date', (r) => r.due_on),
      col('overdue', 'Overdue', 'boolean', (r) => r.overdue),
      col('raised_at', 'Raised', 'datetime', (r) => r.raised_at),
      col('closed_at', 'Closed', 'datetime', (r) => r.closed_at),
      col('age_days', 'Age (days)', 'integer', (r) => r.age_days),
    ]),
    load: async (get, actor, query) => (await get(SnagsService).list(actor, { ...query, limit: 1000 })).items,
  }),
  source({
    kind: 'inspections',
    title: 'Inspections',
    permissions: ['quality.view', 'quality.inspect'],
    module: 'projects',
    query: listQualityInspectionsQuerySchema,
    columns: columnsOf<ListItem<QualityInspectionsService, 'list'>>((col) => [
      col('number', 'Number', 'integer', (r) => r.number),
      col('project', 'Site', 'text', (r) => nameOf(r.project), { width: 22 }),
      col('title', 'Title', 'text', (r) => r.title, { width: 30 }),
      col('template', 'Checklist', 'text', (r) => nameOf(r.template)),
      col('trade', 'Trade', 'text', (r) => r.trade),
      col('location', 'Location', 'text', (r) => r.location),
      col('inspection_date', 'Date', 'date', (r) => r.inspection_date),
      col('inspector', 'Inspector', 'text', (r) => nameOf(r.inspector)),
      col('status', 'Status', 'text', (r) => label(r.status)),
      col('result', 'Result', 'text', (r) => label(r.result)),
      col('failed', 'Failed items', 'integer', (r) => r.counts.failed),
      col('snag_count', 'Snags', 'integer', (r) => r.snag_count),
    ]),
    load: async (get, actor, query) => (await get(QualityInspectionsService).list(actor, { ...query, limit: 500 })).items,
  }),
  source({
    kind: 'quality_tests',
    title: 'Material tests',
    permissions: ['quality.view', 'quality.inspect'],
    module: 'projects',
    query: listQualityTestsQuerySchema,
    columns: columnsOf<ListItem<QualityTestsService, 'list'>>((col) => [
      col('number', 'Number', 'integer', (r) => r.number),
      col('project', 'Site', 'text', (r) => nameOf(r.project), { width: 22 }),
      col('test_type', 'Test', 'text', (r) => label(r.test_type)),
      col('sample_ref', 'Sample', 'text', (r) => r.sample_ref),
      col('location', 'Location', 'text', (r) => r.location),
      col('grade', 'Grade', 'text', (r) => r.grade),
      col('cast_on', 'Cast on', 'date', (r) => r.cast_on),
      col('due_on', 'Due', 'date', (r) => r.due_on),
      col('tested_on', 'Tested on', 'date', (r) => r.tested_on),
      col('result_value', 'Result', 'number', (r) => r.result_value),
      col('unit', 'Unit', 'text', (r) => r.unit),
      col('result', 'Pass / fail', 'text', (r) => label(r.result)),
      col('lab_name', 'Lab', 'text', (r) => r.lab_name),
    ]),
    load: async (get, actor, query) => (await get(QualityTestsService).list(actor, { ...query, limit: 500 })).items,
  }),

  // --- safety ------------------------------------------------------------------------------------
  source({
    kind: 'safety_incidents',
    title: 'Incidents',
    permissions: ['safety.view'],
    module: 'projects',
    query: listSafetyIncidentsQuerySchema,
    columns: columnsOf<ListItem<SafetyIncidentsService, 'list'>>((col) => [
      col('number', 'Number', 'text', (r) => r.number),
      col('project', 'Site', 'text', (r) => nameOf(r.project), { width: 22 }),
      col('occurred_at', 'When', 'datetime', (r) => r.occurred_at),
      col('type', 'Type', 'text', (r) => label(r.type)),
      col('severity', 'Severity', 'text', (r) => label(r.severity)),
      col('title', 'Title', 'text', (r) => r.title, { width: 32 }),
      col('location', 'Location', 'text', (r) => r.location),
      col('status', 'Status', 'text', (r) => label(r.status)),
      col('injured', 'Injured', 'integer', (r) => r.injured),
      col('open_actions', 'Open actions', 'integer', (r) => r.open_actions),
    ]),
    load: async (get, actor, query) => (await get(SafetyIncidentsService).list(actor, { ...query, limit: 500 })).items,
  }),
  source({
    kind: 'safety_observations',
    title: 'Observations',
    permissions: ['safety.view'],
    module: 'projects',
    query: listSafetyObservationsQuerySchema,
    columns: columnsOf<ListItem<SafetyObservationsService, 'list'>>((col) => [
      col('number', 'Number', 'text', (r) => r.number),
      col('project', 'Site', 'text', (r) => nameOf(r.project), { width: 22 }),
      col('observed_at', 'When', 'datetime', (r) => r.observed_at),
      col('type', 'Type', 'text', (r) => label(r.type)),
      col('category', 'Category', 'text', (r) => label(r.category)),
      col('severity', 'Severity', 'text', (r) => label(r.severity)),
      col('description', 'Description', 'text', (r) => r.description, { width: 40 }),
      col('location', 'Location', 'text', (r) => r.location),
      col('status', 'Status', 'text', (r) => label(r.status)),
      col('open_actions', 'Open actions', 'integer', (r) => r.open_actions),
    ]),
    load: async (get, actor, query) => (await get(SafetyObservationsService).list(actor, { ...query, limit: 500 })).items,
  }),
  source({
    kind: 'safety_permits',
    title: 'Permits to work',
    permissions: ['safety.view'],
    module: 'projects',
    query: listSafetyPermitsQuerySchema,
    columns: columnsOf<ListItem<SafetyPermitsService, 'list'>>((col) => [
      col('number', 'Number', 'text', (r) => r.number),
      col('project', 'Site', 'text', (r) => nameOf(r.project), { width: 22 }),
      col('type', 'Type', 'text', (r) => label(r.type)),
      col('description', 'Work', 'text', (r) => r.description, { width: 36 }),
      col('area', 'Area', 'text', (r) => r.area),
      col('valid_from', 'Valid from', 'datetime', (r) => r.valid_from),
      col('valid_to', 'Valid to', 'datetime', (r) => r.valid_to),
      col('status', 'Status', 'text', (r) => label(r.status)),
      col('expired', 'Expired', 'boolean', (r) => r.expired),
      col('crew_count', 'Crew', 'integer', (r) => r.crew_count),
    ]),
    load: async (get, actor, query) => (await get(SafetyPermitsService).list(actor, { ...query, limit: 500 })).items,
  }),
  source({
    kind: 'safety_talks',
    title: 'Toolbox talks',
    permissions: ['safety.view'],
    module: 'projects',
    query: listSafetyToolboxTalksQuerySchema,
    columns: columnsOf<ListItem<SafetyTalksService, 'list'>>((col) => [
      col('talk_date', 'Date', 'date', (r) => r.talk_date),
      col('project', 'Site', 'text', (r) => nameOf(r.project), { width: 22 }),
      col('topic', 'Topic', 'text', (r) => r.topic, { width: 32 }),
      col('presenter', 'Presenter', 'text', (r) => (typeof r.presenter === 'string' ? r.presenter : nameOf(r.presenter))),
      col('duration_minutes', 'Minutes', 'integer', (r) => r.duration_minutes),
      col('attendees', 'Attendees', 'integer', (r) => r.attendees),
      col('signed', 'Signed', 'integer', (r) => r.signed),
    ]),
    load: async (get, actor, query) => (await get(SafetyTalksService).list(actor, { ...query, limit: 500 })).items,
  }),

  // --- design ------------------------------------------------------------------------------------
  source({
    kind: 'rfis',
    title: 'RFIs',
    permissions: ['rfis.view'],
    module: 'projects',
    query: listRfisQuerySchema,
    columns: columnsOf<ListItem<RfisService, 'list'>>((col) => [
      col('label', 'Number', 'text', (r) => r.label),
      col('project', 'Site', 'text', (r) => nameOf(r.project), { width: 22 }),
      col('subject', 'Subject', 'text', (r) => r.subject, { width: 36 }),
      col('discipline', 'Discipline', 'text', (r) => label(r.discipline)),
      col('priority', 'Priority', 'text', (r) => label(r.priority)),
      col('status', 'Status', 'text', (r) => label(r.status)),
      col('raised_on', 'Raised on', 'date', (r) => r.raised_on),
      col('due_on', 'Due', 'date', (r) => r.due_on),
      col('overdue', 'Overdue', 'boolean', (r) => r.overdue),
      col('addressed_to', 'Addressed to', 'text', (r) => nameOf(r.addressed_to)),
      col('answered_at', 'Answered', 'datetime', (r) => r.answered_at),
      col('response_days', 'Response (days)', 'integer', (r) => r.response_days),
      col('cost_impact', 'Cost impact', 'boolean', (r) => r.cost_impact),
      col('schedule_impact', 'Time impact', 'boolean', (r) => r.schedule_impact),
    ]),
    load: async (get, actor, query) => (await get(RfisService).list(actor, { ...query, limit: 500 })).items,
  }),
  source({
    kind: 'submittals',
    title: 'Submittals',
    permissions: ['submittals.view'],
    module: 'projects',
    query: listSubmittalsQuerySchema,
    columns: columnsOf<ListItem<SubmittalsService, 'list'>>((col) => [
      col('label', 'Number', 'text', (r) => r.label),
      col('project', 'Site', 'text', (r) => nameOf(r.project), { width: 22 }),
      col('title', 'Title', 'text', (r) => r.title, { width: 34 }),
      col('type', 'Type', 'text', (r) => label(r.type)),
      col('spec_section', 'Spec section', 'text', (r) => r.spec_section),
      col('status', 'Status', 'text', (r) => label(r.status)),
      col('current_revision', 'Revision', 'integer', (r) => r.current_revision),
      col('due_on', 'Due', 'date', (r) => r.due_on),
      col('overdue', 'Overdue', 'boolean', (r) => r.overdue),
      col('submitted_at', 'Submitted', 'datetime', (r) => r.submitted_at),
      col('reviewed_at', 'Reviewed', 'datetime', (r) => r.reviewed_at),
      col('reviewer', 'Reviewer', 'text', (r) => nameOf(r.reviewer)),
    ]),
    load: async (get, actor, query) => (await get(SubmittalsService).list(actor, { ...query, limit: 500 })).items,
  }),

  // --- plant -------------------------------------------------------------------------------------
  source({
    kind: 'equipment',
    title: 'Equipment',
    permissions: ['equipment.view', 'equipment.log', 'equipment.manage'],
    module: 'projects',
    query: listEquipmentQuerySchema,
    columns: columnsOf<ListItem<EquipmentService, 'list'>>((col) => [
      col('code', 'Code', 'text', (r) => r.code),
      col('name', 'Name', 'text', (r) => r.name, { width: 26 }),
      col('category', 'Category', 'text', (r) => label(r.category)),
      col('make', 'Make', 'text', (r) => r.make),
      col('model', 'Model', 'text', (r) => r.model),
      col('registration_no', 'Registration no', 'text', (r) => r.registration_no),
      col('year', 'Year', 'integer', (r) => r.year),
      col('quantity', 'Quantity', 'integer', (r) => r.quantity),
      col('ownership', 'Ownership', 'text', (r) => label(r.ownership)),
      col('vendor', 'Hired from', 'text', (r) => nameOf(r.vendor)),
      col('hire_basis', 'Hire basis', 'text', (r) => label(r.hire_basis)),
      // Rates are what a machine costs: an operator who only logs hours does not see them.
      col('hire_rate', 'Hire rate', 'money', (r) => r.hire_rate, { when: moneyPerm('equipment.view') }),
      col('operator_rate', 'Operator rate', 'money', (r) => r.operator_rate, { when: moneyPerm('equipment.view') }),
      col('mobilisation_charge', 'Mobilisation charge', 'money', (r) => r.mobilisation_charge, { when: moneyPerm('equipment.view') }),
      col('charge_out_rate', 'Charge-out rate', 'money', (r) => r.charge_out_rate, { when: moneyPerm('equipment.view') }),
      col('meter_type', 'Meter', 'text', (r) => label(r.meter_type)),
      col('meter_reading', 'Meter reading', 'number', (r) => r.meter_reading),
      col('status', 'Status', 'text', (r) => label(r.status)),
      col('current_site', 'Current site', 'text', (r) => nameOf(r.current_site?.project)),
    ]),
    load: async (get, actor, query) => (await get(EquipmentService).list(actor, query)).items,
  }),
  source({
    kind: 'equipment_logs',
    title: 'Equipment logs',
    permissions: ['equipment.view', 'equipment.log', 'equipment.manage'],
    module: 'projects',
    query: listEquipmentLogsQuerySchema,
    columns: columnsOf<ListItem<EquipmentLogsService, 'list'>>((col) => [
      col('log_date', 'Date', 'date', (r) => r.log_date),
      col('equipment', 'Machine', 'text', (r) => nameOf(r.equipment), { width: 24 }),
      col('project', 'Site', 'text', (r) => nameOf(r.project), { width: 22 }),
      col('opening_meter', 'Opening meter', 'number', (r) => r.opening_meter),
      col('closing_meter', 'Closing meter', 'number', (r) => r.closing_meter),
      col('hours_worked', 'Hours worked', 'number', (r) => r.hours_worked),
      col('idle_hours', 'Idle hours', 'number', (r) => r.idle_hours),
      col('breakdown_hours', 'Breakdown hours', 'number', (r) => r.breakdown_hours),
      col('fuel_litres', 'Fuel (litres)', 'number', (r) => r.fuel_litres),
      col('operator', 'Operator', 'text', (r) => (typeof r.operator === 'string' ? r.operator : nameOf(r.operator))),
      col('work_done', 'Work done', 'text', (r) => r.work_done, { width: 36 }),
    ]),
    load: async (get, actor, query) => (await get(EquipmentLogsService).list(actor, { ...query, limit: 1000 })).items,
  }),

  // --- reports -----------------------------------------------------------------------------------
  source({
    kind: 'labour_cost',
    title: 'Labour cost',
    permissions: ['reports.view'],
    module: 'labour',
    query: labourCostQuerySchema,
    columns: columnsOf<Awaited<ReturnType<ReportsService['labourCost']>>['groups'][number]>((col) => [
      col('label', 'Name', 'text', (r) => r.label, { width: 28 }),
      col('days', 'Days', 'number', (r) => r.days),
      col('overtime_hours', 'Overtime hours', 'number', (r) => r.overtime_hours),
      col('amount', 'Cost', 'money', (r) => r.amount),
    ]),
    load: async (get, actor, query) => (await get(ReportsService).labourCost(actor, query)).groups,
  }),
  source({
    kind: 'attendance_register',
    title: 'Attendance register',
    permissions: ['reports.view'],
    module: 'attendance',
    query: attendanceRegisterQuerySchema,
    columns: columnsOf<Awaited<ReturnType<ReportsService['attendanceRegister']>>['workers'][number]>((col) => [
      col('worker_name', 'Worker', 'text', (r) => r.worker_name, { width: 24 }),
      col('trade', 'Trade', 'text', (r) => r.trade),
      col('contractor_name', 'Contractor', 'text', (r) => r.contractor_name ?? 'Direct labour'),
      col('present_count', 'Present', 'integer', (r) => r.present_count),
      col('half_day_count', 'Half days', 'integer', (r) => r.half_day_count),
      col('absent_count', 'Absent', 'integer', (r) => r.absent_count),
      col('days_present', 'Days', 'number', (r) => r.days_present),
      col('overtime_hours', 'Overtime hours', 'number', (r) => r.overtime_hours),
      col('earned', 'Earned', 'money', (r) => r.earned),
    ]),
    // The muster roll's grid: one narrow column per day, P / H / A as on the printed register.
    extraColumns: (query) =>
      eachDate(query.from, query.to).map((day) =>
        col<Awaited<ReturnType<ReportsService['attendanceRegister']>>['workers'][number]>(
          `day_${day}`,
          day.slice(5),
          'text',
          (r) => {
            const mark = r.days[day];
            if (!mark) return null;
            const letter = mark.status === 'present' ? 'P' : mark.status === 'half_day' ? 'H' : 'A';
            return Number(mark.overtime_hours) > 0 ? `${letter}+${mark.overtime_hours}` : letter;
          },
          { width: 7 },
        ),
      ),
    load: async (get, actor, query) => (await get(ReportsService).attendanceRegister(actor, query)).workers,
  }),
  source({
    kind: 'wage_sheet',
    title: 'Wage sheet',
    permissions: ['wages.view'],
    module: 'labour',
    query: z.object({ wage_period_id: uuidSchema }),
    columns: columnsOf<Awaited<ReturnType<ReportsService['wageSheet']>>['rows'][number]>((col) => [
      col('serial', 'No.', 'integer', (r) => r.serial),
      col('name', 'Worker', 'text', (r) => r.name, { width: 24 }),
      col('trade', 'Trade', 'text', (r) => r.trade),
      col('phone', 'Phone', 'text', (r) => phone(r.phone)),
      col('days', 'Days', 'number', (r) => r.days),
      col('overtime_hours', 'Overtime hours', 'number', (r) => r.overtime_hours),
      col('gross', 'Gross', 'money', (r) => r.gross),
      col('advances', 'Advances', 'money', (r) => r.advances),
      col('net', 'Net payable', 'money', (r) => r.net),
      col('paid', 'Paid', 'money', (r) => r.paid),
      col('signature', 'Signature', 'text', () => null, { width: 18 }),
    ]),
    load: async (get, actor, query) => (await get(ReportsService).wageSheet(actor, query.wage_period_id)).rows,
  }),
  source({
    kind: 'person_ledger',
    title: 'People',
    permissions: ['reports.people'],
    module: 'labour',
    query: personLedgerQuerySchema,
    columns: columnsOf<Awaited<ReturnType<ReportsService['personLedger']>>['people'][number]>((col) => [
      col('name', 'Name', 'text', (r) => r.name, { width: 24 }),
      col('role', 'Role', 'text', (r) => label(r.role)),
      col('expenses_approved', 'Expenses approved', 'money', (r) => r.expenses_approved),
      col('expenses_pending', 'Expenses pending', 'money', (r) => r.expenses_pending),
      col('expenses_rejected', 'Expenses rejected', 'money', (r) => r.expenses_rejected),
      col('committed', 'Committed', 'money', (r) => r.committed),
      col('indents_raised', 'Indents raised', 'integer', (r) => r.indents_raised),
      col('labour_booked', 'Labour booked', 'money', (r) => r.labour_booked),
      col('days_booked', 'Days booked', 'number', (r) => r.days_booked),
      col('roll_calls', 'Roll calls', 'integer', (r) => r.roll_calls),
      col('reports_filed', 'Reports filed', 'integer', (r) => r.reports_filed),
    ]),
    load: async (get, actor, query) => (await get(ReportsService).personLedger(actor, query)).people,
  }),

  // --- the company -------------------------------------------------------------------------------
  source({
    kind: 'team',
    title: 'Team',
    permissions: ['team.manage', 'projects.manage', 'wages.view', 'audit.view'],
    query: z.object({}),
    columns: columnsOf<Awaited<ReturnType<TenantsService['listTeam']>>[number]>((col) => [
      col('name', 'Name', 'text', (r) => r.name, { width: 26 }),
      col('phone', 'Phone', 'text', (r) => phone(r.phone)),
      col('email', 'Email', 'text', (r) => r.email, { width: 26 }),
      col('role', 'Role', 'text', (r) => label(r.role)),
      col('status', 'Status', 'text', (r) => label(r.status)),
      col('last_login', 'Last signed in', 'datetime', (r) => r.last_login),
    ]),
    load: (get, actor) => get(TenantsService).listTeam(actor.tenantId),
  }),
  source({
    kind: 'camps',
    title: 'Camps',
    permissions: ['workers.view'],
    module: 'labour',
    query: campDayQuerySchema,
    columns: columnsOf<Awaited<ReturnType<CampsService['list']>>['camps'][number]>((col) => [
      col('name', 'Camp', 'text', (r) => r.name, { width: 26 }),
      col('address', 'Address', 'text', (r) => r.address, { width: 36 }),
      col('capacity', 'Capacity', 'integer', (r) => r.capacity),
      col('residents', 'Residents', 'integer', (r) => r.residents),
      col('on_site', 'On site today', 'integer', (r) => r.on_site),
      col('transport_note', 'Transport', 'text', (r) => r.transport_note, { width: 30 }),
    ]),
    load: async (get, actor, query) => (await get(CampsService).list(actor, query.date)).camps,
  }),
  source({
    kind: 'audit',
    title: 'Audit log',
    permissions: ['audit.view'],
    query: auditQuerySchema,
    columns: columnsOf<ListItem<AuditService, 'list'>>((col) => [
      col('created_at', 'When', 'datetime', (r) => r.created_at),
      col('actor', 'Who', 'text', (r) => nameOf(r.actor) ?? r.actor_type, { width: 22 }),
      col('actor_type', 'Actor type', 'text', (r) => r.actor_type),
      col('action', 'Action', 'text', (r) => r.action),
      col('entity', 'Entity', 'text', (r) => r.entity),
      col('entity_label', 'Record', 'text', (r) => r.entity_label, { width: 26 }),
      col('entity_id', 'Record ID', 'text', (r) => r.entity_id, { width: 38 }),
      col('changed_fields', 'Changed fields', 'text', (r) => r.changed_fields.join(' '), { width: 30 }),
      col('before', 'Before', 'text', (r) => (r.before ? JSON.stringify(r.before) : null), { width: 50 }),
      col('after', 'After', 'text', (r) => (r.after ? JSON.stringify(r.after) : null), { width: 50 }),
      col('ip', 'IP', 'text', (r) => r.ip),
    ]),
    load: (get, actor, query) =>
      allPages((cursor) => get(AuditService).list(actor, { ...query, limit: 200, cursor })),
  }),
] as unknown as ReadonlyArray<ExportSource<never, never>>;

export function exportSource(kind: string): ExportSource<unknown, unknown> | undefined {
  return EXPORT_SOURCES.find((candidate) => candidate.kind === kind) as ExportSource<unknown, unknown> | undefined;
}

export const EXPORT_KINDS = EXPORT_SOURCES.map((candidate) => candidate.kind);

