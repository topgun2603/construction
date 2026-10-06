import { serverFetch } from './server-api';
import type { Page, SiteDocument } from './api-types';

/**
 * What the RFI and submittal forms offer: the document library, and the subcontractors and suppliers
 * a submittal may come from. Each list is best-effort — somebody without procurement access simply
 * gets no suppliers to pick, rather than a page that fails to load.
 */
export async function submittalFormData(permissions: readonly string[]) {
  const [documents, contractors, vendors] = await Promise.all([
    rfiDocuments(permissions),
    serverFetch<Page<{ id: string; name: string }>>('/contractors?limit=200')
      .then((r) => r.items.map((row) => ({ id: row.id, name: row.name })))
      .catch(() => [] as Array<{ id: string; name: string }>),
    serverFetch<Array<{ id: string; name: string }>>('/vendors?active=true')
      .then((rows) => rows.map((row) => ({ id: row.id, name: row.name })))
      .catch(() => [] as Array<{ id: string; name: string }>),
  ]);
  return { documents, parties: { contractors, vendors } };
}

/** The library, for picking the drawings an RFI is about. Empty without `documents.view`. */
export async function rfiDocuments(permissions: readonly string[]): Promise<SiteDocument[]> {
  if (!permissions.includes('documents.view')) return [];
  return serverFetch<{ items: SiteDocument[] }>('/documents')
    .then((r) => r.items)
    .catch(() => [] as SiteDocument[]);
}
