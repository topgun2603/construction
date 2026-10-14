import type { AccountingAccount, AccountingSystem } from '@sitebook/shared';

/** One row of the mapping grid (`GET /accounting/settings`). */
export interface AccountingKeyRow {
  key: string;
  label: string;
  group: string;
  group_label: string;
  /** Catalogue keys must be mapped before an export that uses them; optional ones refine them. */
  required: boolean;
  account: AccountingAccount | null;
  suggested: AccountingAccount | null;
}

export interface AccountingSettingsValues {
  system: AccountingSystem;
  gst_home_state: string | null;
  tally_company: string | null;
  qbo_site_dimension: 'class' | 'location';
  xero_tracking_name: string | null;
  netsuite_subsidiary: string | null;
  netsuite_site_dimension: 'department' | 'class' | 'location';
  updated_at: string | null;
}

/** `GET /accounting/settings?system=` — Settings → Accounting. */
export interface AccountingOverview {
  settings: AccountingSettingsValues;
  /** The system the grid below is for: the saved one unless another was asked for. */
  system: AccountingSystem;
  systems: { id: AccountingSystem; label: string }[];
  tax_regime: string;
  tax_name: string | null;
  currency: string;
  uses_tax_codes: boolean;
  needs_account_code: boolean;
  posts_to_party_ledger: boolean;
  keys: AccountingKeyRow[];
  optional: AccountingKeyRow[];
  completeness: { total: number; mapped: number; missing: string[] };
  can_manage: boolean;
}

export interface AccountingMissing {
  key: string;
  label: string;
  example: string;
}

export interface AccountingPriorBatch {
  number: number;
  system: string;
  at: string;
}

export interface AccountingPreviewVoucher {
  external_id: string;
  source_type: string;
  source_id: string;
  category: string;
  kind: string;
  document: 'bill' | 'invoice' | 'journal';
  date: string;
  reference: string;
  party: string | null;
  site: string | null;
  narration: string;
  /** Total debits, minor units. */
  amount: string;
  lines: { account: string; code: string; debit: string; credit: string }[];
  exported_in: AccountingPriorBatch | null;
}

/** `POST /accounting/preview`. */
export interface AccountingPreview {
  system: AccountingSystem;
  system_label: string;
  from: string;
  to: string;
  currency: string;
  digits: number;
  complete: boolean;
  missing: AccountingMissing[];
  counts: Record<'purchases' | 'payroll' | 'subcontract_bills' | 'sales' | 'payments', number>;
  documents: Record<'bill' | 'invoice' | 'journal', number>;
  debit_total: string;
  credit_total: string;
  accounts: { key: string; code: string; name: string; debit: string; credit: string }[];
  voucher_count: number;
  vouchers: AccountingPreviewVoucher[];
  skipped_count: number;
  skipped: { external_id: string; source_type: string; date: string; exported_in: AccountingPriorBatch }[];
  payroll_left_out: boolean;
  masters: { parties: number; accounts: number } | null;
}

/** A recorded export (`GET /accounting/exports`). */
export interface AccountingBatch {
  id: string;
  number: number;
  system: string;
  system_label: string;
  from: string;
  to: string;
  project_ids: string[];
  include: string[];
  include_exported: boolean;
  voucher_count: number;
  summary: {
    counts?: Record<string, number>;
    debit_total?: string;
    credit_total?: string;
    skipped?: number;
  };
  created_by: string;
  created_at: string;
  files: { id: string; name: string; content_type: string; size_bytes: number }[];
}
