/**
 * Shapes of the data export and deletion API (Settings → Company), as the web app reads them.
 * The API is the source of truth; these mirror its responses.
 */

export interface DataExportItem {
  id: string;
  status: 'queued' | 'running' | 'ready' | 'failed' | 'expired';
  requested_by_user_id: string;
  requested_by_name: string | null;
  size_bytes: number | null;
  error: string | null;
  created_at: string;
  finished_at: string | null;
  expires_at: string | null;
  tables: number | null;
  files: number | null;
}

export interface DataExportList {
  items: DataExportItem[];
  can_request: boolean;
  blocked_reason: 'running' | 'cooldown' | null;
  next_allowed_at: string | null;
  link_days: number;
  cooldown_hours: number;
}

export interface DeletionRequestView {
  id: string;
  status: 'pending' | 'cancelled';
  requested_at: string;
  requested_by_name: string | null;
  purge_after: string;
  cancelled_at: string | null;
  cancelled_by_name: string | null;
  platform_action: string | null;
}

export interface CompanyDeletionStatus {
  company_name: string;
  status: string;
  grace_days: number;
  pending: DeletionRequestView | null;
  history: DeletionRequestView[];
  reauth: { within_minutes: number; signed_in_at: string | null; fresh: boolean };
  mfa: { required: boolean; shown: boolean };
}

export interface LegalAcceptanceView {
  document: string;
  version: string;
  accepted_by_name: string;
  accepted_at: string;
}

export interface LegalOverview {
  dpa: {
    version: string;
    url: string | null;
    accepted: LegalAcceptanceView | null;
    can_accept: boolean;
  };
  history: LegalAcceptanceView[];
}

export interface PersonSearchRow {
  kind: 'worker' | 'user';
  id: string;
  name: string;
  phone: string | null;
  status: string;
  former: boolean;
  anonymised: boolean;
}
