import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import {
  USER_ROLES,
  ipAllowed,
  securityIpApplies,
  type SecurityIpPolicyInput,
  type SecurityMfaPolicyInput,
  type SecuritySessionPolicyInput,
} from '@sitebook/shared';
import { env } from '../../config/env';
import type { RequestUser } from '../../common/auth/request-user';
import { TenantCache } from '../../common/auth/tenant-cache.service';
import { ApiError } from '../../common/errors/api-error';
import { TenantDb } from '../../common/prisma/tenant-db.service';
import { MfaService } from './mfa.service';
import { SessionService, presentSession } from './session.service';

/**
 * Settings → Security: required two-factor, session timeouts, the IP allow-list, and who is signed
 * in across the company.
 *
 * OWNER ONLY, like single sign-on beside it: the route asks for `tenant.manage`, but that can be
 * handed to a custom role, and these rules decide who can get into the company at all.
 *
 * Every change is written to `tenant_security_settings`, whose audit trigger records who changed
 * what; the tenant cache is dropped so the next request on this instance enforces the new rule
 * (other instances within TENANT_CACHE_TTL_SECONDS).
 */
@Injectable()
export class SecuritySettingsService {
  private readonly config = env();

  constructor(
    private readonly tenantDb: TenantDb,
    private readonly tenantCache: TenantCache,
    private readonly sessions: SessionService,
    private readonly mfa: MfaService,
  ) {}

  assertOwner(actor: RequestUser): void {
    if (actor.role !== 'owner') {
      throw ApiError.forbidden('Only an owner can change sign-in security.');
    }
  }

  /** `GET /security/settings`, with the caller's own address and two-factor standing beside it. */
  async overview(actor: RequestUser, ip: string) {
    this.assertOwner(actor);
    const data = await this.tenantDb.transaction(actor.tenantId, async (tx) => {
      const [row, factor, sso] = await Promise.all([
        tx.tenantSecuritySettings.findUnique({ where: { tenantId: actor.tenantId } }),
        tx.mfaFactor.findUnique({ where: { userId: actor.userId }, select: { confirmedAt: true } }),
        tx.ssoConnection.findFirst({ where: { enabled: true }, select: { id: true } }),
      ]);
      return { row, factor, sso };
    });
    const { row } = data;
    const rules = rulesOf(row?.ipRules);
    const exemptOwners = row?.ipExemptOwners ?? true;
    const exemptRoles = row?.ipExemptRoles ?? [];
    const mode = (row?.ipMode ?? 'off') as SecurityIpPolicyInput['ip_mode'];

    return {
      deployment: {
        mfa_configured: this.mfa.configured,
        // Whether the web app is vouching for browsers' addresses. Without it, dashboard requests
        // are seen as the web server's, and the screen says so beside the allow-list.
        client_ip_forwarding: Boolean(this.config.WEB_CLIENT_IP_SECRET),
      },
      current_ip: ip,
      mfa: {
        policy: row?.mfaPolicy ?? 'off',
        trust_idp_mfa: row?.trustIdpMfa ?? true,
        sso_enabled: Boolean(data.sso),
      },
      sessions: {
        idle_timeout_minutes: row?.idleTimeoutMinutes ?? null,
        absolute_lifetime_hours: row?.absoluteLifetimeHours ?? null,
      },
      ip: {
        mode,
        rules,
        exempt_owners: exemptOwners,
        exempt_roles: exemptRoles,
        current_ip_allowed: ipAllowed(ip, rules.map((rule) => rule.cidr)),
      },
      me: {
        enrolled: Boolean(data.factor?.confirmedAt),
        session_verified: actor.mfa === true,
      },
      roles: USER_ROLES.filter((role) => role !== 'owner'),
      updated_at: row?.updatedAt.toISOString() ?? null,
    };
  }

  /**
   * `PUT /security/mfa-policy`.
   *
   * Requiring two-factor is refused until the owner saving it has shown one in this session: it
   * proves the deployment can do it, and it means the person switching it on is not the first one
   * stopped by it.
   */
  async saveMfaPolicy(actor: RequestUser, input: SecurityMfaPolicyInput, ip: string) {
    this.assertOwner(actor);
    if (input.mfa_policy !== 'off') {
      if (!this.mfa.configured) {
        throw ApiError.conflict(
          'Two-factor cannot be required on this deployment: MFA_ENCRYPTION_KEY is not set.',
        );
      }
      if (!actor.mfa) {
        throw ApiError.conflict(
          'Set up two-factor for yourself first (Your account → Security), then require it of others.',
          { reason: 'owner_not_verified' },
        );
      }
    }
    await this.upsert(actor, { mfaPolicy: input.mfa_policy, trustIdpMfa: input.trust_idp_mfa });
    return this.overview(actor, ip);
  }

  /** `PUT /security/session-policy`. Takes effect at each session's next refresh. */
  async saveSessionPolicy(actor: RequestUser, input: SecuritySessionPolicyInput, ip: string) {
    this.assertOwner(actor);
    await this.upsert(actor, {
      idleTimeoutMinutes: input.idle_timeout_minutes,
      absoluteLifetimeHours: input.absolute_lifetime_hours,
    });
    return this.overview(actor, ip);
  }

  /**
   * `PUT /security/ip-policy`.
   *
   * A list that would shut out the owner saving it is refused unless they say they mean it
   * (`confirm_self_lockout`) — the usual way this goes wrong is an office address typed one digit
   * out. With owners exempt (the default) it never applies to them, and that exemption is the real
   * safety net: a wrong list then locks out staff, never the person who can fix it.
   */
  async saveIpPolicy(actor: RequestUser, input: SecurityIpPolicyInput, ip: string) {
    this.assertOwner(actor);
    const cidrs = input.ip_rules.map((rule) => rule.cidr);
    const appliesToMe =
      input.ip_mode !== 'off' &&
      securityIpApplies(
        { mode: input.ip_mode, exemptOwners: input.ip_exempt_owners, exemptRoles: input.ip_exempt_roles },
        { role: actor.role, app: actor.app === true },
      );
    if (appliesToMe && !ipAllowed(ip, cidrs) && !input.confirm_self_lockout) {
      throw ApiError.conflict(
        `Your own address (${ip || 'unknown'}) is not on this list, so saving it would sign you out. Add it, or confirm to save anyway.`,
        { reason: 'self_lockout', current_ip: ip },
      );
    }
    // One entry per block: the same network typed twice is one rule, kept with its first label.
    const seen = new Set<string>();
    const rules = input.ip_rules.filter((rule) => (seen.has(rule.cidr) ? false : (seen.add(rule.cidr), true)));
    await this.upsert(actor, {
      ipMode: input.ip_mode,
      ipRules: rules as unknown as Prisma.InputJsonValue,
      ipExemptOwners: input.ip_exempt_owners,
      ipExemptRoles: [...new Set(input.ip_exempt_roles.filter((role) => role !== 'owner'))],
    });
    return this.overview(actor, ip);
  }

  /** `GET /security/sessions` — who is signed in across the company, for "sign out" per person. */
  async companySessions(actor: RequestUser) {
    this.assertOwner(actor);
    const gate = (await this.tenantCache.get(actor.tenantId))?.security ?? null;
    return this.tenantDb.transaction(actor.tenantId, async (tx) => {
      const users = await tx.user.findMany({
        where: { deletedAt: null, sessions: { some: { revokedAt: null } } },
        select: { id: true, name: true, role: true, roleRef: { select: { name: true } } },
        orderBy: { name: 'asc' },
      });
      const out = [];
      for (const user of users) {
        const live = await this.sessions.listLive(tx, user.id, gate);
        if (live.length === 0) continue;
        out.push({
          user_id: user.id,
          name: user.name,
          role: user.role,
          role_name: user.roleRef?.name ?? user.role,
          sessions: live.map((row) => presentSession(row, actor.sessionId ?? null)),
        });
      }
      return { items: out };
    });
  }

  /**
   * `POST /security/members/:userId/sign-out` — end every session a team member has. Their access
   * token keeps working until it expires (at most fifteen minutes); nothing can refresh it.
   */
  async signOutMember(actor: RequestUser, userId: string) {
    this.assertOwner(actor);
    return this.tenantDb.transaction(actor.tenantId, async (tx) => {
      const user = await tx.user.findFirst({ where: { id: userId, deletedAt: null }, select: { id: true } });
      if (!user) throw ApiError.notFound('User');
      // Signing yourself out from here keeps the session you are using, like "sign out elsewhere".
      const keep = userId === actor.userId ? (actor.sessionId ?? null) : null;
      const ended = await this.sessions.endAllFor(tx, userId, 'revoked_by_admin', keep);
      await tx.auditLog.create({
        data: {
          tenantId: actor.tenantId,
          actorId: actor.userId,
          action: 'security.sessions_revoked',
          entity: 'users',
          entityId: userId,
          after: { sessions: ended, by: 'owner' },
        },
      });
      return { ended };
    });
  }

  private async upsert(actor: RequestUser, data: SettingsPatch) {
    await this.tenantDb.transaction(actor.tenantId, async (tx) => {
      await tx.tenantSecuritySettings.upsert({
        where: { tenantId: actor.tenantId },
        create: { tenantId: actor.tenantId, updatedByUserId: actor.userId, ...data },
        update: { ...data, updatedByUserId: actor.userId },
      });
    });
    this.tenantCache.invalidate(actor.tenantId);
  }
}

/** The columns one section saves; the others are left as they were. */
type SettingsPatch = Partial<{
  mfaPolicy: string;
  trustIdpMfa: boolean;
  idleTimeoutMinutes: number | null;
  absoluteLifetimeHours: number | null;
  ipMode: string;
  ipRules: Prisma.InputJsonValue;
  ipExemptOwners: boolean;
  ipExemptRoles: string[];
}>;

function rulesOf(value: unknown): Array<{ cidr: string; label: string }> {
  if (!Array.isArray(value)) return [];
  return value
    .map((rule: unknown) => {
      const entry = (rule ?? {}) as { cidr?: unknown; label?: unknown };
      return typeof entry.cidr === 'string'
        ? { cidr: entry.cidr, label: typeof entry.label === 'string' ? entry.label : '' }
        : null;
    })
    .filter((rule): rule is { cidr: string; label: string } => rule !== null);
}

