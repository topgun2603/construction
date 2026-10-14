'use server';

import { revalidatePath } from 'next/cache';
import type {
  CreateSafetyActionInput,
  CreateSafetyIncidentInput,
  CreateSafetyObservationInput,
  CreateSafetyPermitInput,
  CreateSafetyToolboxTalkInput,
  QuickSafetyObservationInput,
  SafetyIncidentStatus,
  UpdateSafetyActionInput,
  UpdateSafetyIncidentInput,
  UpdateSafetyPermitInput,
} from '@sitebook/shared';
import { runAction, serverFetch, type ActionResult } from './server-api';
import type {
  SafetyAction,
  SafetyIncidentDetail,
  SafetyObservationDetail,
  SafetyPermitDetail,
  SafetyRoll,
  SafetySuggestionResult,
  SafetyTalkDetail,
} from './safety-types';

/**
 * Safety (roadmap Phase 2, module 8). In a file of its own, like subcontracts and procurement, so the
 * module's writes read together and do not collide with the rest of `actions.ts`.
 */

function refresh(projectId?: string, path?: string) {
  revalidatePath('/safety');
  if (projectId) revalidatePath(`/projects/${projectId}`);
  if (path) revalidatePath(path);
}

// --- incidents -----------------------------------------------------------------------------------

export async function reportSafetyIncident(
  input: Omit<CreateSafetyIncidentInput, 'people'> & {
    people?: Array<{
      worker_id?: string | null;
      name?: string;
      role: 'injured' | 'involved' | 'witness';
      body_part?: string | null;
      injury_nature?: string | null;
      statement?: string | null;
    }>;
  },
): Promise<ActionResult<SafetyIncidentDetail>> {
  const result = await runAction(() =>
    serverFetch<SafetyIncidentDetail>('/safety/incidents', { method: 'POST', body: input }),
  );
  if (result.ok) refresh(input.project_id);
  return result;
}

export async function updateSafetyIncident(
  id: string,
  input: UpdateSafetyIncidentInput,
): Promise<ActionResult<SafetyIncidentDetail>> {
  const result = await runAction(() =>
    serverFetch<SafetyIncidentDetail>(`/safety/incidents/${id}`, { method: 'PATCH', body: input }),
  );
  if (result.ok) refresh(result.data?.project.id, `/safety/incidents/${id}`);
  return result;
}

export async function setSafetyIncidentStatus(
  id: string,
  status: SafetyIncidentStatus,
  note?: string,
): Promise<ActionResult<SafetyIncidentDetail>> {
  const result = await runAction(() =>
    serverFetch<SafetyIncidentDetail>(`/safety/incidents/${id}/status`, {
      method: 'POST',
      body: { status, ...(note ? { note } : {}) },
    }),
  );
  if (result.ok) refresh(result.data?.project.id, `/safety/incidents/${id}`);
  return result;
}

// --- actions and photos --------------------------------------------------------------------------

export async function raiseSafetyAction(
  parent: { incidentId: string } | { observationId: string },
  input: Partial<CreateSafetyActionInput> & { description: string },
): Promise<ActionResult<SafetyAction>> {
  const path =
    'incidentId' in parent
      ? `/safety/incidents/${parent.incidentId}/actions`
      : `/safety/observations/${parent.observationId}/actions`;
  const result = await runAction(() => serverFetch<SafetyAction>(path, { method: 'POST', body: input }));
  if (result.ok) refresh(result.data?.project_id, path.replace('/actions', ''));
  return result;
}

export async function updateSafetyAction(
  id: string,
  input: UpdateSafetyActionInput,
): Promise<ActionResult<SafetyAction>> {
  const result = await runAction(() =>
    serverFetch<SafetyAction>(`/safety/actions/${id}`, { method: 'PATCH', body: input }),
  );
  if (result.ok && result.data) {
    const parent = result.data.incident_id
      ? `/safety/incidents/${result.data.incident_id}`
      : `/safety/observations/${result.data.observation_id}`;
    refresh(result.data.project_id, parent);
  }
  return result;
}

export async function attachSafetyPhoto(input: {
  incident_id?: string;
  observation_id?: string;
  permit_id?: string;
  toolbox_talk_id?: string;
  s3_key: string;
  purpose: 'evidence' | 'witness_statement' | 'closeout' | 'attendance';
  caption?: string;
}): Promise<ActionResult> {
  const result = await runAction(() => serverFetch('/safety/photos', { method: 'POST', body: input }));
  if (result.ok) {
    if (input.incident_id) revalidatePath(`/safety/incidents/${input.incident_id}`);
    if (input.observation_id) revalidatePath(`/safety/observations/${input.observation_id}`);
    if (input.permit_id) revalidatePath(`/safety/permits/${input.permit_id}`);
  }
  return result;
}

// --- permits -------------------------------------------------------------------------------------

export async function requestSafetyPermit(
  input: CreateSafetyPermitInput,
): Promise<ActionResult<SafetyPermitDetail>> {
  const result = await runAction(() =>
    serverFetch<SafetyPermitDetail>('/safety/permits', { method: 'POST', body: input }),
  );
  if (result.ok) refresh(input.project_id);
  return result;
}

export async function updateSafetyPermit(
  id: string,
  input: UpdateSafetyPermitInput,
): Promise<ActionResult<SafetyPermitDetail>> {
  const result = await runAction(() =>
    serverFetch<SafetyPermitDetail>(`/safety/permits/${id}`, { method: 'PATCH', body: input }),
  );
  if (result.ok) refresh(result.data?.project.id, `/safety/permits/${id}`);
  return result;
}

export async function safetyPermitStep(
  id: string,
  step: 'approve-issuer' | 'approve-area' | 'suspend' | 'resume' | 'close',
  note?: string,
): Promise<ActionResult<SafetyPermitDetail>> {
  const [path, body] =
    step === 'approve-issuer'
      ? ['approve', { as: 'issuer' }]
      : step === 'approve-area'
        ? ['approve', { as: 'area_authority' }]
        : [step, note ? { note } : {}];
  const result = await runAction(() =>
    serverFetch<SafetyPermitDetail>(`/safety/permits/${id}/${path}`, { method: 'POST', body }),
  );
  if (result.ok) refresh(result.data?.project.id, `/safety/permits/${id}`);
  return result;
}

// --- toolbox talks -------------------------------------------------------------------------------

export async function safetyRoll(projectId: string, date: string): Promise<ActionResult<SafetyRoll>> {
  return runAction(() =>
    serverFetch<SafetyRoll>(
      `/safety/toolbox-talks/roll?project_id=${encodeURIComponent(projectId)}&date=${encodeURIComponent(date)}`,
    ),
  );
}

export async function recordToolboxTalk(
  input: Omit<CreateSafetyToolboxTalkInput, 'duration_minutes' | 'attendees'> & {
    duration_minutes?: number;
    attendees: Array<{ worker_id: string; signed: boolean }>;
  },
): Promise<ActionResult<SafetyTalkDetail>> {
  const result = await runAction(() =>
    serverFetch<SafetyTalkDetail>('/safety/toolbox-talks', { method: 'POST', body: input }),
  );
  if (result.ok) refresh(input.project_id);
  return result;
}

export async function signToolboxTalk(talkId: string, workerId: string): Promise<ActionResult<SafetyTalkDetail>> {
  const result = await runAction(() =>
    serverFetch<SafetyTalkDetail>(`/safety/toolbox-talks/${talkId}/attendees/${workerId}/sign`, {
      method: 'POST',
      body: {},
    }),
  );
  if (result.ok) refresh(result.data?.project.id, `/safety/talks/${talkId}`);
  return result;
}

// --- observations --------------------------------------------------------------------------------

export async function quickSafetyObservation(
  input: QuickSafetyObservationInput,
): Promise<ActionResult<{ observation: SafetyObservationDetail; suggestion: SafetySuggestionResult | null }>> {
  const result = await runAction(() =>
    serverFetch<{ observation: SafetyObservationDetail; suggestion: SafetySuggestionResult | null }>(
      '/safety/observations/quick',
      { method: 'POST', body: input },
    ),
  );
  if (result.ok) refresh(input.project_id);
  return result;
}

export async function suggestSafetyObservation(note: string): Promise<ActionResult<SafetySuggestionResult>> {
  return runAction(() =>
    serverFetch<SafetySuggestionResult>('/safety/observations/suggest', { method: 'POST', body: { note } }),
  );
}

export async function recordSafetyObservation(
  input: Omit<CreateSafetyObservationInput, 'severity'> & { severity?: CreateSafetyObservationInput['severity'] },
): Promise<ActionResult<SafetyObservationDetail>> {
  const result = await runAction(() =>
    serverFetch<SafetyObservationDetail>('/safety/observations', { method: 'POST', body: input }),
  );
  if (result.ok) refresh(input.project_id);
  return result;
}

// --- pickers -------------------------------------------------------------------------------------

/** The workers assigned to a site, to pick the injured, the crew or the attendees from. */
export async function safetySiteWorkers(
  projectId: string,
): Promise<ActionResult<Array<{ id: string; name: string; trade: string | null }>>> {
  return runAction(async () => {
    const page = await serverFetch<{ items: Array<{ id: string; name: string; trade: string | null }> }>(
      `/workers?project_id=${encodeURIComponent(projectId)}&limit=200`,
    );
    return page.items.map((worker) => ({ id: worker.id, name: worker.name, trade: worker.trade }));
  });
}

/**
 * The team, to assign an action to. Reading the team needs `projects.manage`, which every safety
 * manager on a built-in role has; anybody else gets an empty list and leaves it unassigned.
 */
export async function safetyTeam(): Promise<ActionResult<Array<{ id: string; name: string }>>> {
  return runAction(async () => {
    const team = await serverFetch<Array<{ id: string; name: string; status: string }>>(
      '/tenants/current/team',
    ).catch(() => []);
    return team.filter((member) => member.status === 'active').map(({ id, name }) => ({ id, name }));
  });
}

export async function closeSafetyObservation(
  id: string,
  input: { note?: string; closeout_photo_key?: string },
): Promise<ActionResult<SafetyObservationDetail>> {
  const result = await runAction(() =>
    serverFetch<SafetyObservationDetail>(`/safety/observations/${id}/close`, { method: 'POST', body: input }),
  );
  if (result.ok) refresh(result.data?.project.id, `/safety/observations/${id}`);
  return result;
}
