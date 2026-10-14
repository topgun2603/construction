import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { inflateRawSync } from 'node:zlib';
import { SignJWT, exportJWK, generateKeyPair, type JWTPayload, type KeyLike } from 'jose';
import { SignedXml } from 'xml-crypto';

/**
 * Stand-ins for Microsoft Entra ID, Google and Okta, so the SSO suite needs no real provider.
 *
 * The OIDC one is a real HTTP server on a random local port — discovery, JWKS and a token endpoint
 * — signing id_tokens with a key generated per run, so the API's own fetch, JWKS handling and
 * signature checks run exactly as they would against a provider. The SAML one signs responses with
 * xml-crypto and the self-signed test certificates in `test/fixtures/sso` (test-only keys).
 */

export interface IdTokenOptions {
  nonce: string;
  email: string;
  /** Overrides for any claim, applied last. */
  claims?: JWTPayload;
  /** Sign with this key instead of the published one (for "bad signature"). */
  signWith?: KeyLike;
  /** Lifetime in seconds from now; negative for an already-expired token. */
  expiresIn?: number;
}

export class MockOidcProvider {
  issuer = '';
  readonly clientId = `client-${randomUUID().slice(0, 8)}`;
  readonly clientSecret = `secret-${randomUUID()}`;
  /** What the next code exchange answers with; set by the test before the callback. */
  nextIdToken: (() => Promise<string>) | null = null;
  /** The code_challenge from the authorize URL, checked against the verifier at the token endpoint. */
  expectedChallenge: string | null = null;
  tokenRequests = 0;

  private server: Server | null = null;
  private privateKey!: KeyLike;
  private readonly kid = randomUUID();
  private jwk: Record<string, unknown> = {};

  async start(): Promise<this> {
    const { privateKey, publicKey } = await generateKeyPair('RS256');
    this.privateKey = privateKey;
    this.jwk = { ...(await exportJWK(publicKey)), kid: this.kid, alg: 'RS256', use: 'sig' };

    this.server = createServer((req, res) => {
      void this.handle(req).then(
        ({ status, body }) => {
          res.writeHead(status, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(body));
        },
        () => {
          res.writeHead(500);
          res.end();
        },
      );
    });
    await new Promise<void>((resolve) => this.server?.listen(0, '127.0.0.1', resolve));
    const { port } = this.server.address() as AddressInfo;
    this.issuer = `http://127.0.0.1:${port}`;
    return this;
  }

  async stop(): Promise<void> {
    await new Promise<void>((resolve) => (this.server ? this.server.close(() => resolve()) : resolve()));
  }

  /** A second key with the same `kid`, so a token signed by it fails verification, not lookup. */
  async impostorKey(): Promise<KeyLike> {
    return (await generateKeyPair('RS256')).privateKey;
  }

  async idToken(options: IdTokenOptions): Promise<string> {
    const now = Math.floor(Date.now() / 1000);
    const expiresIn = options.expiresIn ?? 300;
    const claims: JWTPayload = {
      iss: this.issuer,
      aud: this.clientId,
      sub: `sub-${options.email}`,
      email: options.email,
      email_verified: true,
      name: 'Signed In Person',
      nonce: options.nonce,
      iat: expiresIn < 0 ? now + expiresIn - 60 : now,
      exp: now + expiresIn,
      ...options.claims,
    };
    return new SignJWT(claims)
      .setProtectedHeader({ alg: 'RS256', kid: this.kid })
      .sign(options.signWith ?? this.privateKey);
  }

  private async handle(req: IncomingMessage): Promise<{ status: number; body: unknown }> {
    const url = new URL(req.url ?? '/', this.issuer);
    if (req.method === 'GET' && url.pathname === '/.well-known/openid-configuration') {
      return {
        status: 200,
        body: {
          issuer: this.issuer,
          authorization_endpoint: `${this.issuer}/authorize`,
          token_endpoint: `${this.issuer}/token`,
          jwks_uri: `${this.issuer}/jwks`,
          token_endpoint_auth_methods_supported: ['client_secret_basic', 'client_secret_post'],
          id_token_signing_alg_values_supported: ['RS256'],
        },
      };
    }
    if (req.method === 'GET' && url.pathname === '/jwks') {
      return { status: 200, body: { keys: [this.jwk] } };
    }
    if (req.method === 'POST' && url.pathname === '/token') {
      this.tokenRequests += 1;
      const form = new URLSearchParams(await readBody(req));
      const expected = `Basic ${Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64')}`;
      if (req.headers.authorization !== expected) return { status: 401, body: { error: 'invalid_client' } };
      const verifier = form.get('code_verifier') ?? '';
      const challenge = createHash('sha256').update(verifier).digest('base64url');
      if (!this.expectedChallenge || challenge !== this.expectedChallenge) {
        return { status: 400, body: { error: 'invalid_grant', error_description: 'PKCE mismatch' } };
      }
      if (form.get('grant_type') !== 'authorization_code' || !form.get('code') || !this.nextIdToken) {
        return { status: 400, body: { error: 'invalid_grant' } };
      }
      return {
        status: 200,
        body: { access_token: 'unused', token_type: 'Bearer', id_token: await this.nextIdToken() },
      };
    }
    return { status: 404, body: {} };
  }
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk: Buffer) => (data += chunk.toString('utf8')));
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

// --- SAML --------------------------------------------------------------------------------------

export interface TestIdpKeys {
  key: string;
  cert: string;
  /** The certificate as base64 DER, the way an admin pastes it. */
  certBody: string;
}

export function idpKeys(name: 'idp-a' | 'idp-b'): TestIdpKeys {
  const dir = join(__dirname, '..', 'fixtures', 'sso');
  const cert = readFileSync(join(dir, `${name}.crt`), 'utf8');
  return {
    key: readFileSync(join(dir, `${name}.key`), 'utf8'),
    cert,
    certBody: cert.replace(/-----(BEGIN|END) CERTIFICATE-----/g, '').replace(/\s+/g, ''),
  };
}

/** The AuthnRequest id inside a HTTP-Redirect sign-in URL. */
export function samlRequestIdOf(redirectUrl: string): string {
  const request = new URL(redirectUrl).searchParams.get('SAMLRequest') ?? '';
  const xml = inflateRawSync(Buffer.from(request, 'base64')).toString('utf8');
  const match = /\bID="([^"]+)"/.exec(xml);
  if (!match?.[1]) throw new Error('no AuthnRequest id');
  return match[1];
}

export interface SamlResponseOptions {
  keys: TestIdpKeys;
  issuer: string;
  audience: string;
  acsUrl: string;
  inResponseTo: string;
  email: string;
  name?: string;
  /** `assertion` (Entra's default), `response` (Google), or `none`. */
  sign?: 'assertion' | 'response' | 'none';
  /** Minutes until NotOnOrAfter; negative for an expired assertion. */
  validMinutes?: number;
  /** Applied to the XML after signing, to tamper with it. */
  tamper?: (xml: string) => string;
}

/** A base64 SAMLResponse as an identity provider would post it. */
export function samlResponse(options: SamlResponseOptions): string {
  const now = new Date();
  const minutes = options.validMinutes ?? 5;
  const issued = new Date(now.getTime() + (minutes < 0 ? minutes * 60_000 - 120_000 : 0)).toISOString();
  const notBefore = new Date(now.getTime() - 60_000 + (minutes < 0 ? minutes * 60_000 - 120_000 : 0)).toISOString();
  const notOnOrAfter = new Date(now.getTime() + minutes * 60_000).toISOString();
  const responseId = `_r${randomUUID().replace(/-/g, '')}`;
  const assertionId = `_a${randomUUID().replace(/-/g, '')}`;

  const xml =
    `<samlp:Response xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol" xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion" ` +
    `ID="${responseId}" Version="2.0" IssueInstant="${issued}" Destination="${options.acsUrl}" InResponseTo="${options.inResponseTo}">` +
    `<saml:Issuer>${options.issuer}</saml:Issuer>` +
    `<samlp:Status><samlp:StatusCode Value="urn:oasis:names:tc:SAML:2.0:status:Success"/></samlp:Status>` +
    `<saml:Assertion ID="${assertionId}" Version="2.0" IssueInstant="${issued}">` +
    `<saml:Issuer>${options.issuer}</saml:Issuer>` +
    `<saml:Subject>` +
    `<saml:NameID Format="urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress">${options.email}</saml:NameID>` +
    `<saml:SubjectConfirmation Method="urn:oasis:names:tc:SAML:2.0:cm:bearer">` +
    `<saml:SubjectConfirmationData NotOnOrAfter="${notOnOrAfter}" Recipient="${options.acsUrl}" InResponseTo="${options.inResponseTo}"/>` +
    `</saml:SubjectConfirmation>` +
    `</saml:Subject>` +
    `<saml:Conditions NotBefore="${notBefore}" NotOnOrAfter="${notOnOrAfter}">` +
    `<saml:AudienceRestriction><saml:Audience>${options.audience}</saml:Audience></saml:AudienceRestriction>` +
    `</saml:Conditions>` +
    `<saml:AuthnStatement AuthnInstant="${issued}" SessionIndex="${assertionId}">` +
    `<saml:AuthnContext><saml:AuthnContextClassRef>urn:oasis:names:tc:SAML:2.0:ac:classes:PasswordProtectedTransport</saml:AuthnContextClassRef></saml:AuthnContext>` +
    `</saml:AuthnStatement>` +
    `<saml:AttributeStatement>` +
    `<saml:Attribute Name="email"><saml:AttributeValue>${options.email}</saml:AttributeValue></saml:Attribute>` +
    `<saml:Attribute Name="displayName"><saml:AttributeValue>${options.name ?? 'SAML Person'}</saml:AttributeValue></saml:Attribute>` +
    `</saml:AttributeStatement>` +
    `</saml:Assertion>` +
    `</samlp:Response>`;

  const sign = options.sign ?? 'assertion';
  let signed = xml;
  if (sign !== 'none') {
    const target = sign === 'assertion' ? 'Assertion' : 'Response';
    const signer = new SignedXml({
      privateKey: options.keys.key,
      publicCert: options.keys.cert,
      signatureAlgorithm: 'http://www.w3.org/2001/04/xmldsig-more#rsa-sha256',
      canonicalizationAlgorithm: 'http://www.w3.org/2001/10/xml-exc-c14n#',
    });
    signer.addReference({
      xpath: `//*[local-name(.)='${target}']`,
      transforms: [
        'http://www.w3.org/2000/09/xmldsig#enveloped-signature',
        'http://www.w3.org/2001/10/xml-exc-c14n#',
      ],
      digestAlgorithm: 'http://www.w3.org/2001/04/xmlenc#sha256',
    });
    signer.computeSignature(xml, {
      location: { reference: `//*[local-name(.)='${target}']/*[local-name(.)='Issuer']`, action: 'after' },
    });
    signed = signer.getSignedXml();
  }
  const final = options.tamper ? options.tamper(signed) : signed;
  return Buffer.from(final, 'utf8').toString('base64');
}
