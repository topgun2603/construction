import { Injectable, Logger } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { createRemoteJWKSet, errors as joseErrors, jwtVerify, type JWTPayload } from 'jose';
import { ApiError } from '../../common/errors/api-error';
import { SsoConfigService } from './sso-config.service';

/**
 * The OpenID Connect relying party: discovery, the authorization-code request with PKCE, the code
 * exchange, and id_token verification.
 *
 * WHY `jose` AND NOT `openid-client`. openid-client 6 ships as ES modules only, which this
 * CommonJS NestJS build and its Jest suite cannot load without a second toolchain. The parts that
 * must never be hand-rolled — JWS signature verification, JWKS fetching, caching and key rotation,
 * and the `iss`/`aud`/`exp`/`nbf` checks — are exactly what `jose` (the library openid-client is
 * itself built on) does, so the code here is only the plain HTTP around it: two requests and a URL.
 */
export interface OidcDiscovery {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
  token_endpoint_auth_methods_supported?: string[];
  id_token_signing_alg_values_supported?: string[];
}

/** The claims a verified id_token carries that sign-in uses. */
export interface OidcIdentity {
  email: string;
  name: string | null;
  subject: string;
}

/** Asymmetric only. `HS256` would verify against the client secret, which is ours, not the IdP's. */
const ALLOWED_ALGORITHMS = ['RS256', 'RS384', 'RS512', 'PS256', 'PS384', 'PS512', 'ES256', 'ES384', 'ES512', 'EdDSA'];

/** Discovery documents change rarely; an hour keeps a sign-in from paying for a fetch each time. */
const DISCOVERY_TTL_MS = 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 10_000;

@Injectable()
export class OidcClientService {
  private readonly logger = new Logger(OidcClientService.name);
  private readonly discoveries = new Map<string, { doc: OidcDiscovery; at: number }>();
  /** One key set per JWKS URL; `jose` caches keys and refetches when an unknown `kid` appears. */
  private readonly keySets = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

  constructor(private readonly ssoConfig: SsoConfigService) {}

  /** PKCE (RFC 7636): a random verifier kept server-side, and its S256 challenge for the URL. */
  static pkce(): { verifier: string; challenge: string } {
    const verifier = randomBytes(32).toString('base64url');
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    return { verifier, challenge };
  }

  async discover(issuer: string): Promise<OidcDiscovery> {
    const key = issuer.replace(/\/+$/, '');
    const cached = this.discoveries.get(key);
    if (cached && Date.now() - cached.at < DISCOVERY_TTL_MS) return cached.doc;

    this.assertUrlAllowed(key, 'issuer');
    const doc = await this.getJson<OidcDiscovery>(`${key}/.well-known/openid-configuration`, 'discovery');
    if (
      typeof doc.issuer !== 'string' ||
      typeof doc.authorization_endpoint !== 'string' ||
      typeof doc.token_endpoint !== 'string' ||
      typeof doc.jwks_uri !== 'string'
    ) {
      throw ApiError.conflict('The identity provider’s discovery document is incomplete.');
    }
    // OpenID Connect Discovery §4.3: the document must name the issuer it was fetched for. A
    // mismatch is a misconfiguration at best and a substituted provider at worst.
    if (doc.issuer.replace(/\/+$/, '') !== key) {
      throw ApiError.conflict(
        `The identity provider calls itself ${doc.issuer}, not ${issuer}. Use exactly that issuer.`,
      );
    }
    for (const url of [doc.authorization_endpoint, doc.token_endpoint, doc.jwks_uri]) {
      this.assertUrlAllowed(url, 'endpoint');
    }
    this.discoveries.set(key, { doc, at: Date.now() });
    return doc;
  }

  authorizeUrl(
    discovery: OidcDiscovery,
    input: {
      clientId: string;
      scopes: string;
      state: string;
      nonce: string;
      codeChallenge: string;
      loginHint: string;
    },
  ): string {
    const url = new URL(discovery.authorization_endpoint);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('client_id', input.clientId);
    url.searchParams.set('redirect_uri', this.ssoConfig.oidcRedirectUri);
    url.searchParams.set('scope', input.scopes.split(' ').includes('openid') ? input.scopes : `openid ${input.scopes}`);
    url.searchParams.set('state', input.state);
    url.searchParams.set('nonce', input.nonce);
    url.searchParams.set('code_challenge', input.codeChallenge);
    url.searchParams.set('code_challenge_method', 'S256');
    // Entra ID, Google and Okta all honour it: the person is not asked to type their address twice.
    url.searchParams.set('login_hint', input.loginHint);
    return url.toString();
  }

  /** Swaps the authorization code for an id_token at the token endpoint. */
  async exchangeCode(
    discovery: OidcDiscovery,
    input: { code: string; clientId: string; clientSecret: string; codeVerifier: string },
  ): Promise<string> {
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code: input.code,
      redirect_uri: this.ssoConfig.oidcRedirectUri,
      code_verifier: input.codeVerifier,
    });
    const headers: Record<string, string> = {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    };
    /*
     * `client_secret_basic` is the OIDC default and what Okta's web apps are set to; Entra ID and
     * Google accept it too. `client_secret_post` only for a provider that does not offer basic.
     */
    const methods = discovery.token_endpoint_auth_methods_supported;
    if (!methods || methods.includes('client_secret_basic')) {
      const credentials = `${encodeURIComponent(input.clientId)}:${encodeURIComponent(input.clientSecret)}`;
      headers['Authorization'] = `Basic ${Buffer.from(credentials).toString('base64')}`;
    } else {
      body.set('client_id', input.clientId);
      body.set('client_secret', input.clientSecret);
    }

    let response: Response;
    try {
      response = await fetch(discovery.token_endpoint, {
        method: 'POST',
        headers,
        body,
        redirect: 'error',
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
    } catch (error) {
      this.logger.warn({ err: error }, 'OIDC token endpoint unreachable');
      throw ApiError.invalidToken('Could not reach your identity provider to finish signing in.');
    }
    const payload = (await response.json().catch(() => null)) as
      | { id_token?: unknown; error?: unknown; error_description?: unknown }
      | null;
    if (!response.ok || !payload || typeof payload.id_token !== 'string') {
      this.logger.warn(
        { status: response.status, error: payload?.error, description: payload?.error_description },
        'OIDC code exchange refused',
      );
      throw ApiError.invalidToken('Your identity provider refused to finish the sign-in.');
    }
    return payload.id_token;
  }

  /**
   * Verifies an id_token (OpenID Connect Core §3.1.3.7): signature against the provider's JWKS,
   * `iss` exactly the discovered issuer, `aud` containing our client id (and `azp` naming us when
   * there are several audiences), `exp`/`nbf`/`iat` with a minute of clock skew, and `nonce` equal to
   * the one stored for this sign-in. Then the address it asserts.
   */
  async verifyIdToken(
    discovery: OidcDiscovery,
    idToken: string,
    input: { clientId: string; nonce: string; preset: string },
  ): Promise<OidcIdentity> {
    let payload: JWTPayload;
    try {
      const result = await jwtVerify(idToken, this.keySet(discovery.jwks_uri), {
        issuer: discovery.issuer,
        audience: input.clientId,
        algorithms: ALLOWED_ALGORITHMS,
        clockTolerance: 60,
        maxTokenAge: '10m',
        requiredClaims: ['sub', 'exp', 'iat'],
      });
      payload = result.payload;
    } catch (error) {
      this.logger.warn({ err: describeJoseError(error) }, 'id_token verification failed');
      throw ApiError.invalidToken('The sign-in from your identity provider could not be verified.');
    }

    if (Array.isArray(payload.aud) && payload.aud.length > 1 && payload['azp'] !== input.clientId) {
      throw ApiError.invalidToken('The sign-in was issued for a different application.');
    }
    if (typeof payload['nonce'] !== 'string' || payload['nonce'] !== input.nonce) {
      throw ApiError.invalidToken('The sign-in does not belong to this browser session. Start again.');
    }

    const email = emailClaim(payload, input.preset);
    if (!email) {
      throw ApiError.invalidToken(
        'Your identity provider did not send an email address. Ask your administrator to include the email claim.',
      );
    }
    // A provider that says outright the address is unverified is not proof of anything.
    if (payload['email_verified'] === false || payload['email_verified'] === 'false') {
      throw ApiError.invalidToken('Your identity provider says that email address is not verified.');
    }

    return { email, name: nameClaim(payload), subject: String(payload.sub) };
  }

  private keySet(jwksUri: string) {
    let set = this.keySets.get(jwksUri);
    if (!set) {
      set = createRemoteJWKSet(new URL(jwksUri), { timeoutDuration: FETCH_TIMEOUT_MS });
      this.keySets.set(jwksUri, set);
    }
    return set;
  }

  /** https only in production — a provider's answers must not travel in the clear. */
  assertUrlAllowed(value: string, what: string): void {
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      throw ApiError.validationFailed({ [what]: 'not a URL' }, `The ${what} is not a valid URL.`);
    }
    const ok = url.protocol === 'https:' || (this.ssoConfig.allowsInsecureUrls && url.protocol === 'http:');
    if (!ok) {
      throw ApiError.validationFailed({ [what]: 'must be https' }, `The ${what} must start with https://.`);
    }
  }

  private async getJson<T>(url: string, what: string): Promise<T> {
    try {
      const response = await fetch(url, {
        headers: { Accept: 'application/json' },
        redirect: 'error',
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return (await response.json()) as T;
    } catch (error) {
      this.logger.warn({ err: error, url }, `OIDC ${what} fetch failed`);
      throw ApiError.conflict(
        'Could not read the identity provider’s settings from that issuer. Check the issuer URL.',
      );
    }
  }
}

/**
 * The address the token asserts. `email` first; Entra ID only sends it when the app asks for the
 * optional claim, so for that preset the sign-in name (`preferred_username`, normally the UPN, which
 * is the work address) is accepted — and the domain check after this still decides whether it may
 * sign anybody in.
 */
function emailClaim(payload: JWTPayload, preset: string): string | null {
  const candidates = [payload['email']];
  if (preset === 'entra') candidates.push(payload['preferred_username'], payload['upn']);
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && /^[^\s@]+@[^\s@]+$/.test(candidate.trim())) {
      return candidate.trim().toLowerCase();
    }
  }
  return null;
}

function nameClaim(payload: JWTPayload): string | null {
  if (typeof payload['name'] === 'string' && payload['name'].trim()) return payload['name'].trim();
  const parts = [payload['given_name'], payload['family_name']].filter(
    (part): part is string => typeof part === 'string' && part.trim() !== '',
  );
  return parts.length > 0 ? parts.join(' ') : null;
}

function describeJoseError(error: unknown): string {
  if (error instanceof joseErrors.JOSEError) return `${error.code}: ${error.message}`;
  return error instanceof Error ? error.message : String(error);
}
