'use server';

import { revalidatePath } from 'next/cache';
import { cookies } from 'next/headers';
import { ACCESS_COOKIE, REFRESH_COOKIE } from './session';
import { runAction, serverFetch, type ActionResult } from './server-api';
import type { DataExportItem, LegalOverview, PersonSearchRow } from './data-portability-types';

/**
 * Data export and deletion (Settings → Company). The API decides and enforces — owner only, the
 * typed name, the fresh sign-in, the daily limit; these carry the request there and its answer back.
 */

export async function requestDataExport(): Promise<ActionResult<DataExportItem>> {
  const result = await runAction(() => serverFetch<DataExportItem>('/data-exports', { method: 'POST', body: {} }));
  if (result.ok) revalidatePath('/settings/company');
  return result;
}

/** A ten-minute link to a finished export, fetched when the button is pressed. */
export async function dataExportDownloadUrl(exportId: string): Promise<ActionResult<{ url: string; file_name: string }>> {
  return runAction(() => serverFetch<{ url: string; file_name: string }>(`/data-exports/${exportId}/download`));
}

/**
 * Schedules the company for deletion. Every session ends on the API — this one too — so the
 * cookies are dropped here and the browser goes to the sign-in page, where the owner can come back
 * in to cancel.
 */
export async function requestCompanyDeletion(confirmName: string): Promise<ActionResult<{ purge_after: string }>> {
  const result = await runAction(() =>
    serverFetch<{ purge_after: string }>('/company-deletion', {
      method: 'POST',
      body: { confirm_name: confirmName },
    }),
  );
  if (result.ok) {
    const jar = await cookies();
    jar.delete(ACCESS_COOKIE);
    jar.delete(REFRESH_COOKIE);
  }
  return result;
}

export async function cancelCompanyDeletion(): Promise<ActionResult<{ cancelled: boolean }>> {
  const result = await runAction(() =>
    serverFetch<{ cancelled: boolean }>('/company-deletion/cancel', { method: 'POST', body: {} }),
  );
  if (result.ok) revalidatePath('/', 'layout');
  return result;
}

export async function acceptDpa(version: string): Promise<ActionResult<LegalOverview>> {
  const result = await runAction(() =>
    serverFetch<LegalOverview>('/legal/accept', { method: 'POST', body: { document: 'dpa', version } }),
  );
  if (result.ok) revalidatePath('/settings/company');
  return result;
}

export async function searchPeople(q: string): Promise<ActionResult<{ items: PersonSearchRow[] }>> {
  return runAction(() =>
    serverFetch<{ items: PersonSearchRow[] }>(`/people-data/search?q=${encodeURIComponent(q)}`),
  );
}

export async function anonymisePerson(
  kind: 'worker' | 'user',
  id: string,
): Promise<ActionResult<{ anonymised: boolean; documents_deleted: number; files_deleted: number }>> {
  const result = await runAction(() =>
    serverFetch<{ anonymised: boolean; documents_deleted: number; files_deleted: number }>(
      `/people-data/${kind === 'worker' ? 'workers' : 'users'}/${id}/anonymise`,
      { method: 'POST', body: { confirm: 'ANONYMISE' } },
    ),
  );
  if (result.ok) revalidatePath('/settings/company');
  return result;
}
