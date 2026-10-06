'use server';

import { revalidatePath } from 'next/cache';
import type { AiSettingsInput } from '@sitebook/shared';
import { runAction, serverFetch, type ActionResult } from './server-api';
import type { AiSettingsView } from './ai-types';

/**
 * Company AI controls (Settings → Security → AI and data). The API decides and enforces; these
 * carry the form there and bring its answer back. The whole dashboard is revalidated after a save,
 * because every AI button reads the company's switches from `/me` in the shell.
 */

export async function saveAiSettings(input: AiSettingsInput): Promise<ActionResult<AiSettingsView>> {
  const result = await runAction(() => serverFetch<AiSettingsView>('/ai/settings', { method: 'PUT', body: input }));
  if (result.ok) revalidatePath('/', 'layout');
  return result;
}

export async function deleteAiData(): Promise<ActionResult<{ deleted_chunks: number; documents_reset: number }>> {
  const result = await runAction(() =>
    serverFetch<{ deleted_chunks: number; documents_reset: number }>('/ai/data/delete', {
      method: 'POST',
      body: { confirm: 'DELETE' },
    }),
  );
  if (result.ok) revalidatePath('/settings/security');
  return result;
}

export async function reindexDocuments(): Promise<ActionResult<{ queued: number }>> {
  const result = await runAction(() =>
    serverFetch<{ queued: number }>('/ai/documents/reindex', { method: 'POST', body: {} }),
  );
  if (result.ok) revalidatePath('/settings/security');
  return result;
}
