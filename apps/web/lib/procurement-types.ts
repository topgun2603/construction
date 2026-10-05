/**
 * Procurement (roadmap Phase 2, module 2) — the API's shapes.
 *
 * A file of its own, beside `cost-code-types.ts`, so the module's types do not collide with the
 * rest of `api-types.ts`. Money is minor units as a string; quantities are decimal strings.
 * A money field is null when the caller can receive goods but not see prices.
 */

import type { MatchFlag, PurchaseInvoiceStatus, PurchaseOrderStatus, RfqStatus } from '@sitebook/shared';

export interface Vendor {
  id: string;
  name: string;
  contact_name: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  tax_id: string | null;
  payment_terms_days: number | null;
  notes: string | null;
  active: boolean;
  created_at: string;
}

export interface VendorDetail extends Vendor {
  ordered_total: string;
  orders: Array<{
    id: string;
    number: string;
    status: PurchaseOrderStatus;
    total: string;
    created_at: string;
    project_id: string;
    project_name: string;
  }>;
}

export interface PersonRef {
  id: string;
  name: string;
}

export interface CostCodeRef {
  id: string;
  code: string;
  name: string;
}

export interface PurchaseOrderSummary {
  id: string;
  number: string;
  status: PurchaseOrderStatus;
  project_id: string;
  project_name: string;
  vendor_id: string;
  vendor_name: string;
  subtotal: string | null;
  tax_total: string | null;
  total: string | null;
  expected_on: string | null;
  created_at: string;
  approved_at: string | null;
  created_by: PersonRef;
  approved_by: PersonRef | null;
  line_count: number;
}

export interface PurchaseOrderLine {
  id: string;
  material_id: string | null;
  description: string;
  unit: string;
  quantity: string;
  unit_rate: string | null;
  tax_rate_bp: number;
  amount: string | null;
  tax_amount: string | null;
  total: string | null;
  cost_code: CostCodeRef | null;
  received_quantity: string;
  billed_quantity: string;
}

export interface PurchaseOrder {
  id: string;
  number: string;
  status: PurchaseOrderStatus;
  project_id: string;
  project_name: string;
  project_address: string | null;
  vendor: {
    id: string;
    name: string;
    tax_id: string | null;
    phone: string | null;
    email: string | null;
    address: string | null;
    contact_name: string | null;
    payment_terms_days: number | null;
  };
  rfq_id: string | null;
  indent_id: string | null;
  notes: string | null;
  delivery_address: string | null;
  expected_on: string | null;
  subtotal: string | null;
  tax_total: string | null;
  total: string | null;
  billed_total: string | null;
  created_by: PersonRef;
  created_at: string;
  submitted_at: string | null;
  approved_by: PersonRef | null;
  approved_at: string | null;
  decision_note: string | null;
  sent_at: string | null;
  closed_at: string | null;
  cancelled_at: string | null;
  lines: PurchaseOrderLine[];
  receipts: Array<{
    id: string;
    received_on: string;
    ref: string | null;
    note: string | null;
    received_by: PersonRef;
    created_at: string;
    lines: Array<{ po_line_id: string; quantity: string }>;
  }>;
  invoices: Array<{
    id: string;
    invoice_number: string;
    invoice_date: string;
    status: PurchaseInvoiceStatus;
    total: string;
  }>;
  approval?: {
    my_limit: string | null;
    can_approve: boolean;
    approvers: PersonRef[];
  };
}

export interface RfqSummary {
  id: string;
  number: string;
  title: string;
  status: RfqStatus;
  project_id: string;
  project_name: string;
  required_by: string | null;
  created_at: string;
  item_count: number;
  quote_count: number;
}

export interface Rfq {
  id: string;
  number: string;
  title: string;
  notes: string | null;
  status: RfqStatus;
  project_id: string;
  project_name: string;
  indent_id: string | null;
  required_by: string | null;
  awarded_quote_id: string | null;
  created_by: PersonRef;
  created_at: string;
  purchase_orders: Array<{ id: string; number: string; status: PurchaseOrderStatus }>;
  items: Array<{
    id: string;
    material_id: string | null;
    description: string;
    unit: string;
    quantity: string;
    cost_code: CostCodeRef | null;
  }>;
  quotes: Array<{
    id: string;
    vendor: { id: string; name: string; tax_id: string | null };
    delivery_days: number | null;
    valid_until: string | null;
    notes: string | null;
    lines: Array<{ rfq_item_id: string; unit_rate: string; tax_rate_bp: number }>;
  }>;
  comparison: {
    lowest_quote_id: string | null;
    best_split_total: string | null;
    quotes: Array<{
      quote_id: string;
      subtotal: string;
      tax: string;
      total: string;
      complete: boolean;
      quoted_items: number;
    }>;
    items: Array<{
      rfq_item_id: string;
      lowest_quote_id: string | null;
      cells: Array<{ quote_id: string; amount: string; tax: string; total: string }>;
    }>;
  };
}

export interface PurchaseInvoice {
  id: string;
  purchase_order_id: string;
  purchase_order_number: string;
  project_id: string;
  project_name: string;
  vendor: { id: string; name: string; tax_id: string | null };
  invoice_number: string;
  invoice_date: string;
  due_date: string | null;
  subtotal: string;
  tax_total: string;
  total: string;
  attachment_s3_key: string | null;
  status: PurchaseInvoiceStatus;
  flags: MatchFlag[];
  tolerance_bp: number;
  note: string | null;
  recorded_by: PersonRef;
  approved_by: PersonRef | null;
  approved_at: string | null;
  decision_note: string | null;
  created_at: string;
  lines: Array<{
    id: string;
    po_line_id: string;
    description: string;
    unit: string;
    quantity: string;
    unit_rate: string;
    amount: string;
    tax_amount: string;
    ordered_quantity: string;
    ordered_unit_rate: string;
    ordered_tax_rate_bp: number;
    received_quantity: string;
    cost_code: CostCodeRef | null;
    expense_id: string | null;
  }>;
}

export interface ProcurementSettings {
  match_tolerance_bp: number;
  limits: Array<{
    id: string;
    role_id: string | null;
    role_name: string | null;
    user_id: string | null;
    user_name: string | null;
    max_amount: string | null;
  }>;
  my_limit: string | null;
  can_approve: boolean;
}

/** A line as the order and award forms send it. */
export interface PurchaseOrderLineInput {
  material_id?: string | null;
  description?: string;
  unit?: string;
  quantity: string;
  unit_rate: string;
  tax_rate_bp: number;
  cost_code_id?: string | null;
}
