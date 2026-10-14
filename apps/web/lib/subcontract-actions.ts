'use server';

import { revalidatePath } from 'next/cache';
import type { PaymentMode } from '@sitebook/shared';
import { runAction, serverFetch, type ActionResult } from './server-api';
import type {
  RaBillDetail,
  RaDeductionInput,
  SubcontractDetail,
  SubcontractLineInput,
  SubcontractStatus,
} from './subcontract-types';

/**
 * Subcontracts and RA bills (roadmap Phase 2, module 3). In a file of their own, like cost codes, so
 * the module's writes read together and do not collide with the rest of `actions.ts`.
 */

const LIST = '/subcontracts';
const detailPath = (id: string) => `/subcontracts/${id}`;
const billPath = (id: string) => `/subcontracts/bills/${id}`;

function refresh(subcontractId?: string, billId?: string) {
  revalidatePath(LIST);
  if (subcontractId) revalidatePath(detailPath(subcontractId));
  if (billId) revalidatePath(billPath(billId));
}

export interface SubcontractTermsInput {
  title?: string;
  scope?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  retention_bp?: number;
  retention_release_at_completion_bp?: number;
  defects_liability_months?: number;
  advance_amount?: string;
  advance_recovery_bp?: number;
  tax_rate_bp?: number;
  payment_terms?: string | null;
}

export async function createSubcontract(
  input: SubcontractTermsInput & {
    project_id: string;
    contractor_id: string;
    title: string;
    number?: string;
    lines?: SubcontractLineInput[];
  },
): Promise<ActionResult<SubcontractDetail>> {
  const result = await runAction(() =>
    serverFetch<SubcontractDetail>('/subcontracts', { method: 'POST', body: input }),
  );
  if (result.ok) {
    refresh();
    revalidatePath(`/projects/${input.project_id}`);
  }
  return result;
}

export async function updateSubcontract(
  id: string,
  input: SubcontractTermsInput & { contractor_id?: string; number?: string },
): Promise<ActionResult> {
  const result = await runAction(() =>
    serverFetch(`/subcontracts/${id}`, { method: 'PATCH', body: input }),
  );
  if (result.ok) refresh(id);
  return result;
}

export async function deleteSubcontract(id: string): Promise<ActionResult> {
  const result = await runAction(() => serverFetch(`/subcontracts/${id}`, { method: 'DELETE' }));
  if (result.ok) refresh();
  return result;
}

export async function setSubcontractStatus(
  id: string,
  status: SubcontractStatus,
  completedOn?: string,
): Promise<ActionResult> {
  const result = await runAction(() =>
    serverFetch(`/subcontracts/${id}/status`, {
      method: 'POST',
      body: { status, ...(completedOn ? { completed_on: completedOn } : {}) },
    }),
  );
  if (result.ok) refresh(id);
  return result;
}

export async function addSubcontractLine(id: string, line: SubcontractLineInput): Promise<ActionResult> {
  const result = await runAction(() =>
    serverFetch(`/subcontracts/${id}/lines`, { method: 'POST', body: line }),
  );
  if (result.ok) refresh(id);
  return result;
}

export async function removeSubcontractLine(id: string, lineId: string): Promise<ActionResult> {
  const result = await runAction(() =>
    serverFetch(`/subcontracts/${id}/lines/${lineId}`, { method: 'DELETE' }),
  );
  if (result.ok) refresh(id);
  return result;
}

export async function proposeVariation(
  id: string,
  input: { title: string; reason?: string; lines: SubcontractLineInput[] },
): Promise<ActionResult> {
  const result = await runAction(() =>
    serverFetch(`/subcontracts/${id}/variations`, { method: 'POST', body: input }),
  );
  if (result.ok) refresh(id);
  return result;
}

export async function decideVariation(
  id: string,
  variationId: string,
  status: 'approved' | 'rejected',
  note?: string,
): Promise<ActionResult> {
  const result = await runAction(() =>
    serverFetch(`/subcontracts/${id}/variations/${variationId}/decide`, {
      method: 'POST',
      body: { status, ...(note ? { note } : {}) },
    }),
  );
  if (result.ok) refresh(id);
  return result;
}

export async function releaseRetention(
  id: string,
  input: { amount: string; released_on: string; note?: string },
): Promise<ActionResult> {
  const result = await runAction(() =>
    serverFetch(`/subcontracts/${id}/retention-releases`, { method: 'POST', body: input }),
  );
  if (result.ok) refresh(id);
  return result;
}

export interface PaymentInput {
  amount: string;
  paid_on: string;
  mode: PaymentMode;
  reference?: string;
  note?: string;
}

/** The advance, or released retention. */
export async function paySubcontract(
  id: string,
  input: PaymentInput & { kind: 'advance' | 'retention'; retention_release_id?: string },
): Promise<ActionResult> {
  const result = await runAction(() =>
    serverFetch(`/subcontracts/${id}/payments`, { method: 'POST', body: input }),
  );
  if (result.ok) refresh(id);
  return result;
}

export async function attachSubcontractDocument(id: string, documentId: string): Promise<ActionResult> {
  const result = await runAction(() =>
    serverFetch(`/subcontracts/${id}/documents`, { method: 'POST', body: { document_id: documentId } }),
  );
  if (result.ok) refresh(id);
  return result;
}

export async function detachSubcontractDocument(id: string, documentId: string): Promise<ActionResult> {
  const result = await runAction(() =>
    serverFetch(`/subcontracts/${id}/documents/${documentId}`, { method: 'DELETE' }),
  );
  if (result.ok) refresh(id);
  return result;
}

// --- RA bills ------------------------------------------------------------------------------------

export interface RaBillInput {
  period_from?: string | null;
  period_to?: string;
  bill_date?: string;
  lines?: Array<{ line_id: string; quantity_to_date: string }>;
  deductions?: RaDeductionInput[];
  note?: string | null;
}

export async function createRaBill(
  subcontractId: string,
  input: RaBillInput & { period_to: string },
): Promise<ActionResult<RaBillDetail>> {
  const result = await runAction(() =>
    serverFetch<RaBillDetail>(`/subcontracts/${subcontractId}/bills`, { method: 'POST', body: input }),
  );
  if (result.ok) refresh(subcontractId);
  return result;
}

export async function updateRaBill(
  subcontractId: string,
  billId: string,
  input: RaBillInput,
): Promise<ActionResult<RaBillDetail>> {
  const result = await runAction(() =>
    serverFetch<RaBillDetail>(`/subcontract-bills/${billId}`, { method: 'PATCH', body: input }),
  );
  if (result.ok) refresh(subcontractId, billId);
  return result;
}

export async function deleteRaBill(subcontractId: string, billId: string): Promise<ActionResult> {
  const result = await runAction(() =>
    serverFetch(`/subcontract-bills/${billId}`, { method: 'DELETE' }),
  );
  if (result.ok) refresh(subcontractId);
  return result;
}

export async function submitRaBill(subcontractId: string, billId: string): Promise<ActionResult> {
  const result = await runAction(() =>
    serverFetch(`/subcontract-bills/${billId}/submit`, { method: 'POST' }),
  );
  if (result.ok) refresh(subcontractId, billId);
  return result;
}

export async function returnRaBill(
  subcontractId: string,
  billId: string,
  note: string,
): Promise<ActionResult> {
  const result = await runAction(() =>
    serverFetch(`/subcontract-bills/${billId}/return`, { method: 'POST', body: { note } }),
  );
  if (result.ok) refresh(subcontractId, billId);
  return result;
}

export async function certifyRaBill(
  subcontractId: string,
  billId: string,
  input: {
    lines: Array<{ line_id: string; certified_quantity_to_date: string }>;
    deductions?: RaDeductionInput[];
    note?: string;
  },
): Promise<ActionResult> {
  const result = await runAction(() =>
    serverFetch(`/subcontract-bills/${billId}/certify`, { method: 'POST', body: input }),
  );
  if (result.ok) refresh(subcontractId, billId);
  return result;
}

export async function payRaBill(
  subcontractId: string,
  billId: string,
  input: PaymentInput,
): Promise<ActionResult> {
  const result = await runAction(() =>
    serverFetch(`/subcontract-bills/${billId}/payments`, { method: 'POST', body: input }),
  );
  if (result.ok) refresh(subcontractId, billId);
  return result;
}
