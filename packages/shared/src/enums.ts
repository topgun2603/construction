/**
 * Domain enums. These mirror the Postgres enum types created in the Prisma
 * migrations — keep both sides in step (spec §7).
 */

/**
 * A plan's code.
 *
 * Just a string, because the catalogue is rows in `plans` rather than values in this file. What a
 * term costs, what it is called and how long it runs are commercial decisions — the sort made on a
 * phone call with a customer — and holding them here meant a migration and a deploy to change a
 * price.
 *
 * `PLAN_SEED_CODES` are the four the product shipped with. They are a starting catalogue and a
 * convenience for fixtures, **not** the set of valid values: an operator can add "two years" and
 * retire any of these.
 */
export type Plan = string;

export const PLAN_SEED_CODES = ['three_months', 'six_months', 'one_year', 'lifetime'] as const;

export const TENANT_STATUSES = ['active', 'suspended', 'cancelled'] as const;
export type TenantStatus = (typeof TENANT_STATUSES)[number];

export const USER_ROLES = [
  'owner',
  'project_manager',
  'site_supervisor',
  'accounts',
  'client',
] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const USER_STATUSES = ['pending', 'active', 'disabled'] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

export const PROJECT_STATUSES = ['planning', 'active', 'on_hold', 'completed'] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

export const PAYMENT_TERMS = ['weekly', 'fortnightly', 'monthly'] as const;
export type PaymentTerms = (typeof PAYMENT_TERMS)[number];

export const SKILL_LEVELS = ['unskilled', 'semi', 'skilled'] as const;
export type SkillLevel = (typeof SKILL_LEVELS)[number];

export const WORKER_STATUSES = ['active', 'inactive'] as const;
export type WorkerStatus = (typeof WORKER_STATUSES)[number];

export const DPR_STATUSES = ['draft', 'submitted'] as const;
export type DprStatus = (typeof DPR_STATUSES)[number];

export const ATTENDANCE_STATUSES = ['present', 'half_day', 'absent'] as const;
export type AttendanceStatus = (typeof ATTENDANCE_STATUSES)[number];

export const WAGE_PERIOD_STATUSES = ['open', 'finalised', 'paid'] as const;
export type WagePeriodStatus = (typeof WAGE_PERIOD_STATUSES)[number];

export const LABOUR_PAYMENT_TYPES = ['advance', 'wage', 'bonus', 'deduction'] as const;
export type LabourPaymentType = (typeof LABOUR_PAYMENT_TYPES)[number];

export const PAYMENT_MODES = ['cash', 'upi', 'bank'] as const;
export type PaymentMode = (typeof PAYMENT_MODES)[number];

export const INDENT_STATUSES = [
  'requested',
  'approved',
  'rejected',
  'ordered',
  'received',
] as const;
export type IndentStatus = (typeof INDENT_STATUSES)[number];

export const URGENCIES = ['low', 'normal', 'high'] as const;
export type Urgency = (typeof URGENCIES)[number];

export const SYNC_OPS = ['create', 'update'] as const;
export type SyncOp = (typeof SYNC_OPS)[number];

/** Roles that may approve indents and expenses (spec §2). */
export const APPROVER_ROLES: readonly UserRole[] = ['owner', 'project_manager'];

/** Roles that operate the wage ledger (spec §8A). */
export const ACCOUNTS_ROLES: readonly UserRole[] = ['owner', 'accounts'];
