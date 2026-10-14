import { Injectable, Logger } from '@nestjs/common';
import { X509Certificate, randomBytes } from 'node:crypto';
import { SAML, ValidateInResponseTo, type CacheProvider, type Profile, type SamlConfig } from '@node-saml/node-saml';
import { XMLParser } from 'fast-xml-parser';
import { ApiError } from '../../common/errors/api-error';
import { SsoConfigService } from './sso-config.service';

/**
 * The SAML 2.0 service provider, on top of `@node-saml/node-saml`.
 *
 * WHY node-saml. XML signature verification is the part of SAML that has broken every hand-rolled
 * implementation (signature wrapping, comment truncation, unsigned-assertion substitution), and
 * node-saml is the maintained successor to passport-saml with xml-crypto underneath it. It checks
 * the signature against the configured certificate, the audience, `NotBefore`/`NotOnOrAfter`, and
 * `InResponseTo` against our request id. On top of it this service adds what it leaves to the
 * caller: the assertion's `Issuer`, the response `Destination` and the `Recipient` must name us
 * and this company's provider, and the request id is the one stored for this very sign-in.
 *
 * Replay protection is the stored request: one AuthnRequest id per sign-in, accepted once.
 */
export interface SamlIdentity {
  email: string;
  name: string | null;
  nameId: string;
}

export interface SamlIdpSettings {
  entityId: string;
  ssoUrl: string;
  certificate: string;
}

const FETCH_TIMEOUT_MS = 10_000;
const MAX_METADATA_BYTES = 500_000;

/** Attribute names providers use for the address and the name, most specific first. */
const EMAIL_ATTRIBUTES = [
  'email',
  'mail',
  'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress',
  'urn:oid:0.9.2342.19200300.100.1.3',
  'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/upn',
];
const NAME_ATTRIBUTES = [
  'http://schemas.microsoft.com/identity/claims/displayname',
  'displayName',
  'name',
  'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name',
];
const GIVEN_NAME_ATTRIBUTES = ['firstName', 'givenName', 'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/givenname'];
const FAMILY_NAME_ATTRIBUTES = ['lastName', 'surname', 'sn', 'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/surname'];

@Injectable()
export class SamlClientService {
  private readonly logger = new Logger(SamlClientService.name);

  constructor(private readonly ssoConfig: SsoConfigService) {}

  /** A fresh AuthnRequest id. XML ids must not start with a digit, hence the underscore. */
  static newRequestId(): string {
    return `_${randomBytes(20).toString('hex')}`;
  }

  /** The IdP URL (HTTP-Redirect binding) carrying a signed-for-nobody AuthnRequest with this id. */
  async authorizeUrl(
    tenantId: string,
    idp: SamlIdpSettings,
    input: { requestId: string; relayState: string },
  ): Promise<string> {
    const saml = this.instance(tenantId, idp, input.requestId);
    return saml.getAuthorizeUrlAsync(input.relayState, undefined, {});
  }

  /**
   * Checks a posted SAMLResponse for the sign-in whose AuthnRequest id was `requestId`, and returns
   * who it says signed in. Throws `ApiError.invalidToken` for anything short of fully valid.
   */
  async validate(
    tenantId: string,
    idp: SamlIdpSettings,
    input: { requestId: string; issuedAt: Date; samlResponse: string },
  ): Promise<SamlIdentity> {
    const saml = this.instance(tenantId, idp, input.requestId, input.issuedAt);
    let profile: Profile | null;
    try {
      ({ profile } = await saml.validatePostResponseAsync({ SAMLResponse: input.samlResponse }));
    } catch (error) {
      this.logger.warn({ err: error instanceof Error ? error.message : error }, 'SAML response refused');
      throw ApiError.invalidToken('The sign-in from your identity provider could not be verified.');
    }
    if (!profile) throw ApiError.invalidToken('Your identity provider sent no sign-in.');

    // node-saml checks `Issuer` only on logout messages, so the assertion's is checked here.
    if (profile.issuer !== idp.entityId) {
      this.logger.warn({ issuer: profile.issuer }, 'SAML assertion from an unexpected issuer');
      throw ApiError.invalidToken('The sign-in came from a different identity provider.');
    }

    const acsUrl = this.ssoConfig.samlAcsUrl(tenantId);
    const destination = responseDestination(profile.getSamlResponseXml?.() ?? '');
    if (destination !== null && destination !== acsUrl) {
      throw ApiError.invalidToken('The sign-in was addressed to a different service.');
    }
    const recipient = assertionRecipient(profile.getAssertion?.());
    if (recipient !== null && recipient !== acsUrl) {
      throw ApiError.invalidToken('The sign-in was addressed to a different service.');
    }

    const email = firstString(profile, EMAIL_ATTRIBUTES) ?? (looksLikeEmail(profile.nameID) ? profile.nameID : null);
    if (!email || !looksLikeEmail(email)) {
      throw ApiError.invalidToken(
        'Your identity provider did not send an email address. Set the Name ID format to email address.',
      );
    }
    const given = firstString(profile, GIVEN_NAME_ATTRIBUTES);
    const family = firstString(profile, FAMILY_NAME_ATTRIBUTES);
    const name =
      firstString(profile, NAME_ATTRIBUTES) ?? ([given, family].filter(Boolean).join(' ') || null);

    return { email: email.trim().toLowerCase(), name, nameId: profile.nameID };
  }

  /** Our SP metadata for the company, for the admin to upload to their provider. */
  serviceProviderMetadata(tenantId: string): string {
    const saml = new SAML({
      issuer: this.ssoConfig.samlEntityId(tenantId),
      callbackUrl: this.ssoConfig.samlAcsUrl(tenantId),
      // Never used to verify anything here; the constructor insists on one.
      idpCert: 'unused',
      identifierFormat: 'urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress',
      wantAssertionsSigned: true,
    });
    return saml.generateServiceProviderMetadata(null, null);
  }

  /** Reads the values sign-in needs from an IdP's metadata, fetched or pasted. */
  async readMetadata(input: { url?: string; xml?: string }): Promise<SamlIdpSettings> {
    const xml = input.url ? await this.fetchMetadata(input.url) : (input.xml ?? '');
    return parseIdpMetadata(xml);
  }

  /** Bare base64 DER, or a refusal if it is not an X.509 certificate at all. */
  static normaliseCertificate(value: string): string {
    const body = value
      .replace(/-----BEGIN CERTIFICATE-----/g, '')
      .replace(/-----END CERTIFICATE-----/g, '')
      .replace(/\s+/g, '');
    try {
      new X509Certificate(Buffer.from(body, 'base64'));
    } catch {
      throw ApiError.validationFailed(
        { saml_idp_certificate: 'not an X.509 certificate' },
        'The signing certificate is not a valid X.509 certificate.',
      );
    }
    return body;
  }

  private instance(tenantId: string, idp: SamlIdpSettings, requestId: string, issuedAt = new Date()): SAML {
    const config: SamlConfig = {
      entryPoint: idp.ssoUrl,
      issuer: this.ssoConfig.samlEntityId(tenantId),
      audience: this.ssoConfig.samlEntityId(tenantId),
      callbackUrl: this.ssoConfig.samlAcsUrl(tenantId),
      idpCert: idp.certificate,
      idpIssuer: idp.entityId,
      identifierFormat: 'urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress',
      /*
       * Either the response or the assertion must carry a valid signature that covers the
       * assertion; node-saml refuses an unsigned one either way. Requiring one particular element
       * would turn away Google (signs the response) or Entra ID's default (signs the assertion).
       */
      wantAuthnResponseSigned: false,
      wantAssertionsSigned: false,
      validateInResponseTo: ValidateInResponseTo.always,
      cacheProvider: onlyThisRequest(requestId, issuedAt),
      // The same ten minutes as the stored request and the signed RelayState.
      requestIdExpirationPeriodMs: 10 * 60_000,
      generateUniqueId: () => requestId,
      // Entra ID refuses a requested `PasswordProtectedTransport` when the person used MFA or a
      // passkey (AADSTS75011); the provider's own policy decides how strongly to authenticate.
      disableRequestedAuthnContext: true,
      acceptedClockSkewMs: 60_000,
      maxAssertionAgeMs: 10 * 60_000,
      signatureAlgorithm: 'sha256',
    };
    return new SAML(config);
  }

  private async fetchMetadata(url: string): Promise<string> {
    const parsed = new URL(url);
    if (!(parsed.protocol === 'https:' || (this.ssoConfig.allowsInsecureUrls && parsed.protocol === 'http:'))) {
      throw ApiError.validationFailed({ url: 'must be https' }, 'The metadata URL must start with https://.');
    }
    try {
      const response = await fetch(url, {
        redirect: 'follow',
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const text = await response.text();
      if (text.length > MAX_METADATA_BYTES) throw new Error('metadata too large');
      return text;
    } catch (error) {
      this.logger.warn({ err: error, url }, 'SAML metadata fetch failed');
      throw ApiError.conflict('Could not download the metadata from that URL.');
    }
  }
}

/**
 * node-saml checks `InResponseTo` against a cache of ids it issued. This one knows exactly one id
 * — the request stored for the sign-in the RelayState names — so a response to any other request,
 * including one for another company or another person's sign-in, is refused.
 */
function onlyThisRequest(requestId: string, issuedAt: Date): CacheProvider {
  return {
    saveAsync: async (key, value) => (key === requestId ? { value, createdAt: Date.now() } : null),
    // node-saml reads the value as the time the request was issued and checks it against
    // `requestIdExpirationPeriodMs`, so it is the stored request's own creation time.
    getAsync: async (key) => (key === requestId ? issuedAt.toISOString() : null),
    removeAsync: async (key) => key,
  };
}

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  removeNSPrefix: true,
  // No entity expansion: metadata is untrusted input.
  processEntities: false,
});

/**
 * The `Destination` on the response element, or null when absent. Read only after node-saml has
 * verified the signature, as an extra check; identity never comes from this parse.
 */
function responseDestination(xml: string): string | null {
  if (!xml) return null;
  const doc = xmlParser.parse(xml) as { Response?: { '@_Destination'?: string } };
  return doc.Response?.['@_Destination'] ?? null;
}

/** `SubjectConfirmationData/@Recipient` from the verified assertion (xml2js shape), or null. */
function assertionRecipient(assertion: unknown): string | null {
  const root = (assertion as { Assertion?: Record<string, unknown> } | undefined)?.Assertion;
  const subject = (root?.['Subject'] as Array<Record<string, unknown>> | undefined)?.[0];
  const confirmations = subject?.['SubjectConfirmation'] as Array<Record<string, unknown>> | undefined;
  for (const confirmation of confirmations ?? []) {
    const data = (confirmation['SubjectConfirmationData'] as Array<{ $?: { Recipient?: string } }> | undefined)?.[0];
    if (data?.$?.Recipient) return data.$.Recipient;
  }
  return null;
}

export function parseIdpMetadata(xml: string): SamlIdpSettings {
  let doc: Record<string, unknown>;
  try {
    doc = xmlParser.parse(xml) as Record<string, unknown>;
  } catch {
    throw ApiError.validationFailed({ xml: 'not XML' }, 'That is not SAML metadata.');
  }
  const descriptor = (doc['EntityDescriptor'] ??
    asArray((doc['EntitiesDescriptor'] as Record<string, unknown> | undefined)?.['EntityDescriptor'])[0]) as
    | Record<string, unknown>
    | undefined;
  const idp = asArray(descriptor?.['IDPSSODescriptor'])[0] as Record<string, unknown> | undefined;
  const entityId = descriptor?.['@_entityID'];
  if (!descriptor || !idp || typeof entityId !== 'string') {
    throw ApiError.validationFailed({ xml: 'no IdP descriptor' }, 'That metadata does not describe an identity provider.');
  }

  const services = asArray(idp['SingleSignOnService']) as Array<Record<string, string>>;
  const redirect =
    services.find((s) => s['@_Binding'] === 'urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect') ?? null;
  if (!redirect?.['@_Location']) {
    throw ApiError.validationFailed(
      { xml: 'no HTTP-Redirect SSO service' },
      'The provider offers no HTTP-Redirect sign-in URL, which is the one BUILDR uses.',
    );
  }

  const keys = asArray(idp['KeyDescriptor']) as Array<Record<string, unknown>>;
  const signing = keys.find((key) => key['@_use'] !== 'encryption');
  const certificate = deepFind(signing, 'X509Certificate');
  if (!certificate) {
    throw ApiError.validationFailed({ xml: 'no signing certificate' }, 'The metadata has no signing certificate.');
  }

  return {
    entityId,
    ssoUrl: redirect['@_Location'],
    certificate: SamlClientService.normaliseCertificate(certificate),
  };
}

function asArray(value: unknown): unknown[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function deepFind(node: unknown, key: string): string | null {
  if (!node || typeof node !== 'object') return null;
  for (const [name, value] of Object.entries(node as Record<string, unknown>)) {
    if (name === key) {
      const first = asArray(value)[0];
      if (typeof first === 'string') return first;
      if (first && typeof first === 'object' && typeof (first as Record<string, unknown>)['#text'] === 'string') {
        return (first as Record<string, string>)['#text'] ?? null;
      }
    }
    const found = deepFind(value, key);
    if (found) return found;
  }
  return null;
}

function firstString(profile: Profile, names: string[]): string | null {
  for (const name of names) {
    const value = profile[name];
    const first = Array.isArray(value) ? value[0] : value;
    if (typeof first === 'string' && first.trim() !== '') return first.trim();
  }
  return null;
}

function looksLikeEmail(value: unknown): value is string {
  return typeof value === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}
