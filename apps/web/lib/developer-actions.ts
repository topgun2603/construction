'use server';

import { revalidatePath } from 'next/cache';
import type {
  PublicApiKeyCreateInput,
  WebhookEndpointCreateInput,
  WebhookEndpointUpdateInput,
} from '@sitebook/shared';
import { runAction, serverFetch, type ActionResult } from './server-api';
import type {
  ApiKeyView,
  WebhookDeliveryLog,
  WebhookDeliveryOutcome,
  WebhookEndpointView,
} from './developer-types';

/**
 * Settings → Developers. The API decides and enforces (owner only, scopes, SSRF rules); these carry
 * the form there and bring its answer back. A key or signing secret comes back once, in the answer
 * to the create call, and is shown by the form that asked — it is never stored on this server.
 */

const PAGE = '/settings/developers';

async function write<T>(path: string, method: string, body?: unknown): Promise<ActionResult<T>> {
  const result = await runAction(() => serverFetch<T>(path, { method, ...(body === undefined ? {} : { body }) }));
  if (result.ok) revalidatePath(PAGE);
  return result;
}

// Input types are the shared schemas' *input*: the form sends JSON, the API parses it.
type KeyForm = Omit<PublicApiKeyCreateInput, 'allowed_cidrs'> & { allowed_cidrs?: string[] };

export async function createApiKey(input: KeyForm): Promise<ActionResult<{ key: ApiKeyView; secret: string }>> {
  return write('/developers/api-keys', 'POST', input);
}

export async function revokeApiKey(id: string): Promise<ActionResult<ApiKeyView>> {
  return write(`/developers/api-keys/${encodeURIComponent(id)}/revoke`, 'POST', {});
}

export async function createWebhook(
  input: WebhookEndpointCreateInput,
): Promise<ActionResult<{ endpoint: WebhookEndpointView; secret: string }>> {
  return write('/developers/webhooks', 'POST', input);
}

export async function updateWebhook(id: string, input: WebhookEndpointUpdateInput): Promise<ActionResult<WebhookEndpointView>> {
  return write(`/developers/webhooks/${encodeURIComponent(id)}`, 'PATCH', input);
}

export async function deleteWebhook(id: string): Promise<ActionResult<void>> {
  return write(`/developers/webhooks/${encodeURIComponent(id)}`, 'DELETE');
}

export async function pingWebhook(id: string): Promise<ActionResult<WebhookDeliveryOutcome>> {
  return write(`/developers/webhooks/${encodeURIComponent(id)}/ping`, 'POST', {});
}

export async function resendDelivery(deliveryId: string): Promise<ActionResult<WebhookDeliveryOutcome>> {
  return write(`/developers/webhooks/deliveries/${encodeURIComponent(deliveryId)}/resend`, 'POST', {});
}

/** The log is read on demand when an endpoint is opened, not with the page. */
export async function loadDeliveries(endpointId: string, cursor?: string): Promise<ActionResult<WebhookDeliveryLog>> {
  const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : '';
  return runAction(() => serverFetch<WebhookDeliveryLog>(`/developers/webhooks/${encodeURIComponent(endpointId)}/deliveries${query}`));
}
