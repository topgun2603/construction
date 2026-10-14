import { Injectable, Logger } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { promises as dns } from 'node:dns';
import { Prisma } from '@prisma/client';
import {
  SSO_DEFAULT_SCOPES,
  ssoTxtRecordValue,
  type ScimRoleMappingInput,
  type SsoConnectionInput,
  type SsoDomainInput,
  type SsoSamlMetadataInput,
} from '@sitebook/shared';
import type { RequestUser } from '../../common/auth/request-user';
import { ApiError } from '../../common/errors/api-error';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TenantDb, type TenantTx } from '../../common/prisma/tenant-db.service';
import { OidcClientService } from './oidc-client.service';
import { SamlClientService } from './saml-client.service';
import { SsoConfigService } from './sso-config.service';

/** More than any real company needs; enough to stop a settings form being used as a DNS prober. */
const MAX_DOMAINS = 20;

/**
 * Settings → Security → Single sign-on.
 *
 * OWNER ONLY. The route also asks for `tenant.manage`, but that permission can be handed to a
 * custom role, and this setting is stronger than anything else on the account: whoever controls
 * the identity provider can sign in as anybody on the company's domains, and enforcement decides
 * who may use any other way in. That is the owner's call, like removing the last owner is.
 */
@Injectable()
export class SsoSettingsService {
  private readonly logger = new Logger(SsoSettingsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantDb: TenantDb,
    private readonly ssoConfig: SsoConfigService,
    private readonly oidc: OidcClientService,
    private readonly saml: SamlClientService,
  ) {}

  assertOwner(actor: RequestUser): void {
    if (actor.role !== 'owner') {
      throw ApiError.forbidden('Only an owner can change single sign-on.');
    }
  }

  async overview(actor: RequestUser) {
    this.assertOwner(actor);
    const data = await this.tenantDb.transaction(actor.tenantId, async (tx) => {
      const [connection, domains, tokens, mappings, roles] = await Promise.all([
        tx.ssoConnection.findFirst({}),
        tx.ssoDomain.findMany({ orderBy: { createdAt: 'asc' } }),
        tx.scimToken.findMany({ where: { revokedAt: null }, orderBy: { createdAt: 'desc' } }),
        tx.scimRoleMapping.findMany({
          orderBy: { groupName: 'asc' },
          include: { role: { select: { name: true } } },
        }),
        tx.role.findMany({
          where: { baseRole: { not: 'owner' } },
          orderBy: { name: 'asc' },
          select: { id: true, name: true, baseRole: true },
        }),
      ]);
      return { connection, domains, tokens, mappings, roles };
    });

    const { connection } = data;
    return {
      deployment: {
        urls_configured: this.ssoConfig.urlsConfigured,
        encryption_configured: this.ssoConfig.encryptionConfigured,
      },
      service_provider: this.ssoConfig.serviceProviderUrls(actor.tenantId),
      connection: connection
        ? {
            id: connection.id,
            protocol: connection.protocol,
            preset: connection.preset,
            enabled: connection.enabled,
            oidc_issuer: connection.oidcIssuer,
            oidc_client_id: connection.oidcClientId,
            // Never the secret itself, not even encrypted: only whether one is stored.
            has_client_secret: Boolean(connection.oidcClientSecretCipher),
            oidc_scopes: connection.oidcScopes,
            saml_idp_entity_id: connection.samlIdpEntityId,
            saml_idp_sso_url: connection.samlIdpSsoUrl,
            saml_idp_certificate: connection.samlIdpCertificate,
            saml_idp_metadata_url: connection.samlIdpMetadataUrl,
            jit_enabled: connection.jitEnabled,
            jit_role_id: connection.jitRoleId,
            enforce_sso: connection.enforceSso,
            updated_at: connection.updatedAt.toISOString(),
          }
        : null,
      domains: data.domains.map((row) => ({
        id: row.id,
        domain: row.domain,
        verified_at: row.verifiedAt?.toISOString() ?? null,
        last_checked_at: row.lastCheckedAt?.toISOString() ?? null,
        txt_name: row.domain,
        txt_value: ssoTxtRecordValue(row.verificationToken),
      })),
      scim_tokens: data.tokens.map((row) => ({
        id: row.id,
        hint: row.tokenHint,
        created_at: row.createdAt.toISOString(),
        last_used_at: row.lastUsedAt?.toISOString() ?? null,
      })),
      role_mappings: data.mappings.map((row) => ({
        id: row.id,
        group_name: row.groupName,
        role_id: row.roleId,
        role_name: row.role.name,
      })),
      roles: data.roles.map((role) => ({ id: role.id, name: role.name, base_role: role.baseRole })),
    };
  }

  async saveConnection(actor: RequestUser, input: SsoConnectionInput) {
    this.assertOwner(actor);

    // Omitted keeps the stored value; null or empty clears it.
    const certificate =
      input.saml_idp_certificate === undefined
        ? undefined
        : input.saml_idp_certificate
          ? SamlClientService.normaliseCertificate(input.saml_idp_certificate)
          : null;
    for (const [field, value] of [
      ['issuer', input.oidc_issuer],
      ['SAML sign-in URL', input.saml_idp_sso_url],
      ['metadata URL', input.saml_idp_metadata_url],
    ] as const) {
      if (value) this.oidc.assertUrlAllowed(value, field);
    }
    const secretCipher =
      input.oidc_client_secret === undefined
        ? undefined
        : input.oidc_client_secret === ''
          ? null
          : this.ssoConfig.cipher().encrypt(input.oidc_client_secret);

    const fields = {
      protocol: input.protocol,
      preset: input.preset,
      enabled: input.enabled,
      jitEnabled: input.jit_enabled,
      jitRoleId: input.jit_role_id ?? null,
      enforceSso: input.enforce_sso,
      ...(input.oidc_issuer !== undefined ? { oidcIssuer: input.oidc_issuer?.replace(/\/+$/, '') ?? null } : {}),
      ...(input.oidc_client_id !== undefined ? { oidcClientId: input.oidc_client_id || null } : {}),
      ...(secretCipher !== undefined ? { oidcClientSecretCipher: secretCipher } : {}),
      ...(input.oidc_scopes !== undefined ? { oidcScopes: input.oidc_scopes || SSO_DEFAULT_SCOPES } : {}),
      ...(input.saml_idp_entity_id !== undefined ? { samlIdpEntityId: input.saml_idp_entity_id || null } : {}),
      ...(input.saml_idp_sso_url !== undefined ? { samlIdpSsoUrl: input.saml_idp_sso_url || null } : {}),
      ...(certificate !== undefined ? { samlIdpCertificate: certificate || null } : {}),
      ...(input.saml_idp_metadata_url !== undefined
        ? { samlIdpMetadataUrl: input.saml_idp_metadata_url || null }
        : {}),
      updatedByUserId: actor.userId,
    };

    const saved = await this.tenantDb.transaction(actor.tenantId, async (tx) => {
      const existing = await tx.ssoConnection.findFirst({});
      const merged = { ...existing, ...fields };

      if (merged.jitEnabled && !merged.jitRoleId) {
        throw ApiError.validationFailed({ jit_role_id: 'required' }, 'Choose the role new people get.');
      }
      if (merged.jitRoleId) await assertAssignableRole(tx, merged.jitRoleId, 'jit_role_id');

      if (merged.enabled) {
        if (!this.ssoConfig.urlsConfigured) {
          throw ApiError.conflict(
            'Single sign-on cannot be switched on until this deployment sets API_PUBLIC_URL and WEB_BASE_URL.',
          );
        }
        const missing =
          merged.protocol === 'oidc'
            ? !merged.oidcIssuer || !merged.oidcClientId || !merged.oidcClientSecretCipher
            : !merged.samlIdpEntityId || !merged.samlIdpSsoUrl || !merged.samlIdpCertificate;
        if (missing) {
          throw ApiError.validationFailed(
            { enabled: 'incomplete' },
            merged.protocol === 'oidc'
              ? 'Fill in the issuer, client ID and client secret before switching single sign-on on.'
              : 'Fill in the entity ID, sign-in URL and signing certificate before switching single sign-on on.',
          );
        }
      }
      if (merged.enforceSso) {
        if (!merged.enabled) {
          throw ApiError.validationFailed({ enforce_sso: 'needs SSO on' }, 'Switch single sign-on on before enforcing it.');
        }
        const verified = await tx.ssoDomain.count({ where: { verifiedAt: { not: null } } });
        if (verified === 0) {
          throw ApiError.validationFailed(
            { enforce_sso: 'needs a verified domain' },
            'Verify at least one email domain before enforcing single sign-on.',
          );
        }
      }

      return existing
        ? tx.ssoConnection.update({ where: { id: existing.id }, data: fields })
        : tx.ssoConnection.create({ data: { tenantId: actor.tenantId, ...fields } });
    });

    // Switching an OIDC connection on reads the issuer once, so a typo is caught here and not by
    // the first person who tries to sign in. Off again if it cannot be read.
    if (saved.enabled && saved.protocol === 'oidc' && saved.oidcIssuer) {
      try {
        await this.oidc.discover(saved.oidcIssuer);
      } catch (error) {
        await this.tenantDb.transaction(actor.tenantId, (tx) =>
          tx.ssoConnection.update({ where: { id: saved.id }, data: { enabled: false, enforceSso: false } }),
        );
        throw error;
      }
    }
    return this.overview(actor);
  }

  async importSamlMetadata(actor: RequestUser, input: SsoSamlMetadataInput) {
    this.assertOwner(actor);
    const idp = await this.saml.readMetadata(input);
    return {
      saml_idp_entity_id: idp.entityId,
      saml_idp_sso_url: idp.ssoUrl,
      saml_idp_certificate: idp.certificate,
    };
  }

  async addDomain(actor: RequestUser, input: SsoDomainInput) {
    this.assertOwner(actor);
    await this.tenantDb.transaction(actor.tenantId, async (tx) => {
      if ((await tx.ssoDomain.count()) >= MAX_DOMAINS) {
        throw ApiError.conflict(`A company can claim at most ${MAX_DOMAINS} domains.`);
      }
      const existing = await tx.ssoDomain.findFirst({ where: { domain: input.domain }, select: { id: true } });
      if (existing) throw ApiError.conflict('That domain is already on the list.');
      await tx.ssoDomain.create({
        data: {
          tenantId: actor.tenantId,
          domain: input.domain,
          // Fresh per company and per claim: knowing another company's token proves nothing here.
          verificationToken: randomBytes(18).toString('base64url'),
        },
      });
    });
    return this.overview(actor);
  }

  /**
   * Looks for `buildr-verification=<token>` in the domain's TXT records. Only somebody who runs the
   * domain's DNS can put it there, which is the whole proof; and a domain another company has
   * already verified stays theirs.
   */
  async verifyDomain(actor: RequestUser, domainId: string) {
    this.assertOwner(actor);
    const row = await this.tenantDb
      .clientFor(actor.tenantId)
      .ssoDomain.findFirst({ where: { id: domainId } });
    if (!row) throw ApiError.notFound('Domain');
    if (row.verifiedAt) return this.overview(actor);

    const claimed = await this.prisma.ssoDomainDirectory.findUnique({
      where: { domain: row.domain },
      select: { tenantId: true },
    });
    if (claimed && claimed.tenantId !== actor.tenantId) throw alreadyClaimed(row.domain);

    const expected = ssoTxtRecordValue(row.verificationToken);
    const found = await this.txtRecordsOf(row.domain);
    const matched = found.some((record) => record.trim() === expected);

    try {
      await this.tenantDb.transaction(actor.tenantId, (tx) =>
        tx.ssoDomain.update({
          where: { id: row.id },
          data: { lastCheckedAt: new Date(), ...(matched ? { verifiedAt: new Date() } : {}) },
        }),
      );
    } catch (error) {
      // Lost a race with another company verifying the same domain a moment earlier.
      if (isUniqueViolation(error)) throw alreadyClaimed(row.domain);
      throw error;
    }

    if (!matched) {
      throw ApiError.validationFailed(
        { domain: 'TXT record not found' },
        `No TXT record "${expected}" on ${row.domain} yet. DNS changes can take a while to appear — try again shortly.`,
      );
    }
    return this.overview(actor);
  }

  async removeDomain(actor: RequestUser, domainId: string) {
    this.assertOwner(actor);
    await this.tenantDb.transaction(actor.tenantId, async (tx) => {
      const deleted = await tx.ssoDomain.deleteMany({ where: { id: domainId } });
      if (deleted.count === 0) throw ApiError.notFound('Domain');
      // Enforcement with no verified domain left would do nothing while claiming to be on.
      if ((await tx.ssoDomain.count({ where: { verifiedAt: { not: null } } })) === 0) {
        await tx.ssoConnection.updateMany({ where: { enforceSso: true }, data: { enforceSso: false } });
      }
    });
    return this.overview(actor);
  }

  /**
   * A new SCIM token, shown once. Any earlier token stops working in the same transaction —
   * rotating is the common reason to press the button, and a forgotten second token is a standing
   * credential nobody is watching.
   */
  async createScimToken(actor: RequestUser): Promise<{ token: string }> {
    this.assertOwner(actor);
    const token = `scim_${randomBytes(32).toString('base64url')}`;
    await this.tenantDb.transaction(actor.tenantId, async (tx) => {
      await tx.scimToken.updateMany({ where: { revokedAt: null }, data: { revokedAt: new Date() } });
      await tx.scimToken.create({
        data: {
          tenantId: actor.tenantId,
          tokenHash: createHash('sha256').update(token).digest('hex'),
          tokenHint: token.slice(-4),
          createdByUserId: actor.userId,
        },
      });
    });
    return { token };
  }

  async revokeScimTokens(actor: RequestUser) {
    this.assertOwner(actor);
    await this.tenantDb.transaction(actor.tenantId, (tx) =>
      tx.scimToken.updateMany({ where: { revokedAt: null }, data: { revokedAt: new Date() } }),
    );
    return this.overview(actor);
  }

  async addRoleMapping(actor: RequestUser, input: ScimRoleMappingInput) {
    this.assertOwner(actor);
    await this.tenantDb.transaction(actor.tenantId, async (tx) => {
      await assertAssignableRole(tx, input.role_id, 'role_id');
      const clash = await tx.scimRoleMapping.findFirst({
        where: { groupName: { equals: input.group_name, mode: 'insensitive' } },
        select: { id: true },
      });
      if (clash) throw ApiError.conflict('That group already has a role.');
      await tx.scimRoleMapping.create({
        data: { tenantId: actor.tenantId, groupName: input.group_name, roleId: input.role_id },
      });
    });
    return this.overview(actor);
  }

  async removeRoleMapping(actor: RequestUser, mappingId: string) {
    this.assertOwner(actor);
    const deleted = await this.tenantDb
      .clientFor(actor.tenantId)
      .scimRoleMapping.deleteMany({ where: { id: mappingId } });
    if (deleted.count === 0) throw ApiError.notFound('Group mapping');
    return this.overview(actor);
  }

  private async txtRecordsOf(domain: string): Promise<string[]> {
    try {
      // A TXT record may arrive split into 255-byte chunks; joined, they are the record.
      const records = await dns.resolveTxt(domain);
      return records.map((chunks) => chunks.join(''));
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code !== 'ENODATA' && code !== 'ENOTFOUND') {
        this.logger.warn({ err: error, domain }, 'TXT lookup failed');
      }
      return [];
    }
  }
}

/** A role in this company that is not an owner role — provisioning never makes an owner. */
async function assertAssignableRole(tx: TenantTx, roleId: string, field: string): Promise<void> {
  const role = await tx.role.findFirst({ where: { id: roleId }, select: { baseRole: true } });
  if (!role) throw ApiError.validationFailed({ [field]: 'unknown role' }, 'That role does not exist.');
  if (role.baseRole === 'owner') {
    throw ApiError.validationFailed(
      { [field]: 'owner' },
      'Single sign-on cannot hand out an owner role. Make owners by hand in Settings → Team.',
    );
  }
}

function alreadyClaimed(domain: string): ApiError {
  return ApiError.conflict(`${domain} is already verified by another company.`);
}

function isUniqueViolation(error: unknown): boolean {
  if (error instanceof Prisma.PrismaClientKnownRequestError) return error.code === 'P2002';
  // A violation raised inside the directory trigger reaches Prisma as an unknown request error.
  return error instanceof Error && /23505|unique/i.test(error.message);
}
