import type { Prisma } from '@prisma/client';
import { utcDateToIsoDate } from '@sitebook/shared';

/**
 * How each resource looks on the public API — and in webhook payloads, which reuse these so that an
 * `expense.created` event's `data.expense` is exactly what `GET /public/v1/expenses/{id}` returns.
 *
 * The rules, the same everywhere (and in the OpenAPI document):
 * - snake_case keys, like the rest of the API;
 * - money as an integer number of minor units (paise, fils, cents) with the company's `currency`
 *   beside it — never a float, never a formatted string;
 * - calendar dates as `YYYY-MM-DD`, moments as ISO 8601 UTC;
 * - only what an integration needs: no storage keys, no bank details, no internal bookkeeping.
 *
 * Amounts are converted with `Number()`: a construction company's figures are nowhere near 2^53
 * minor units (90 trillion rupees), so a JSON number is exact and what every client expects.
 */

function money(value: bigint | null): number | null {
  return value === null ? null : Number(value);
}

function day(value: Date | null): string | null {
  return value ? utcDateToIsoDate(value) : null;
}

function instant(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}

// --- projects (sites) ------------------------------------------------------------------------------

export const PUBLIC_PROJECT_SELECT = {
  id: true,
  name: true,
  clientName: true,
  address: true,
  lat: true,
  lng: true,
  status: true,
  startDate: true,
  targetEndDate: true,
  budgetAmount: true,
  contractValue: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.ProjectSelect;

export function publicProjectView(
  row: Prisma.ProjectGetPayload<{ select: typeof PUBLIC_PROJECT_SELECT }>,
  currency: string,
) {
  return {
    id: row.id,
    name: row.name,
    client_name: row.clientName,
    address: row.address,
    location: row.lat !== null && row.lng !== null ? { lat: row.lat, lng: row.lng } : null,
    status: row.status,
    start_date: day(row.startDate),
    target_end_date: day(row.targetEndDate),
    budget_amount: money(row.budgetAmount),
    contract_value: money(row.contractValue),
    currency,
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
  };
}

// --- workers ---------------------------------------------------------------------------------------

export const PUBLIC_WORKER_SELECT = {
  id: true,
  name: true,
  phone: true,
  trade: true,
  skillLevel: true,
  status: true,
  contractorId: true,
  payBasis: true,
  dailyWage: true,
  overtimeRatePerHour: true,
  basicSalary: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.WorkerSelect;

export function publicWorkerView(row: Prisma.WorkerGetPayload<{ select: typeof PUBLIC_WORKER_SELECT }>, currency: string) {
  return {
    id: row.id,
    name: row.name,
    phone: row.phone,
    trade: row.trade,
    skill_level: row.skillLevel,
    status: row.status,
    contractor_id: row.contractorId,
    pay_basis: row.payBasis,
    daily_wage: money(row.dailyWage),
    overtime_rate_per_hour: money(row.overtimeRatePerHour),
    basic_salary: money(row.basicSalary),
    currency,
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
  };
}

// --- attendance ------------------------------------------------------------------------------------

export const PUBLIC_ATTENDANCE_SELECT = {
  id: true,
  projectId: true,
  workerId: true,
  attendanceDate: true,
  status: true,
  overtimeHours: true,
  wageSnapshot: true,
  overtimeRateSnapshot: true,
  recordedAt: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.AttendanceSelect;

export function publicAttendanceView(
  row: Prisma.AttendanceGetPayload<{ select: typeof PUBLIC_ATTENDANCE_SELECT }>,
  currency: string,
) {
  return {
    id: row.id,
    project_id: row.projectId,
    worker_id: row.workerId,
    date: day(row.attendanceDate),
    status: row.status,
    overtime_hours: Number(row.overtimeHours),
    /** The day's wage as it stood when attendance was marked. */
    daily_wage: money(row.wageSnapshot),
    overtime_rate_per_hour: money(row.overtimeRateSnapshot),
    currency,
    recorded_at: row.recordedAt.toISOString(),
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
  };
}

// --- expenses --------------------------------------------------------------------------------------

export const PUBLIC_EXPENSE_SELECT = {
  id: true,
  projectId: true,
  amount: true,
  taxAmount: true,
  category: true,
  spentOn: true,
  note: true,
  supplierTaxId: true,
  status: true,
  approvedAt: true,
  createdAt: true,
  updatedAt: true,
  costCode: { select: { id: true, code: true, name: true } },
  submitter: { select: { id: true, name: true } },
  approver: { select: { id: true, name: true } },
} satisfies Prisma.ExpenseSelect;

export function publicExpenseView(row: Prisma.ExpenseGetPayload<{ select: typeof PUBLIC_EXPENSE_SELECT }>, currency: string) {
  return {
    id: row.id,
    project_id: row.projectId,
    amount: money(row.amount),
    tax_amount: money(row.taxAmount),
    currency,
    category: row.category,
    spent_on: day(row.spentOn),
    note: row.note,
    supplier_tax_id: row.supplierTaxId,
    status: row.status,
    cost_code: row.costCode,
    submitted_by: row.submitter,
    approved_by: row.approver,
    approved_at: instant(row.approvedAt),
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
  };
}

// --- purchase orders -------------------------------------------------------------------------------

export const PUBLIC_PURCHASE_ORDER_SELECT = {
  id: true,
  number: true,
  projectId: true,
  status: true,
  expectedOn: true,
  subtotal: true,
  taxTotal: true,
  total: true,
  submittedAt: true,
  approvedAt: true,
  sentAt: true,
  closedAt: true,
  cancelledAt: true,
  createdAt: true,
  updatedAt: true,
  vendor: { select: { id: true, name: true } },
} satisfies Prisma.PurchaseOrderSelect;

export const PUBLIC_PURCHASE_ORDER_LINE_SELECT = {
  id: true,
  description: true,
  unit: true,
  quantity: true,
  unitRate: true,
  taxRateBp: true,
  amount: true,
  taxAmount: true,
  receivedQuantity: true,
  materialId: true,
  costCodeId: true,
} satisfies Prisma.PurchaseOrderLineSelect;

export function publicPurchaseOrderView(
  row: Prisma.PurchaseOrderGetPayload<{ select: typeof PUBLIC_PURCHASE_ORDER_SELECT }>,
  currency: string,
  lines?: Array<Prisma.PurchaseOrderLineGetPayload<{ select: typeof PUBLIC_PURCHASE_ORDER_LINE_SELECT }>>,
) {
  return {
    id: row.id,
    number: row.number,
    project_id: row.projectId,
    vendor: row.vendor,
    status: row.status,
    expected_on: day(row.expectedOn),
    subtotal: money(row.subtotal),
    tax_total: money(row.taxTotal),
    total: money(row.total),
    currency,
    submitted_at: instant(row.submittedAt),
    approved_at: instant(row.approvedAt),
    sent_at: instant(row.sentAt),
    closed_at: instant(row.closedAt),
    cancelled_at: instant(row.cancelledAt),
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
    ...(lines
      ? {
          lines: lines.map((line) => ({
            id: line.id,
            description: line.description,
            unit: line.unit,
            // Quantities keep their three decimals as a string: a float would turn 0.1 m³ into 0.1000000001.
            quantity: line.quantity.toString(),
            received_quantity: line.receivedQuantity.toString(),
            unit_rate: money(line.unitRate),
            tax_rate_bp: line.taxRateBp,
            amount: money(line.amount),
            tax_amount: money(line.taxAmount),
            material_id: line.materialId,
            cost_code_id: line.costCodeId,
          })),
        }
      : {}),
  };
}

// --- daily reports ---------------------------------------------------------------------------------

export const PUBLIC_DAILY_REPORT_SELECT = {
  id: true,
  projectId: true,
  reportDate: true,
  status: true,
  weather: true,
  workDone: true,
  issues: true,
  submittedAt: true,
  createdAt: true,
  updatedAt: true,
  submitter: { select: { id: true, name: true } },
} satisfies Prisma.DailyReportSelect;

export function publicDailyReportView(row: Prisma.DailyReportGetPayload<{ select: typeof PUBLIC_DAILY_REPORT_SELECT }>) {
  return {
    id: row.id,
    project_id: row.projectId,
    date: day(row.reportDate),
    status: row.status,
    weather: row.weather,
    work_done: row.workDone,
    issues: row.issues,
    submitted_by: row.submitter,
    submitted_at: instant(row.submittedAt),
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
  };
}

// --- change orders ---------------------------------------------------------------------------------

export const PUBLIC_CHANGE_ORDER_SELECT = {
  id: true,
  projectId: true,
  number: true,
  revision: true,
  title: true,
  description: true,
  reason: true,
  status: true,
  raisedOn: true,
  costImpact: true,
  clientPrice: true,
  taxAmount: true,
  clientTotal: true,
  timeImpactDays: true,
  submittedAt: true,
  approvedAt: true,
  implementedAt: true,
  cancelledAt: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.ChangeOrderSelect;

export function publicChangeOrderView(
  row: Prisma.ChangeOrderGetPayload<{ select: typeof PUBLIC_CHANGE_ORDER_SELECT }>,
  currency: string,
) {
  return {
    id: row.id,
    project_id: row.projectId,
    number: row.number,
    revision: row.revision,
    title: row.title,
    description: row.description,
    reason: row.reason,
    status: row.status,
    raised_on: day(row.raisedOn),
    cost_impact: money(row.costImpact),
    client_price: money(row.clientPrice),
    tax_amount: money(row.taxAmount),
    client_total: money(row.clientTotal),
    currency,
    time_impact_days: row.timeImpactDays,
    submitted_at: instant(row.submittedAt),
    approved_at: instant(row.approvedAt),
    implemented_at: instant(row.implementedAt),
    cancelled_at: instant(row.cancelledAt),
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
  };
}

// --- RFIs ------------------------------------------------------------------------------------------

export const PUBLIC_RFI_SELECT = {
  id: true,
  projectId: true,
  number: true,
  subject: true,
  question: true,
  discipline: true,
  priority: true,
  status: true,
  raisedOn: true,
  dueOn: true,
  sentAt: true,
  answeredAt: true,
  closedAt: true,
  costImpact: true,
  scheduleImpact: true,
  addressedToCompany: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.RfiSelect;

export function publicRfiView(row: Prisma.RfiGetPayload<{ select: typeof PUBLIC_RFI_SELECT }>) {
  return {
    id: row.id,
    project_id: row.projectId,
    number: row.number,
    subject: row.subject,
    question: row.question,
    discipline: row.discipline,
    priority: row.priority,
    status: row.status,
    raised_on: day(row.raisedOn),
    due_on: day(row.dueOn),
    addressed_to_company: row.addressedToCompany,
    cost_impact: row.costImpact,
    schedule_impact: row.scheduleImpact,
    sent_at: instant(row.sentAt),
    answered_at: instant(row.answeredAt),
    closed_at: instant(row.closedAt),
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
  };
}
