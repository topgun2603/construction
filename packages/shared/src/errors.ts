/**
 * Error codes returned as `{ code, message, details? }` (spec §9).
 * Clients branch on `code`, never on the message text.
 */
export const ERROR_CODES = {
  UNAUTHENTICATED: 'UNAUTHENTICATED',
  INVALID_TOKEN: 'INVALID_TOKEN',
  TOKEN_EXPIRED: 'TOKEN_EXPIRED',
  FORBIDDEN: 'FORBIDDEN',
  MODULE_NOT_ENABLED: 'MODULE_NOT_ENABLED',
  PROJECT_NOT_ASSIGNED: 'PROJECT_NOT_ASSIGNED',
  NOT_FOUND: 'NOT_FOUND',
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  CONFLICT: 'CONFLICT',
  PERIOD_FINALISED: 'PERIOD_FINALISED',
  DUPLICATE_ATTENDANCE: 'DUPLICATE_ATTENDANCE',
  WORKER_OVERBOOKED: 'WORKER_OVERBOOKED',
  TENANT_SUSPENDED: 'TENANT_SUSPENDED',
  PLAN_EXPIRED: 'PLAN_EXPIRED',
  USER_PENDING: 'USER_PENDING',
  PHONE_ALREADY_REGISTERED: 'PHONE_ALREADY_REGISTERED',
  RATE_LIMITED: 'RATE_LIMITED',
  /** The company makes this person sign in through its identity provider ("Sign in with SSO"). */
  SSO_REQUIRED: 'SSO_REQUIRED',
  /**
   * The company requires a second factor and this session has not shown one. Everything answers
   * this except the enrol/verify endpoints; the web app routes to its two-factor screen.
   */
  MFA_REQUIRED: 'MFA_REQUIRED',
  /** The company's IP allow-list does not include the address this request came from. */
  IP_NOT_ALLOWED: 'IP_NOT_ALLOWED',
  /** The session passed the company's idle timeout or absolute lifetime. Sign in again. */
  SESSION_EXPIRED: 'SESSION_EXPIRED',
  /**
   * The company (or the operator, for every company) has turned this AI feature off. 403: the
   * request is understood and refused by policy — distinct from 409 with `details.ai =
   * 'not_configured'`, which means the deployment has no model key at all.
   */
  AI_DISABLED: 'AI_DISABLED',
  /**
   * The company is scheduled for deletion (grace period running). Nobody can use it except its owner,
   * and the owner only to see when it goes and to cancel; the web app routes to that screen.
   */
  TENANT_PENDING_DELETION: 'TENANT_PENDING_DELETION',
  /** The action needs a sign-in in the last few minutes (deleting the company). Sign in again. */
  REAUTH_REQUIRED: 'REAUTH_REQUIRED',
  INTERNAL: 'INTERNAL',
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

export interface ApiErrorBody {
  code: ErrorCode;
  message: string;
  details?: unknown;
}
