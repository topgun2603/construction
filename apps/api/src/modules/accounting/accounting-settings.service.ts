import { Injectable } from '@nestjs/common';
import {
  ACCOUNTING_KEY_GROUP_LABELS,
  ACCOUNTING_SYSTEM_LABELS,
  ACCOUNTING_SYSTEMS,
  accountingDefaultMap,
  accountingKeyCatalogue,
  accountingKeyLabel,
  accountingNeedsAccountCode,
  accountingPostsToPartyLedger,
  accountingUsesTaxCodes,
  taxRule,
  type AccountingAccount,
  type AccountingDefaultsInput,
  type AccountingKeyGroup,
  type AccountingMappingInput,
  type AccountingSettingsInput,
  type AccountingSystem,
} from '@sitebook/shared';
import { can, type RequestUser } from '../../common/auth/request-user';
import { ApiError } from '../../common/errors/api-error';
import { TenantDb, type TenantTx } from '../../common/prisma/tenant-db.service';

/** The settings row as the services use it, with every default filled in for a company that has none. */
export interface AccountingSettingsView {
  system: AccountingSystem;
  gst_home_state: string | null;
  tally_company: string | null;
  qbo_site_dimension: 'class' | 'location';
  xero_tracking_name: string | null;
  netsuite_subsidiary: string | null;
  netsuite_site_dimension: 'department' | 'class' | 'location';
  updated_at: string | null;
}

export async function readAccountingSettings(tx: TenantTx): Promise<AccountingSettingsView> {
  const row = await tx.accountingSettings.findFirst();
  return {
    system: (row?.system as AccountingSystem | undefined) ?? 'tally',
    gst_home_state: row?.gstHomeState ?? null,
    tally_company: row?.tallyCompany ?? null,
    qbo_site_dimension: (row?.qboSiteDimension as 'class' | 'location' | undefined) ?? 'class',
    xero_tracking_name: row?.xeroTrackingName ?? null,
    netsuite_subsidiary: row?.netsuiteSubsidiary ?? null,
    netsuite_site_dimension: (row?.netsuiteSiteDimension as 'department' | 'class' | 'location' | undefined) ?? 'department',
    updated_at: row?.updatedAt.toISOString() ?? null,
  };
}

/** The company's saved mapping for one system, as the voucher builder takes it. */
export async function readAccountingMap(tx: TenantTx, system: AccountingSystem): Promise<Record<string, AccountingAccount>> {
  const rows = await tx.accountingAccountMap.findMany({ where: { system }, select: { key: true, code: true, name: true } });
  return Object.fromEntries(rows.map((row) => [row.key, { code: row.code, name: row.name }]));
}

/** Whether a saved row is usable: a name, and a code where the system goes by codes. */
function isMapped(system: AccountingSystem, account: AccountingAccount | undefined): boolean {
  if (!account?.name.trim()) return false;
  return !accountingNeedsAccountCode(system) || account.code.trim() !== '';
}

/**
 * Settings → Accounting: which system the books are kept in, and which account each kind of money
 * posts to there.
 *
 * Reading is for anybody who exports or manages; changing is `accounting.manage`. Every change lands
 * in `accounting_settings` or `accounting_account_maps`, whose audit triggers record who changed what.
 * Suggested accounts are only ever written by the explicit "use the suggested accounts" action, so
 * nothing posts to an account the company has not seen.
 */
@Injectable()
export class AccountingSettingsService {
  constructor(private readonly tenantDb: TenantDb) {}

  /** `GET /accounting/settings?system=`: the settings, and the mapping grid for one system. */
  async overview(actor: RequestUser, requested?: AccountingSystem) {
    return this.tenantDb.transaction(actor.tenantId, async (tx) => {
      const settings = await readAccountingSettings(tx);
      const system = requested ?? settings.system;
      const [map, projects, costCodes] = await Promise.all([
        readAccountingMap(tx, system),
        tx.project.findMany({
          where: { deletedAt: null, ...(actor.seesAllProjects ? {} : { id: { in: actor.projectIds } }) },
          select: { id: true, name: true },
          orderBy: { name: 'asc' },
        }),
        tx.costCode.findMany({
          where: actor.seesAllProjects ? {} : { projectId: { in: actor.projectIds } },
          distinct: ['code'],
          select: { code: true, name: true },
          orderBy: { code: 'asc' },
          take: 500,
        }),
      ]);
      const regime = actor.taxRegime;
      const defaults = accountingDefaultMap(system, regime);
      const catalogue = accountingKeyCatalogue(system, regime);
      const catalogued = new Set(catalogue.map((item) => item.key));

      const row = (key: string, label: string, group: AccountingKeyGroup | 'optional', required: boolean) => ({
        key,
        label,
        group,
        group_label: group === 'optional' ? 'Optional: by rate, cost code and site' : ACCOUNTING_KEY_GROUP_LABELS[group],
        required,
        account: map[key] ?? null,
        suggested: defaults[key] ?? null,
      });

      const keys = catalogue.map((item) => row(item.key, item.label, item.group, true));
      // Optional rows: a suggested per-rate ledger, every cost code and every site, and anything saved
      // earlier that is none of those (a rate the company added by hand).
      const optionalKeys = new Set<string>([
        ...Object.keys(defaults).filter((key) => !catalogued.has(key)),
        ...costCodes.map((code) => `cost_code:${code.code}`),
        ...projects.map((project) => `site:${project.id}`),
        ...Object.keys(map).filter((key) => !catalogued.has(key)),
      ]);
      const siteNames = new Map(projects.map((project) => [`site:${project.id}`, project.name]));
      const codeNames = new Map(costCodes.map((code) => [`cost_code:${code.code}`, `${code.code} ${code.name}`]));
      const optional = [...optionalKeys]
        .filter((key) => !key.startsWith('site:') || siteNames.has(key))
        .map((key) =>
          row(
            key,
            siteNames.has(key)
              ? `Site: ${siteNames.get(key)}`
              : codeNames.has(key)
                ? `Cost code ${codeNames.get(key)}`
                : accountingKeyLabel(key, regime),
            'optional',
            false,
          ),
        );

      const missing = keys.filter((item) => !isMapped(system, map[item.key])).map((item) => item.key);
      return {
        settings,
        system,
        systems: ACCOUNTING_SYSTEMS.map((id) => ({ id, label: ACCOUNTING_SYSTEM_LABELS[id] })),
        tax_regime: regime,
        tax_name: taxRule(regime).taxName,
        currency: actor.currency,
        uses_tax_codes: accountingUsesTaxCodes(system),
        needs_account_code: accountingNeedsAccountCode(system),
        posts_to_party_ledger: accountingPostsToPartyLedger(system),
        keys,
        optional,
        completeness: { total: keys.length, mapped: keys.length - missing.length, missing },
        can_manage: can(actor, 'accounting.manage'),
      };
    });
  }

  /** `PUT /accounting/settings`. */
  async saveSettings(actor: RequestUser, input: AccountingSettingsInput) {
    const data = {
      system: input.system,
      gstHomeState: input.gst_home_state,
      tallyCompany: input.tally_company,
      qboSiteDimension: input.qbo_site_dimension,
      xeroTrackingName: input.xero_tracking_name,
      netsuiteSubsidiary: input.netsuite_subsidiary,
      netsuiteSiteDimension: input.netsuite_site_dimension,
      updatedByUserId: actor.userId,
    };
    await this.tenantDb.transaction(actor.tenantId, async (tx) => {
      await tx.accountingSettings.upsert({
        where: { tenantId: actor.tenantId },
        create: { tenantId: actor.tenantId, ...data },
        update: data,
      });
    });
    return this.overview(actor, input.system);
  }

  /**
   * `PUT /accounting/mappings`: save what is on the grid. An empty name clears the row. Xero and SAP
   * identify accounts by code, so a row there without one is refused rather than saved to fail later.
   */
  async saveMappings(actor: RequestUser, input: AccountingMappingInput) {
    const needsCode = accountingNeedsAccountCode(input.system);
    const withoutCode = input.rows.filter((row) => row.name && !row.code).map((row) => row.key);
    if (needsCode && withoutCode.length > 0) {
      throw ApiError.validationFailed(
        { keys: withoutCode },
        `${ACCOUNTING_SYSTEM_LABELS[input.system]} needs an account code for every account`,
      );
    }
    const keys = input.rows.map((row) => row.key);
    if (new Set(keys).size !== keys.length) {
      throw ApiError.validationFailed({ keys }, 'Each account appears once');
    }
    await this.tenantDb.transaction(actor.tenantId, async (tx) => {
      const existing = new Map(
        (await tx.accountingAccountMap.findMany({ where: { system: input.system, key: { in: keys } } })).map((row) => [row.key, row]),
      );
      for (const row of input.rows) {
        const current = existing.get(row.key);
        if (!row.name) {
          if (current) await tx.accountingAccountMap.delete({ where: { id: current.id } });
          continue;
        }
        // Unchanged rows are left alone, so the audit log shows only what somebody actually changed.
        if (current && current.code === row.code && current.name === row.name) continue;
        if (current) {
          await tx.accountingAccountMap.update({
            where: { id: current.id },
            data: { code: row.code, name: row.name, updatedByUserId: actor.userId },
          });
        } else {
          await tx.accountingAccountMap.create({
            data: { tenantId: actor.tenantId, system: input.system, key: row.key, code: row.code, name: row.name, updatedByUserId: actor.userId },
          });
        }
      }
    });
    return this.overview(actor, input.system);
  }

  /** `POST /accounting/mappings/defaults`: the suggested account for every key not yet mapped. */
  async applyDefaults(actor: RequestUser, input: AccountingDefaultsInput) {
    await this.tenantDb.transaction(actor.tenantId, async (tx) => {
      const saved = new Set(
        (await tx.accountingAccountMap.findMany({ where: { system: input.system }, select: { key: true } })).map((row) => row.key),
      );
      const defaults = accountingDefaultMap(input.system, actor.taxRegime);
      const rows = Object.entries(defaults)
        .filter(([key]) => !saved.has(key))
        .map(([key, account]) => ({
          tenantId: actor.tenantId,
          system: input.system,
          key,
          code: account.code,
          name: account.name,
          updatedByUserId: actor.userId,
        }));
      // The audit trigger is per row, so each suggestion accepted is still its own entry.
      if (rows.length > 0) await tx.accountingAccountMap.createMany({ data: rows });
    });
    return this.overview(actor, input.system);
  }
}
