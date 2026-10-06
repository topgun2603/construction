import { serverFetch } from './server-api';
import type { M365Delivery, M365Status } from './m365-types';

/**
 * Whether "Send by email" can be offered, for a server page. Anything but a clear yes is a no: a
 * page must never fail to render because the integration could not be asked, and the WhatsApp and
 * copy-link buttons are always there to fall back on.
 */
export async function m365Status(): Promise<M365Status> {
  try {
    return await serverFetch<M365Status>('/integrations/m365/status');
  } catch {
    return { connected: false, mailbox: null };
  }
}

/** The emails sent about one record (`/rfis/:id/emails` and the like), or none if they cannot be read. */
export async function emailsAbout(path: string): Promise<M365Delivery[]> {
  try {
    return await serverFetch<M365Delivery[]>(path);
  } catch {
    return [];
  }
}
