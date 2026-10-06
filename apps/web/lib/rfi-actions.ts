'use server';

import { revalidatePath } from 'next/cache';
import type {
  CreateRfiInput,
  CreateSubmittalInput,
  ReviewSubmittalInput,
  RfiDraftAiInput,
  RfiFileInput,
  RfiResponseInput,
  RfiSettingsInput,
  SubmitSubmittalInput,
  UpdateRfiInput,
  UpdateSubmittalInput,
} from '@sitebook/shared';
import { runAction, serverFetch, type ActionResult } from './server-api';
import type { RfiAiResult, RfiDetail, RfiLink, RfiSettings, SubmittalDetail } from './rfi-types';

/**
 * RFIs and submittals (roadmap Phase 2, module 9). In a file of their own, like safety and
 * procurement, so the module's writes read together and do not collide with the rest of `actions.ts`.
 */

function refreshRfi(projectId?: string, id?: string) {
  revalidatePath('/rfis');
  if (id) revalidatePath(`/rfis/${id}`);
  if (projectId) revalidatePath(`/projects/${projectId}`);
}

function refreshSubmittal(projectId?: string, id?: string) {
  revalidatePath('/submittals');
  if (id) revalidatePath(`/submittals/${id}`);
  if (projectId) revalidatePath(`/projects/${projectId}`);
}

async function rfiWrite(path: string, method: string, body?: unknown): Promise<ActionResult<RfiDetail>> {
  const result = await runAction(() => serverFetch<RfiDetail>(path, { method, body }));
  if (result.ok) refreshRfi(result.data?.project.id, result.data?.id);
  return result;
}

async function submittalWrite(path: string, method: string, body?: unknown): Promise<ActionResult<SubmittalDetail>> {
  const result = await runAction(() => serverFetch<SubmittalDetail>(path, { method, body }));
  if (result.ok) refreshSubmittal(result.data?.project.id, result.data?.id);
  return result;
}

// --- RFIs ------------------------------------------------------------------------------------------

export async function createRfi(input: CreateRfiInput): Promise<ActionResult<RfiDetail>> {
  return rfiWrite('/rfis', 'POST', input);
}

export async function updateRfi(id: string, input: UpdateRfiInput): Promise<ActionResult<RfiDetail>> {
  return rfiWrite(`/rfis/${id}`, 'PATCH', input);
}

export async function deleteRfi(id: string): Promise<ActionResult> {
  const result = await runAction(() => serverFetch(`/rfis/${id}`, { method: 'DELETE' }));
  if (result.ok) refreshRfi();
  return result;
}

export async function openRfi(id: string): Promise<ActionResult<RfiDetail>> {
  return rfiWrite(`/rfis/${id}/open`, 'POST');
}

export async function rfiLink(id: string): Promise<ActionResult<RfiLink & { rfi: RfiDetail }>> {
  const result = await runAction(() => serverFetch<RfiLink & { rfi: RfiDetail }>(`/rfis/${id}/link`, { method: 'POST' }));
  if (result.ok) refreshRfi(result.data?.rfi.project.id, id);
  return result;
}

export async function revokeRfiLinks(id: string): Promise<ActionResult<RfiDetail>> {
  return rfiWrite(`/rfis/${id}/link/revoke`, 'POST');
}

export async function respondToRfi(id: string, input: RfiResponseInput): Promise<ActionResult<RfiDetail>> {
  return rfiWrite(`/rfis/${id}/responses`, 'POST', input);
}

export async function markRfiOfficial(id: string, responseId: string): Promise<ActionResult<RfiDetail>> {
  return rfiWrite(`/rfis/${id}/responses/${responseId}/official`, 'POST');
}

export async function reopenRfi(id: string, note?: string): Promise<ActionResult<RfiDetail>> {
  return rfiWrite(`/rfis/${id}/reopen`, 'POST', note ? { note } : {});
}

export async function closeRfi(id: string, note?: string): Promise<ActionResult<RfiDetail>> {
  return rfiWrite(`/rfis/${id}/close`, 'POST', note ? { note } : {});
}

export async function voidRfi(id: string, reason: string): Promise<ActionResult<RfiDetail>> {
  return rfiWrite(`/rfis/${id}/void`, 'POST', { reason });
}

export async function addRfiAttachments(id: string, attachments: RfiFileInput[]): Promise<ActionResult<RfiDetail>> {
  return rfiWrite(`/rfis/${id}/attachments`, 'POST', { attachments });
}

export async function removeRfiAttachment(id: string, attachmentId: string): Promise<ActionResult<RfiDetail>> {
  return rfiWrite(`/rfis/${id}/attachments/${attachmentId}`, 'DELETE');
}

export async function raiseChangeOrderFromRfi(
  id: string,
): Promise<ActionResult<{ change_order: { id: string; label: string }; rfi: RfiDetail }>> {
  const result = await runAction(() =>
    serverFetch<{ change_order: { id: string; label: string }; rfi: RfiDetail }>(`/rfis/${id}/change-order`, {
      method: 'POST',
    }),
  );
  if (result.ok) {
    refreshRfi(result.data?.rfi.project.id, id);
    revalidatePath('/change-orders');
  }
  return result;
}

export async function draftRfiWithAi(input: RfiDraftAiInput): Promise<ActionResult<RfiAiResult>> {
  return runAction(() => serverFetch<RfiAiResult>('/rfis/draft-ai', { method: 'POST', body: input }));
}

export async function updateRfiSettings(input: RfiSettingsInput): Promise<ActionResult<RfiSettings>> {
  const result = await runAction(() => serverFetch<RfiSettings>('/rfis/settings', { method: 'PUT', body: input }));
  if (result.ok) {
    revalidatePath('/rfis');
    revalidatePath('/submittals');
  }
  return result;
}

// --- submittals ------------------------------------------------------------------------------------

export async function createSubmittal(input: CreateSubmittalInput): Promise<ActionResult<SubmittalDetail>> {
  return submittalWrite('/submittals', 'POST', input);
}

export async function updateSubmittal(id: string, input: UpdateSubmittalInput): Promise<ActionResult<SubmittalDetail>> {
  return submittalWrite(`/submittals/${id}`, 'PATCH', input);
}

export async function deleteSubmittal(id: string): Promise<ActionResult> {
  const result = await runAction(() => serverFetch(`/submittals/${id}`, { method: 'DELETE' }));
  if (result.ok) refreshSubmittal();
  return result;
}

export async function addSubmittalFiles(id: string, files: RfiFileInput[]): Promise<ActionResult<SubmittalDetail>> {
  return submittalWrite(`/submittals/${id}/files`, 'POST', { files });
}

export async function removeSubmittalFile(id: string, fileId: string): Promise<ActionResult<SubmittalDetail>> {
  return submittalWrite(`/submittals/${id}/files/${fileId}`, 'DELETE');
}

export async function submitSubmittal(id: string, input: SubmitSubmittalInput): Promise<ActionResult<SubmittalDetail>> {
  return submittalWrite(`/submittals/${id}/submit`, 'POST', input);
}

export async function submittalLink(id: string): Promise<ActionResult<RfiLink & { submittal: SubmittalDetail }>> {
  const result = await runAction(() =>
    serverFetch<RfiLink & { submittal: SubmittalDetail }>(`/submittals/${id}/link`, { method: 'POST' }),
  );
  if (result.ok) refreshSubmittal(result.data?.submittal.project.id, id);
  return result;
}

export async function revokeSubmittalLinks(id: string): Promise<ActionResult<SubmittalDetail>> {
  return submittalWrite(`/submittals/${id}/link/revoke`, 'POST');
}

export async function startSubmittalReview(id: string): Promise<ActionResult<SubmittalDetail>> {
  return submittalWrite(`/submittals/${id}/start-review`, 'POST');
}

export async function reviewSubmittal(id: string, input: ReviewSubmittalInput): Promise<ActionResult<SubmittalDetail>> {
  return submittalWrite(`/submittals/${id}/review`, 'POST', input);
}

export async function resubmitSubmittal(id: string, copyFiles: boolean): Promise<ActionResult<SubmittalDetail>> {
  return submittalWrite(`/submittals/${id}/resubmit`, 'POST', { copy_files: copyFiles });
}
