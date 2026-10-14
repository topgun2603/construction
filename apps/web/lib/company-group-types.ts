import type {
  CompanyGroupCountKey,
  CompanyGroupMoneyKey,
  CompanyGroupPermission,
  CompanyGroupRateUsed,
} from '@sitebook/shared';

/** Company groups (Phase 2, module 11) as the API returns them. Money is minor units as strings. */

/** One company the signed-in person belongs to — the switcher's and the sign-in picker's rows. */
export interface CompanyMembership {
  tenant_id: string;
  tenant_name: string;
  logo_url: string | null;
  country: string;
  currency: string;
  role: string;
  role_name: string;
  status: string;
  current: boolean;
}

export interface CompanyGroupCompany {
  tenant_id: string;
  name: string;
  currency: string;
  country: string;
  status: string;
  joined_at: string;
  current: boolean;
}

export interface CompanyGroupAdmin {
  id: string;
  tenant_id: string;
  tenant_name: string | null;
  user_id: string;
  name: string | null;
  phone: string | null;
  permissions: CompanyGroupPermission[];
  active: boolean;
}

export interface CompanyGroupInvitation {
  id: string;
  group_id: string;
  group_name: string | null;
  tenant_id: string;
  tenant_name: string | null;
  status: string;
  created_at: string;
  responded_at: string | null;
}

export interface CompanyGroupRateRow {
  id: string;
  currency: string;
  rate: string;
  effective_from: string;
  created_at: string;
}

export interface CompanyGroupOverview {
  company: { id: string; name: string; currency: string; is_owner: boolean };
  group: { id: string; name: string; base_currency: string; created_at: string } | null;
  my_permissions: CompanyGroupPermission[];
  companies: CompanyGroupCompany[];
  admins: CompanyGroupAdmin[];
  outgoing_invitations: CompanyGroupInvitation[];
  incoming_invitations: CompanyGroupInvitation[];
  rates: CompanyGroupRateRow[];
}

export interface CompanyGroupReportCompany {
  tenant_id: string;
  name: string;
  currency: string;
  locale: string;
  status: string;
  money: Record<CompanyGroupMoneyKey, string>;
  counts: Record<CompanyGroupCountKey, number>;
}

export interface CompanyGroupReport {
  group: { id: string; name: string; base_currency: string };
  period: { from: string; to: string };
  rates_as_of: string;
  companies: CompanyGroupReportCompany[];
  total: {
    currency: string;
    money: Record<CompanyGroupMoneyKey, string>;
    counts: Record<CompanyGroupCountKey, number>;
    rates_used: CompanyGroupRateUsed[];
    missing_currencies: string[];
    complete: boolean;
  };
}
