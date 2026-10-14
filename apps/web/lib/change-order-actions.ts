'use server';

import { revalidatePath } from 'next/cache';
import { runAction, serverFetch, type ActionResult } from './server-api';
import type { ChangeOrderDetail, ChangeOrderInput, ChangeOrderSiteSummary } from './change-order-types';

/**
 * Change orders (roadmap Phase 2, module 4). In a file of their own, like subcontracts, so the
 * module's writes read together and do not collide with the rest of `actions.ts`.
 */

const LIST = '/change-orders';

function refresh(changeOrder?: { id: string; project: { id: string } }) {
  revalidatePath(LIST);
  if (changeOrder) {
    revalidatePath(`${LIST}/${changeOrder.id}`);
    // The site's tab, its approvals, its header (handover date) and its cost report all move.
    revalidatePath(`/projects/${changeOrder.project.id}`);
  }
}

async function step(
  id: string,
  path: string,
  body: Record<string, unknown> = {},
): Promise<ActionResult<ChangeOrderDetail>> {
  const result = await runAction(() =>
    serverFetch<ChangeOrderDetail>(`/change-orders/${id}/${path}`, { method: 'POST', body }),
  );
  if (result.ok && result.data) refresh(result.data);
  return result;
}

export async function createChangeOrder(
  input: ChangeOrderInput & { project_id: string; title: string; reason: string; suggestion_id?: string },
): Promise<ActionResult<ChangeOrderDetail>> {
  const result = await runAction(() =>
    serverFetch<ChangeOrderDetail>('/change-orders', { method: 'POST', body: input }),
  );
  if (result.ok && result.data) refresh(result.data);
  return result;
}

export async function updateChangeOrder(id: string, input: ChangeOrderInput): Promise<ActionResult<ChangeOrderDetail>> {
  const result = await runAction(() =>
    serverFetch<ChangeOrderDetail>(`/change-orders/${id}`, { method: 'PATCH', body: input }),
  );
  if (result.ok && result.data) refresh(result.data);
  return result;
}

export async function deleteChangeOrder(id: string, projectId: string): Promise<ActionResult> {
  const result = await runAction(() => serverFetch(`/change-orders/${id}`, { method: 'DELETE' }));
  if (result.ok) {
    revalidatePath(LIST);
    revalidatePath(`/projects/${projectId}`);
  }
  return result;
}

export async function submitChangeOrder(id: string) {
  return step(id, 'submit');
}

export async function returnChangeOrder(id: string, note?: string) {
  return step(id, 'return', note ? { note } : {});
}

export async function approveChangeOrder(id: string, note?: string) {
  return step(id, 'approve', note ? { note } : {});
}

export async function recordClientDecision(id: string, status: 'approved' | 'rejected', note?: string) {
  return step(id, 'client-decision', { status, ...(note ? { note } : {}) });
}

export async function reviseChangeOrder(id: string) {
  return step(id, 'revise');
}

export async function implementChangeOrder(id: string) {
  return step(id, 'implement');
}

export async function cancelChangeOrder(id: string, note?: string) {
  return step(id, 'cancel', note ? { note } : {});
}

export async function attachChangeOrderDocument(id: string, documentId: string) {
  return step(id, 'attachments', { document_id: documentId });
}

export async function removeChangeOrderAttachment(id: string, attachmentId: string): Promise<ActionResult<ChangeOrderDetail>> {
  const result = await runAction(() =>
    serverFetch<ChangeOrderDetail>(`/change-orders/${id}/attachments/${attachmentId}`, { method: 'DELETE' }),
  );
  if (result.ok && result.data) refresh(result.data);
  return result;
}

export async function setContractValue(
  projectId: string,
  contractValue: string | null,
): Promise<ActionResult<ChangeOrderSiteSummary>> {
  const result = await runAction(() =>
    serverFetch<ChangeOrderSiteSummary>(`/projects/${projectId}/contract-value`, {
      method: 'PUT',
      body: { contract_value: contractValue },
    }),
  );
  if (result.ok) revalidatePath(`/projects/${projectId}`);
  return result;
}

export async function dismissChangeOrderSuggestion(id: string, projectId?: string): Promise<ActionResult> {
  const result = await runAction(() =>
    serverFetch(`/change-order-suggestions/${id}/dismiss`, { method: 'POST' }),
  );
  if (result.ok) {
    revalidatePath(LIST);
    if (projectId) revalidatePath(`/projects/${projectId}`);
  }
  return result;
}
