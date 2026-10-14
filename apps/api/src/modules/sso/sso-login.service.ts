import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import {
  ERROR_CODES,
  SSO_PLACEHOLDER_PHONE_PREFIX,
  ssoDomainOf,
  type SsoCompleteInput,
  type SsoStartInput,
  type TokenPair,
} from '@sitebook/shared';
import type { SsoConnection } from '@prisma/client';
import { ApiError } from '../../common/errors/api-error';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TenantDb, type TenantTx } from '../../common/prisma/tenant-db.service';
import { TokenService, identityClaim } from '../../common/auth/token.service';
import { AuthService } from '../auth/auth.service';
import { OidcClientService } from './oidc-client.service';
import { SamlClientService, type SamlIdpSettings } from './saml-client.service';
import { SsoConfigService } from './sso-config.service';

/** How long a sign-in may sit at the identity provider — matches the signed state's lifetime. */
const REQUEST_TTL_MS = 10 * 60 * 1000;

/** Who the provider said signed in, before they are matched to anybody here. */
interface AssertedIdentity {
  email: string;
  name: string | null;
}

/**
 * "Sign in with SSO", end to end.
 *
 *   1. start     work email → verified domain → company (`sso_domain_directory`) → its connection.
 *                A `sso_login_requests` row holds the nonce, PKCE verifier or SAML request id; the
 *                provider gets a signed state naming only the company and that row.
 *   2. callback  the provider answers (OIDC code to our redirect URI, or a SAMLResponse posted to
 *                the ACS URL). The row is claimed once, the answer verified against *this company's*
 *                connection only, the address matched to a person in this company (or created,
 *                when JIT is on). The browser is sent to the web callback with a two-minute ticket
 *                in the URL fragment — never a token in a URL.
 *   3. complete  the web page swaps the ticket, plus the browser binding it made at step 1, for our
 *                usual token pair, with `idn = email:<address>` so the company switcher works.
 *
 * CROSS-COMPANY SAFETY. The company is fixed by the signed state at step 1 and every check after
 * uses that company's connection: company B's provider cannot answer for company A, because A's
 * certificate or JWKS is what the answer is verified against. And the address the provider asserts
 * must be on a domain the company has *verified* — otherwise B's provider could assert an address at
 * A's domain, and the `email:` identity in the session would let the company switcher walk that
 * person into A.
 */
@Injectable()
export class SsoLoginService {
  private readonly logger = new Logger(SsoLoginService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantDb: TenantDb,
    private readonly tokens: TokenService,
    private readonly auth: AuthService,
    private readonly ssoConfig: SsoConfigService,
    private readonly oidc: OidcClientService,
    private readonly saml: SamlClientService,
  ) {}

  async start(input: SsoStartInput): Promise<{ redirect_url: string }> {
    const domain = ssoDomainOf(input.email);
    if (!domain) throw ApiError.validationFailed({ email: 'not an address' }, 'Enter your work email.');

    // The one lookup made before any company is known: a verified domain to a tenant id, from the
    // trigger-kept directory (see the migration header). Nothing else is readable from here.
    const entry = await this.prisma.ssoDomainDirectory.findUnique({
      where: { domain },
      select: { tenantId: true },
    });
    if (!entry) throw notSetUp(domain);
    const tenantId = entry.tenantId;

    const connection = await this.tenantDb.transaction(tenantId, async (tx) => {
      await assertTenantActive(tx, tenantId);
      return tx.ssoConnection.findFirst({});
    });
    if (!connection?.enabled) throw notSetUp(domain);
    if (!this.ssoConfig.urlsConfigured) throw notSetUp(domain);

    const requestId = randomUUID();
    const state = this.tokens.signSsoState({ tenantId, requestId });
    const base = {
      id: requestId,
      tenantId,
      connectionId: connection.id,
      protocol: connection.protocol,
      bindingHash: sha256(input.binding),
      expiresAt: new Date(Date.now() + REQUEST_TTL_MS),
    };

    if (connection.protocol === 'oidc') {
      const { issuer, clientId } = requireOidc(connection);
      // Discovery before the row: a provider that cannot be reached leaves nothing behind.
      const discovery = await this.oidc.discover(issuer);
      const nonce = randomBytes(24).toString('base64url');
      const pkce = OidcClientService.pkce();
      await this.saveRequest(tenantId, { ...base, nonce, pkceVerifierSecret: pkce.verifier });
      return {
        redirect_url: this.oidc.authorizeUrl(discovery, {
          clientId,
          scopes: connection.oidcScopes,
          state,
          nonce,
          codeChallenge: pkce.challenge,
          loginHint: input.email,
        }),
      };
    }

    const idp = requireSaml(connection);
    const samlRequestId = SamlClientService.newRequestId();
    await this.saveRequest(tenantId, { ...base, samlRequestId });
    return {
      redirect_url: await this.saml.authorizeUrl(tenantId, idp, { requestId: samlRequestId, relayState: state }),
    };
  }

  /** `GET /auth/sso/oidc/callback`. Always answers with where to send the browser next. */
  async oidcCallback(query: Record<string, unknown>): Promise<string> {
    return this.finishAtProvider(async () => {
      const claims = this.tokens.verifySsoState(stringOf(query['state']));
      const providerError = stringOf(query['error']);
      if (providerError) {
        const description = stringOf(query['error_description']).slice(0, 200);
        throw ApiError.invalidToken(
          `Your identity provider stopped the sign-in${description ? `: ${description}` : ` (${providerError.slice(0, 60)})`}.`,
        );
      }
      const code = stringOf(query['code']);
      if (!code) throw ApiError.invalidToken('Your identity provider sent no sign-in code.');

      const { request, connection } = await this.claimRequest(claims.tenant_id, claims.rid, 'oidc');
      return this.afterVerification(claims.tenant_id, request.id, connection, async () => {
        const { issuer, clientId } = requireOidc(connection);
        const discovery = await this.oidc.discover(issuer);
        const idToken = await this.oidc.exchangeCode(discovery, {
          code,
          clientId,
          clientSecret: this.clientSecretOf(connection),
          codeVerifier: request.pkceVerifierSecret ?? '',
        });
        return this.oidc.verifyIdToken(discovery, idToken, {
          clientId,
          nonce: request.nonce ?? '',
          preset: connection.preset,
        });
      });
    });
  }

  /** `POST /auth/sso/saml/:tenantId/acs`. Always answers with where to send the browser next. */
  async samlAcs(tenantId: string, body: Record<string, unknown>): Promise<string> {
    return this.finishAtProvider(async () => {
      const claims = this.tokens.verifySsoState(stringOf(body['RelayState']));
      // The ACS URL names a company and so does the state; a response posted to one company's
      // endpoint carrying another's state is somebody splicing two sign-ins together.
      if (claims.tenant_id !== tenantId) throw ApiError.invalidToken('This sign-in belongs to a different company.');
      const samlResponse = stringOf(body['SAMLResponse']);
      if (!samlResponse) throw ApiError.invalidToken('Your identity provider sent no sign-in.');

      const { request, connection } = await this.claimRequest(tenantId, claims.rid, 'saml');
      return this.afterVerification(tenantId, request.id, connection, () =>
        this.saml.validate(tenantId, requireSaml(connection), {
          requestId: request.samlRequestId ?? '',
          issuedAt: request.createdAt,
          samlResponse,
        }),
      );
    });
  }

  /** `POST /auth/sso/complete` — the ticket and the browser binding, for a token pair. */
  async complete(input: SsoCompleteInput, userAgent?: string): Promise<TokenPair> {
    const claims = this.tokens.verifySsoTicket(input.ticket);
    const tenantId = claims.tenant_id;

    const outcome = await this.tenantDb.transaction(tenantId, async (tx) => {
      await assertTenantActive(tx, tenantId);
      const request = await tx.ssoLoginRequest.findFirst({
        where: { id: claims.rid, status: 'authenticated', expiresAt: { gt: new Date() } },
        select: { id: true, bindingHash: true, userId: true, email: true, connectionId: true },
      });
      if (!request?.userId || !request.email) return { kind: 'used' as const };

      // A sign-in carried to another browser stops here, and is spent, so it cannot be retried.
      if (!sameHash(request.bindingHash, sha256(input.binding))) {
        await tx.ssoLoginRequest.update({ where: { id: request.id }, data: { status: 'failed' } });
        return { kind: 'foreign' as const };
      }
      const claimed = await tx.ssoLoginRequest.updateMany({
        where: { id: request.id, status: 'authenticated' },
        data: { status: 'completed', completedAt: new Date() },
      });
      if (claimed.count !== 1) return { kind: 'used' as const };

      await tx.auditLog.create({
        data: {
          tenantId,
          actorId: request.userId,
          action: 'sso.sign_in',
          entity: 'users',
          entityId: request.userId,
          after: { email: request.email, connection_id: request.connectionId },
        },
      });
      return { kind: 'ok' as const, userId: request.userId, email: request.email };
    });

    if (outcome.kind === 'foreign') {
      throw ApiError.invalidToken('This sign-in was started in a different browser. Start again here.');
    }
    if (outcome.kind === 'used') {
      throw ApiError.invalidToken('This sign-in link has expired or was already used. Start again.');
    }

    return this.auth.issueSession({
      tenantId,
      userId: outcome.userId,
      deviceId: input.device_id,
      userAgent,
      activatePending: true,
      identity: identityClaim({ kind: 'email', email: outcome.email }),
      via: 'sso',
    });
  }

  // --- the callback half -----------------------------------------------------------------------

  /**
   * Runs a callback and turns its outcome into the web callback URL: a ticket on success, a
   * readable reason otherwise. The browser is mid-redirect, so a JSON error would be a dead page.
   */
  private async finishAtProvider(run: () => Promise<string>): Promise<string> {
    const target = this.ssoConfig.webCallbackUrl;
    try {
      const ticket = await run();
      return `${target}#ticket=${encodeURIComponent(ticket)}`;
    } catch (error) {
      const message =
        error instanceof ApiError
          ? messageOf(error)
          : 'Single sign-on failed. Try again, or ask your administrator to check the connection.';
      if (!(error instanceof ApiError)) this.logger.error({ err: error }, 'SSO callback failed');
      return `${target}#error=${encodeURIComponent(message)}`;
    }
  }

  /**
   * Claims the stored request for this callback, once. A second callback with the same state —
   * a replayed code or SAMLResponse, or a refresh of the callback page — finds it already taken.
   */
  private async claimRequest(tenantId: string, requestId: string, protocol: 'oidc' | 'saml') {
    return this.tenantDb.transaction(tenantId, async (tx) => {
      await assertTenantActive(tx, tenantId);
      const claimed = await tx.ssoLoginRequest.updateMany({
        where: { id: requestId, protocol, status: 'started', expiresAt: { gt: new Date() } },
        data: { status: 'callback' },
      });
      if (claimed.count !== 1) {
        throw ApiError.invalidToken('This sign-in has expired or was already used. Start again.');
      }
      const request = await tx.ssoLoginRequest.findUniqueOrThrow({ where: { id: requestId } });
      const connection = await tx.ssoConnection.findFirst({ where: { id: request.connectionId } });
      // Switched off or changed protocol while the person was at the provider: not honoured.
      if (!connection?.enabled || connection.protocol !== protocol) {
        throw ApiError.forbidden('Single sign-on has been switched off for this company.');
      }
      return { request, connection };
    });
  }

  /**
   * Verifies the provider's answer, then matches the person — recording a refusal in the company's
   * audit log so an admin debugging their provider can see why somebody could not get in.
   */
  private async afterVerification(
    tenantId: string,
    requestId: string,
    connection: SsoConnection,
    verify: () => Promise<AssertedIdentity>,
  ): Promise<string> {
    let asserted: AssertedIdentity | null = null;
    try {
      asserted = await verify();
      const identity = asserted;
      await this.tenantDb.transaction(tenantId, async (tx) => {
        const userId = await this.resolveUser(tx, tenantId, connection, identity);
        await tx.ssoLoginRequest.update({
          where: { id: requestId },
          data: { status: 'authenticated', userId, email: identity.email },
        });
      });
      return this.tokens.signSsoTicket({ tenantId, requestId });
    } catch (error) {
      await this.recordRefusal(tenantId, requestId, connection.id, asserted?.email ?? null, error);
      throw error;
    }
  }

  /**
   * The person in this company the provider vouched for. By email, within this company only, and
   * only for an address on one of its verified domains.
   */
  private async resolveUser(
    tx: TenantTx,
    tenantId: string,
    connection: SsoConnection,
    identity: AssertedIdentity,
  ): Promise<string> {
    const domain = ssoDomainOf(identity.email);
    const verified = domain
      ? await tx.ssoDomain.findFirst({ where: { domain, verifiedAt: { not: null } }, select: { id: true } })
      : null;
    if (!verified) {
      throw ApiError.forbidden(
        `Your identity provider signed in ${identity.email}, which is not on a domain this company has verified.`,
      );
    }

    const user = await tx.user.findFirst({
      where: { email: identity.email, deletedAt: null },
      select: { id: true, status: true },
    });
    if (user) {
      if (user.status === 'disabled') {
        throw ApiError.forbidden('Your account has been switched off. Ask your administrator.');
      }
      return user.id;
    }

    if (!connection.jitEnabled) {
      throw ApiError.forbidden(
        `${identity.email} is not on this company’s team yet. Ask an administrator to add you.`,
      );
    }
    const role = connection.jitRoleId
      ? await tx.role.findFirst({ where: { id: connection.jitRoleId }, select: { id: true, baseRole: true } })
      : null;
    // Never an owner, whatever the row says — settings refuse one, and this refuses it again.
    if (!role || role.baseRole === 'owner') {
      throw ApiError.forbidden('New accounts cannot be created: no default role is set. Ask your administrator.');
    }

    const created = await tx.user.create({
      data: {
        tenantId,
        phone: `${SSO_PLACEHOLDER_PHONE_PREFIX}${randomBytes(16).toString('hex')}`,
        email: identity.email,
        name: identity.name?.slice(0, 120) || identity.email.split('@')[0] || identity.email,
        role: role.baseRole,
        roleId: role.id,
        // Pending until the session below is issued, which activates it like any first sign-in.
        status: 'pending',
      },
      select: { id: true },
    });
    await tx.auditLog.create({
      data: {
        tenantId,
        actorId: created.id,
        action: 'sso.user_provisioned',
        entity: 'users',
        entityId: created.id,
        after: { email: identity.email, role_id: role.id, connection_id: connection.id },
      },
    });
    return created.id;
  }

  private async recordRefusal(
    tenantId: string,
    requestId: string,
    connectionId: string,
    email: string | null,
    error: unknown,
  ): Promise<void> {
    try {
      await this.tenantDb.transaction(tenantId, async (tx) => {
        await tx.ssoLoginRequest.updateMany({ where: { id: requestId }, data: { status: 'failed' } });
        await tx.auditLog.create({
          data: {
            tenantId,
            action: 'sso.sign_in_refused',
            entity: 'sso_connections',
            entityId: connectionId,
            after: {
              email,
              reason: error instanceof ApiError ? messageOf(error) : 'unexpected error',
            },
          },
        });
      });
    } catch (logError) {
      // The refusal itself is what matters to the person; a failed log line must not mask it.
      this.logger.warn({ err: logError }, 'Could not record an SSO refusal');
    }
  }

  private clientSecretOf(connection: SsoConnection): string {
    if (!connection.oidcClientSecretCipher) {
      throw ApiError.forbidden('Single sign-on is missing its client secret. Ask your administrator.');
    }
    return this.ssoConfig.cipher().decrypt(connection.oidcClientSecretCipher);
  }

  private async saveRequest(
    tenantId: string,
    data: {
      id: string;
      tenantId: string;
      connectionId: string;
      protocol: string;
      bindingHash: string;
      expiresAt: Date;
      nonce?: string;
      pkceVerifierSecret?: string;
      samlRequestId?: string;
    },
  ): Promise<void> {
    await this.tenantDb.transaction(tenantId, async (tx) => {
      // Housekeeping rides along: this company's sign-ins from more than a day ago are dead weight.
      await tx.ssoLoginRequest.deleteMany({
        where: { createdAt: { lt: new Date(Date.now() - 24 * 60 * 60 * 1000) } },
      });
      await tx.ssoLoginRequest.create({ data });
    });
  }
}

function requireOidc(connection: SsoConnection): { issuer: string; clientId: string } {
  if (!connection.oidcIssuer || !connection.oidcClientId) {
    throw ApiError.forbidden('Single sign-on is not fully set up for this company.');
  }
  return { issuer: connection.oidcIssuer, clientId: connection.oidcClientId };
}

function requireSaml(connection: SsoConnection): SamlIdpSettings {
  if (!connection.samlIdpEntityId || !connection.samlIdpSsoUrl || !connection.samlIdpCertificate) {
    throw ApiError.forbidden('Single sign-on is not fully set up for this company.');
  }
  return {
    entityId: connection.samlIdpEntityId,
    ssoUrl: connection.samlIdpSsoUrl,
    certificate: connection.samlIdpCertificate,
  };
}

async function assertTenantActive(tx: TenantTx, tenantId: string): Promise<void> {
  const tenant = await tx.tenant.findUnique({ where: { id: tenantId }, select: { status: true } });
  if (tenant?.status !== 'active') throw ApiError.tenantSuspended();
}

function notSetUp(domain: string): ApiError {
  return new ApiError(
    HttpStatus.NOT_FOUND,
    ERROR_CODES.NOT_FOUND,
    `Single sign-on is not set up for ${domain}. Sign in with your mobile number instead.`,
  );
}

function messageOf(error: ApiError): string {
  const body = error.getResponse();
  return typeof body === 'object' && body !== null && 'message' in body
    ? String((body as { message: unknown }).message)
    : error.message;
}

function stringOf(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function sameHash(a: string, b: string): boolean {
  const left = Buffer.from(a, 'hex');
  const right = Buffer.from(b, 'hex');
  return left.length === right.length && timingSafeEqual(left, right);
}
