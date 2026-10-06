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

  /*
   * Cost codes and budgets. Viewing is the budget and the budget-vs-actual report — what a line was
   * priced at is the builder's margin, so it is not handed to everybody who records a diesel bill.
   * Picking a code when recording an expense needs only `expenses.record`.
   */
  'cost_codes.view',
  'cost_codes.manage',

  /*
   * Subcontracts and progress (RA) billing. Split along the decisions a job actually has: who sees
   * what a subcontract is worth (the margin again), who writes and changes them, who measures work
   * on site, who certifies a bill as owed, and who hands the money over.
   */
  'subcontracts.view',
  'subcontracts.manage',
  'subcontracts.measure',
  'subcontracts.certify',
  'subcontracts.pay',

  /*
   * Procurement (roadmap Phase 2, module 2): suppliers, quotes, purchase orders, goods received
   * and supplier invoices. Split along the decisions a company separates on purpose — the person
   * who raises an order should not be the only one who can approve it, the store keeper who signs
   * for a delivery need not see what it cost, and whoever matches the invoice is accounts.
   * How much a person may approve is an amount (Settings → Procurement), not a permission.
   */
  'vendors.manage',
  'procurement.view',
  'procurement.manage',
  'procurement.approve',
  'procurement.receive',
  'procurement.invoices',

  /*
   * Change orders (roadmap Phase 2, module 4): variations to the client's contract. Seeing one shows
   * its cost as well as its price — the margin — so viewing is its own permission. Approving is the
   * internal sign-off before anything is put in front of the client.
   */
  'change_orders.view',
  'change_orders.manage',
  'change_orders.approve',

  /*
   * QA/QC (roadmap Phase 2, module 7): inspections, material tests and snag lists. Split along who
   * does what on a real job — anyone running the site reads the quality record; supervisors and
   * engineers inspect, record tests and raise snags; the checklist library is a quality manager's
   * to write; and saying a snag is really fixed (or that it is not) is the one decision kept from
   * whoever fixed it.
   */
  'quality.view',
  'quality.inspect',
  'quality.manage',
  'quality.verify',

  /*
   * Scheduling (roadmap Phase 2, module 6). Reading the programme is for everybody running the job;
   * changing the plan — tasks, links, baselines, imports — is the planner's; reporting how far the
   * work has got and when it really started is the supervisor's, and does not let them move the plan.
   */
  'schedule.view',
  'schedule.manage',
  'schedule.progress',

  /*
   * Safety (HSE, roadmap Phase 2, module 8). Reporting is deliberately wide — anybody on a site who
   * sees a hazard or a near miss must be able to write it down, or it goes unreported. Managing is
   * the investigation, the close-out and signing permits to work, which is a competent person's job.
   */
  'safety.view',
  'safety.report',
  'safety.manage',

  /*
   * Bill of quantities (roadmap Phase 2, module 5): the client-side BOQ and the running bills raised
   * against it. Split along the same lines as subcontracts — who sees what the job is priced at, who
   * writes the BOQ, who measures on site, and who bills the client.
   */
  'boq.view',
  'boq.manage',
  'boq.measure',
  'boq.bill',

  /*
   * RFIs and submittals (roadmap Phase 2, module 9). Raising a question to the designer is a site
   * job, so a supervisor manages RFIs. Submittals are split three ways: who reads the log, who
   * prepares and sends them, and who may stamp a review on the record — usually the consultant
   * through their own link, but sometimes a manager recording what came back by hand.
   */
  'rfis.view',
  'rfis.manage',
  'submittals.view',
  'submittals.manage',
  'submittals.review',

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
  /*
   * Read the audit log: every change anybody made, with the before and after. Owner-only by
   * default — it shows salaries, payments and who touched them, which is exactly what makes it
   * worth having and exactly why it is not every manager's to browse.
   */
  'audit.view',
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
    group: 'Cost codes and budgets',
    items: [
      {
        permission: 'cost_codes.view',
        label: 'See budgets and the budget-vs-actual report',
        note: 'What each line was priced at. Anyone who records expenses can still pick a code.',
      },
      {
        permission: 'cost_codes.manage',
        label: 'Edit cost codes, budgets and templates',
      },
    ],
  },
  {
    group: 'Subcontracts',
    items: [
      {
        permission: 'subcontracts.view',
        label: 'See subcontracts, their bills and statements',
        note: 'What each subcontract is worth and what has been paid on it',
      },
      {
        permission: 'subcontracts.manage',
        label: 'Write subcontracts, their rates and variations',
      },
      {
        permission: 'subcontracts.measure',
        label: 'Measure work done for a running bill',
        note: 'Enter quantities and back-charges on a draft bill. Without “see subcontracts” the rates and amounts stay hidden.',
      },
      {
        permission: 'subcontracts.certify',
        label: 'Certify bills, approve variations and release retention',
        note: 'What a certified bill says is owed becomes cost on the site',
      },
      { permission: 'subcontracts.pay', label: 'Record payments to subcontractors' },
    ],
  },
  {
    group: 'Procurement',
    items: [
      { permission: 'vendors.manage', label: 'Add and edit suppliers' },
      {
        permission: 'procurement.view',
        label: 'See quotes and purchase orders',
        note: 'Includes the prices suppliers quoted',
      },
      {
        permission: 'procurement.manage',
        label: 'Ask for quotes and raise purchase orders',
      },
      {
        permission: 'procurement.approve',
        label: 'Approve purchase orders',
        note: 'Only up to their approval limit, set in Settings → Procurement. Owners have none.',
      },
      {
        permission: 'procurement.receive',
        label: 'Receive goods against a purchase order',
        note: 'Books the delivery into site stock',
      },
      {
        permission: 'procurement.invoices',
        label: 'Record and match supplier invoices',
        note: 'An approved invoice becomes an expense on the site',
      },
    ],
  },
  {
    group: 'Change orders',
    items: [
      {
        permission: 'change_orders.view',
        label: 'See change orders and the contract value',
        note: 'Shows what each change costs as well as what the client is charged',
      },
      {
        permission: 'change_orders.manage',
        label: 'Raise and edit change orders',
        note: 'Also sees the extra-work suggestions picked up from daily reports and messages',
      },
      {
        permission: 'change_orders.approve',
        label: 'Approve change orders before they go to the client',
        note: 'Nobody but an owner approves one they raised themselves',
      },
    ],
  },
  {
    group: 'Quality',
    items: [
      {
        permission: 'quality.view',
        label: 'See inspections, test results and snag lists',
      },
      {
        permission: 'quality.inspect',
        label: 'Run inspections, record tests and raise snags',
        note: 'Includes marking a snag fixed with its “after” photo',
      },
      {
        permission: 'quality.manage',
        label: 'Edit the checklist library',
      },
      {
        permission: 'quality.verify',
        label: 'Close or reopen fixed snags, and countersign inspections',
        note: 'The check on whoever did the fixing',
      },
    ],
  },
  {
    group: 'Schedule',
    items: [
      { permission: 'schedule.view', label: 'See the programme, critical path and look-ahead' },
      {
        permission: 'schedule.manage',
        label: 'Plan the schedule: tasks, links, baselines and imports',
      },
      {
        permission: 'schedule.progress',
        label: 'Report progress on tasks',
        note: 'Percent complete and actual start and finish dates. The plan itself stays as it is.',
      },
    ],
  },
  {
    group: 'Safety',
    items: [
      {
        permission: 'safety.view',
        label: 'See incidents, permits, toolbox talks and safety figures',
      },
      {
        permission: 'safety.report',
        label: 'Report incidents and observations, record toolbox talks, request permits',
        note: 'Give this to everybody on site: an unreported near miss is the next accident.',
      },
      {
        permission: 'safety.manage',
        label: 'Investigate and close incidents, issue and suspend permits',
        note: 'Signs permits to work as issuer or area authority',
      },
    ],
  },
  {
    group: 'Bill of quantities',
    items: [
      {
        permission: 'boq.view',
        label: 'See the BOQ, its rates and the bills to the client',
        note: 'What each item is priced at and what has been billed',
      },
      { permission: 'boq.manage', label: 'Import and edit the BOQ and the client’s billing terms' },
      {
        permission: 'boq.measure',
        label: 'Record measurements against BOQ items',
        note: 'Without “see the BOQ” the rates and amounts stay hidden.',
      },
      {
        permission: 'boq.bill',
        label: 'Raise, certify and invoice running bills to the client',
        note: 'An invoiced bill becomes an instalment in the payment schedule',
      },
    ],
  },
  {
    group: 'RFIs and submittals',
    items: [
      { permission: 'rfis.view', label: 'See RFIs and their answers' },
      {
        permission: 'rfis.manage',
        label: 'Raise, send, answer and close RFIs',
        note: 'Includes sending the designer a link to answer without an account',
      },
      { permission: 'submittals.view', label: 'See submittals and their reviews' },
      {
        permission: 'submittals.manage',
        label: 'Prepare, send and resubmit submittals',
      },
      {
        permission: 'submittals.review',
        label: 'Record a review outcome on a submittal',
        note: 'For a review that came back by email or by hand; consultants review through their link',
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
      {
        permission: 'audit.view',
        label: 'Read and export the audit log',
        note: 'Every change anybody made, including wages and payments',
      },
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
    // Running a job means owning its breakdown and its budget lines.
    'cost_codes.view',
    'cost_codes.manage',
    // Writes the subcontracts on their jobs, measures them and certifies the bills. Paying is the
    // books' — the same split as wages, where a manager sees the sheet and accounts pays it.
    'subcontracts.view',
    'subcontracts.manage',
    'subcontracts.measure',
    'subcontracts.certify',
    // Buying for the job is running the job — approving only up to the limit the owner sets.
    'vendors.manage',
    'procurement.view',
    'procurement.manage',
    'procurement.approve',
    'procurement.receive',
    // Pricing and agreeing changes with the client is running the job. Their own change orders still
    // need somebody else to approve them.
    'change_orders.view',
    'change_orders.manage',
    'change_orders.approve',
    // Quality on their jobs end to end, including the library and closing what was fixed.
    'quality.view',
    'quality.inspect',
    'quality.manage',
    'quality.verify',
    // The programme is the project manager's to write and keep.
    'schedule.view',
    'schedule.manage',
    'schedule.progress',
    // Runs safety on their jobs: investigates incidents and signs permits to work.
    'safety.view',
    'safety.report',
    'safety.manage',
    // The BOQ is the job's: the manager imports it, measures against it and bills the client on it.
    'boq.view',
    'boq.manage',
    'boq.measure',
    'boq.bill',
    // Questions to the designers and the approvals of what is built are the manager's to run.
    'rfis.view',
    'rfis.manage',
    'submittals.view',
    'submittals.manage',
    'submittals.review',
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
    // Signing for a delivery against the order is the same job as signing for it at all. What the
    // order cost is not theirs to see, so no `procurement.view`.
    'procurement.receive',
    'expenses.view',
    'expenses.record',
    // Measures the subcontractor's work on their own site for the running bill. Not the rates or
    // the bill's money: what a subcontract is worth is the margin, the same as a budget line.
    'subcontracts.measure',
    // Walks the floors: runs the pour card, records the cube results and raises snags — and marks
    // their own fixes done. Saying a fix is good enough to close stays with the manager.
    'quality.view',
    'quality.inspect',
    // Works to the programme and says how far it has got; re-planning it is the manager's.
    'schedule.view',
    'schedule.progress',
    // The person on site when something happens: reports it, records the morning toolbox talk and
    // asks for a permit. Signing their own permit is not theirs, so no `safety.manage`.
    'safety.view',
    'safety.report',
    // Measures the work against the BOQ on their own site; what it is billed at is not theirs to see.
    'boq.measure',
    // The person who finds the clash on site raises the RFI about it. Submittals they read, to
    // build to what was approved; preparing and stamping them is not theirs.
    'rfis.view',
    'rfis.manage',
    'submittals.view',
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
    // Reads the budget report because cost against budget is accounts' question too; setting the
    // budget is the job's, not the books'.
    'cost_codes.view',
    // Reads every subcontract account and pays the certified bills; certifying them is the job's.
    'subcontracts.view',
    'subcontracts.pay',
    // Matching the supplier's invoice to the order and the delivery is the books' job, and so is
    // keeping supplier tax numbers right. Approving the order itself is not.
    'vendors.manage',
    'procurement.view',
    'procurement.invoices',
    // Reads the register: an approved change order is money the client will be billed.
    'change_orders.view',
    // When the work happens is when the money goes out and comes in.
    'schedule.view',
    // Reads the BOQ and raises the client's bills on it, the same half of the ledger as receipts.
    'boq.view',
    'boq.bill',
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
