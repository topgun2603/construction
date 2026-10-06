import type { M365ConnectionStatus, M365EmailKind, MeetingActionStatus, MeetingStatus } from '@sitebook/shared';

/** One email sent (or tried) from the connected mailbox. */
export interface M365Delivery {
  id: string;
  kind: M365EmailKind;
  entity_type: string | null;
  entity_id: string | null;
  from: string;
  to: string[];
  cc: string[];
  subject: string;
  status: 'sent' | 'failed';
  provider_request_id: string | null;
  error: string | null;
  sent_at: string | null;
  created_at: string;
}

/** `GET /integrations/m365` — Settings → Integrations. */
export interface M365Overview {
  deployment: {
    configured: boolean;
    missing: string[];
    redirect_uri: string | null;
    scopes: string[];
  };
  connection: {
    status: M365ConnectionStatus;
    mailbox_email: string;
    mailbox_name: string | null;
    scopes: string[];
    calendar_sync: boolean;
    calendar_synced_at: string | null;
    calendar_events: number;
    last_error: string | null;
    last_used_at: string | null;
    connected_at: string;
    connected_by: { id: string; name: string } | null;
  } | null;
  recent_deliveries: M365Delivery[];
}

/** `GET /integrations/m365/status` — any member: may "Send by email" be offered? */
export interface M365Status {
  connected: boolean;
  mailbox: string | null;
}

export interface M365CalendarSync {
  created: number;
  updated: number;
  removed: number;
  unchanged: number;
  failed: number;
}

// --- meetings --------------------------------------------------------------------------------------

export interface MeetingSummary {
  id: string;
  project: { id: string; name: string };
  title: string;
  starts_at: string;
  ends_at: string;
  location: string | null;
  status: MeetingStatus;
  in_calendar: boolean;
  invite_sent_at: string | null;
  minutes_sent_at: string | null;
  attendee_count?: number;
  open_actions?: number;
}

export interface MeetingAttendee {
  id: string;
  user_id: string | null;
  name: string;
  email: string | null;
  external: boolean;
}

export interface MeetingActionItem {
  id: string;
  description: string;
  owner: { user_id: string | null; name: string } | null;
  due_on: string | null;
  status: MeetingActionStatus;
  overdue: boolean;
  completed_at: string | null;
}

export interface MeetingDetail extends MeetingSummary {
  agenda: string | null;
  minutes: string | null;
  created_by: { id: string; name: string };
  attendees: MeetingAttendee[];
  action_items: MeetingActionItem[];
  emails: M365Delivery[];
}
