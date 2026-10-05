'use server';

import { revalidatePath } from 'next/cache';
import { API_URL } from './api';
import { runAction, serverFetch, type ActionResult } from './server-api';
import { currentAccessToken } from './session';
import type {
  ScheduleBaselineSummary,
  ScheduleCalendar,
  ScheduleConstraintType,
  ScheduleDependency,
  ScheduleImportPreview,
  ScheduleImportResult,
  ScheduleLinkType,
  ScheduleLookAhead,
  ScheduleTask,
  ScheduleTaskKind,
  ScheduleVarianceReport,
} from './schedule-types';

/**
 * Scheduling (roadmap Phase 2, module 6). In a file of its own, like cost codes and subcontracts,
 * so the module's writes read together and do not collide with the rest of `actions.ts`.
 */

const sitePath = (projectId: string) => `/projects/${projectId}`;
const base = (projectId: string) => `/projects/${projectId}/schedule`;

async function write<T>(projectId: string, fn: () => Promise<T>): Promise<ActionResult<T>> {
  const result = await runAction(fn);
  if (result.ok) revalidatePath(sitePath(projectId));
  return result;
}

export type ScheduleImportFormat = 'auto' | 'msproject' | 'p6';

export interface ScheduleTaskInput {
  name?: string;
  kind?: ScheduleTaskKind;
  parent_id?: string | null;
  wbs_code?: string | null;
  duration_days?: number;
  constraint_type?: ScheduleConstraintType;
  constraint_date?: string | null;
  cost_code_id?: string | null;
  responsible_user_id?: string | null;
  contractor_id?: string | null;
  milestone_id?: string | null;
  notes?: string | null;
  sort_order?: number;
}

export interface ScheduleTaskPatch extends ScheduleTaskInput {
  /** Pins the start: sets start-no-earlier-than. */
  start_date?: string;
  /** Sets the duration to the working days from its start. */
  finish_date?: string;
  percent_complete?: number;
  actual_start?: string | null;
  actual_finish?: string | null;
}

export interface ScheduleProgressInput {
  percent_complete?: number;
  actual_start?: string | null;
  actual_finish?: string | null;
}

export async function createScheduleTask(
  projectId: string,
  input: ScheduleTaskInput & { name: string },
): Promise<ActionResult<ScheduleTask>> {
  return write(projectId, () =>
    serverFetch<ScheduleTask>(`${base(projectId)}/tasks`, { method: 'POST', body: input }),
  );
}

export async function updateScheduleTask(
  projectId: string,
  taskId: string,
  input: ScheduleTaskPatch,
): Promise<ActionResult<ScheduleTask>> {
  return write(projectId, () =>
    serverFetch<ScheduleTask>(`${base(projectId)}/tasks/${taskId}`, {
      method: 'PATCH',
      body: input,
    }),
  );
}

/** Percent complete and actual dates — what a supervisor on the site may change. */
export async function recordScheduleProgress(
  projectId: string,
  taskId: string,
  input: ScheduleProgressInput,
): Promise<ActionResult<ScheduleTask>> {
  return write(projectId, () =>
    serverFetch<ScheduleTask>(`${base(projectId)}/tasks/${taskId}/progress`, {
      method: 'POST',
      body: input,
    }),
  );
}

export async function deleteScheduleTask(projectId: string, taskId: string): Promise<ActionResult> {
  return write(projectId, () =>
    serverFetch(`${base(projectId)}/tasks/${taskId}`, { method: 'DELETE' }),
  );
}

export async function createScheduleDependency(
  projectId: string,
  input: { predecessor_id: string; successor_id: string; type: ScheduleLinkType; lag_days: number },
): Promise<ActionResult<ScheduleDependency>> {
  return write(projectId, () =>
    serverFetch<ScheduleDependency>(`${base(projectId)}/dependencies`, {
      method: 'POST',
      body: input,
    }),
  );
}

export async function updateScheduleDependency(
  projectId: string,
  dependencyId: string,
  input: { type?: ScheduleLinkType; lag_days?: number },
): Promise<ActionResult<ScheduleDependency>> {
  return write(projectId, () =>
    serverFetch<ScheduleDependency>(`${base(projectId)}/dependencies/${dependencyId}`, {
      method: 'PATCH',
      body: input,
    }),
  );
}

export async function deleteScheduleDependency(
  projectId: string,
  dependencyId: string,
): Promise<ActionResult> {
  return write(projectId, () =>
    serverFetch(`${base(projectId)}/dependencies/${dependencyId}`, { method: 'DELETE' }),
  );
}

export async function saveScheduleCalendar(
  projectId: string,
  input: { name?: string; working_days: number[]; holidays: string[] },
): Promise<ActionResult<ScheduleCalendar>> {
  return write(projectId, () =>
    serverFetch<ScheduleCalendar>(`${base(projectId)}/calendar`, { method: 'PUT', body: input }),
  );
}

/** Drop the site's own calendar and go back to the company's. */
export async function resetScheduleCalendar(projectId: string): Promise<ActionResult> {
  return write(projectId, () =>
    serverFetch(`${base(projectId)}/calendar`, { method: 'DELETE' }),
  );
}

export async function createScheduleBaseline(
  projectId: string,
  name: string,
): Promise<ActionResult<ScheduleBaselineSummary>> {
  return write(projectId, () =>
    serverFetch<ScheduleBaselineSummary>(`${base(projectId)}/baselines`, {
      method: 'POST',
      body: { name },
    }),
  );
}

export async function deleteScheduleBaseline(
  projectId: string,
  baselineId: string,
): Promise<ActionResult> {
  return write(projectId, () =>
    serverFetch(`${base(projectId)}/baselines/${baselineId}`, { method: 'DELETE' }),
  );
}

export async function scheduleVarianceReport(
  projectId: string,
  baselineId: string,
): Promise<ActionResult<ScheduleVarianceReport>> {
  return runAction(() =>
    serverFetch<ScheduleVarianceReport>(`${base(projectId)}/baselines/${baselineId}`),
  );
}

/** Read a file without writing anything, so the person sees what would be imported. */
export async function previewScheduleImport(
  projectId: string,
  xml: string,
  format: ScheduleImportFormat,
): Promise<ActionResult<ScheduleImportPreview>> {
  return runAction(() =>
    serverFetch<ScheduleImportPreview>(`${base(projectId)}/import/preview`, {
      method: 'POST',
      body: { xml, format },
    }),
  );
}

export async function importSchedule(
  projectId: string,
  input: { xml: string; format: ScheduleImportFormat; mode: 'replace' | 'append'; use_calendar: boolean },
): Promise<ActionResult<ScheduleImportResult>> {
  return write(projectId, () =>
    serverFetch<ScheduleImportResult>(`${base(projectId)}/import`, { method: 'POST', body: input }),
  );
}

/** Put the site's milestones that are not on the schedule yet onto it. */
export async function linkScheduleMilestones(
  projectId: string,
): Promise<ActionResult<{ created: number }>> {
  return write(projectId, () =>
    serverFetch<{ created: number }>(`${base(projectId)}/milestones`, { method: 'POST' }),
  );
}

/** The next `days` days of starts and finishes on one site. */
export async function scheduleLookAhead(
  projectId: string,
  days = 14,
): Promise<ActionResult<ScheduleLookAhead>> {
  return runAction(() =>
    serverFetch<ScheduleLookAhead>(
      `/schedule/look-ahead?project_id=${encodeURIComponent(projectId)}&days=${days}&format=json`,
    ),
  );
}

/**
 * The schedule as MS Project XML. The API answers with text, not JSON, so this reads the response
 * itself rather than through `serverFetch`; the token still never leaves the server.
 */
export async function exportScheduleXml(projectId: string): Promise<ActionResult<string>> {
  try {
    const token = await currentAccessToken();
    const response = await fetch(`${API_URL}${base(projectId)}/export`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      cache: 'no-store',
    });
    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as { message?: string } | null;
      return { ok: false, error: payload?.message ?? `Export failed with ${response.status}` };
    }
    return { ok: true, data: await response.text() };
  } catch {
    return { ok: false, error: 'Something went wrong. Try again.', code: 'INTERNAL' };
  }
}
