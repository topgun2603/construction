'use server';

import { revalidatePath } from 'next/cache';
import type {
  M365SendEmailInput,
  MeetingActionItemInput,
  MeetingActionItemUpdateInput,
  MeetingCreateInput,
  MeetingUpdateInput,
} from '@sitebook/shared';
import { runAction, serverFetch, type ActionResult } from './server-api';
import type { M365CalendarSync, M365Delivery, M365Overview, MeetingDetail } from './m365-types';

/**
 * Microsoft 365 (Settings → Integrations, "Send by email") and site meetings. In a file of their
 * own so these writes read together and do not collide with the rest of `actions.ts`. The API
 * decides and enforces every rule; these carry the request and bring its answer back.
 */

function refreshSettings() {
  revalidatePath('/settings/integrations');
}

// --- the connection --------------------------------------------------------------------------------

/** Microsoft's sign-in URL to send the browser to. */
export async function startM365Connect(loginHint?: string): Promise<ActionResult<{ redirect_url: string }>> {
  return runAction(() =>
    serverFetch<{ redirect_url: string }>('/integrations/m365/connect', {
      method: 'POST',
      body: loginHint ? { login_hint: loginHint } : {},
    }),
  );
}

export async function disconnectM365(): Promise<ActionResult<M365Overview>> {
  const result = await runAction(() => serverFetch<M365Overview>('/integrations/m365', { method: 'DELETE' }));
  // Every "Send by email" button reads the status, so the whole dashboard is stale.
  if (result.ok) revalidatePath('/', 'layout');
  return result;
}

export async function setM365CalendarSync(
  on: boolean,
): Promise<ActionResult<M365Overview & { sync: M365CalendarSync | null }>> {
  const result = await runAction(() =>
    serverFetch<M365Overview & { sync: M365CalendarSync | null }>('/integrations/m365/settings', {
      method: 'PUT',
      body: { calendar_sync: on },
    }),
  );
  if (result.ok) refreshSettings();
  return result;
}

export async function syncM365Calendar(): Promise<ActionResult<{ sync: M365CalendarSync }>> {
  const result = await runAction(() =>
    serverFetch<{ sync: M365CalendarSync }>('/integrations/m365/calendar/sync', { method: 'POST' }),
  );
  if (result.ok) refreshSettings();
  return result;
}

// --- send by email ---------------------------------------------------------------------------------

export async function emailRfi(id: string, input: M365SendEmailInput = {}): Promise<ActionResult<{ delivery: M365Delivery }>> {
  const result = await runAction(() =>
    serverFetch<{ delivery: M365Delivery }>(`/rfis/${id}/email`, { method: 'POST', body: input }),
  );
  if (result.ok) {
    revalidatePath('/rfis');
    revalidatePath(`/rfis/${id}`);
  }
  return result;
}

export async function emailSubmittal(
  id: string,
  input: M365SendEmailInput = {},
): Promise<ActionResult<{ delivery: M365Delivery }>> {
  const result = await runAction(() =>
    serverFetch<{ delivery: M365Delivery }>(`/submittals/${id}/email`, { method: 'POST', body: input }),
  );
  if (result.ok) {
    revalidatePath('/submittals');
    revalidatePath(`/submittals/${id}`);
  }
  return result;
}

export async function emailChangeOrder(
  id: string,
  input: M365SendEmailInput = {},
): Promise<ActionResult<{ delivery: M365Delivery }>> {
  const result = await runAction(() =>
    serverFetch<{ delivery: M365Delivery }>(`/change-orders/${id}/email`, { method: 'POST', body: input }),
  );
  if (result.ok) revalidatePath(`/change-orders/${id}`);
  return result;
}

// --- meetings --------------------------------------------------------------------------------------

function refreshMeeting(projectId?: string, id?: string) {
  if (projectId) revalidatePath(`/projects/${projectId}`);
  if (id) revalidatePath(`/meetings/${id}`);
}

async function meetingWrite(path: string, method: string, body?: unknown): Promise<ActionResult<MeetingDetail>> {
  const result = await runAction(() =>
    serverFetch<MeetingDetail>(path, { method, ...(body === undefined ? {} : { body }) }),
  );
  if (result.ok) refreshMeeting(result.data?.project.id, result.data?.id);
  return result;
}

export async function createMeeting(input: MeetingCreateInput): Promise<ActionResult<MeetingDetail>> {
  return meetingWrite('/meetings', 'POST', input);
}

export async function updateMeeting(id: string, input: MeetingUpdateInput): Promise<ActionResult<MeetingDetail>> {
  return meetingWrite(`/meetings/${id}`, 'PATCH', input);
}

export async function cancelMeeting(id: string): Promise<ActionResult<MeetingDetail>> {
  return meetingWrite(`/meetings/${id}/cancel`, 'POST');
}

export async function deleteMeeting(id: string, projectId: string): Promise<ActionResult> {
  const result = await runAction(() => serverFetch(`/meetings/${id}`, { method: 'DELETE' }));
  if (result.ok) refreshMeeting(projectId);
  return result;
}

export async function addMeetingAction(id: string, input: MeetingActionItemInput): Promise<ActionResult<MeetingDetail>> {
  return meetingWrite(`/meetings/${id}/action-items`, 'POST', input);
}

export async function updateMeetingAction(
  id: string,
  itemId: string,
  input: MeetingActionItemUpdateInput,
): Promise<ActionResult<MeetingDetail>> {
  return meetingWrite(`/meetings/${id}/action-items/${itemId}`, 'PATCH', input);
}

export async function removeMeetingAction(id: string, itemId: string): Promise<ActionResult<MeetingDetail>> {
  return meetingWrite(`/meetings/${id}/action-items/${itemId}`, 'DELETE');
}

export async function sendMeetingInvite(
  id: string,
): Promise<ActionResult<{ meeting: MeetingDetail; invited: string[]; skipped: string[] }>> {
  const result = await runAction(() =>
    serverFetch<{ meeting: MeetingDetail; invited: string[]; skipped: string[] }>(`/meetings/${id}/invite`, {
      method: 'POST',
    }),
  );
  if (result.ok) refreshMeeting(result.data?.meeting.project.id, id);
  return result;
}

export async function sendMeetingMinutes(
  id: string,
  note?: string,
): Promise<ActionResult<{ meeting: MeetingDetail; delivery: M365Delivery; skipped: string[] }>> {
  const result = await runAction(() =>
    serverFetch<{ meeting: MeetingDetail; delivery: M365Delivery; skipped: string[] }>(`/meetings/${id}/minutes/send`, {
      method: 'POST',
      body: note ? { note } : {},
    }),
  );
  if (result.ok) refreshMeeting(result.data?.meeting.project.id, id);
  return result;
}
