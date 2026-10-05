import type { SubcontractStatementView } from '@sitebook/shared';

/**
 * Subcontracts and progress (RA) billing (roadmap Phase 2, module 3) — the API's shapes.
 *
 * Money is minor units as a string; quantities are decimal strings. Money is `null` for somebody who
 * may measure work on site but not see what it is worth (`subcontracts.measure` without
 * `subcontracts.view`).
 */

export type SubcontractStatus = 'draft' | 'active' | 'completed' | 'closed' | 'terminated';
export type RaBillStatus = 'draft' | 'submitted' | 'certified' | 'paid';

export interface Person {
  id: string;
  name: string;
}

export interface CostCodeRef {
  id: string;
  code: string;
  name: string;
}

/** `GET /subcontracts`. */
export interface SubcontractSummary {
  id: string;
  number: string;
  title: string;
  status: SubcontractStatus;
  project: { id: string; name: string };
  contractor: { id: string; name: string };
  start_date: string | null;
  end_date: string | null;
  current_value: string | null;
  certified: string | null;
  paid: string | null;
  balance_due: string | null;
  retention_held: string | null;
  open_bill: { id: string; number: number; status: RaBillStatus } | null;
}

export interface SubcontractLine {
  id: string;
  item_code: string | null;
  description: string;
  unit: string;
  quantity: string;
  rate: string | null;
  amount: string | null;
  cost_code: CostCodeRef | null;
  variation_id: string | null;
  certified_quantity: string;
  certified_value: string | null;
}

export interface SubcontractVariation {
  id: string;
  number: number;
  title: string;
  reason: string | null;
  status: 'pending' | 'approved' | 'rejected';
  value: string | null;
  requested_by: Person | null;
  decided_by: Person | null;
  decided_at: string | null;
  decision_note: string | null;
  created_at: string;
  lines: SubcontractLine[];
}

export interface RaBillFigures {
  gross_to_date: string;
  previous_gross: string;
  gross: string;
  retention_to_date: string;
  retention: string;
  advance_recovered_to_date: string;
  advance_recovery: string;
  deductions: string;
  tax_rate_bp: number;
  tax: string;
  net_payable: string;
}

export interface RaBillSummary {
  id: string;
  subcontract_id: string;
  number: number;
  status: RaBillStatus;
  period_from: string | null;
  period_to: string;
  bill_date: string;
  note: string | null;
  created_by: Person | null;
  submitted_by: Person | null;
  submitted_at: string | null;
  certified_by: Person | null;
  certified_at: string | null;
  certification_note: string | null;
  figures: RaBillFigures | null;
  paid: string | null;
  balance: string | null;
}

export interface SubcontractPayment {
  id: string;
  kind: 'advance' | 'bill' | 'retention';
  bill_id: string | null;
  bill_number: number | null;
  retention_release_id: string | null;
  amount: string;
  paid_on: string;
  mode: string;
  reference: string | null;
  note: string | null;
  recorded_by: Person | null;
}

export interface RetentionRelease {
  id: string;
  amount: string;
  released_on: string;
  note: string | null;
  approved_by: Person | null;
  paid: string;
}

/** `GET /subcontracts/:id`. */
export interface SubcontractDetail extends Omit<SubcontractSummary, 'contractor'> {
  scope: string | null;
  completed_on: string | null;
  contractor: {
    id: string;
    name: string;
    phone: string | null;
    tax_id: string | null;
    address: string | null;
  };
  retention_bp: number;
  retention_release_at_completion_bp: number;
  defects_liability_months: number;
  defects_liability_ends: string | null;
  advance_amount: string | null;
  advance_recovery_bp: number;
  tax_rate_bp: number;
  payment_terms: string | null;
  lines: SubcontractLine[];
  variations: SubcontractVariation[];
  bills: RaBillSummary[];
  retention_releases: RetentionRelease[];
  payments: SubcontractPayment[];
  documents: Array<{ id: string; title: string; category: string; version: number }>;
  statement: SubcontractStatementView | null;
  retention_tranches: { at_completion: string; after_defects: string } | null;
}

export interface RaBillLine {
  line_id: string;
  item_code: string | null;
  description: string;
  unit: string;
  cost_code: CostCodeRef | null;
  variation_id: string | null;
  contract_quantity: string;
  previous_quantity: string;
  claimed_quantity: string;
  certified_quantity: string | null;
  rate: string | null;
  previous_value: string | null;
  value_to_date: string | null;
  this_bill: string | null;
}

export interface RaDeduction {
  id: string;
  kind: 'material' | 'labour' | 'damage' | 'penalty' | 'other';
  description: string;
  amount: string;
  cost_code: CostCodeRef | null;
  expense_id: string | null;
  stock_movement_id: string | null;
}

/** `GET /subcontract-bills/:id`. */
export interface RaBillDetail extends RaBillSummary {
  subcontract: {
    id: string;
    number: string;
    title: string;
    status: SubcontractStatus;
    retention_bp: number;
    advance_recovery_bp: number;
    tax_rate_bp: number;
    payment_terms: string | null;
    project: { id: string; name: string };
    contractor: {
      id: string;
      name: string;
      phone: string | null;
      tax_id: string | null;
      address: string | null;
    };
  };
  lines: RaBillLine[];
  deductions: RaDeduction[];
  payments: SubcontractPayment[];
}

/** What the forms send for a line of the schedule of rates. */
export interface SubcontractLineInput {
  cost_code_id?: string | null;
  item_code?: string;
  description: string;
  unit: string;
  quantity: string;
  rate: string;
}

export interface RaDeductionInput {
  kind: RaDeduction['kind'];
  description: string;
  amount: string;
  cost_code_id?: string | null;
}
