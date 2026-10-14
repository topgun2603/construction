/**
 * How the audit log names things. The log stores table and column names, which are exact but
 * unreadable to an owner; this is the one place they become words.
 *
 * Anything missing here falls back to the table name with underscores turned to spaces, so a table
 * added later still reads tolerably before somebody names it.
 */
export const ENTITY_LABELS: Record<string, string> = {
  tenants: 'Company',
  roles: 'Role',
  users: 'Team member',
  projects: 'Site',
  project_members: 'Site assignment',
  milestones: 'Milestone',
  contractors: 'Contractor',
  workers: 'Worker',
  worker_projects: 'Worker on site',
  worker_documents: 'Worker document',
  camps: 'Camp',
  daily_reports: 'Daily report',
  dpr_activities: 'Report activity',
  dpr_photos: 'Report photo',
  dpr_manpower: 'Report manpower',
  attendance: 'Attendance',
  wage_periods: 'Wage period',
  wage_lines: 'Wage line',
  labour_payments: 'Labour payment',
  materials: 'Material',
  material_indents: 'Indent',
  indent_items: 'Indent item',
  material_estimates: 'Material estimate',
  stock_movements: 'Stock movement',
  expenses: 'Expense',
  project_media: 'Site photo',
  site_messages: 'Message',
  site_message_attachments: 'Message attachment',
  documents: 'Document',
  payment_stages: 'Payment stage',
  client_payments: 'Client payment',
  approvals: 'Client approval',
  site_checks: 'Site check',
  subscriptions: 'Subscription',
  invoices: 'Invoice',
  audit_logs: 'Audit log',
  // Single sign-on and provisioning
  sso_connections: 'Single sign-on',
  sso_domains: 'Verified domain',
  scim_tokens: 'Provisioning token',
  scim_users: 'Provisioned person',
  scim_groups: 'Provider group',
  scim_group_members: 'Provider group member',
  scim_role_mappings: 'Group role mapping',
  // Two-factor, sessions and sign-in rules
  tenant_security_settings: 'Sign-in rules',
  user_sessions: 'Sign-in session',
  mfa_factors: 'Authenticator app',
  mfa_recovery_codes: 'Recovery code',
  // QA/QC
  quality_checklist_templates: 'Checklist',
  quality_checklist_items: 'Checklist line',
  quality_inspections: 'Inspection',
  quality_inspection_items: 'Inspection line',
  quality_inspection_signoffs: 'Inspection signature',
  quality_tests: 'Material test',
  snags: 'Snag',
  snag_photos: 'Snag photo',
  snag_events: 'Snag history',
  safety_incidents: 'Safety incident',
  safety_incident_people: 'Person in an incident',
  safety_actions: 'Safety action',
  safety_permits: 'Permit to work',
  safety_permit_crew: 'Permit crew',
  safety_toolbox_talks: 'Toolbox talk',
  safety_toolbox_attendees: 'Toolbox talk attendee',
  safety_observations: 'Safety observation',
  safety_photos: 'Safety photo',
  rfi_settings: 'RFI and submittal defaults',
  rfis: 'RFI',
  rfi_documents: 'RFI drawing reference',
  rfi_responses: 'RFI answer',
  rfi_attachments: 'RFI attachment',
  submittals: 'Submittal',
  submittal_revisions: 'Submittal revision',
  submittal_files: 'Submittal file',
  equipment: 'Machine',
  equipment_allocations: 'Machine on a site',
  equipment_logs: 'Machine daily log',
  equipment_fuel: 'Fuel issued to a machine',
  equipment_service_plans: 'Service plan',
  equipment_maintenance: 'Machine service or repair',
  equipment_documents: 'Machine document',
  equipment_hire_bookings: 'Booked hire invoice',
  accounting_settings: 'Accounting system',
  accounting_account_maps: 'Account mapping',
  accounting_export_batches: 'Export to accounts',
};

/** The entity filter: the tables people most often go looking through, in the order they think. */
export const ENTITY_FILTER_ORDER = [
  'workers',
  'attendance',
  'wage_periods',
  'labour_payments',
  'expenses',
  'material_indents',
  'stock_movements',
  'projects',
  'contractors',
  'users',
  'roles',
  'tenants',
  'documents',
  'client_payments',
  'payment_stages',
  'approvals',
  'worker_documents',
  'camps',
  'daily_reports',
  'materials',
  'milestones',
  // Quality: who signed an inspection, who closed a snag, whether a cube result changed.
  'quality_inspections',
  'quality_tests',
  'snags',
  // Which ledger money posts to, and every export to the accounting system.
  'accounting_account_maps',
  'accounting_export_batches',
];

export function entityLabel(entity: string): string {
  return ENTITY_LABELS[entity] ?? humanise(entity);
}

/** `daily_wage` → `Daily wage`. */
export function humanise(name: string): string {
  return name.replace(/[._]/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
}

/**
 * Columns holding money in minor units. Shown as money, because `15000` beside a daily wage reads
 * as fifteen thousand rupees when it is a hundred and fifty.
 */
const MONEY_COLUMN =
  /(^|_)(amount|wage|salary|allowance|payable|deducted|budget|spent|forecast|earned|advances|paid)(_|$)|_snapshot$|rate_per_hour$/;

export function isMoneyColumn(column: string): boolean {
  return MONEY_COLUMN.test(column) && !/(_pct|_bp|_at|_on|_id)$/.test(column);
}
