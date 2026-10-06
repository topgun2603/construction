import { Injectable } from '@nestjs/common';
import {
  SECURITY_IP_MODES,
  SECURITY_MFA_POLICIES,
  effectiveModules,
  type Plan,
  type SecurityIpMode,
  type SecurityMfaPolicy,
  type TenantStatus,
} from '@sitebook/shared';
import { env } from '../../config/env';
import { TenantDb } from '../prisma/tenant-db.service';

/**
 * A company's sign-in rules (Settings → Security), read with the tenant so the global guard can
 * enforce them without a query of its own. See `tenant_security_settings`.
 */
export interface TenantSecurityGate {
  mfaPolicy: SecurityMfaPolicy;
  trustIdpMfa: boolean;
  idleTimeoutMinutes: number | null;
  absoluteLifetimeHours: number | null;
  ipMode: SecurityIpMode;
  ipCidrs: string[];
  ipExemptOwners: boolean;
  ipExemptRoles: string[];
}

export interface TenantGateInfo {
  id: string;
  status: TenantStatus;
  plan: Plan;
  enabledModules: string[];
  /** Null for a lifetime plan, which never runs out. */
  planExpiresOn: Date | null;
  timezone: string;
  currency: string;
  locale: string;
  taxRegime: string;
  country: string;
  /** Null when the company has never saved a rule — every rule off. */
  security: TenantSecurityGate | null;
}

interface CacheEntry {
  value: TenantGateInfo;
  expiresAt: number;
}

/**
 * Every authenticated request needs the tenant's plan and module list to run
 * PlanGuard. Reading it from Postgres each time would put a query in front of the
 * fast dashboard endpoints for data that changes a few times a year, so it is held
 * in process for a few seconds.
 *
 * In-process means a plan change can take up to TENANT_CACHE_TTL_SECONDS to reach
 * every instance; `invalidate` makes it immediate on the instance that handled the
 * change. Once Redis is wired up (build order step 5) this moves there so the
 * invalidation is cluster-wide.
 */
@Injectable()
export class TenantCache {
  private readonly ttlMs = env().TENANT_CACHE_TTL_SECONDS * 1000;
  private readonly entries = new Map<string, CacheEntry>();

  constructor(private readonly tenantDb: TenantDb) {}

  async get(tenantId: string): Promise<TenantGateInfo | null> {
    const cached = this.entries.get(tenantId);
    if (cached && cached.expiresAt > Date.now()) return cached.value;

    const tenant = await this.tenantDb.clientFor(tenantId).tenant.findUnique({
      where: { id: tenantId },
      select: {
        id: true,
        status: true,
        plan: true,
        enabledModules: true,
        planExpiresOn: true,
        timezone: true,
        currency: true,
        locale: true,
        taxRegime: true,
        country: true,
        // The sign-in rules ride along on the same query: every authenticated request needs them,
        // and a second round trip for a row most companies do not even have would be waste.
        securitySettings: {
          select: {
            mfaPolicy: true,
            trustIdpMfa: true,
            idleTimeoutMinutes: true,
            absoluteLifetimeHours: true,
            ipMode: true,
            ipRules: true,
            ipExemptOwners: true,
            ipExemptRoles: true,
          },
        },
      },
    });
    if (!tenant) {
      this.entries.delete(tenantId);
      return null;
    }

    const value: TenantGateInfo = {
      planExpiresOn: tenant.planExpiresOn,
      id: tenant.id,
      status: tenant.status,
      plan: tenant.plan,
      // Resolve plan defaults here so every caller sees the same effective list.
      enabledModules: effectiveModules(tenant.plan, tenant.enabledModules),
      timezone: tenant.timezone,
      currency: tenant.currency,
      locale: tenant.locale,
      taxRegime: tenant.taxRegime,
      country: tenant.country,
      security: securityGateOf(tenant.securitySettings),
    };
    this.entries.set(tenantId, { value, expiresAt: Date.now() + this.ttlMs });
    return value;
  }

  invalidate(tenantId: string): void {
    this.entries.delete(tenantId);
  }

  clear(): void {
    this.entries.clear();
  }
}

/**
 * The stored row as the guard reads it. A row whose every rule is off reads as no row, so a
 * company that tried a rule and switched it back pays nothing for having looked.
 */
export function securityGateOf(
  row: {
    mfaPolicy: string;
    trustIdpMfa: boolean;
    idleTimeoutMinutes: number | null;
    absoluteLifetimeHours: number | null;
    ipMode: string;
    ipRules: unknown;
    ipExemptOwners: boolean;
    ipExemptRoles: string[];
  } | null,
): TenantSecurityGate | null {
  if (!row) return null;
  const gate: TenantSecurityGate = {
    mfaPolicy: (SECURITY_MFA_POLICIES as readonly string[]).includes(row.mfaPolicy)
      ? (row.mfaPolicy as SecurityMfaPolicy)
      : 'off',
    trustIdpMfa: row.trustIdpMfa,
    idleTimeoutMinutes: row.idleTimeoutMinutes,
    absoluteLifetimeHours: row.absoluteLifetimeHours,
    ipMode: (SECURITY_IP_MODES as readonly string[]).includes(row.ipMode)
      ? (row.ipMode as SecurityIpMode)
      : 'off',
    ipCidrs: Array.isArray(row.ipRules)
      ? row.ipRules
          .map((rule: unknown) =>
            rule && typeof rule === 'object' ? (rule as { cidr?: unknown }).cidr : null,
          )
          .filter((cidr): cidr is string => typeof cidr === 'string')
      : [],
    ipExemptOwners: row.ipExemptOwners,
    ipExemptRoles: row.ipExemptRoles,
  };
  // `trust_idp_mfa` only matters once two-factor is required, so on its own it is not a rule.
  const anything =
    gate.mfaPolicy !== 'off' ||
    gate.ipMode !== 'off' ||
    gate.idleTimeoutMinutes !== null ||
    gate.absoluteLifetimeHours !== null;
  return anything ? gate : null;
}
