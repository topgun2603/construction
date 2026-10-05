import type { BoqBillStatus, BoqColumnMapping, BoqImportProblem, BoqImportRow, BoqItemKind } from '@sitebook/shared';
import { basisPointsToPercent } from '@sitebook/shared';
import type { Tone } from '@/components/ui/badge';

/**
 * Bill of quantities (roadmap Phase 2, module 5) — the API's shapes.
 *
 * Money is minor units as a string, quantities decimal strings. Money is `null` for somebody who
 * measures on site but cannot see what the job is priced at (`boq.measure` without `boq.view`).
 */

export type BoqPaymentStatus = 'not_invoiced' | 'unpaid' | 'part_paid' | 'paid';

export interface BoqItem {
  id: string;
  parent_id: string | null;
  depth: number;
  kind: BoqItemKind;
  item_no: string;
  description: string;
  unit: string | null;
  quantity: string | null;
  rate: string | null;
  amount: string | null;
  cost_code: { id: string; code: string; name: string } | null;
  measured_quantity: string | null;
  billed_quantity: string | null;
  measured_value: string | null;
  billed_value: string | null;
  balance: string | null;
  percent_bp: number;
  over: boolean;
  excess_quantity: string | null;
}

export interface BoqBillSummary {
  id: string;
  number: number;
  status: BoqBillStatus;
  payment_status: BoqPaymentStatus;
  period_from: string | null;
  period_to: string;
  bill_date: string;
  claimed_gross: string;
  gross: string;
  tax: string;
  net_payable: string;
  paid: string;
}

/** `GET /projects/:id/boq`. */
export interface BoqView {
  id: string | null;
  project: { id: string; name: string };
  title: string;
  tax_name: string | null;
  show_money: boolean;
  terms: {
    retention_bp: number;
    advance_amount: string | null;
    advance_recovery_bp: number;
    tax_rate_bp: number;
  } | null;
  items: BoqItem[];
  totals: {
    contract: string;
    measured: string;
    billed: string;
    balance: string;
    percent_bp: number;
    items: number;
    over_quantity: number;
  } | null;
  bills: BoqBillSummary[];
  can_replace: boolean;
}

/** The body of a preview or an import. */
export interface BoqImportRequest {
  file_name: string;
  content_base64: string;
  sheet?: string;
  header_row?: number;
  mapping?: BoqColumnMapping;
  mode?: 'replace' | 'append';
}

/** `POST /projects/:id/boq/import/preview`. */
export interface BoqImportPreview {
  sheets: string[];
  sheet: string | null;
  header_row: number;
  headers: string[];
  sample: string[][];
  mapping: BoqColumnMapping;
  rows: BoqImportRow[];
  errors: BoqImportProblem[];
  skipped: BoqImportProblem[];
  total: string;
  items: number;
  sections: number;
  can_replace: boolean;
  can_import: boolean;
}

export interface BoqMeasurement {
  id: string;
  item_id: string;
  measured_on: string;
  location: string | null;
  count: string | null;
  length: string | null;
  breadth: string | null;
  height: string | null;
  quantity: string;
  deduction: boolean;
  note: string | null;
  photo_keys: string[];
  measured_by: { id: string; name: string };
  created_at: string;
}

export interface BoqItemProgress {
  id: string;
  item_no: string;
  description: string;
  unit: string | null;
  quantity: string | null;
  measured_quantity: string;
  percent_bp: number;
  over: boolean;
  excess_quantity: string;
}

export interface BoqBillLine {
  item_id: string;
  item_no: string;
  description: string;
  section: string | null;
  depth: number;
  unit: string | null;
  rate: string;
  contract_quantity: string;
  measured_quantity: string;
  previous_quantity: string;
  claimed_quantity: string;
  certified_quantity: string | null;
  previous_value: string;
  value_to_date: string;
  this_bill: string;
  over_contract: boolean;
}

/** `GET /boq-bills/:id`. */
export interface BoqBillDetail {
  id: string;
  number: number;
  status: BoqBillStatus;
  payment_status: BoqPaymentStatus;
  period_from: string | null;
  period_to: string;
  bill_date: string;
  note: string | null;
  certification_note: string | null;
  boq: {
    id: string;
    title: string;
    retention_bp: number;
    advance_amount: string;
    advance_recovery_bp: number;
    tax_name: string | null;
    project: { id: string; name: string; client_name: string | null; address: string | null };
  };
  lines: BoqBillLine[];
  previous: { retention_to_date: string; advance_recovered_to_date: string };
  figures: {
    claimed_gross: string;
    gross_to_date: string;
    previous_gross: string;
    gross: string;
    retention_to_date: string;
    retention: string;
    advance_recovered_to_date: string;
    advance_recovery: string;
    tax_rate_bp: number;
    tax: string;
    net_payable: string;
  };
  invoice: {
    payment_stage_id: string;
    label: string;
    amount: string;
    tax_amount: string;
    due_date: string | null;
    raised_at: string | null;
    paid: string;
    outstanding: string;
  } | null;
  created_by: { id: string; name: string } | null;
  submitted_by: { id: string; name: string } | null;
  submitted_at: string | null;
  certified_by: { id: string; name: string } | null;
  certified_at: string | null;
  invoiced_by: { id: string; name: string } | null;
  invoiced_at: string | null;
}

/** How a bill's status reads, and its colour. Paid is worked out from the receipts. */
export const BOQ_BILL_STATUS: Record<BoqBillStatus, { label: string; tone: Tone }> = {
  draft: { label: 'Draft', tone: 'neutral' },
  submitted: { label: 'With the client', tone: 'pending' },
  certified: { label: 'Certified, not invoiced', tone: 'accent' },
  invoiced: { label: 'Invoiced', tone: 'accent' },
};

export const BOQ_PAYMENT_STATUS: Record<BoqPaymentStatus, { label: string; tone: Tone }> = {
  not_invoiced: { label: 'Not invoiced', tone: 'neutral' },
  unpaid: { label: 'Unpaid', tone: 'pending' },
  part_paid: { label: 'Part paid', tone: 'pending' },
  paid: { label: 'Paid', tone: 'done' },
};

/** 1250 basis points → "12.5%". */
export function boqPercent(bp: number): string {
  return `${basisPointsToPercent(bp)}%`;
}
