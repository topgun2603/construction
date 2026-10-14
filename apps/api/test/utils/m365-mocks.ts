import { createHash, randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

/**
 * A stand-in for the Microsoft identity platform and Microsoft Graph, so the Microsoft 365 suites
 * need no tenant, no app registration and no network.
 *
 * A real HTTP server on a random local port: the API's own `fetch` calls run exactly as they would
 * against login.microsoftonline.com and graph.microsoft.com. It behaves like Microsoft where it
 * matters to security — the code exchange checks the client secret, the exact redirect URI and the
 * PKCE verifier against the challenge from the authorize URL, codes are single use, refresh tokens
 * can be revoked (`invalid_grant`), access tokens expire and are then refused with 401 — and it
 * records every request so a test can check the payload field by field.
 */

export interface MockUser {
  id: string;
  mail: string;
  displayName: string;
}

type Recipient = { emailAddress: { address: string; name?: string } };

/** The body of a `POST /me/sendMail` the API made. */
export interface SentMail {
  message: {
    subject: string;
    body: { contentType: string; content: string };
    toRecipients: Recipient[];
    ccRecipients?: Recipient[];
    internetMessageHeaders?: Array<{ name: string; value: string }>;
  };
  saveToSentItems: boolean;
}

export interface RecordedRequest {
  method: string;
  path: string;
  token: string | null;
  body: unknown;
}

export class MockMicrosoft {
  baseUrl = '';
  readonly clientId = `m365-client-${randomUUID().slice(0, 8)}`;
  readonly clientSecret = `m365-secret-${randomUUID()}`;
  redirectUri = '';
  /** Seconds an access token lives. 61 makes the API's minute of slack leave it already expired. */
  accessTokenTtl = 3600;
  /** Scopes granted at the code exchange; a test can withhold one. */
  grantedScope = 'Mail.Send Calendars.ReadWrite User.Read profile openid email';

  readonly tokenRequests: Array<Record<string, string>> = [];
  readonly graphRequests: RecordedRequest[] = [];
  /** The next Graph call (any) answers this instead. */
  failNext: { status: number; code: string; message: string } | null = null;

  private server: Server | null = null;
  private readonly users = new Map<string, MockUser>();
  private readonly codes = new Map<string, { challenge: string; user: MockUser; redirectUri: string }>();
  private readonly refreshTokens = new Map<string, MockUser>();
  private readonly accessTokens = new Map<string, { user: MockUser; expiresAt: number }>();
  private readonly events = new Map<string, { owner: string; body: Record<string, unknown> }>();
  private readonly transactionIds = new Map<string, string>();

  async start(): Promise<this> {
    this.server = createServer((req, res) => {
      void this.handle(req).then(
        ({ status, body, headers }) => {
          res.writeHead(status, { 'Content-Type': 'application/json', ...(headers ?? {}) });
          res.end(body === undefined ? '' : JSON.stringify(body));
        },
        () => {
          res.writeHead(500);
          res.end();
        },
      );
    });
    // IPv6 loopback, like the suites' own server: 127.0.0.1's ephemeral ports are the ones a busy
    // machine runs out of first.
    await new Promise<void>((resolve) => this.server?.listen(0, '::1', resolve));
    const { port } = this.server.address() as AddressInfo;
    this.baseUrl = `http://[::1]:${port}`;
    return this;
  }

  async stop(): Promise<void> {
    await new Promise<void>((resolve) => (this.server ? this.server.close(() => resolve()) : resolve()));
  }

  user(mail: string, displayName = 'Projects Mailbox'): MockUser {
    let user = this.users.get(mail);
    if (!user) {
      user = { id: randomUUID(), mail, displayName };
      this.users.set(mail, user);
    }
    return user;
  }

  /**
   * What happens in the browser at Microsoft: the person signs in as `mail` and consents. Checks the
   * authorize URL the API built and returns the code and state Microsoft would redirect back with.
   */
  consent(authorizeUrl: string, mail: string): { code: string; state: string; url: URL } {
    const url = new URL(authorizeUrl);
    const challenge = url.searchParams.get('code_challenge');
    if (!challenge || url.searchParams.get('code_challenge_method') !== 'S256') throw new Error('no PKCE');
    const code = `code-${randomUUID()}`;
    this.codes.set(code, { challenge, user: this.user(mail), redirectUri: url.searchParams.get('redirect_uri') ?? '' });
    return { code, state: url.searchParams.get('state') ?? '', url };
  }

  /** The admin removed the app's consent in Entra: every refresh token for that mailbox dies. */
  revoke(mail: string): void {
    for (const [token, user] of this.refreshTokens) if (user.mail === mail) this.refreshTokens.delete(token);
    this.expireAccessTokens();
  }

  /** Every access token stops working now (a password reset, a revoked session). */
  expireAccessTokens(): void {
    this.accessTokens.clear();
  }

  /** Graph requests by method and a path prefix, e.g. `('POST', '/v1.0/me/sendMail')`. */
  requests(method: string, pathPrefix: string): RecordedRequest[] {
    return this.graphRequests.filter((entry) => entry.method === method && entry.path.startsWith(pathPrefix));
  }

  lastMail(): SentMail {
    const sent = this.requests('POST', '/v1.0/me/sendMail');
    if (sent.length === 0) throw new Error('no mail sent');
    return sent.at(-1)!.body as SentMail;
  }

  eventCount(): number {
    return this.events.size;
  }

  clearRecords(): void {
    this.graphRequests.length = 0;
    this.tokenRequests.length = 0;
  }

  // --- the server ----------------------------------------------------------------------------------

  private async handle(req: IncomingMessage): Promise<{ status: number; body?: unknown; headers?: Record<string, string> }> {
    const raw = await readBody(req);
    const path = req.url ?? '/';
    if (req.method === 'POST' && /^\/[^/]+\/oauth2\/v2\.0\/token$/.test(path)) {
      return this.token(Object.fromEntries(new URLSearchParams(raw)));
    }
    if (path.startsWith('/v1.0/')) return this.graph(req, path, raw);
    return { status: 404, body: { error: 'not_found' } };
  }

  private token(form: Record<string, string>) {
    this.tokenRequests.push(form);
    if (form['client_id'] !== this.clientId || form['client_secret'] !== this.clientSecret) {
      return refused('invalid_client', 'AADSTS7000215: Invalid client secret provided.', 401);
    }
    let user: MockUser;
    if (form['grant_type'] === 'authorization_code') {
      const grant = this.codes.get(form['code'] ?? '');
      this.codes.delete(form['code'] ?? ''); // single use, like Microsoft's
      if (!grant) return refused('invalid_grant', 'AADSTS70008: The provided authorization code is expired or used.');
      if (form['redirect_uri'] !== grant.redirectUri || form['redirect_uri'] !== this.redirectUri) {
        return refused('invalid_grant', 'AADSTS50011: The redirect URI does not match.');
      }
      const verifier = form['code_verifier'] ?? '';
      if (createHash('sha256').update(verifier).digest('base64url') !== grant.challenge) {
        return refused('invalid_grant', 'AADSTS501481: The Code_Verifier does not match the code_challenge.');
      }
      user = grant.user;
    } else if (form['grant_type'] === 'refresh_token') {
      const found = this.refreshTokens.get(form['refresh_token'] ?? '');
      if (!found) return refused('invalid_grant', 'AADSTS70000: The provided grant has been revoked.');
      user = found;
    } else {
      return refused('unsupported_grant_type', 'unsupported');
    }
    const accessToken = `at-${randomUUID()}`;
    const refreshToken = `rt-${randomUUID()}`;
    this.accessTokens.set(accessToken, { user, expiresAt: Date.now() + this.accessTokenTtl * 1000 });
    // Microsoft keeps an earlier refresh token valid after issuing a new one.
    this.refreshTokens.set(refreshToken, user);
    return {
      status: 200,
      body: {
        token_type: 'Bearer',
        scope: this.grantedScope,
        expires_in: this.accessTokenTtl,
        access_token: accessToken,
        refresh_token: refreshToken,
      },
    };
  }

  private graph(req: IncomingMessage, path: string, raw: string) {
    const header = req.headers['authorization'];
    const token = typeof header === 'string' && header.startsWith('Bearer ') ? header.slice(7) : null;
    const body = raw ? JSON.parse(raw) : undefined;
    const method = req.method ?? 'GET';
    this.graphRequests.push({ method, path, token, body });

    const session = token ? this.accessTokens.get(token) : undefined;
    if (!session || session.expiresAt <= Date.now()) {
      return { status: 401, body: { error: { code: 'InvalidAuthenticationToken', message: 'Access token has expired.' } } };
    }
    if (this.failNext) {
      const failure = this.failNext;
      this.failNext = null;
      return { status: failure.status, body: { error: { code: failure.code, message: failure.message } }, headers: { 'request-id': 'req-failed' } };
    }
    const requestId = `req-${randomUUID()}`;
    const user = session.user;

    if (method === 'GET' && path.startsWith('/v1.0/me?')) {
      return { status: 200, body: { id: user.id, mail: user.mail, userPrincipalName: user.mail, displayName: user.displayName } };
    }
    if (method === 'POST' && path === '/v1.0/me/sendMail') {
      return { status: 202, headers: { 'request-id': requestId } };
    }
    if (method === 'POST' && path === '/v1.0/me/events') {
      const transactionId = (body as { transactionId?: string }).transactionId;
      const repeat = transactionId ? this.transactionIds.get(transactionId) : undefined;
      if (repeat) return { status: 201, body: { id: repeat } };
      const id = `evt-${randomUUID()}`;
      this.events.set(id, { owner: user.mail, body: body as Record<string, unknown> });
      if (transactionId) this.transactionIds.set(transactionId, id);
      return { status: 201, body: { id }, headers: { 'request-id': requestId } };
    }
    const event = /^\/v1\.0\/me\/events\/([^/]+)(\/cancel)?$/.exec(path);
    if (event) {
      const id = decodeURIComponent(event[1]!);
      const stored = this.events.get(id);
      if (!stored || stored.owner !== user.mail) return { status: 404, body: { error: { code: 'ErrorItemNotFound', message: 'Not found' } } };
      if (method === 'PATCH') {
        stored.body = { ...stored.body, ...(body as Record<string, unknown>) };
        return { status: 200, body: { id } };
      }
      if (method === 'DELETE' || (method === 'POST' && event[2])) {
        this.events.delete(id);
        return { status: method === 'DELETE' ? 204 : 202 };
      }
    }
    return { status: 400, body: { error: { code: 'BadRequest', message: `Unexpected ${method} ${path}` } } };
  }
}

function refused(error: string, description: string, status = 400) {
  return { status, body: { error, error_description: description } };
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}
