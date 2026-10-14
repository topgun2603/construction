import type { TenantLocaleInput } from '@sitebook/shared';

/**
 * The tenant's locale columns, selected and serialised in one place so `/me` and `/tenants`
 * cannot drift apart. Spread into a Prisma `select`.
 */
export const selectTenantLocale = {
  country: true,
  currency: true,
  timezone: true,
  locale: true,
  taxRegime: true,
} as const;

export interface TenantLocaleRow {
  country: string;
  currency: string;
  timezone: string;
  locale: string;
  taxRegime: string;
}

export function tenantLocaleView(row: TenantLocaleRow): TenantLocaleInput {
  return {
    country: row.country,
    currency: row.currency,
    timezone: row.timezone,
    locale: row.locale,
    // The CHECK constraint in the tenant_locale migration holds this to TAX_REGIMES.
    tax_regime: row.taxRegime as TenantLocaleInput['tax_regime'],
  };
}

/** API field names → Prisma's, for the subset an onboarding or update body carried. */
export function tenantLocaleData(input: Partial<TenantLocaleInput>): Partial<TenantLocaleRow> {
  return {
    ...(input.country === undefined ? {} : { country: input.country }),
    ...(input.currency === undefined ? {} : { currency: input.currency }),
    ...(input.timezone === undefined ? {} : { timezone: input.timezone }),
    ...(input.locale === undefined ? {} : { locale: input.locale }),
    ...(input.tax_regime === undefined ? {} : { taxRegime: input.tax_regime }),
  };
}
