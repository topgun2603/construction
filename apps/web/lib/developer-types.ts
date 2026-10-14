/**
 * Settings → Developers: what `/v1/developers/api-keys` and `/v1/developers/webhooks` answer.
 * Mirrors `ApiKeysService` and `WebhookEndpointsService` in the API.
 */

export interface ApiKeyView {
  id: string;
  name: string;
  /** `bk_live_…abcd` — enough to recognise, never enough to use. */
  hint: string;
  scopes: string[];
  allowed_cidrs: string[];
  expires_at: string | null;
  state: 'active' | 'expired' | 'revoked';
  created_by: { id: string; name: string | null };
  last_used_at: string | null;
  last_used_ip: string | null;
  revoked_at: string | null;
  created_at: string;
}

export interface ApiKeyList {
  /** False when the server has no API_KEY_PEPPER (production only). */
  configured: boolean;
  keys: ApiKeyView[];
}

export interface WebhookEndpointView {
  id: string;
  url: string;
  description: string | null;
  events: string[];
  secret_last4: string;
  status: 'active' | 'disabled';
  disabled_reason: 'failing' | 'owner' | null;
  disabled_at: string | null;
  consecutive_failures: number;
  last_success_at: string | null;
  last_failure_at: string | null;
  created_at: string;
}

export interface WebhookList {
  configured: boolean;
  endpoints: WebhookEndpointView[];
}

export interface WebhookAttemptView {
  attempt: number;
  status_code: number | null;
  ok: boolean;
  latency_ms: number;
  error: string | null;
  response_snippet: string | null;
  created_at: string;
}

export interface WebhookDeliveryView {
  id: string;
  status: 'pending' | 'sending' | 'succeeded' | 'failed';
  event: { id: string; type: string; created_at: string };
  attempt_count: number;
  max_attempts: number;
  next_attempt_at: string | null;
  last_status_code: number | null;
  last_error: string | null;
  last_latency_ms: number | null;
  delivered_at: string | null;
  resend_of_id: string | null;
  created_at: string;
  attempts: WebhookAttemptView[];
}

export interface WebhookDeliveryLog {
  data: WebhookDeliveryView[];
  next_cursor: string | null;
}

/** What a ping or a resend reports straight back. */
export interface WebhookDeliveryOutcome {
  delivery_id: string;
  status: 'succeeded' | 'pending' | 'failed' | 'skipped';
  attempt: number;
  status_code: number | null;
  latency_ms: number | null;
  error: string | null;
}
