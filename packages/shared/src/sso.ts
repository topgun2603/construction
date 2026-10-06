/**
 * Single sign-on and user provisioning (roadmap Phase 3, item 1): a company signs its people in
 * through its own identity provider — Microsoft Entra ID, Google Workspace, Okta — over OpenID
 * Connect or SAML 2.0, and that provider can create and switch off accounts over SCIM 2.0.
 *
 * Everything here is named `sso…` / `scim…` / `SSO_…` / `SCIM_…` so it cannot collide with the
 * modules being built beside it.
 */

export const SSO_PROTOCOLS = ['oidc', 'saml'] as const;
export type SsoProtocol = (typeof SSO_PROTOCOLS)[number];

export const SSO_PRESETS = ['entra', 'google', 'okta', 'other'] as const;
export type SsoPreset = (typeof SSO_PRESETS)[number];

/**
 * What the settings screen says about each provider. Kept here, beside the presets, so the help
 * text and the API's defaults cannot describe two different set-ups.
 *
 * `issuerHint` is what the issuer URL looks like, with the parts the admin fills in shown in angle
 * brackets; `samlHint` is where that provider keeps the SAML values to copy.
 */
export const SSO_PRESET_GUIDES: Record<
  SsoPreset,
  { label: string; issuerHint: string; oidcHint: string; samlHint: string; scimHint: string }
> = {
  entra: {
    label: 'Microsoft Entra ID',
    issuerHint: 'https://login.microsoftonline.com/<tenant-id>/v2.0',
    oidcHint:
      'Entra admin centre → App registrations → New registration. Add the redirect URI below as a Web platform redirect, create a client secret under Certificates & secrets, and copy the Application (client) ID. Use your directory (tenant) ID in the issuer — never "common" or "organizations".',
    samlHint:
      'Entra admin centre → Enterprise applications → New application → Create your own → Set up single sign-on → SAML. Paste our Entity ID and Reply URL (ACS), then copy the App Federation Metadata URL here.',
    scimHint:
      'In the same enterprise application → Provisioning → Automatic. Tenant URL is the SCIM base URL below; Secret Token is the token you generate here.',
  },
  google: {
    label: 'Google Workspace',
    issuerHint: 'https://accounts.google.com',
    oidcHint:
      'Google Cloud console → APIs & Services → Credentials → Create OAuth client ID (Web application). Add the redirect URI below. Set the OAuth consent screen to Internal so only your Workspace can use it.',
    samlHint:
      'Google Admin console → Apps → Web and mobile apps → Add custom SAML app. Copy the SSO URL, Entity ID and certificate here (or download the IdP metadata), then enter our ACS URL and Entity ID, with Name ID format EMAIL.',
    scimHint:
      'Google Workspace provisions only to its catalogue apps, so add people here by hand or let them be created at first sign-in.',
  },
  okta: {
    label: 'Okta',
    issuerHint: 'https://<your-org>.okta.com',
    oidcHint:
      'Okta admin → Applications → Create App Integration → OIDC, Web Application. Add the redirect URI below as a sign-in redirect URI and copy the client ID and secret. The issuer is your Okta org URL (or an authorization server such as …/oauth2/default).',
    samlHint:
      'Okta admin → Applications → Create App Integration → SAML 2.0. Single sign-on URL is our ACS URL, Audience URI is our Entity ID, Name ID format EmailAddress. Copy the Metadata URL from the Sign On tab here.',
    scimHint:
      'In the app → General → enable SCIM provisioning; Provisioning → Integration: SCIM connector base URL below, unique identifier field userName, authentication HTTP Header with the token you generate here.',
  },
  other: {
    label: 'Another provider',
    issuerHint: 'https://idp.example.com',
    oidcHint:
      'Register a confidential web client using the authorization code flow, add the redirect URI below, and copy its issuer, client ID and client secret.',
    samlHint:
      'Create a SAML 2.0 application with our ACS URL and Entity ID, Name ID in email format, and a signed response or assertion. Copy its metadata URL or XML here.',
    scimHint: 'Point a SCIM 2.0 client at the base URL below with the token as a bearer token.',
  },
};

/** Scopes asked for when the admin leaves the field alone: enough for an email and a name. */
export const SSO_DEFAULT_SCOPES = 'openid email profile';

/**
 * The TXT record that proves a company controls a domain: `buildr-verification=<token>` on the
 * domain itself. One record per company — two companies trying to claim the same domain get two
 * different tokens, and only the one the domain's DNS actually carries can verify.
 */
export const SSO_TXT_PREFIX = 'buildr-verification=';

export function ssoTxtRecordValue(token: string): string {
  return `${SSO_TXT_PREFIX}${token}`;
}

/**
 * The domain a person's address is on, lower case, or null for something that is not an address.
 * Compared whole: `mail.alnoor.ae` is not `alnoor.ae`, because a subdomain can be run by somebody
 * else entirely and verifying one must not quietly cover the other.
 */
export function ssoDomainOf(email: string): string | null {
  const at = email.lastIndexOf('@');
  if (at <= 0 || at === email.length - 1) return null;
  const domain = email.slice(at + 1).trim().toLowerCase();
  return ssoIsDomain(domain) ? domain : null;
}

/**
 * A bare DNS name an admin may claim: letters, digits and hyphens in dot-separated labels, at
 * least two labels, a TLD that is not all digits. No scheme, no path, no wildcard, no IP address.
 */
export function ssoIsDomain(value: string): boolean {
  if (value.length > 253) return false;
  const labels = value.split('.');
  if (labels.length < 2) return false;
  if (/^\d+$/.test(labels[labels.length - 1] ?? '')) return false;
  return labels.every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label));
}

/**
 * Tidies what an admin typed into the domain box: `https://www.AlNoor.ae/` and `@alnoor.ae`
 * become `www.alnoor.ae` and `alnoor.ae`. Null when what is left is not a domain.
 */
export function ssoNormaliseDomain(input: string): string | null {
  const domain = input
    .trim()
    .toLowerCase()
    .replace(/^[a-z]+:\/\//, '')
    .replace(/^@/, '')
    .replace(/[/?#].*$/, '')
    .replace(/\.$/, '');
  return ssoIsDomain(domain) ? domain : null;
}

/**
 * The stand-in for a phone number on a person created by single sign-on or SCIM.
 *
 * `users.phone` is required, and unique per company, because the product grew up around the
 * mobile number: OTP, WhatsApp, the worker app. An identity provider usually knows no phone at
 * all, so a provisioned person gets this instead. It can never match a real sign-in — phone
 * sign-in compares digits only, and this has a colon in it — and the clients show the email in
 * its place. Making the column nullable would have touched every reader of `phone` in the product
 * for a field only these accounts lack.
 */
export const SSO_PLACEHOLDER_PHONE_PREFIX = 'sso:';

export function ssoIsPlaceholderPhone(phone: string | null | undefined): boolean {
  return typeof phone === 'string' && phone.startsWith(SSO_PLACEHOLDER_PHONE_PREFIX);
}

/** SCIM 2.0 schema URNs (RFC 7643 / 7644). */
export const SCIM_SCHEMA_USER = 'urn:ietf:params:scim:schemas:core:2.0:User';
export const SCIM_SCHEMA_GROUP = 'urn:ietf:params:scim:schemas:core:2.0:Group';
export const SCIM_SCHEMA_LIST = 'urn:ietf:params:scim:api:messages:2.0:ListResponse';
export const SCIM_SCHEMA_PATCH = 'urn:ietf:params:scim:api:messages:2.0:PatchOp';
export const SCIM_SCHEMA_ERROR = 'urn:ietf:params:scim:api:messages:2.0:Error';
export const SCIM_SCHEMA_SP_CONFIG = 'urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig';
export const SCIM_SCHEMA_RESOURCE_TYPE = 'urn:ietf:params:scim:schemas:core:2.0:ResourceType';

/** The most results one SCIM page returns, whatever `count` asks for. */
export const SCIM_MAX_PAGE_SIZE = 200;

/**
 * A SCIM `filter` this API understands: one attribute, `eq`, one quoted value — what Entra ID and
 * Okta actually send (`userName eq "a@b.com"`, `externalId eq "…"`, `displayName eq "…"`). Null
 * for anything else, which the API answers with `invalidFilter` rather than guessing.
 */
export function scimParseFilter(filter: string): { attribute: string; value: string } | null {
  const match = /^\s*([A-Za-z][\w.:-]*)\s+eq\s+"((?:[^"\\]|\\.)*)"\s*$/i.exec(filter);
  if (!match) return null;
  return {
    attribute: match[1] as string,
    value: (match[2] as string).replace(/\\(.)/g, '$1'),
  };
}

/**
 * A SCIM boolean. Entra ID sends `"False"` as a string in PATCH operations; Okta sends a real
 * boolean. Null for anything that is neither.
 */
export function scimBoolean(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const lower = value.trim().toLowerCase();
    if (lower === 'true') return true;
    if (lower === 'false') return false;
  }
  return null;
}
