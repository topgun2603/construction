import { HttpStatus, Injectable } from '@nestjs/common';
import { ERROR_CODES } from '@sitebook/shared';
import { env } from '../../config/env';
import { FieldCipher } from '../../common/crypto/field-cipher';
import { ApiError } from '../../common/errors/api-error';

/**
 * The deployment half of single sign-on: the public URLs an identity provider is told to send
 * people back to, and the key client secrets are encrypted under.
 *
 * Every URL is built from `API_PUBLIC_URL` and nothing from the request. A `Host` header is
 * whatever the caller typed, and an ACS URL or redirect URI derived from it would let a crafted
 * request choose where a provider's answer is checked against.
 */
@Injectable()
export class SsoConfigService {
  private readonly config = env();
  private cipherInstance: FieldCipher | null = null;

  /** True when the API knows its own public URL and the web app's — SSO cannot work without both. */
  get urlsConfigured(): boolean {
    return Boolean(this.config.API_PUBLIC_URL && this.config.WEB_BASE_URL);
  }

  get encryptionConfigured(): boolean {
    return Boolean(this.config.SSO_ENCRYPTION_KEY);
  }

  /** http:// issuers and metadata URLs are allowed outside production, for local mock providers. */
  get allowsInsecureUrls(): boolean {
    return this.config.NODE_ENV !== 'production';
  }

  private get apiBase(): string {
    const base = this.config.API_PUBLIC_URL;
    if (!base) throw notConfigured();
    return `${base.replace(/\/+$/, '')}/v1`;
  }

  /** One redirect URI for every company — the `state` says which company the answer is for. */
  get oidcRedirectUri(): string {
    return `${this.apiBase}/auth/sso/oidc/callback`;
  }

  /**
   * Per company, so one company's SAML audience can never satisfy another's. Doubles as the URL the
   * SP metadata is served from, which is the convention most providers expect of an entity id.
   */
  samlEntityId(tenantId: string): string {
    return `${this.apiBase}/auth/sso/saml/${tenantId}/metadata`;
  }

  samlAcsUrl(tenantId: string): string {
    return `${this.apiBase}/auth/sso/saml/${tenantId}/acs`;
  }

  get scimBaseUrl(): string {
    return `${this.apiBase}/scim/v2`;
  }

  /** The web page that finishes a sign-in. The ticket or error travels in the fragment. */
  get webCallbackUrl(): string {
    const base = this.config.WEB_BASE_URL;
    if (!base) throw notConfigured();
    return `${base.replace(/\/+$/, '')}/sso/callback`;
  }

  /** Every URL the settings screen shows, or null when the deployment has not set them up. */
  serviceProviderUrls(tenantId: string) {
    if (!this.config.API_PUBLIC_URL) return null;
    return {
      oidc_redirect_uri: this.oidcRedirectUri,
      saml_entity_id: this.samlEntityId(tenantId),
      saml_acs_url: this.samlAcsUrl(tenantId),
      saml_metadata_url: this.samlEntityId(tenantId),
      scim_base_url: this.scimBaseUrl,
    };
  }

  cipher(): FieldCipher {
    if (!this.config.SSO_ENCRYPTION_KEY) {
      // Refuse rather than store a client secret in the clear.
      throw ApiError.conflict(
        'Client secrets cannot be stored on this deployment: SSO_ENCRYPTION_KEY is not set.',
      );
    }
    this.cipherInstance ??= new FieldCipher(this.config.SSO_ENCRYPTION_KEY);
    return this.cipherInstance;
  }
}

function notConfigured(): ApiError {
  return new ApiError(
    HttpStatus.SERVICE_UNAVAILABLE,
    ERROR_CODES.CONFLICT,
    'Single sign-on is not configured on this deployment (API_PUBLIC_URL and WEB_BASE_URL).',
  );
}
