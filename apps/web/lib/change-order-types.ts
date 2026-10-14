import type { ChangeOrderReason, ChangeOrderStatus } from '@sitebook/shared';

/**
 * Change orders (roadmap Phase 2, module 4) — the API's shapes. Money is minor units as a string,
 * like everywhere else.
 */

export type { ChangeOrderReason, ChangeOrderStatus };

export interface ChangeOrderPerson {
  id: string;
  name: string;
  role: string;
}

/** A row of `GET /change-orders`. */
export interface ChangeOrderSummary {
  id: string;
  project: { id: string; name: string };
  number: number;
  revision: number;
  label: string;
  title: string;
  reason: ChangeOrderReason;
  status: ChangeOrderStatus;
  raised_by: ChangeOrderPerson | null;
  raised_on: string;
  cost_impact: string;
  client_price: string;
  margin: string;
  tax: string;
  client_total: string;
  time_impact_days: number;
  sent_at: string | null;
  client_decided_at: string | null;
  updated_at: string;
}

export interface ChangeOrderRegister {
  items: ChangeOrderSummary[];
  totals: {
    count: number;
    approved_count: number;
    approved_cost: string;
    approved_price: string;
    approved_days: number;
    pending_count: number;
    pending_price: string;
    awaiting_client: number;
    awaiting_approval: number;
  };
}

export interface ChangeOrderLine {
  id: string;
  cost_code: { id: string; code: string; name: string } | null;
  description: string;
  unit: string | null;
  quantity: string | null;
  rate: string | null;
  amount: string;
}

/** `GET /change-orders/:id`. */
export interface ChangeOrderDetail extends ChangeOrderSummary {
  description: string | null;
  markup_bp: number;
  entered_price: string | null;
  tax_rate_bp: number;
  lines: ChangeOrderLine[];
  attachments: Array<{
    id: string;
    document: { id: string; title: string; version: number } | null;
    content_type: string | null;
    caption: string | null;
    url: string | null;
  }>;
  submitted_by: ChangeOrderPerson | null;
  submitted_at: string | null;
  approved_by: ChangeOrderPerson | null;
  approved_at: string | null;
  review_note: string | null;
  approval: { id: string; status: 'pending' | 'approved' | 'rejected' } | null;
  client_decided_by: ChangeOrderPerson | null;
  client_note: string | null;
  applied_at: string | null;
  implemented_by: ChangeOrderPerson | null;
  implemented_at: string | null;
  cancelled_by: ChangeOrderPerson | null;
  cancelled_at: string | null;
  cancel_reason: string | null;
  budget_revisions: Array<{
    id: string;
    cost_code: { id: string; code: string; name: string };
    requested: string;
    amount: string;
    budget_before: string;
    budget_after: string;
    created_at: string;
  }>;
  site_revision: {
    time_impact_days: number;
    handover_before: string | null;
    handover_after: string | null;
    contract_before: string | null;
    contract_after: string | null;
    site_budget_before: string | null;
    site_budget_after: string | null;
    created_at: string;
  } | null;
}

/** `GET /projects/:id/change-order-summary`. */
export interface ChangeOrderSiteSummary {
  project_id: string;
  project_name: string;
  contract_value: string | null;
  approved_changes: string;
  approved_cost: string;
  approved_count: number;
  revised_contract_value: string | null;
  original_handover: string | null;
  handover: string | null;
  extension_days: number;
  awaiting_count: number;
  awaiting_price: string;
  awaiting_days: number;
  history: Array<{
    change_order: { id: string; label: string; title: string };
    time_impact_days: number;
    handover_before: string | null;
    handover_after: string | null;
    contract_before: string | null;
    contract_after: string | null;
    at: string;
  }>;
}

/** `GET /change-order-suggestions`: extra work the scope-creep catcher spotted. */
export interface ChangeOrderSuggestion {
  id: string;
  project: { id: string; name: string };
  source_kind: 'daily_report' | 'site_message';
  source_id: string;
  source_date: string | null;
  source_author: string | null;
  excerpt: string;
  summary: string | null;
  matched: string[];
  detected_by: 'rules' | 'ai';
  status: 'open' | 'dismissed' | 'converted';
  change_order_id: string | null;
  created_at: string;
}

/** What a client sees of a change order, carried on its portal approval. Never the cost. */
export interface ClientChangeOrder {
  id: string;
  label: string;
  title: string;
  description: string | null;
  reason: ChangeOrderReason;
  status: ChangeOrderStatus;
  client_price: string;
  tax: string;
  client_total: string;
  time_impact_days: number;
  items: Array<{ description: string; quantity: string | null; unit: string | null }>;
}

/** A line as the API takes it. */
export interface ChangeOrderLineInput {
  cost_code_id?: string | null;
  description: string;
  unit?: string | null;
  quantity?: string | null;
  rate?: string | null;
  amount?: string | null;
}

export interface ChangeOrderInput {
  title?: string;
  description?: string | null;
  reason?: ChangeOrderReason;
  raised_on?: string;
  markup_bp?: number;
  client_price?: string | null;
  tax_rate_bp?: number;
  time_impact_days?: number;
  lines?: ChangeOrderLineInput[];
}
