import type { SecurityIpMode, SecurityMfaPolicy, TokenPair, UserRole } from '@sitebook/shared';

/** `GET /security/settings` — Settings → Security, the rules beside single sign-on. */
export interface SecuritySettings {
  deployment: {
    /** MFA_ENCRYPTION_KEY is set, so people can enrol an authenticator. */
    mfa_configured: boolean;
    /** The web server passes browsers' addresses on (WEB_CLIENT_IP_SECRET on both sides). */
    client_ip_forwarding: boolean;
  };
  /** The address the API sees for you right now. */
  current_ip: string;
  mfa: { policy: SecurityMfaPolicy; trust_idp_mfa: boolean; sso_enabled: boolean };
  sessions: { idle_timeout_minutes: number | null; absolute_lifetime_hours: number | null };
  ip: {
    mode: SecurityIpMode;
    rules: Array<{ cidr: string; label: string }>;
    exempt_owners: boolean;
    exempt_roles: UserRole[];
    current_ip_allowed: boolean;
  };
  /** The owner looking at the page. */
  me: { enrolled: boolean; session_verified: boolean };
  /** Base roles that can be exempted from the allow-list. */
  roles: UserRole[];
  updated_at: string | null;
}

/** One signed-in session — `GET /auth/sessions`, and per person in `GET /security/sessions`. */
export interface SessionView {
  id: string;
  method: 'phone' | 'email' | 'sso';
  client: 'web' | 'app';
  user_agent: string | null;
  ip: string | null;
  started_at: string;
  last_active_at: string;
  two_factor: boolean;
  current: boolean;
}

export interface CompanySessions {
  items: Array<{ user_id: string; name: string; role: string; role_name: string; sessions: SessionView[] }>;
}

/** `GET /auth/mfa`. */
export interface MfaStatus {
  required: boolean;
  enrolled: boolean;
  session_verified: boolean;
  recovery_codes_left: number;
  locked_until: string | null;
  configured: boolean;
  user_name: string;
  company_name: string;
}

export interface MfaEnrolment {
  secret: string;
  otpauth_uri: string;
}

export interface MfaConfirmed {
  recovery_codes: string[];
  tokens: TokenPair | null;
}
