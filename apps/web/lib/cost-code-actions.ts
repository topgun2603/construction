'use server';

import { revalidatePath } from 'next/cache';
import type { CostCodeImportRow } from '@sitebook/shared';
import { runAction, serverFetch, type ActionResult } from './server-api';
import type {
  CostCode,
  CostCodeMergeResult,
  CostCodeTemplate,
  CostCodeTemplateLine,
} from './cost-code-types';

/**
 * Cost codes and budgets (roadmap Phase 2, module 1). In a file of their own so the module's
 * writes read together and do not collide with the rest of `actions.ts`.
 */

const sitePath = (projectId: string) => `/projects/${projectId}`;

/** The codes to pick from when recording an expense against a site. */
export async function costCodeOptions(projectId: string): Promise<ActionResult<CostCode[]>> {
  return runAction(() => serverFetch<CostCode[]>(`/projects/${projectId}/cost-codes`));
}

export async function createCostCode(
  projectId: string,
  input: {
    code: string;
    name: string;
    parent_id?: string | null;
    unit?: string;
    budget?: string;
  },
): Promise<ActionResult> {
  const result = await runAction(() =>
    serverFetch(`/projects/${projectId}/cost-codes`, { method: 'POST', body: input }),
  );
  if (result.ok) revalidatePath(sitePath(projectId));
  return result;
}

export async function updateCostCode(
  projectId: string,
  id: string,
  input: {
    code?: string;
    name?: string;
    parent_id?: string | null;
    unit?: string | null;
    budget?: string;
    labour_default?: boolean;
  },
): Promise<ActionResult> {
  const result = await runAction(() =>
    serverFetch(`/projects/${projectId}/cost-codes/${id}`, { method: 'PATCH', body: input }),
  );
  if (result.ok) revalidatePath(sitePath(projectId));
  return result;
}

export async function deleteCostCode(projectId: string, id: string): Promise<ActionResult> {
  const result = await runAction(() =>
    serverFetch(`/projects/${projectId}/cost-codes/${id}`, { method: 'DELETE' }),
  );
  if (result.ok) revalidatePath(sitePath(projectId));
  return result;
}

export async function applyCostCodeTemplate(
  projectId: string,
  templateId: string,
): Promise<ActionResult<CostCodeMergeResult>> {
  const result = await runAction(() =>
    serverFetch<CostCodeMergeResult>(`/projects/${projectId}/cost-codes/apply-template`, {
      method: 'POST',
      body: { template_id: templateId },
    }),
  );
  if (result.ok) revalidatePath(sitePath(projectId));
  return result;
}

/** Rows already parsed by `parseCostCodeCsv`, budgets in minor units. */
export async function importCostCodes(
  projectId: string,
  rows: CostCodeImportRow[],
): Promise<ActionResult<CostCodeMergeResult>> {
  const result = await runAction(() =>
    serverFetch<CostCodeMergeResult>(`/projects/${projectId}/cost-codes/import`, {
      method: 'POST',
      body: { rows },
    }),
  );
  if (result.ok) revalidatePath(sitePath(projectId));
  return result;
}

export async function createCostCodeTemplate(input: {
  name: string;
  description?: string;
  from_template_id?: string;
  from_project_id?: string;
  items?: CostCodeTemplateLine[];
}): Promise<ActionResult<CostCodeTemplate>> {
  const result = await runAction(() =>
    serverFetch<CostCodeTemplate>('/cost-code-templates', { method: 'POST', body: input }),
  );
  if (result.ok) revalidatePath('/settings/cost-codes');
  return result;
}

export async function updateCostCodeTemplate(
  id: string,
  input: { name?: string; description?: string | null; items?: CostCodeTemplateLine[] },
): Promise<ActionResult<CostCodeTemplate>> {
  const result = await runAction(() =>
    serverFetch<CostCodeTemplate>(`/cost-code-templates/${id}`, { method: 'PUT', body: input }),
  );
  if (result.ok) revalidatePath('/settings/cost-codes');
  return result;
}

export async function deleteCostCodeTemplate(id: string): Promise<ActionResult> {
  const result = await runAction(() =>
    serverFetch(`/cost-code-templates/${id}`, { method: 'DELETE' }),
  );
  if (result.ok) revalidatePath('/settings/cost-codes');
  return result;
}
