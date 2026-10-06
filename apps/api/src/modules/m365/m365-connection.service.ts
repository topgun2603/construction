import { Injectable, Logger } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import type { M365CallbackInput, M365ConnectInput } from '@sitebook/shared';
import type { RequestUser } from '../../common/auth/request-user';
import { ApiError } from '../../common/errors/api-error';
import { TenantDb } from '../../common/prisma/tenant-db.service';
import { GraphClient, GraphRequestError, M365GrantError, type M365TokenSet } from './graph-client.service';
import { M365ConfigService, notConfigured } from './m365-config.service';

/** How long a connect may sit at Microsoft's sign-in page. */
const REQUEST_TTL_MS = 10 * 60 * 1000;
/** Microsoft hands out a new refresh token on every refresh; keep the newest at most this often. */
const ROTATE_REFRESH_TOKEN_MS = 24 * 60 * 60 * 1000;
/** Scopes without which the connection is pointless. The rest are nice to have. */
const REQUIRED_SCOPES = ['Mail.Send', 'Calendars.ReadWrite'];

export type M365AuditAction = 'm365.connected' | 'm365.disconnected' | 'm365.reconnect_needed';

/** A usable mailbox: its address and a live access token. */
export interface M365Session {
  mailbox: string;
  mailboxName: string | null;
  accessToken: string;
}

/**
 * The company's Microsoft 365 connection: connecting (OAuth 2.0 authorization code + PKCE against
 * the Microsoft identity platform), keeping a live access token, and disconnecting.
 *
 *   1. start     `integrations.manage` asks to connect. A random `state` (only its SHA-256 stored)
 *                and a PKCE verifier (encrypted) go in `integration_m365_auth_requests`, owned by
 *                the person who asked; the browser goes to Microsoft with the state and the S256
 *                challenge.
 *   2. callback  Microsoft sends the browser to the *web* page at MS_GRAPH_REDIRECT_URI, which posts
 *                code + state here with that person's own session. The request must be theirs, in
 *                this company, unexpired and unused — so somebody who tricks an admin into opening
 *                a connect link cannot attach their mailbox to that admin's company, nor the
 *                other way round. The code is redeemed with the verifier, `GET /me` names the
 *                mailbox, and the refresh token is stored encrypted.
 *   3. use       `withGraph` hands a live access token to a Graph call, refreshing when it is about
 *                to lapse, and once more if Graph answers 401. A refused refresh marks the
 *                connection `needs_reconnect`: every "Send by email" then falls back, and the card
 *                asks an owner to connect again.
 *
 * Disconnecting deletes the tokens. Microsoft has no endpoint for an app to revoke a delegated
 * grant, so the settings card says where to remove the consent (Entra → Enterprise applications)
 * for anybody who wants Microsoft's side gone as well.
 */
@Injectable()
export class M365ConnectionService {
  private readonly logger = new Logger(M365ConnectionService.name);
  /** One refresh per company at a time in this process: concurrent sends share its result. */
  private readonly refreshing = new Map<string, Promise<M365Session>>();

  constructor(
    private readonly tenantDb: TenantDb,
    private readonly config: M365ConfigService,
    private readonly graph: GraphClient,
  ) {}

  // --- settings ------------------------------------------------------------------------------------

  async overview(actor: RequestUser) {
    const data = await this.tenantDb.transaction(actor.tenantId, async (tx) => {
      const connection = await tx.integrationM365Connection.findFirst({});
      const connectedBy = connection?.connectedByUserId
        ? await tx.user.findFirst({ where: { id: connection.connectedByUserId }, select: { id: true, name: true } })
        : null;
      const deliveries = await tx.emailDelivery.findMany({ orderBy: { createdAt: 'desc' }, take: 20 });
      const synced = connection ? await tx.integrationM365CalendarEvent.count() : 0;
      return { connection, connectedBy, deliveries, synced };
    });
    const { connection } = data;
    return {
      deployment: {
        configured: this.config.configured,
        missing: this.config.missingSettings,
        redirect_uri: this.config.configured ? this.config.redirectUri : null,
        scopes: this.config.scope.split(' '),
      },
      connection: connection
        ? {
            status: connection.status,
            mailbox_email: connection.mailboxEmail,
            mailbox_name: connection.mailboxName,
            // Never a token, not even encrypted.
            scopes: connection.scopes.split(' ').filter(Boolean),
            calendar_sync: connection.calendarSync,
            calendar_synced_at: connection.calendarSyncedAt?.toISOString() ?? null,
            calendar_events: data.synced,
            last_error: connection.lastError,
            last_used_at: connection.lastUsedAt?.toISOString() ?? null,
            connected_at: connection.connectedAt.toISOString(),
            connected_by: data.connectedBy,
          }
        : null,
      recent_deliveries: data.deliveries.map(deliveryView),
    };
  }

  /**
   * Whether "Send by email" can be offered, for any signed-in member — a feature screen needs to know
   * whether to show the button, not who connected it or how.
   */
  async status(tenantId: string): Promise<{ connected: boolean; mailbox: string | null }> {
    const connection = await this.tenantDb
      .clientFor(tenantId)
      .integrationM365Connection.findFirst({ select: { status: true, mailboxEmail: true } });
    const connected = this.config.configured && connection?.status === 'connected';
    return { connected, mailbox: connected ? connection!.mailboxEmail : null };
  }

  // --- connecting ----------------------------------------------------------------------------------

  async start(actor: RequestUser, input: M365ConnectInput): Promise<{ redirect_url: string }> {
    if (!this.config.configured) throw notConfigured();
    const state = randomBytes(32).toString('base64url');
    const verifier = randomBytes(32).toString('base64url');
    const challenge = createHash('sha256').update(verifier).digest('base64url');

    await this.tenantDb.transaction(actor.tenantId, async (tx) => {
      // Yesterday's abandoned attempts are of no use to anybody.
      await tx.integrationM365AuthRequest.deleteMany({ where: { expiresAt: { lt: new Date(Date.now() - REQUEST_TTL_MS) } } });
      await tx.integrationM365AuthRequest.create({
        data: {
          tenantId: actor.tenantId,
          userId: actor.userId,
          stateHash: sha256(state),
          pkceVerifierCipher: this.config.cipher().encrypt(verifier),
          expiresAt: new Date(Date.now() + REQUEST_TTL_MS),
        },
      });
    });

    const url = new URL(this.config.authorizeEndpoint);
    url.searchParams.set('client_id', this.config.clientId);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('redirect_uri', this.config.redirectUri);
    url.searchParams.set('response_mode', 'query');
    url.searchParams.set('scope', this.config.scope);
    url.searchParams.set('state', state);
    url.searchParams.set('code_challenge', challenge);
    url.searchParams.set('code_challenge_method', 'S256');
    // Always the account picker: the admin is often signed in as themselves and means to connect
    // the shared projects@ mailbox.
    url.searchParams.set('prompt', 'select_account');
    if (input.login_hint) url.searchParams.set('login_hint', input.login_hint);
    return { redirect_url: url.toString() };
  }

  async callback(actor: RequestUser, input: M365CallbackInput) {
    if (!this.config.configured) throw notConfigured();
    const verifier = await this.tenantDb.transaction(actor.tenantId, async (tx) => {
      const request = await tx.integrationM365AuthRequest.findFirst({ where: { stateHash: sha256(input.state) } });
      if (!request || request.usedAt || request.expiresAt <= new Date()) {
        throw ApiError.invalidToken('This Microsoft 365 sign-in has expired or was already used. Start again.');
      }
      if (request.userId !== actor.userId) {
        throw ApiError.forbidden('Only the person who started connecting Microsoft 365 can finish it.');
      }
      // Claimed before the code is redeemed: two tabs racing on one callback get one connection.
      const claimed = await tx.integrationM365AuthRequest.updateMany({
        where: { id: request.id, usedAt: null },
        data: { usedAt: new Date() },
      });
      if (claimed.count !== 1) throw ApiError.invalidToken('This Microsoft 365 sign-in was already used. Start again.');
      return this.config.cipher().decrypt(request.pkceVerifierCipher);
    });

    const tokens = await this.redeem(() => this.graph.exchangeCode(input.code, verifier));
    if (!tokens.refreshToken) {
      throw ApiError.conflict('Microsoft did not allow offline access, so emails could not be sent later. Ask your Microsoft 365 admin to allow it.');
    }
    const granted = normaliseScopes(tokens.scope);
    const missing = REQUIRED_SCOPES.filter((scope) => !granted.includes(scope));
    if (missing.length > 0) {
      throw ApiError.conflict(`Microsoft did not grant ${missing.join(' and ')}. Ask your Microsoft 365 admin to approve the app's permissions.`);
    }
    const me = await this.redeem(() => this.graph.me(tokens.accessToken));
    const mailbox = (me.mail ?? me.userPrincipalName ?? '').trim().toLowerCase();
    if (!mailbox.includes('@')) {
      throw ApiError.conflict('That Microsoft account has no mailbox. Connect an account with Exchange Online email.');
    }

    const cipher = this.config.cipher();
    const now = new Date();
    const fields = {
      status: 'connected',
      mailboxEmail: mailbox,
      mailboxName: me.displayName?.trim() || null,
      msUserId: me.id,
      scopes: granted.join(' '),
      refreshTokenCipher: cipher.encrypt(tokens.refreshToken),
      refreshTokenRotatedAt: now,
      accessTokenCipher: cipher.encrypt(tokens.accessToken),
      accessTokenExpiresAt: tokens.expiresAt,
      lastError: null,
      connectedByUserId: actor.userId,
      connectedAt: now,
    };
    await this.tenantDb.transaction(actor.tenantId, async (tx) => {
      const existing = await tx.integrationM365Connection.findFirst({ select: { id: true, msUserId: true } });
      if (existing) {
        await tx.integrationM365Connection.update({ where: { id: existing.id }, data: fields });
        // A different mailbox's calendar does not hold the events the old one's sync made.
        if (existing.msUserId !== me.id) await tx.integrationM365CalendarEvent.deleteMany({});
      } else {
        await tx.integrationM365Connection.create({ data: { tenantId: actor.tenantId, ...fields } });
      }
      await audit(tx, actor.tenantId, actor.userId, 'm365.connected', { mailbox, scopes: granted });
    });
    return this.overview(actor);
  }

  /**
   * Forgets the tokens. Events the calendar sync made are taken out of the calendar first, best
   * effort — a calendar full of stale milestones nobody can update any more is worse than none.
   */
  async disconnect(actor: RequestUser, removeEvents: (session: M365Session) => Promise<void>) {
    const connection = await this.tenantDb
      .clientFor(actor.tenantId)
      .integrationM365Connection.findFirst({ select: { id: true, mailboxEmail: true, status: true } });
    if (!connection) return this.overview(actor);
    if (connection.status === 'connected' && this.config.configured) {
      try {
        await removeEvents(await this.session(actor.tenantId));
      } catch (error) {
        this.logger.warn({ err: error, tenantId: actor.tenantId }, 'Could not remove synced events before disconnecting');
      }
    }
    await this.tenantDb.transaction(actor.tenantId, async (tx) => {
      await tx.integrationM365CalendarEvent.deleteMany({});
      await tx.integrationM365AuthRequest.deleteMany({});
      await tx.integrationM365Connection.deleteMany({});
      await audit(tx, actor.tenantId, actor.userId, 'm365.disconnected', { mailbox: connection.mailboxEmail });
    });
    return this.overview(actor);
  }

  // --- using it ------------------------------------------------------------------------------------

  /** The mailbox and a live access token, or a 409 saying it is not connected. */
  async session(tenantId: string, forceRefresh = false): Promise<M365Session> {
    if (!this.config.configured) throw notConnected();
    const connection = await this.tenantDb.clientFor(tenantId).integrationM365Connection.findFirst({});
    if (!connection) throw notConnected();
    if (connection.status !== 'connected') throw notConnected(true);
    if (!forceRefresh && connection.accessTokenCipher && connection.accessTokenExpiresAt && connection.accessTokenExpiresAt > new Date()) {
      return {
        mailbox: connection.mailboxEmail,
        mailboxName: connection.mailboxName,
        accessToken: this.config.cipher().decrypt(connection.accessTokenCipher),
      };
    }
    const inFlight = this.refreshing.get(tenantId);
    if (inFlight) return inFlight;
    const refresh = this.refresh(tenantId, connection).finally(() => this.refreshing.delete(tenantId));
    this.refreshing.set(tenantId, refresh);
    return refresh;
  }

  /**
   * Runs one Graph call with a live token. A 401 means the access token died early (a password
   * reset, a revoked session): refresh once and try again; a second 401 is a real refusal.
   */
  async withGraph<T>(tenantId: string, call: (session: M365Session) => Promise<T>): Promise<T> {
    const session = await this.session(tenantId);
    let result: T;
    try {
      result = await call(session);
    } catch (error) {
      if (!(error instanceof GraphRequestError) || error.status !== 401) throw error;
      result = await call(await this.session(tenantId, true));
    }
    await this.tenantDb
      .clientFor(tenantId)
      .integrationM365Connection.updateMany({ data: { lastUsedAt: new Date() } })
      .catch(() => undefined);
    return result;
  }

  private async refresh(
    tenantId: string,
    connection: { id: string; mailboxEmail: string; mailboxName: string | null; refreshTokenCipher: string; refreshTokenRotatedAt: Date },
  ): Promise<M365Session> {
    const cipher = this.config.cipher();
    let tokens: M365TokenSet;
    try {
      tokens = await this.graph.refresh(cipher.decrypt(connection.refreshTokenCipher));
    } catch (error) {
      if (error instanceof M365GrantError) {
        // Consent withdrawn, password changed, the account disabled: nothing the product can fix.
        await this.tenantDb.transaction(tenantId, async (tx) => {
          await tx.integrationM365Connection.update({
            where: { id: connection.id },
            data: { status: 'needs_reconnect', lastError: error.message, accessTokenCipher: null, accessTokenExpiresAt: null },
          });
          await audit(tx, tenantId, null, 'm365.reconnect_needed', { mailbox: connection.mailboxEmail, reason: error.code });
        });
        throw notConnected(true);
      }
      throw error;
    }
    const rotate = Boolean(tokens.refreshToken) && Date.now() - connection.refreshTokenRotatedAt.getTime() > ROTATE_REFRESH_TOKEN_MS;
    await this.tenantDb.clientFor(tenantId).integrationM365Connection.update({
      where: { id: connection.id },
      data: {
        accessTokenCipher: cipher.encrypt(tokens.accessToken),
        accessTokenExpiresAt: tokens.expiresAt,
        ...(rotate ? { refreshTokenCipher: cipher.encrypt(tokens.refreshToken!), refreshTokenRotatedAt: new Date() } : {}),
      },
    });
    return { mailbox: connection.mailboxEmail, mailboxName: connection.mailboxName, accessToken: tokens.accessToken };
  }

  /** A Microsoft refusal during connect, as something the admin can act on. */
  private async redeem<T>(call: () => Promise<T>): Promise<T> {
    try {
      return await call();
    } catch (error) {
      if (error instanceof M365GrantError || error instanceof GraphRequestError) {
        throw ApiError.conflict(`Microsoft refused the connection: ${error.message}`);
      }
      throw error;
    }
  }
}

export function notConnected(needsReconnect = false): ApiError {
  return ApiError.conflict(
    needsReconnect
      ? 'Microsoft 365 needs connecting again (Settings → Integrations). Send it by WhatsApp or copy the link meanwhile.'
      : 'Microsoft 365 is not connected. Send it by WhatsApp or copy the link, or connect a mailbox in Settings → Integrations.',
    { reason: needsReconnect ? 'm365_needs_reconnect' : 'm365_not_connected' },
  );
}

export function deliveryView(row: {
  id: string;
  kind: string;
  entityType: string | null;
  entityId: string | null;
  toEmails: string[];
  ccEmails: string[];
  fromEmail: string;
  subject: string;
  status: string;
  providerRequestId: string | null;
  error: string | null;
  sentAt: Date | null;
  createdAt: Date;
}) {
  return {
    id: row.id,
    kind: row.kind,
    entity_type: row.entityType,
    entity_id: row.entityId,
    from: row.fromEmail,
    to: row.toEmails,
    cc: row.ccEmails,
    subject: row.subject,
    status: row.status,
    provider_request_id: row.providerRequestId,
    error: row.error,
    sent_at: row.sentAt?.toISOString() ?? null,
    created_at: row.createdAt.toISOString(),
  };
}

/** A hand-written audit entry, in the caller's transaction so it stands or falls with the change. */
export async function audit(
  tx: Prisma.TransactionClient,
  tenantId: string,
  actorId: string | null,
  action: M365AuditAction | 'meeting.invite_sent' | 'meeting.minutes_sent' | 'meeting.cancelled',
  after: Prisma.InputJsonValue,
  entity = 'integration_m365_connections',
  entityId: string | null = null,
): Promise<void> {
  await tx.auditLog.create({ data: { tenantId, actorId, action, entity, entityId, after } });
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/** `https://graph.microsoft.com/Mail.Send` and `Mail.Send` are the same grant. */
function normaliseScopes(scope: string): string[] {
  return [...new Set(scope.split(/\s+/).filter(Boolean).map((entry) => entry.split('/').pop()!))];
}
