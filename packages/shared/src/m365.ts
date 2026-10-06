/**
 * Microsoft 365 email and calendar (roadmap Phase 3, "Calendar and email"), and site meetings with
 * minutes.
 *
 * A company connects one of its own mailboxes — projects@company.com, say — through Microsoft Graph,
 * and the product then sends RFIs, submittal reviews, change orders and meeting minutes *from that
 * mailbox*, and puts meetings (and, if asked, milestones and RFI due dates) in its calendar. Mail
 * from the address the consultant already deals with is read; mail from a product's robot address is
 * filtered.
 *
 * Everything here is named `m365…` / `meeting…` / `M365_…` / `MEETING_…` so it cannot collide with
 * the modules being built beside it.
 */

/**
 * The delegated Graph permissions asked for, and nothing more: send as the mailbox, write its
 * calendar, read who it is. `offline_access` is what returns a refresh token, so the product can
 * send at 8 a.m. when nobody is signed in. Deliberately not `Mail.Read` — the product never reads
 * anybody's inbox, and an app that could would be a far worse thing to have connected.
 */
export const M365_SCOPES = ['offline_access', 'Mail.Send', 'Calendars.ReadWrite', 'User.Read'] as const;

/** connected — usable. needs_reconnect — Microsoft refused the stored token; an owner must connect again. */
export const M365_CONNECTION_STATUSES = ['connected', 'needs_reconnect'] as const;
export type M365ConnectionStatus = (typeof M365_CONNECTION_STATUSES)[number];

/** What an email was for. Each is one row in `email_deliveries`, whatever happened to it. */
export const M365_EMAIL_KINDS = [
  'rfi_sent',
  'rfi_answered',
  'rfi_overdue',
  'submittal_review',
  'change_order_sent',
  'meeting_minutes',
] as const;
export type M365EmailKind = (typeof M365_EMAIL_KINDS)[number];

export const M365_EMAIL_KIND_LABELS: Record<M365EmailKind, string> = {
  rfi_sent: 'RFI sent',
  rfi_answered: 'RFI answered',
  rfi_overdue: 'RFIs overdue',
  submittal_review: 'Submittal for review',
  change_order_sent: 'Change order to the client',
  meeting_minutes: 'Meeting minutes',
};

/** What the calendar sync puts in the connected calendar, when the company switches it on. */
export const M365_CALENDAR_SOURCES = ['milestone', 'rfi_due'] as const;
export type M365CalendarSource = (typeof M365_CALENDAR_SOURCES)[number];

/**
 * Where a person sets the app up in Microsoft Entra, step by step. On the settings screen when the
 * deployment has not been configured, and repeated in the API's env documentation — kept here so
 * the two cannot drift.
 */
export const M365_SETUP_STEPS = [
  'Entra admin centre → App registrations → New registration. Supported account types: "Accounts in any organizational directory (Multitenant)".',
  'Redirect URI: platform "Web", the exact URL in MS_GRAPH_REDIRECT_URI (the web app’s /settings/integrations/microsoft/callback).',
  'API permissions → Add → Microsoft Graph → Delegated: offline_access, Mail.Send, Calendars.ReadWrite, User.Read. No application permissions.',
  'Certificates & secrets → New client secret. Put the Application (client) ID in MS_GRAPH_CLIENT_ID and the secret value in MS_GRAPH_CLIENT_SECRET.',
] as const;

// --- meetings --------------------------------------------------------------------------------------

/** scheduled → held (minutes written) | cancelled. */
export const MEETING_STATUSES = ['scheduled', 'held', 'cancelled'] as const;
export type MeetingStatus = (typeof MEETING_STATUSES)[number];

export const MEETING_STATUS_LABELS: Record<MeetingStatus, string> = {
  scheduled: 'Scheduled',
  held: 'Held',
  cancelled: 'Cancelled',
};

export const MEETING_ACTION_STATUSES = ['open', 'done'] as const;
export type MeetingActionStatus = (typeof MEETING_ACTION_STATUSES)[number];

/** An action item is overdue when it is still open after its due day, on the company's clock. */
export function meetingActionIsOverdue(
  status: MeetingActionStatus,
  dueOn: string | null,
  today: string,
): boolean {
  return status === 'open' && dueOn !== null && dueOn < today;
}

/**
 * Lower-cased, de-duplicated addresses, in the order first given. Outlook treats addresses as
 * case-insensitive, and the same person typed twice must not get the invite twice.
 */
export function m365UniqueEmails(addresses: ReadonlyArray<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of addresses) {
    const address = raw?.trim().toLowerCase();
    if (!address || seen.has(address)) continue;
    seen.add(address);
    out.push(address);
  }
  return out;
}
