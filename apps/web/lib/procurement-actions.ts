'use server';

import { revalidatePath } from 'next/cache';
import { runAction, serverFetch, type ActionResult } from './server-api';
import type {
  ProcurementSettings,
  PurchaseInvoice,
  PurchaseOrder,
  PurchaseOrderLineInput,
  Rfq,
  Vendor,
} from './procurement-types';
import type { CostCode } from './cost-code-types';

/**
 * Procurement (roadmap Phase 2, module 2). In a file of their own, like the cost-code actions, so
 * the module's writes read together and do not collide with the rest of `actions.ts`.
 */

function refresh(...paths: string[]) {
  revalidatePath('/procurement', 'layout');
  for (const path of paths) revalidatePath(path);
}

// --- suppliers -------------------------------------------------------------------------------------

export interface VendorInput {
  name?: string;
  contact_name?: string | null;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  tax_id?: string | null;
  payment_terms_days?: number | null;
  notes?: string | null;
  active?: boolean;
}

export async function createVendor(input: VendorInput): Promise<ActionResult<Vendor>> {
  const result = await runAction(() => serverFetch<Vendor>('/vendors', { method: 'POST', body: input }));
  if (result.ok) refresh();
  return result;
}

export async function updateVendor(id: string, input: VendorInput): Promise<ActionResult<Vendor>> {
  const result = await runAction(() =>
    serverFetch<Vendor>(`/vendors/${id}`, { method: 'PATCH', body: input }),
  );
  if (result.ok) refresh();
  return result;
}

export async function deleteVendor(id: string): Promise<ActionResult> {
  const result = await runAction(() => serverFetch(`/vendors/${id}`, { method: 'DELETE' }));
  if (result.ok) refresh();
  return result;
}

/** The site's cost codes, for the line pickers. */
export async function siteCostCodes(projectId: string): Promise<ActionResult<CostCode[]>> {
  return runAction(() => serverFetch<CostCode[]>(`/projects/${projectId}/cost-codes`));
}

// --- quotes ----------------------------------------------------------------------------------------

export async function createRfq(input: {
  project_id: string;
  title: string;
  notes?: string;
  required_by?: string;
  indent_id?: string;
  items?: Array<{
    material_id?: string | null;
    description?: string;
    unit?: string;
    quantity: string;
    cost_code_id?: string | null;
  }>;
}): Promise<ActionResult<Rfq>> {
  const result = await runAction(() => serverFetch<Rfq>('/rfqs', { method: 'POST', body: input }));
  if (result.ok) refresh();
  return result;
}

export async function saveQuote(
  rfqId: string,
  input: {
    vendor_id: string;
    delivery_days?: number | null;
    valid_until?: string | null;
    notes?: string | null;
    lines: Array<{ rfq_item_id: string; unit_rate: string; tax_rate_bp: number }>;
  },
): Promise<ActionResult<Rfq>> {
  const result = await runAction(() =>
    serverFetch<Rfq>(`/rfqs/${rfqId}/quotes`, { method: 'PUT', body: input }),
  );
  if (result.ok) refresh(`/procurement/rfqs/${rfqId}`);
  return result;
}

export async function removeQuote(rfqId: string, quoteId: string): Promise<ActionResult> {
  const result = await runAction(() =>
    serverFetch(`/rfqs/${rfqId}/quotes/${quoteId}`, { method: 'DELETE' }),
  );
  if (result.ok) refresh(`/procurement/rfqs/${rfqId}`);
  return result;
}

export async function awardRfq(
  rfqId: string,
  quoteId: string,
): Promise<ActionResult<{ purchase_order_id: string }>> {
  const result = await runAction(() =>
    serverFetch<{ purchase_order_id: string }>(`/rfqs/${rfqId}/award`, {
      method: 'POST',
      body: { quote_id: quoteId },
    }),
  );
  if (result.ok) refresh(`/procurement/rfqs/${rfqId}`);
  return result;
}

export async function cancelRfq(rfqId: string): Promise<ActionResult> {
  const result = await runAction(() => serverFetch(`/rfqs/${rfqId}/cancel`, { method: 'POST' }));
  if (result.ok) refresh(`/procurement/rfqs/${rfqId}`);
  return result;
}

// --- purchase orders -------------------------------------------------------------------------------

export async function createPurchaseOrder(input: {
  project_id: string;
  vendor_id: string;
  notes?: string;
  delivery_address?: string;
  expected_on?: string;
  lines: PurchaseOrderLineInput[];
}): Promise<ActionResult<PurchaseOrder>> {
  const result = await runAction(() =>
    serverFetch<PurchaseOrder>('/purchase-orders', { method: 'POST', body: input }),
  );
  if (result.ok) refresh(`/projects/${input.project_id}`);
  return result;
}

export async function updatePurchaseOrder(
  id: string,
  input: {
    vendor_id?: string;
    notes?: string | null;
    delivery_address?: string | null;
    expected_on?: string | null;
    lines?: PurchaseOrderLineInput[];
  },
): Promise<ActionResult<PurchaseOrder>> {
  const result = await runAction(() =>
    serverFetch<PurchaseOrder>(`/purchase-orders/${id}`, { method: 'PATCH', body: input }),
  );
  if (result.ok) refresh(`/procurement/orders/${id}`);
  return result;
}

/** submit · approve · reject · send · cancel · close — one door, the API decides what is legal. */
export async function purchaseOrderAction(
  id: string,
  action: 'submit' | 'approve' | 'reject' | 'send' | 'cancel' | 'close',
  note?: string,
): Promise<ActionResult<PurchaseOrder>> {
  const result = await runAction(() =>
    serverFetch<PurchaseOrder>(`/purchase-orders/${id}/${action}`, {
      method: 'POST',
      body: note ? { note } : {},
    }),
  );
  if (result.ok) refresh(`/procurement/orders/${id}`);
  return result;
}

export async function receiveGoods(
  id: string,
  input: {
    received_on: string;
    ref?: string;
    note?: string;
    lines: Array<{ po_line_id: string; quantity: string }>;
  },
): Promise<ActionResult<PurchaseOrder>> {
  const result = await runAction(() =>
    serverFetch<PurchaseOrder>(`/purchase-orders/${id}/receipts`, { method: 'POST', body: input }),
  );
  if (result.ok) refresh(`/procurement/orders/${id}`, '/stock');
  return result;
}

// --- invoices --------------------------------------------------------------------------------------

export async function recordPurchaseInvoice(
  orderId: string,
  input: {
    invoice_number: string;
    invoice_date: string;
    due_date?: string;
    attachment_s3_key?: string;
    note?: string;
    lines: Array<{ po_line_id: string; quantity: string; unit_rate: string; tax_amount: string }>;
  },
): Promise<ActionResult<PurchaseInvoice>> {
  const result = await runAction(() =>
    serverFetch<PurchaseInvoice>(`/purchase-orders/${orderId}/invoices`, {
      method: 'POST',
      body: input,
    }),
  );
  if (result.ok) refresh(`/procurement/orders/${orderId}`);
  return result;
}

export async function approvePurchaseInvoice(
  id: string,
  input: { accept_variance?: boolean; note?: string },
): Promise<ActionResult<PurchaseInvoice>> {
  const result = await runAction(() =>
    serverFetch<PurchaseInvoice>(`/purchase-invoices/${id}/approve`, { method: 'POST', body: input }),
  );
  if (result.ok) refresh(`/procurement/invoices/${id}`, '/expenses');
  return result;
}

export async function rejectPurchaseInvoice(id: string, note: string): Promise<ActionResult<PurchaseInvoice>> {
  const result = await runAction(() =>
    serverFetch<PurchaseInvoice>(`/purchase-invoices/${id}/reject`, {
      method: 'POST',
      body: { note },
    }),
  );
  if (result.ok) refresh(`/procurement/invoices/${id}`);
  return result;
}

export async function deletePurchaseInvoice(id: string): Promise<ActionResult> {
  const result = await runAction(() => serverFetch(`/purchase-invoices/${id}`, { method: 'DELETE' }));
  if (result.ok) refresh();
  return result;
}

// --- settings --------------------------------------------------------------------------------------

export async function saveProcurementSettings(input: {
  match_tolerance_bp?: number;
  limits?: Array<{ role_id?: string | null; user_id?: string | null; max_amount: string | null }>;
}): Promise<ActionResult<ProcurementSettings>> {
  const result = await runAction(() =>
    serverFetch<ProcurementSettings>('/procurement/settings', { method: 'PUT', body: input }),
  );
  if (result.ok) refresh('/procurement/settings');
  return result;
}
