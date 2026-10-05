'use server';

import { revalidatePath } from 'next/cache';
import type {
  CompleteQualityInspectionInput,
  CreateQualityInspectionInput,
  CreateQualityTemplateInput,
  CreateQualityTestInput,
  CreateSnagInput,
  FixSnagInput,
  QualityInspectionView,
  QualityTemplateView,
  QualityTestView,
  QuickSnagInput,
  RecordQualityInspectionItemsInput,
  RecordQualityTestResultInput,
  SignQualityInspectionInput,
  SnagPhotoStage,
  SnagView,
  UpdateQualityInspectionInput,
  UpdateQualityTemplateInput,
  UpdateQualityTestInput,
  UpdateSnagInput,
} from '@sitebook/shared';
import type { Milestone, ProjectMember } from './api-types';
import { runAction, serverFetch, type ActionResult } from './server-api';

/**
 * QA/QC (roadmap Phase 2, module 7): inspections, material tests, snags and the checklist library.
 * In a file of their own, like subcontracts, so the module's writes read together and do not
 * collide with the rest of `actions.ts`.
 *
 * Every write revalidates the company page and, when it knows one, the site's page — a snag closed
 * from its own page should not still read "fixed" on the site's Quality tab.
 */

const LIST = '/quality';
const inspectionPath = (id: string) => `/quality/inspections/${id}`;
const snagPath = (id: string) => `/quality/snags/${id}`;

function refresh(options: { projectId?: string; inspectionId?: string; snagId?: string } = {}) {
  revalidatePath(LIST);
  if (options.projectId) revalidatePath(`/projects/${options.projectId}`);
  if (options.inspectionId) revalidatePath(inspectionPath(options.inspectionId));
  if (options.snagId) revalidatePath(snagPath(options.snagId));
}

// --- options for the dialogs ---------------------------------------------------------------------

/** The site's stages, for tying an inspection to a point on its timeline. */
export async function milestoneOptions(projectId: string): Promise<ActionResult<Milestone[]>> {
  return runAction(() => serverFetch<Milestone[]>(`/projects/${projectId}/milestones`));
}

/**
 * Who could be given a snag on one site: the people assigned to it. The company team list needs a
 * management permission a supervisor raising a snag does not have, and the site's own people are
 * who it would go to anyway.
 */
export async function sitePeopleOptions(
  projectId: string,
): Promise<ActionResult<Array<{ id: string; name: string }>>> {
  return runAction(async () => {
    const members = await serverFetch<ProjectMember[]>(`/projects/${projectId}/members`);
    return members
      .filter((member) => member.user.role !== 'client' && member.user.status === 'active')
      .map((member) => ({ id: member.user.id, name: member.user.name }));
  });
}

// --- templates -----------------------------------------------------------------------------------

export async function createQualityTemplate(
  input: CreateQualityTemplateInput,
): Promise<ActionResult<QualityTemplateView>> {
  const result = await runAction(() =>
    serverFetch<QualityTemplateView>('/quality/templates', { method: 'POST', body: input }),
  );
  if (result.ok) revalidatePath('/settings/quality');
  return result;
}

export async function updateQualityTemplate(
  id: string,
  input: UpdateQualityTemplateInput,
): Promise<ActionResult<QualityTemplateView>> {
  const result = await runAction(() =>
    serverFetch<QualityTemplateView>(`/quality/templates/${id}`, { method: 'PATCH', body: input }),
  );
  if (result.ok) revalidatePath('/settings/quality');
  return result;
}

/** Archives a template that has been used, deletes one that never was. */
export async function deleteQualityTemplate(id: string): Promise<ActionResult> {
  const result = await runAction(() =>
    serverFetch(`/quality/templates/${id}`, { method: 'DELETE' }),
  );
  if (result.ok) revalidatePath('/settings/quality');
  return result;
}

// --- inspections ---------------------------------------------------------------------------------

export async function startInspection(
  input: CreateQualityInspectionInput,
): Promise<ActionResult<QualityInspectionView>> {
  const result = await runAction(() =>
    serverFetch<QualityInspectionView>('/quality/inspections', { method: 'POST', body: input }),
  );
  if (result.ok) refresh({ projectId: input.project_id });
  return result;
}

export async function updateInspection(
  id: string,
  input: UpdateQualityInspectionInput,
): Promise<ActionResult<QualityInspectionView>> {
  const result = await runAction(() =>
    serverFetch<QualityInspectionView>(`/quality/inspections/${id}`, { method: 'PATCH', body: input }),
  );
  if (result.ok) refresh({ inspectionId: id, projectId: result.data?.project.id });
  return result;
}

/**
 * Answers for one or more lines. Deliberately does not revalidate: the runner saves on every tap,
 * and re-rendering the whole page from the server after each one would fight the inspector's
 * thumb. The runner keeps the returned view as its state instead.
 */
export async function saveInspectionItems(
  id: string,
  items: RecordQualityInspectionItemsInput['items'],
): Promise<ActionResult<QualityInspectionView>> {
  return runAction(() =>
    serverFetch<QualityInspectionView>(`/quality/inspections/${id}/items`, {
      method: 'PUT',
      body: { items },
    }),
  );
}

export async function completeInspection(
  id: string,
  input: CompleteQualityInspectionInput,
): Promise<ActionResult<QualityInspectionView>> {
  const result = await runAction(() =>
    serverFetch<QualityInspectionView>(`/quality/inspections/${id}/complete`, {
      method: 'POST',
      body: input,
    }),
  );
  if (result.ok) refresh({ inspectionId: id, projectId: result.data?.project.id });
  return result;
}

/** A client's or consultant's countersignature — accepted, or recorded as not accepted. */
export async function signInspection(
  id: string,
  input: SignQualityInspectionInput,
): Promise<ActionResult<QualityInspectionView>> {
  const result = await runAction(() =>
    serverFetch<QualityInspectionView>(`/quality/inspections/${id}/sign`, {
      method: 'POST',
      body: input,
    }),
  );
  if (result.ok) refresh({ inspectionId: id, projectId: result.data?.project.id });
  return result;
}

export async function deleteInspection(id: string, projectId?: string): Promise<ActionResult> {
  const result = await runAction(() =>
    serverFetch(`/quality/inspections/${id}`, { method: 'DELETE' }),
  );
  if (result.ok) refresh({ projectId });
  return result;
}

// --- material tests ------------------------------------------------------------------------------

/** A cube set comes back as one row per age, so this answers with a list. */
export async function createQualityTest(
  input: CreateQualityTestInput,
): Promise<ActionResult<{ items: QualityTestView[] }>> {
  const result = await runAction(() =>
    serverFetch<{ items: QualityTestView[] }>('/quality/tests', { method: 'POST', body: input }),
  );
  if (result.ok) refresh({ projectId: input.project_id });
  return result;
}

export async function updateQualityTest(
  id: string,
  input: UpdateQualityTestInput,
): Promise<ActionResult<QualityTestView>> {
  const result = await runAction(() =>
    serverFetch<QualityTestView>(`/quality/tests/${id}`, { method: 'PATCH', body: input }),
  );
  if (result.ok) refresh({ projectId: result.data?.project.id });
  return result;
}

export async function deleteQualityTest(id: string, projectId?: string): Promise<ActionResult> {
  const result = await runAction(() => serverFetch(`/quality/tests/${id}`, { method: 'DELETE' }));
  if (result.ok) refresh({ projectId });
  return result;
}

export async function recordTestResult(
  id: string,
  input: RecordQualityTestResultInput,
): Promise<ActionResult<QualityTestView>> {
  const result = await runAction(() =>
    serverFetch<QualityTestView>(`/quality/tests/${id}/result`, { method: 'POST', body: input }),
  );
  if (result.ok) refresh({ projectId: result.data?.project.id });
  return result;
}

// --- snags ---------------------------------------------------------------------------------------

export async function createSnag(input: CreateSnagInput): Promise<ActionResult<SnagView>> {
  const result = await runAction(() =>
    serverFetch<SnagView>('/quality/snags', { method: 'POST', body: input }),
  );
  if (result.ok) refresh({ projectId: input.project_id });
  return result;
}

/** A photo and a few words (or a voice note) that become a draft for somebody to confirm. */
export async function quickSnag(input: QuickSnagInput): Promise<ActionResult<SnagView>> {
  const result = await runAction(() =>
    serverFetch<SnagView>('/quality/snags/quick', { method: 'POST', body: input }),
  );
  if (result.ok) refresh({ projectId: input.project_id });
  return result;
}

export async function updateSnag(id: string, input: UpdateSnagInput): Promise<ActionResult<SnagView>> {
  const result = await runAction(() =>
    serverFetch<SnagView>(`/quality/snags/${id}`, { method: 'PATCH', body: input }),
  );
  if (result.ok) refresh({ snagId: id, projectId: result.data?.project.id });
  return result;
}

export async function addSnagPhotos(
  id: string,
  stage: SnagPhotoStage,
  photoKeys: string[],
): Promise<ActionResult<SnagView>> {
  const result = await runAction(() =>
    serverFetch<SnagView>(`/quality/snags/${id}/photos`, {
      method: 'POST',
      body: { stage, photo_keys: photoKeys },
    }),
  );
  if (result.ok) refresh({ snagId: id, projectId: result.data?.project.id });
  return result;
}

/** Confirm a draft: from here it is somebody's job. */
export async function openSnag(id: string): Promise<ActionResult<SnagView>> {
  const result = await runAction(() =>
    serverFetch<SnagView>(`/quality/snags/${id}/open`, { method: 'POST', body: {} }),
  );
  if (result.ok) refresh({ snagId: id, projectId: result.data?.project.id });
  return result;
}

export async function fixSnag(id: string, input: FixSnagInput): Promise<ActionResult<SnagView>> {
  const result = await runAction(() =>
    serverFetch<SnagView>(`/quality/snags/${id}/fix`, { method: 'POST', body: input }),
  );
  if (result.ok) refresh({ snagId: id, projectId: result.data?.project.id });
  return result;
}

export async function verifySnag(id: string, note?: string): Promise<ActionResult<SnagView>> {
  const result = await runAction(() =>
    serverFetch<SnagView>(`/quality/snags/${id}/verify`, {
      method: 'POST',
      body: note ? { note } : {},
    }),
  );
  if (result.ok) refresh({ snagId: id, projectId: result.data?.project.id });
  return result;
}

export async function reopenSnag(id: string, reason: string): Promise<ActionResult<SnagView>> {
  const result = await runAction(() =>
    serverFetch<SnagView>(`/quality/snags/${id}/reopen`, { method: 'POST', body: { reason } }),
  );
  if (result.ok) refresh({ snagId: id, projectId: result.data?.project.id });
  return result;
}

/** Only a draft can be deleted; anything confirmed is closed instead, so its history stays. */
export async function deleteSnag(id: string, projectId?: string): Promise<ActionResult> {
  const result = await runAction(() => serverFetch(`/quality/snags/${id}`, { method: 'DELETE' }));
  if (result.ok) refresh({ projectId });
  return result;
}
