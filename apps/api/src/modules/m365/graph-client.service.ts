import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { M365ConfigService } from './m365-config.service';

/**
 * The few Microsoft identity platform and Graph calls the integration makes, over plain `fetch`.
 *
 * WHY NOT THE GRAPH SDK. Six requests — two to the token endpoint, `GET /me`, `sendMail` and the
 * event create/update/cancel — do not justify a dependency that pulls in its own auth layer and
 * middleware chain, and plain requests are what the e2e suite's local stand-in can check field by
 * field. Every URL is built from `M365ConfigService`, i.e. Microsoft's own hosts.
 */

export interface M365TokenSet {
  accessToken: string;
  /** Microsoft issues a new refresh token with each refresh; absent only if it chose not to. */
  refreshToken: string | null;
  expiresAt: Date;
  scope: string;
}

export interface GraphMe {
  id: string;
  mail: string | null;
  userPrincipalName: string | null;
  displayName: string | null;
}

export interface GraphRecipient {
  emailAddress: { address: string; name?: string };
}

/** The `message` of `POST /me/sendMail`. */
export interface GraphMessage {
  subject: string;
  body: { contentType: 'HTML' | 'Text'; content: string };
  toRecipients: GraphRecipient[];
  ccRecipients?: GraphRecipient[];
  internetMessageHeaders?: Array<{ name: string; value: string }>;
}

/** The body of `POST /me/events` / `PATCH /me/events/{id}`. */
export interface GraphEvent {
  subject: string;
  body: { contentType: 'HTML' | 'Text'; content: string };
  start: { dateTime: string; timeZone: string };
  end: { dateTime: string; timeZone: string };
  location?: { displayName: string };
  attendees?: Array<GraphRecipient & { type: 'required' | 'optional' }>;
  isAllDay?: boolean;
  showAs?: 'free' | 'busy' | 'tentative';
  isReminderOn?: boolean;
  /** Graph's idempotency key on create: a retried request does not book the meeting twice. */
  transactionId?: string;
  categories?: string[];
}

/** Microsoft refused the stored grant (revoked, expired, consent withdrawn): connect again. */
export class M365GrantError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
  }
}

/** A Graph call that failed, with Microsoft's own error code and message. */
export class GraphRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly requestId: string | null,
  ) {
    super(message);
  }
}

const FETCH_TIMEOUT_MS = 15_000;

@Injectable()
export class GraphClient {
  private readonly logger = new Logger(GraphClient.name);

  constructor(private readonly config: M365ConfigService) {}

  /** The authorization-code grant with PKCE (RFC 7636), for the connect callback. */
  async exchangeCode(code: string, codeVerifier: string): Promise<M365TokenSet> {
    return this.token({
      grant_type: 'authorization_code',
      code,
      redirect_uri: this.config.redirectUri,
      code_verifier: codeVerifier,
      scope: this.config.scope,
    });
  }

  async refresh(refreshToken: string): Promise<M365TokenSet> {
    return this.token({ grant_type: 'refresh_token', refresh_token: refreshToken, scope: this.config.scope });
  }

  async me(accessToken: string): Promise<GraphMe> {
    const { body } = await this.request<GraphMe>(accessToken, 'GET', '/me?$select=id,mail,userPrincipalName,displayName');
    return body;
  }

  /** `POST /me/sendMail`: 202 and no body. Microsoft's `request-id` is what identifies the call. */
  async sendMail(accessToken: string, message: GraphMessage): Promise<{ requestId: string | null }> {
    const { requestId } = await this.request(accessToken, 'POST', '/me/sendMail', { message, saveToSentItems: true });
    return { requestId };
  }

  async createEvent(accessToken: string, event: GraphEvent): Promise<{ id: string }> {
    const { body } = await this.request<{ id: string }>(accessToken, 'POST', '/me/events', event);
    return { id: body.id };
  }

  async updateEvent(accessToken: string, id: string, event: GraphEvent): Promise<void> {
    // `transactionId` is a create-only property.
    const { transactionId: _ignored, ...patch } = event;
    await this.request(accessToken, 'PATCH', `/me/events/${encodeURIComponent(id)}`, patch);
  }

  /** Sends the attendees a cancellation, which deletes it from their calendars and the organiser's. */
  async cancelEvent(accessToken: string, id: string, comment: string): Promise<void> {
    await this.request(accessToken, 'POST', `/me/events/${encodeURIComponent(id)}/cancel`, { comment });
  }

  /** Deletes an event with no attendees (a synced milestone). Already gone counts as done. */
  async deleteEvent(accessToken: string, id: string): Promise<void> {
    try {
      await this.request(accessToken, 'DELETE', `/me/events/${encodeURIComponent(id)}`);
    } catch (error) {
      if (error instanceof GraphRequestError && error.status === 404) return;
      throw error;
    }
  }

  // --- plumbing ------------------------------------------------------------------------------------

  private async token(fields: Record<string, string>): Promise<M365TokenSet> {
    const body = new URLSearchParams({
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
      ...fields,
    });
    let response: Response;
    try {
      response = await fetch(this.config.tokenEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
        body,
        redirect: 'error',
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
    } catch (error) {
      this.logger.warn({ err: error }, 'Microsoft token endpoint unreachable');
      throw new GraphRequestError(503, 'unreachable', 'Could not reach Microsoft. Try again in a minute.', null);
    }
    const payload = (await response.json().catch(() => null)) as {
      access_token?: unknown;
      refresh_token?: unknown;
      expires_in?: unknown;
      scope?: unknown;
      error?: unknown;
      error_description?: unknown;
    } | null;
    if (!response.ok || !payload || typeof payload.access_token !== 'string') {
      const code = typeof payload?.error === 'string' ? payload.error : `http_${response.status}`;
      // Microsoft's descriptions start with an AADSTS code, which is what an admin searches for.
      const description =
        typeof payload?.error_description === 'string' ? payload.error_description.split('\r\n')[0]!.slice(0, 300) : '';
      this.logger.warn({ status: response.status, code, description }, 'Microsoft token request refused');
      if (code === 'invalid_grant' || code === 'interaction_required' || code === 'consent_required') {
        throw new M365GrantError(code, description || 'Microsoft no longer accepts this connection.');
      }
      throw new GraphRequestError(response.status, code, description || 'Microsoft refused the request.', null);
    }
    const expiresIn = Number(payload.expires_in);
    return {
      accessToken: payload.access_token,
      refreshToken: typeof payload.refresh_token === 'string' ? payload.refresh_token : null,
      // A minute early, so a token is never used in the second it lapses.
      expiresAt: new Date(Date.now() + (Number.isFinite(expiresIn) ? expiresIn : 3600) * 1000 - 60_000),
      scope: typeof payload.scope === 'string' ? payload.scope : this.config.scope,
    };
  }

  private async request<T = unknown>(
    accessToken: string,
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
    path: string,
    json?: unknown,
  ): Promise<{ body: T; requestId: string | null }> {
    const clientRequestId = randomUUID();
    let response: Response;
    try {
      response = await fetch(`${this.config.graphBase}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: 'application/json',
          'client-request-id': clientRequestId,
          ...(json === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        ...(json === undefined ? {} : { body: JSON.stringify(json) }),
        redirect: 'error',
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
    } catch (error) {
      this.logger.warn({ err: error, path }, 'Microsoft Graph unreachable');
      throw new GraphRequestError(503, 'unreachable', 'Could not reach Microsoft. Try again in a minute.', null);
    }
    const requestId = response.headers.get('request-id') ?? clientRequestId;
    const text = await response.text();
    const body = text ? (safeJson(text) as T) : (undefined as T);
    if (!response.ok) {
      const error = (body as { error?: { code?: string; message?: string } } | undefined)?.error;
      throw new GraphRequestError(
        response.status,
        error?.code ?? `http_${response.status}`,
        (error?.message ?? 'Microsoft refused the request.').slice(0, 300),
        requestId,
      );
    }
    return { body, requestId };
  }
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}
