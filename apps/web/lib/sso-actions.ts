'use server';

import { revalidatePath } from 'next/cache';
import type { ScimRoleMappingInput, SsoConnectionInput, SsoSamlMetadataInput } from '@sitebook/shared';
import { runAction, serverFetch, type ActionResult } from './server-api';
import type { SsoSettings } from './sso-types';

/**
 * Settings → Security → Single sign-on. Owner-only on the API; these only carry the form there and
 * hand back the API's own refusal when there is one.
 */

function refresh() {
  revalidatePath('/settings/security');
}

async function write<T>(path: string, method: string, body?: unknown): Promise<ActionResult<T>> {
  const result = await runAction(() => serverFetch<T>(path, { method, ...(body === undefined ? {} : { body }) }));
  if (result.ok) refresh();
  return result;
}

export async function saveSsoConnection(input: SsoConnectionInput): Promise<ActionResult<SsoSettings>> {
  return write('/sso/connection', 'PUT', input);
}

/** Reads an IdP's metadata into the form. Saves nothing. */
export async function importSsoSamlMetadata(input: SsoSamlMetadataInput): Promise<
  ActionResult<{ saml_idp_entity_id: string; saml_idp_sso_url: string; saml_idp_certificate: string }>
> {
  return runAction(() => serverFetch('/sso/saml/metadata', { method: 'POST', body: input }));
}

export async function addSsoDomain(domain: string): Promise<ActionResult<SsoSettings>> {
  return write('/sso/domains', 'POST', { domain });
}

export async function verifySsoDomain(id: string): Promise<ActionResult<SsoSettings>> {
  return write(`/sso/domains/${id}/verify`, 'POST');
}

export async function removeSsoDomain(id: string): Promise<ActionResult<SsoSettings>> {
  return write(`/sso/domains/${id}`, 'DELETE');
}

/** A new SCIM token, returned once. The previous one stops working. */
export async function createScimToken(): Promise<ActionResult<{ token: string }>> {
  return write('/sso/scim-token', 'POST');
}

export async function revokeScimTokens(): Promise<ActionResult<SsoSettings>> {
  return write('/sso/scim-token', 'DELETE');
}

export async function addScimRoleMapping(input: ScimRoleMappingInput): Promise<ActionResult<SsoSettings>> {
  return write('/sso/role-mappings', 'POST', input);
}

export async function removeScimRoleMapping(id: string): Promise<ActionResult<SsoSettings>> {
  return write(`/sso/role-mappings/${id}`, 'DELETE');
}
