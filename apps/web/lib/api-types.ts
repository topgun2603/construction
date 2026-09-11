/**
 * Response shapes from the API.
 *
 * Money arrives as a decimal string of paise (ADR 0003) and `numeric(4,1)` values
 * as one-decimal strings — both are kept as strings here so nothing is parsed into
 * a float on the way through.
 */

export interface Page<T> {
  items: T[];
  next_cursor: string | null;
}

export interface ProjectSummary {
  id: string;
  name: string;
  client_name: string | null;
  address: string | null;
  lat: number | null;
  lng: number | null;
  start_date: string | null;
  target_end_date: string | null;
  budget_amount: string | null;
  status: string;
}

export interface ProjectListItem extends ProjectSummary {
  /** Signed photo URLs for the card carousel, the chosen cover first. */
  covers: Array<{ id: string; url: string }>;
  photo_count: number;
}

export interface DashboardSite extends ProjectSummary {
  /** Labour plus expenses this month — the design's spend-vs-budget number. */
  spend_month: string;
  expenses_month: string;
  dpr_status: 'submitted' | 'draft' | 'missing';
  dpr_submitted_at: string | null;
  dpr_has_issues: boolean;
  headcount_today: number;
  labour_cost_week: string;
  labour_cost_month: string;
  pending_indents: number;
  urgent_indents: number;
}

export interface DashboardOverview {
  date: string;
  /** Last 7 days including today, zeros included. */
  headcount_series: Array<{ date: string; count: number }>;
  totals: {
    site_count: number;
    dprs_in: number;
    headcount_today: number;
    labour_cost_month: string;
    labour_cost_week: string;
    pending_indents: number;
    urgent_indents: number;
    budget_committed: string;
    expenses_month: string;
    pending_expenses: number;
    spend_month: string;
  };
  sites: DashboardSite[];
}

export interface DashboardToday {
  date: string;
  reports: Array<{
    id: string;
    project_id: string;
    project_name: string;
    status: string;
    work_done: string | null;
    issues: string | null;
    submitted_at: string | null;
    submitted_by: string;
    headcount: number;
    reported_manpower: number;
    photo_count: number;
  }>;
  approvals: Array<{
    id: string;
    project_id: string;
    project_name: string;
    urgency: string;
    notes: string | null;
    requested_by: string;
    created_at: string;
    summary: string;
  }>;
}

export interface Contractor {
  id: string;
  name: string;
  trade: string | null;
  phone: string | null;
  payment_terms: string;
  worker_count: number;
}

export interface Worker {
  id: string;
  name: string;
  phone: string | null;
  trade: string | null;
  skill_level: string;
  status: string;
  contractor_id: string | null;
  contractor_name: string | null;
  daily_wage: string;
  overtime_rate_per_hour: string;
  photo_s3_key: string | null;
  client_id: string | null;
}

export interface AttendanceRow {
  id: string;
  worker_id: string;
  worker_name: string;
  contractor_id: string | null;
  contractor_name: string | null;
  trade: string | null;
  status: 'present' | 'half_day' | 'absent';
  overtime_hours: string;
  wage_snapshot: string;
  overtime_rate_snapshot: string;
  earned: string;
  client_id: string | null;
}

export interface AttendanceDay {
  project_id: string;
  attendance_date: string;
  locked: boolean;
  total_earned: string;
  present_count: number;
  half_day_count: number;
  items: AttendanceRow[];
}

export interface WagePeriod {
  id: string;
  contractor_id: string | null;
  contractor_name: string;
  period_start: string;
  period_end: string;
  status: 'open' | 'finalised' | 'paid';
  total_earned: string;
  total_advances: string;
  total_paid: string;
  line_count: number;
  /** `scheduled` when the nightly job drafted it rather than a person. */
  source: string;
}

export interface WageLine {
  id: string;
  worker_id: string;
  worker_name: string;
  trade: string | null;
  phone: string | null;
  days_present: string;
  overtime_hours: string;
  gross_amount: string;
  advances_deducted: string;
  net_payable: string;
  paid_amount: string;
  outstanding: string;
  note: string | null;
}

export type WagePeriodDetail = WagePeriod & { lines: WageLine[] };

export interface LabourPayment {
  id: string;
  type: 'advance' | 'wage' | 'bonus' | 'deduction';
  amount: string;
  paid_on: string;
  mode: string;
  worker_id: string | null;
  worker_name: string | null;
  contractor_id: string | null;
  contractor_name: string | null;
  project_id: string | null;
  wage_period_id: string | null;
  reference: string | null;
  note: string | null;
  client_id: string | null;
}

export interface Indent {
  id: string;
  project_id: string;
  project_name: string;
  status: 'requested' | 'approved' | 'rejected' | 'ordered' | 'received';
  urgency: 'low' | 'normal' | 'high';
  notes: string | null;
  required_by: string | null;
  requested_by: { id: string; name: string };
  approved_by: { id: string; name: string } | null;
  approved_at: string | null;
  created_at: string;
  items: Array<{
    id: string;
    material_id: string;
    material_name: string;
    unit: string;
    quantity: string;
    received_quantity: string;
  }>;
}

export interface Expense {
  id: string;
  project_id: string;
  project_name: string;
  amount: string;
  category: string;
  spent_on: string;
  bill_s3_key: string | null;
  note: string | null;
  status: 'pending' | 'approved' | 'rejected';
  submitted_by: { id: string; name: string };
  approved_by: { id: string; name: string } | null;
  approved_at: string | null;
  created_at: string;
  client_id: string | null;
}

export interface ExpenseSummary {
  from: string;
  to: string;
  group_by: 'category' | 'project';
  total: string;
  pending: string;
  groups: Array<{ key: string; label: string; amount: string; count: number }>;
}

export interface Material {
  id: string;
  name: string;
  unit: string;
  category: string | null;
}

export interface DailyReport {
  id: string;
  project_id: string;
  project_name: string;
  report_date: string;
  weather: string | null;
  work_done: string | null;
  issues: string | null;
  status: 'draft' | 'submitted';
  submitted_at: string | null;
  submitted_by: { id: string; name: string };
  headcount: number;
  activities: Array<{ id: string; activity: string; quantity: string | null; unit: string | null }>;
  manpower: Array<{ id: string; trade: string; count: number }>;
  photos: Array<{
    id: string;
    s3_key: string;
    thumb_s3_key: string | null;
    caption: string | null;
    taken_at: string | null;
  }>;
}

export interface LabourCostReport {
  from: string;
  to: string;
  group_by: 'project' | 'contractor' | 'worker';
  total: string;
  groups: Array<{
    key: string;
    label: string;
    days: string;
    overtime_hours: string;
    amount: string;
  }>;
}

export interface AttendanceRegister {
  from: string;
  to: string;
  /** Every calendar day in the range, so the grid has a column even for a blank day. */
  dates: string[];
  workers: Array<{
    worker_id: string;
    worker_name: string;
    trade: string | null;
    contractor_id: string | null;
    contractor_name: string | null;
    /** Keyed by ISO date. A day with no record is simply absent from the map. */
    days: Record<string, { status: string; overtime_hours: string; project_id: string }>;
    present_count: number;
    half_day_count: number;
    absent_count: number;
    days_present: string;
    overtime_hours: string;
    earned: string;
  }>;
  totals: {
    worker_count: number;
    days_present: string;
    overtime_hours: string;
    earned: string;
  };
}

export interface PersonLedger {
  from: string;
  to: string;
  people: Array<{
    user_id: string;
    name: string;
    phone: string;
    role: string;
    status: string;
    expenses_approved: string;
    expenses_pending: string;
    expenses_rejected: string;
    expense_count: number;
    indents_raised: number;
    indents_approved: number;
    labour_booked: string;
    days_booked: string;
    roll_calls: number;
    reports_filed: number;
    committed: string;
  }>;
  totals: {
    expenses_approved: string;
    expenses_pending: string;
    expenses_rejected: string;
    labour_booked: string;
    indents_raised: number;
    reports_filed: number;
  };
}

export interface WorkerLedger {
  worker: Worker;
  outstanding: string;
  total_earned: string;
  total_paid: string;
  entries: Array<{
    id: string;
    date: string;
    kind: 'attendance' | 'payment';
    label: string;
    earned: string;
    paid: string;
    balance: string;
    detail: Record<string, unknown>;
  }>;
}

export interface WageSheet {
  builder: string;
  wage_period_id: string;
  contractor: { id: string | null; name: string; phone: string | null };
  period_start: string;
  period_end: string;
  status: string;
  totals: { gross: string; advances: string; net: string; paid: string };
  rows: Array<{
    serial: number;
    worker_id: string;
    name: string;
    trade: string | null;
    phone: string | null;
    days: string;
    overtime_hours: string;
    gross: string;
    advances: string;
    net: string;
    paid: string;
  }>;
}

export interface TeamMember {
  id: string;
  name: string;
  phone: string;
  role: string;
  status: string;
  last_login: string | null;
}

export interface Tenant {
  id: string;
  name: string;
  logo_url: string | null;
  plan: string;
  enabled_modules: string[];
  status: string;
}

export interface ProjectMember {
  id: string;
  role_on_project: string;
  user: { id: string; name: string; phone: string; role: string; status: string };
}

export interface Milestone {
  id: string;
  name: string;
  planned_date: string | null;
  actual_date: string | null;
  sort_order: number;
}

export interface Role {
  id: string;
  name: string;
  base_role: string;
  permissions: string[];
  sees_all_projects: boolean;
  /** Built-in roles cannot be edited or deleted. */
  is_system: boolean;
  member_count: number;
}

export interface ScheduledJob {
  key: string;
  name: string;
  description: string;
  /** What it writes into your data, or null when it only sends something. */
  effect: string | null;
  cron: string;
  timezone: string;
  /** "7:00 pm every day", or null when the cron is not a plain daily pattern. */
  readable: string | null;
  next_run: string | null;
  enabled: boolean;
}

export interface AutomationSummary {
  timezone: string;
  jobs_enabled: boolean;
  jobs: ScheduledJob[];
}

export interface StockOnHandRow {
  material_id: string;
  material_name: string;
  unit: string;
  category: string | null;
  received: string;
  used: string;
  on_hand: string;
  /** The ledger says less than nothing is there, which needs investigating. */
  negative: boolean;
}

export interface StockOnHand {
  items: StockOnHandRow[];
  totals: { material_count: number };
}

export interface StockMovement {
  id: string;
  project_id: string;
  project_name: string;
  material_id: string;
  material_name: string;
  unit: string;
  type: 'in' | 'out';
  quantity: string;
  moved_on: string;
  /** Set when the row came from receiving an indent, so a GRN traces back to its order. */
  indent_id: string | null;
  ref: string | null;
  note: string | null;
  recorded_by: { id: string; name: string };
}

export interface MaterialEstimate {
  id: string;
  material_id: string;
  material_name: string;
  unit: string;
  category: string | null;
  estimated_quantity: string;
  note: string | null;
}

export interface MaterialOverrunRow {
  material_id: string;
  material_name: string;
  unit: string;
  estimated: string;
  received: string;
  consumed: string;
  /** Positive means over the estimate. */
  variance: string;
  over: boolean;
  /** Null when nothing was estimated — not the same as "0% used". */
  percent_used: number | null;
}

export interface MaterialOverrun {
  items: MaterialOverrunRow[];
  totals: { material_count: number; over_estimate: number };
}

export interface Billing {
  /** The plan that gates features. Differs from the subscription's while an upgrade is mid-checkout. */
  plan: string;
  status: 'none' | 'trialing' | 'active' | 'past_due' | 'cancelled';
  /** Paise per cycle. */
  amount: string;
  current_period_end: string | null;
  /** Set when cancellation was requested but the paid period has not run out. */
  cancel_at: string | null;
  last_failure_reason: string | null;
  checkout_url: string | null;
  /** False when this deployment has no Razorpay credentials. */
  billing_configured: boolean;
}

export interface BillingInvoice {
  id: string;
  amount: string;
  status: string;
  invoice_url: string | null;
  issued_at: string | null;
  paid_at: string | null;
}

export interface StartedSubscription {
  subscription_id: string;
  checkout_url: string | null;
  /** True when no Razorpay account is configured — the UI explains rather than pretending. */
  dry_run: boolean;
  plan: string;
  amount: string;
}

export interface ProjectMedia {
  id: string;
  kind: 'photo' | 'video';
  s3_key: string;
  thumb_s3_key: string | null;
  caption: string | null;
  /** Display order within the site, ascending. The first photo is the one the card leads with. */
  position: number;
  content_type: string;
  size_bytes: number;
  taken_at: string | null;
  created_at: string;
  uploaded_by: { id: string; name: string };
}

/** One message in a site's conversation. */
export interface MessagePerson {
  id: string;
  name: string;
  role: string;
}

export interface SiteMessage {
  id: string;
  body: string;
  audience: 'everyone' | 'team' | 'direct';
  created_at: string;
  author: MessagePerson;
  /** The one person a `direct` message was for; null on a broadcast. */
  recipient: MessagePerson | null;
  /** Written by the person reading it — what puts your own words on the right. */
  mine: boolean;
  /**
   * Whether Remove should be offered at all.
   *
   * Decided by the server, not by comparing timestamps here: a browser with a wrong clock would
   * otherwise show a button that fails, or hide one that would have worked.
   */
  can_delete: boolean;
  /** Who has seen it. Only ever populated on your own messages. */
  read_by: Array<{ id: string; name: string }>;
  attachments: Array<{
    id: string;
    content_type: string;
    size_bytes: number;
    /** What the file was called. Null for a photograph. */
    filename: string | null;
    caption: string | null;
    /** Whether it can be shown, or only offered for download. */
    is_image: boolean;
    /** Thumbnail where one exists, the original otherwise. */
    url: string | null;
    full_url: string | null;
  }>;
}

export interface SiteMessagePage {
  items: SiteMessage[];
  /** How much of this thread the reader has not seen. */
  unread_count: number;
  last_read_at: string | null;
  /** Timestamp to ask for what came before this page, or null at the start of the thread. */
  next_before: string | null;
}

export type DocumentCategory =
  | 'drawing'
  | 'contract'
  | 'approval'
  | 'permit'
  | 'invoice'
  | 'other';

/** A drawing, contract or approval — one revision of it. */
export interface SiteDocument {
  id: string;
  project_id: string | null;
  project_name: string | null;
  /** Groups every revision of the same document. */
  family_id: string;
  version: number;
  title: string;
  category: DocumentCategory;
  content_type: string;
  size_bytes: number;
  visible_to_client: boolean;
  created_at: string;
  uploaded_by: { id: string; name: string };
  url: string | null;
}
