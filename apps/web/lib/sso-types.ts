import type { SsoPreset, SsoProtocol } from '@sitebook/shared';

/** `GET /sso/settings` — Settings → Security → Single sign-on. */
export interface SsoSettings {
  deployment: { urls_configured: boolean; encryption_configured: boolean };
  /** Null when the deployment has not set API_PUBLIC_URL. */
  service_provider: {
    oidc_redirect_uri: string;
    saml_entity_id: string;
    saml_acs_url: string;
    saml_metadata_url: string;
    scim_base_url: string;
  } | null;
  connection: SsoConnectionView | null;
  domains: SsoDomainView[];
  scim_tokens: Array<{ id: string; hint: string; created_at: string; last_used_at: string | null }>;
  role_mappings: Array<{ id: string; group_name: string; role_id: string; role_name: string }>;
  /** Roles SSO may hand out — never an owner role. */
  roles: Array<{ id: string; name: string; base_role: string }>;
}

export interface SsoConnectionView {
  id: string;
  protocol: SsoProtocol;
  preset: SsoPreset;
  enabled: boolean;
  oidc_issuer: string | null;
  oidc_client_id: string | null;
  has_client_secret: boolean;
  oidc_scopes: string;
  saml_idp_entity_id: string | null;
  saml_idp_sso_url: string | null;
  saml_idp_certificate: string | null;
  saml_idp_metadata_url: string | null;
  jit_enabled: boolean;
  jit_role_id: string | null;
  enforce_sso: boolean;
  updated_at: string;
}

export interface SsoDomainView {
  id: string;
  domain: string;
  verified_at: string | null;
  last_checked_at: string | null;
  txt_name: string;
  txt_value: string;
}
