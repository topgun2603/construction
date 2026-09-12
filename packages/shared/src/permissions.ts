import type { UserRole } from './enums';

/**
 * What a role is allowed to do.
 *
 * Permissions exist so an owner can invent a role the product did not ship with — a store
 * keeper who records stock but cannot approve spend, a quantity surveyor who reads every
 * report but touches nothing. The five built-in roles become presets over this same list
 * rather than a parallel system.
 *
 * Named `<subject>.<verb>` and deliberately coarse: one permission per decision a person
 * either can or cannot make. Finer granularity reads well on a checklist and then nobody
 * can tell what a role actually does.
 */
export const PERMISSIONS = [
  // Sites
  'projects.view',
  'projects.manage',
  'projects.delete',
  'milestones.manage',

  // Daily progress
  'dpr.view',
  'dpr.file',

  // Labour
  'workers.view',
  'workers.manage',
  'workers.delete',
  'contractors.manage',
  'contractors.delete',
  'attendance.view',
  'attendance.record',

  // Money owed to labour
  'wages.view',
  'wages.generate',
  'wages.finalise',
  'wages.pay',
  'payments.view',
  'payments.record',
  'payments.reconcile',

  // Materials
  'materials.manage',
  'stock.view',
  'stock.record',
  'estimates.manage',
  'indents.raise',
  'indents.approve',

  // Petty cash
  'expenses.view',
  'expenses.record',
  'expenses.approve',

  // Talking to the client
  'messages.post',
  'messages.internal',

  // Drawings, contracts, approvals
  'documents.view',
  'documents.manage',

  /*
   * What the client owes, and what they have paid.
   *
   * Separate from `expenses.*` and `payments.*`, which are money going *out* — to labour and to
   * suppliers. This is the money coming in, and the two lists must never be gated together: a
   * supervisor who records petty cash has no business knowing what the client still owes, and a
   * client must never reach the outgoing side at all.
   */
  'client_payments.view',
  'client_payments.manage',

  /*
   * Asking the client to sign off, and the signing off itself.
   *
   * Split deliberately. Requesting is a site action — a supervisor holds up a tile sample and asks.
   * Deciding is the answer, and the record names whoever gave it, which is the only thing that
   * makes an approval worth anything when somebody disputes it six months later.
   */
  'approvals.request',
  'approvals.decide',

  // Reporting
  'reports.view',
  'reports.people',

  // Running the account
  'team.manage',
  'roles.manage',
  'tenant.manage',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

const PERMISSION_SET = new Set<string>(PERMISSIONS);

export function isPermission(value: string): value is Permission {
  return PERMISSION_SET.has(value);
}

/**
 * Human labels, grouped the way the role editor shows them.
 *
 * Written as what the person can do, not as the table they can touch: "Approve material
 * indents" is checkable by an owner deciding who should do it; "indents.approve" is not.
 */
export const PERMISSION_GROUPS: ReadonlyArray<{
  group: string;
  items: ReadonlyArray<{ permission: Permission; label: string; note?: string }>;
}> = [
  {
    group: 'Sites',
    items: [
      { permission: 'projects.view', label: 'See sites they are assigned to' },
      { permission: 'projects.manage', label: 'Create and edit sites' },
      { permission: 'projects.delete', label: 'Archive a site' },
      { permission: 'milestones.manage', label: 'Edit the site timeline' },
    ],
  },
  {
    group: 'Daily progress',
    items: [
      { permission: 'dpr.view', label: 'Read daily reports' },
      { permission: 'dpr.file', label: 'File the daily report' },
    ],
  },
  {
    group: 'Labour',
    items: [
      { permission: 'workers.view', label: 'See the worker roster' },
      { permission: 'workers.manage', label: 'Add and edit workers' },
      { permission: 'workers.delete', label: 'Delete a worker' },
      { permission: 'contractors.manage', label: 'Add and edit contractors' },
      { permission: 'contractors.delete', label: 'Delete a contractor' },
      { permission: 'attendance.view', label: 'See attendance' },
      { permission: 'attendance.record', label: 'Take the roll call' },
    ],
  },
  {
    group: 'Wages',
    items: [
      { permission: 'wages.view', label: 'See wage sheets' },
      { permission: 'wages.generate', label: 'Generate a wage period' },
      {
        permission: 'wages.finalise',
        label: 'Finalise a wage period',
        note: 'Locks attendance for those dates',
      },
      { permission: 'wages.pay', label: 'Record wage payments' },
      { permission: 'payments.view', label: 'See advances and cash entries' },
      {
        permission: 'payments.record',
        label: 'Record an advance or bonus',
        note: 'Supervisors hand out advances on site',
      },
      {
        permission: 'payments.reconcile',
        label: 'Delete cash entries and see contractor balances',
      },
    ],
  },
  {
    group: 'Materials',
    items: [
      { permission: 'materials.manage', label: 'Edit the material catalogue' },
      { permission: 'stock.view', label: 'See site stock and what it has cost' },
      {
        permission: 'stock.record',
        label: 'Record material received or used',
        note: 'Receiving an indent books stock in automatically',
      },
      {
        permission: 'estimates.manage',
        label: 'Set how much a site should consume',
        note: 'What the overrun report measures against',
      },
      { permission: 'indents.raise', label: 'Raise a material indent' },
      { permission: 'indents.approve', label: 'Approve or reject indents' },
    ],
  },
  {
    group: 'Expenses',
    items: [
      { permission: 'expenses.view', label: 'See expenses' },
      { permission: 'expenses.record', label: 'Record an expense' },
      {
        permission: 'expenses.approve',
        label: 'Approve or reject expenses',
        note: 'Nobody can approve their own, whatever their role',
      },
    ],
  },
  {
    group: 'Client conversation',
    items: [
      { permission: 'messages.post', label: 'Write in the site conversation' },
      {
        permission: 'messages.internal',
        label: 'See and write team-only notes',
        note: 'Notes the client never sees. Without this, everything they write in the '
          + 'conversation is visible to the client.',
      },
    ],
  },
  {
    group: 'Documents',
    items: [
      { permission: 'documents.view', label: 'Open drawings and documents' },
      { permission: 'documents.manage', label: 'Upload, replace and remove documents' },
    ],
  },
  {
    group: 'Client billing',
    items: [
      {
        permission: 'client_payments.view',
        label: 'See what the client owes and has paid',
        note: 'Money coming in. Nothing to do with petty cash or wages, which go out.',
      },
      {
        permission: 'client_payments.manage',
        label: 'Set the payment schedule and record receipts',
      },
    ],
  },
  {
    group: 'Client approvals',
    items: [
      {
        permission: 'approvals.request',
        label: 'Ask the client to approve something',
        note: 'A drawing, a selection, a variation',
      },
      {
        permission: 'approvals.decide',
        label: 'Approve or reject on the record',
        note: 'The decision names whoever gave it. Give this to somebody standing in for the '
          + 'client only if a decision recorded in their name is meant to be yours.',
      },
    ],
  },
  {
    group: 'Reports',
    items: [
      { permission: 'reports.view', label: 'Labour cost and attendance reports' },
      {
        permission: 'reports.people',
        label: 'Per-person accountability report',
        note: 'Shows what each person spent and committed',
      },
    ],
  },
  {
    group: 'Account',
    items: [
      { permission: 'team.manage', label: 'Invite and remove people' },
      { permission: 'roles.manage', label: 'Create and edit roles' },
      { permission: 'tenant.manage', label: 'Change company details and plan' },
    ],
  },
];

/**
 * The five built-in roles, expressed as permission sets.
 *
 * These reproduce exactly what the `@Roles(...)` decorators allowed before permissions
 * existed, so converting the API changes no behaviour for anyone. Derived by reading every
 * decorator rather than by intuition about what each role "should" do — the presets are a
 * description of the product as shipped, not an improvement on it.
 *
 * `client` gets almost nothing: the client portal is Phase 3, and until it exists a client
 * account can sign in and see the sites it is attached to, nothing more.
 */
const SYSTEM_ROLE_PERMISSIONS: Record<UserRole, readonly Permission[]> = {
  // Everything, by definition. An owner who could be locked out of part of their own
  // account would have nobody to ask.
  owner: PERMISSIONS,

  project_manager: [
    'projects.view',
    'projects.manage',
    // Not projects.delete: archiving a site was owner-only before permissions existed.
    'milestones.manage',
    'dpr.view',
    'dpr.file',
    'workers.view',
    'workers.manage',
    'workers.delete',
    'contractors.manage',
    // Not contractors.delete: owner-only before.
    'attendance.view',
    'attendance.record',
    'wages.view',
    'payments.view',
    'payments.record',
    'materials.manage',
    'stock.view',
    'stock.record',
    'estimates.manage',
    'indents.raise',
    'indents.approve',
    'expenses.view',
    'expenses.record',
    'expenses.approve',
    'messages.post',
    'messages.internal',
    'documents.view',
    'documents.manage',
    // Sees what the client owes, because chasing it is part of running the job. Setting the
    // schedule and receipting the money is accounts' work, not theirs.
    'client_payments.view',
    'approvals.request',
    'reports.view',
  ],

  site_supervisor: [
    'projects.view',
    'dpr.view',
    'dpr.file',
    'workers.view',
    'attendance.view',
    'attendance.record',
    // Supervisors hand out advances at the gate (spec §8A), so this is theirs — but
    // payments.view is not: the site ledger is not a supervisor's to read.
    'payments.record',
    'indents.raise',
    // The store is the supervisor's job: they sign for what arrives and issue what is used.
    // Setting the estimate is not — that is the figure their consumption is judged against.
    'stock.view',
    'stock.record',
    'expenses.view',
    'expenses.record',
    'messages.post',
    'messages.internal',
    // Reads the drawings they are building from; revising them is not a site decision.
    'documents.view',
    // Holding up a tile sample and asking "this one?" is the most ordinary thing on a site. What
    // the client owes is none of their business, so no `client_payments.view` comes with it.
    'approvals.request',
  ],

  // The money roles: everything about paying people, nothing about running a site.
  accounts: [
    'projects.view',
    'dpr.view',
    'workers.view',
    'workers.manage',
    // Not workers.delete: that was owner and project manager only.
    'contractors.manage',
    'attendance.view',
    'wages.view',
    'wages.generate',
    'wages.finalise',
    'wages.pay',
    'payments.view',
    'payments.record',
    'payments.reconcile',
    // Reads stock because material cost lands on the books, but does not move it.
    'stock.view',
    'expenses.view',
    'expenses.record',
    'expenses.approve',
    'messages.post',
    'messages.internal',
    'documents.view',
    // The money coming in is accounts' half of the ledger, the same as the money going out.
    'client_payments.view',
    'client_payments.manage',
    'reports.view',
    'reports.people',
  ],

  /*
   * Read-only, and narrower than before. Until permissions existed, `client` could reach
   * every route with no `@Roles` decorator — recording an expense or an advance among
   * them. Nothing in the product intended that; the gating simply had no way to say
   * "everyone except the customer". This is the one place the conversion deliberately
   * takes access away.
   */
  /*
   * The client is no longer only a reader.
   *
   * They can write in the site conversation and open the documents somebody deliberately shared
   * with them — and nothing else. Notably not `messages.internal`: the team's notes about a job are
   * not part of what a client bought. The one-way portal this replaced sent every real question to
   * WhatsApp, where it left no record against the site.
   */
  /*
   * `client_payments.view` is what they owe, never what the job costs to build. The two are
   * different tables for exactly this reason — the margin is the difference between them, and it is
   * not the client's to read.
   *
   * `approvals.decide` is the one thing on this list only they should really be doing.
   */
  client: [
    'projects.view',
    'dpr.view',
    'messages.post',
    'documents.view',
    'client_payments.view',
    'approvals.decide',
  ],
};

export function permissionsForSystemRole(role: UserRole): readonly Permission[] {
  return SYSTEM_ROLE_PERMISSIONS[role] ?? [];
}

/**
 * Whether a role sees the whole tenant or only its assigned projects.
 *
 * Owners and accounts are tenant-wide: an owner supervises everything, and a wage sheet
 * cannot be assembled from a subset of the sites a worker was on. Everyone else is scoped
 * to their assignments, which is enforced by `ProjectAccess`, not by this flag alone.
 */
export function systemRoleSeesAllProjects(role: UserRole): boolean {
  return role === 'owner' || role === 'accounts';
}

/** Built-in role descriptions, shown beside each preset in the role editor. */
export const SYSTEM_ROLE_NOTES: Record<UserRole, string> = {
  owner: 'Full control, including billing and roles. Cannot be restricted.',
  project_manager: 'Runs sites: approves indents and expenses, manages workers.',
  site_supervisor: 'On site: files the daily report, takes the roll call, raises indents.',
  accounts: 'Money: wage periods, payments, expense approval, reports.',
  client: 'Their own sites: progress, photos, shared documents, and the conversation.',
};
