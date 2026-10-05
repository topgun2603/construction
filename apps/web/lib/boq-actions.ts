'use server';

import { revalidatePath } from 'next/cache';
import { runAction, serverFetch, type ActionResult } from './server-api';
import type { BoqBillDetail, BoqItemProgress, BoqMeasurement, BoqView } from './boq-types';

/**
 * Bill of quantities (roadmap Phase 2, module 5). In a file of its own, like cost codes and
 * subcontracts, so the module's writes read together and stay out of `actions.ts`.
 *
 * The import is not here: a BOQ sheet can be larger than a server action's 1 MB body, so it goes
 * through the `/boq/import` route handler instead.
 */

const sitePath = (projectId: string) => `/projects/${projectId}`;
const billPath = (billId: string) => `/boq/bills/${billId}`;

function refresh(projectId?: string, billId?: string) {
  if (projectId) revalidatePath(sitePath(projectId));
  if (billId) revalidatePath(billPath(billId));
}

export async function updateBoqTerms(
  projectId: string,
  input: {
    title?: string;
    retention_bp?: number;
    advance_amount?: string;
    advance_recovery_bp?: number;
    tax_rate_bp?: number;
  },
): Promise<ActionResult<BoqView>> {
  const result = await runAction(() =>
    serverFetch<BoqView>(`/projects/${projectId}/boq`, { method: 'PATCH', body: input }),
  );
  if (result.ok) refresh(projectId);
  return result;
}

export async function addBoqItem(
  projectId: string,
  input: {
    kind: 'section' | 'item';
    item_no: string;
    description: string;
    parent_id?: string | null;
    unit?: string;
    quantity?: string;
    rate?: string;
    cost_code_id?: string | null;
  },
): Promise<ActionResult<BoqView>> {
  const result = await runAction(() =>
    serverFetch<BoqView>(`/projects/${projectId}/boq/items`, { method: 'POST', body: input }),
  );
  if (result.ok) refresh(projectId);
  return result;
}

export async function updateBoqItem(
  projectId: string,
  itemId: string,
  input: {
    item_no?: string;
    description?: string;
    unit?: string;
    quantity?: string;
    rate?: string;
    cost_code_id?: string | null;
  },
): Promise<ActionResult<BoqView>> {
  const result = await runAction(() =>
    serverFetch<BoqView>(`/boq-items/${itemId}`, { method: 'PATCH', body: input }),
  );
  if (result.ok) refresh(projectId);
  return result;
}

export async function removeBoqItem(projectId: string, itemId: string): Promise<ActionResult> {
  const result = await runAction(() => serverFetch(`/boq-items/${itemId}`, { method: 'DELETE' }));
  if (result.ok) refresh(projectId);
  return result;
}

export async function autoMapBoqCostCodes(
  projectId: string,
  apply: boolean,
): Promise<
  ActionResult<{
    proposals: Array<{
      item_id: string;
      item_no: string;
      description: string;
      cost_code: { id: string; code: string; name: string };
    }>;
    applied: number;
  }>
> {
  const result = await runAction(() =>
    serverFetch<{
      proposals: Array<{
        item_id: string;
        item_no: string;
        description: string;
        cost_code: { id: string; code: string; name: string };
      }>;
      applied: number;
    }>(`/projects/${projectId}/boq/auto-map`, { method: 'POST', body: { apply } }),
  );
  if (result.ok && apply) refresh(projectId);
  return result;
}

// --- measurement book ----------------------------------------------------------------------------

export async function listBoqMeasurements(
  itemId: string,
): Promise<ActionResult<{ item: BoqItemProgress; items: BoqMeasurement[] }>> {
  return runAction(() =>
    serverFetch<{ item: BoqItemProgress; items: BoqMeasurement[] }>(`/boq-items/${itemId}/measurements`),
  );
}

export async function recordBoqMeasurement(
  projectId: string,
  itemId: string,
  input: {
    measured_on: string;
    location?: string;
    count?: string;
    length?: string;
    breadth?: string;
    height?: string;
    deduction?: boolean;
    note?: string;
    photo_keys?: string[];
    client_id?: string;
  },
): Promise<ActionResult<{ measurement: BoqMeasurement; item: BoqItemProgress }>> {
  const result = await runAction(() =>
    serverFetch<{ measurement: BoqMeasurement; item: BoqItemProgress }>(`/boq-items/${itemId}/measurements`, {
      method: 'POST',
      body: input,
    }),
  );
  if (result.ok) refresh(projectId);
  return result;
}

export async function removeBoqMeasurement(projectId: string, measurementId: string): Promise<ActionResult> {
  const result = await runAction(() => serverFetch(`/boq-measurements/${measurementId}`, { method: 'DELETE' }));
  if (result.ok) refresh(projectId);
  return result;
}

// --- bills to the client -------------------------------------------------------------------------

export async function createBoqBill(
  projectId: string,
  input: { period_from?: string; period_to: string; bill_date?: string; note?: string },
): Promise<ActionResult<BoqBillDetail>> {
  const result = await runAction(() =>
    serverFetch<BoqBillDetail>(`/projects/${projectId}/boq/bills`, { method: 'POST', body: input }),
  );
  if (result.ok) refresh(projectId);
  return result;
}

export async function updateBoqBill(
  projectId: string,
  billId: string,
  input: {
    period_from?: string | null;
    period_to?: string;
    bill_date?: string;
    lines?: Array<{ item_id: string; quantity_to_date: string }>;
    note?: string | null;
  },
): Promise<ActionResult<BoqBillDetail>> {
  const result = await runAction(() =>
    serverFetch<BoqBillDetail>(`/boq-bills/${billId}`, { method: 'PATCH', body: input }),
  );
  if (result.ok) refresh(projectId, billId);
  return result;
}

export async function deleteBoqBill(projectId: string, billId: string): Promise<ActionResult> {
  const result = await runAction(() => serverFetch(`/boq-bills/${billId}`, { method: 'DELETE' }));
  if (result.ok) refresh(projectId);
  return result;
}

export async function submitBoqBill(projectId: string, billId: string): Promise<ActionResult> {
  const result = await runAction(() => serverFetch(`/boq-bills/${billId}/submit`, { method: 'POST' }));
  if (result.ok) refresh(projectId, billId);
  return result;
}

export async function returnBoqBill(projectId: string, billId: string, note: string): Promise<ActionResult> {
  const result = await runAction(() =>
    serverFetch(`/boq-bills/${billId}/return`, { method: 'POST', body: { note } }),
  );
  if (result.ok) refresh(projectId, billId);
  return result;
}

export async function certifyBoqBill(
  projectId: string,
  billId: string,
  input: { lines: Array<{ item_id: string; certified_quantity_to_date: string }>; note?: string },
): Promise<ActionResult> {
  const result = await runAction(() =>
    serverFetch(`/boq-bills/${billId}/certify`, { method: 'POST', body: input }),
  );
  if (result.ok) refresh(projectId, billId);
  return result;
}

export async function invoiceBoqBill(
  projectId: string,
  billId: string,
  input: { due_date?: string },
): Promise<ActionResult> {
  const result = await runAction(() =>
    serverFetch(`/boq-bills/${billId}/invoice`, { method: 'POST', body: input }),
  );
  if (result.ok) refresh(projectId, billId);
  return result;
}
