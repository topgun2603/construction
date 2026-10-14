import type {
  SafetyActionKind,
  SafetyActionStatus,
  SafetyIncidentStatus,
  SafetyIncidentType,
  SafetyObservationStatus,
  SafetyObservationType,
  SafetyPermitStatus,
  SafetyPermitType,
  SafetySeverity,
  SafetyChecklistItem,
} from '@sitebook/shared';

/** What the safety API (roadmap Phase 2, module 8) returns, as the web reads it. */

export interface SafetyPerson {
  id: string;
  name: string;
}

export interface SafetySiteRef {
  id: string;
  name: string;
}

export interface SafetyPhoto {
  id: string;
  purpose: 'evidence' | 'witness_statement' | 'closeout' | 'attendance';
  s3_key: string;
  caption: string | null;
  uploaded_by: SafetyPerson | null;
  created_at: string;
  /** Signed for an hour; null when storage is not configured. */
  url: string | null;
}

export interface SafetyAction {
  id: string;
  project_id: string;
  incident_id: string | null;
  observation_id: string | null;
  kind: SafetyActionKind;
  description: string;
  assignee: SafetyPerson | null;
  due_on: string | null;
  overdue: boolean;
  status: SafetyActionStatus;
  raised_on: string;
  raised_by: SafetyPerson | null;
  done_by: SafetyPerson | null;
  done_at: string | null;
  note: string | null;
}

export interface SafetyIncidentSummary {
  id: string;
  number: string;
  project: SafetySiteRef;
  occurred_at: string;
  occurred_on: string;
  type: SafetyIncidentType;
  severity: SafetySeverity;
  title: string;
  location: string | null;
  status: SafetyIncidentStatus;
  injured: number;
  open_actions: number;
  reported_by: SafetyPerson | null;
}

export interface SafetyIncidentDetail extends Omit<SafetyIncidentSummary, 'injured' | 'open_actions'> {
  occurred_local: string;
  description: string | null;
  immediate_action: string | null;
  root_cause_whys: string[];
  root_cause: string | null;
  lost_days: number | null;
  next_statuses: SafetyIncidentStatus[];
  recordable: boolean;
  serious: boolean;
  serious_notified_at: string | null;
  investigated_by: SafetyPerson | null;
  closed_by: SafetyPerson | null;
  closed_at: string | null;
  closure_note: string | null;
  people: Array<{
    id: string;
    worker_id: string | null;
    name: string;
    role: 'injured' | 'involved' | 'witness';
    body_part: string | null;
    injury_nature: string | null;
    statement: string | null;
  }>;
  actions: SafetyAction[];
  photos: SafetyPhoto[];
}

export interface SafetyPermitSummary {
  id: string;
  number: string;
  project: SafetySiteRef;
  type: SafetyPermitType;
  description: string;
  area: string;
  valid_from: string;
  valid_to: string;
  status: SafetyPermitStatus;
  expired: boolean;
  crew_count: number;
  requested_by: SafetyPerson | null;
  issuer: SafetyPerson | null;
  area_authority: SafetyPerson | null;
}

export interface SafetyPermitDetail extends Omit<SafetyPermitSummary, 'crew_count'> {
  precautions: string | null;
  checklist: SafetyChecklistItem[];
  checklist_complete: boolean;
  valid_from_local: string;
  valid_to_local: string;
  issued_at: string | null;
  area_authority_at: string | null;
  suspended_reason: string | null;
  closed_by: SafetyPerson | null;
  closed_at: string | null;
  close_note: string | null;
  expiry_alerted_at: string | null;
  crew: Array<{ worker_id: string; name: string; trade: string | null }>;
  photos: SafetyPhoto[];
}

export interface SafetyTalkSummary {
  id: string;
  project: SafetySiteRef;
  talk_date: string;
  topic: string;
  topic_key: string | null;
  presenter: SafetyPerson | null;
  duration_minutes: number;
  attendees: number;
  signed: number;
}

export interface SafetyTalkDetail extends Omit<SafetyTalkSummary, 'attendees' | 'signed'> {
  notes: string | null;
  created_by: SafetyPerson | null;
  attendees: Array<{ worker_id: string; name: string; trade: string | null; signed_at: string | null }>;
  photos: SafetyPhoto[];
}

export interface SafetyRoll {
  date: string;
  items: Array<{ worker_id: string; name: string; trade: string | null; status: string }>;
}

export interface SafetyCoverage {
  week_from: string;
  week_to: string;
  talks: number;
  sites: Array<{
    project_id: string;
    project_name: string;
    talks: number;
    attendees: number;
    on_roll: number;
    coverage_percent: number | null;
    last_talk_on: string | null;
  }>;
}

export interface SafetyObservationSummary {
  id: string;
  number: string;
  project: SafetySiteRef;
  observed_at: string;
  observed_on: string;
  type: SafetyObservationType;
  category: string;
  severity: SafetySeverity;
  description: string;
  location: string | null;
  status: SafetyObservationStatus;
  suggested_by: 'ai' | 'rules' | null;
  open_actions: number;
  photos: number;
  reported_by: SafetyPerson | null;
}

export interface SafetyObservationDetail extends Omit<SafetyObservationSummary, 'open_actions' | 'photos'> {
  observed_local: string;
  transcript: string | null;
  closed_by: SafetyPerson | null;
  closed_at: string | null;
  close_note: string | null;
  actions: SafetyAction[];
  photos: SafetyPhoto[];
}

export interface SafetySuggestionResult {
  type: SafetyObservationType;
  category: string;
  severity: SafetySeverity;
  source: 'ai' | 'rules';
}

export interface SafetySiteFigures {
  project_id: string;
  project_name: string;
  status: string;
  man_hours: number;
  lti_count: number;
  recordable_count: number;
  ltifr: number | null;
  trir: number | null;
  last_lti_on: string | null;
  has_lti: boolean;
  days_since_lti: number | null;
  open_incidents: number;
  open_actions: number;
  overdue_actions: number;
  open_observations: number;
  active_permits: number;
}

export interface SafetyKpis {
  from: string;
  to: string;
  today: string;
  shift_hours: number;
  man_hours: number;
  lti_count: number;
  recordable_count: number;
  ltifr: number | null;
  trir: number | null;
  last_lti_on: string | null;
  days_since_lti: number | null;
  incidents_by_type: Record<SafetyIncidentType, number>;
  open_incidents: number;
  observations: {
    total: number;
    open: number;
    by_type: Record<SafetyObservationType, number>;
    by_category: Record<string, number>;
  };
  actions: { open: number; overdue: number; by_age: Record<'0_7' | '8_30' | '31_90' | '90_plus', number> };
  permits: { requested: number; active: number; suspended: number; expired_open: number };
  toolbox_talks: number;
  sites: SafetySiteFigures[];
}
