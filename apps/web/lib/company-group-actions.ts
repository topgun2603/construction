'use server';

import { revalidatePath } from 'next/cache';
import { cookies } from 'next/headers';
import type {
  CompanyGroupPermission,
  CompanyGroupRateInput,
  CreateCompanyGroupInput,
  UpdateCompanyGroupInput,
} from '@sitebook/shared';
import { runAction, serverFetch, type ActionResult } from './server-api';
import { ACCESS_COOKIE, REFRESH_COOKIE } from './session';
import type { CompanyGroupInvitation, CompanyGroupOverview } from './company-group-types';

/**
 * Company groups (roadmap Phase 2, module 11), and switching company. In a file of their own so the
 * module's writes read together and stay out of `actions.ts`.
 */

function refresh() {
  revalidatePath('/settings/group');
  revalidatePath('/group');
}

export async function createCompanyGroup(
  input: CreateCompanyGroupInput,
): Promise<ActionResult<CompanyGroupOverview>> {
  const result = await runAction(() =>
    serverFetch<CompanyGroupOverview>('/company-groups', { method: 'POST', body: input }),
  );
  if (result.ok) refresh();
  return result;
}

export async function updateCompanyGroup(
  input: UpdateCompanyGroupInput,
): Promise<ActionResult<CompanyGroupOverview>> {
  const result = await runAction(() =>
    serverFetch<CompanyGroupOverview>('/company-groups/current', { method: 'PATCH', body: input }),
  );
  if (result.ok) refresh();
  return result;
}

export async function inviteCompanyToGroup(input: {
  tenant_id?: string;
  owner_phone?: string;
}): Promise<ActionResult<CompanyGroupInvitation>> {
  const result = await runAction(() =>
    serverFetch<CompanyGroupInvitation>('/company-groups/current/invitations', {
      method: 'POST',
      body: input,
    }),
  );
  if (result.ok) refresh();
  return result;
}

export async function cancelCompanyGroupInvitation(id: string): Promise<ActionResult> {
  const result = await runAction(() =>
    serverFetch(`/company-groups/current/invitations/${id}`, { method: 'DELETE' }),
  );
  if (result.ok) refresh();
  return result;
}

export async function acceptCompanyGroupInvitation(id: string): Promise<ActionResult> {
  const result = await runAction(() =>
    serverFetch(`/company-groups/invitations/${id}/accept`, { method: 'POST' }),
  );
  if (result.ok) refresh();
  return result;
}

export async function declineCompanyGroupInvitation(id: string): Promise<ActionResult> {
  const result = await runAction(() =>
    serverFetch(`/company-groups/invitations/${id}/decline`, { method: 'POST' }),
  );
  if (result.ok) refresh();
  return result;
}

export async function leaveCompanyGroup(): Promise<ActionResult> {
  const result = await runAction(() =>
    serverFetch('/company-groups/current/leave', { method: 'POST' }),
  );
  if (result.ok) refresh();
  return result;
}

export async function grantCompanyGroupAdmin(input: {
  tenant_id: string;
  phone: string;
  permissions: CompanyGroupPermission[];
}): Promise<ActionResult> {
  const result = await runAction(() =>
    serverFetch('/company-groups/current/admins', { method: 'POST', body: input }),
  );
  if (result.ok) refresh();
  return result;
}

export async function revokeCompanyGroupAdmin(id: string): Promise<ActionResult> {
  const result = await runAction(() =>
    serverFetch(`/company-groups/current/admins/${id}`, { method: 'DELETE' }),
  );
  if (result.ok) refresh();
  return result;
}

export async function setCompanyGroupRate(input: CompanyGroupRateInput): Promise<ActionResult> {
  const result = await runAction(() =>
    serverFetch('/company-groups/current/rates', { method: 'POST', body: input }),
  );
  if (result.ok) refresh();
  return result;
}

export async function removeCompanyGroupRate(id: string): Promise<ActionResult> {
  const result = await runAction(() =>
    serverFetch(`/company-groups/current/rates/${id}`, { method: 'DELETE' }),
  );
  if (result.ok) refresh();
  return result;
}

interface TokenPair {
  access_token: string;
  refresh_token: string;
  expires_in: number;
}

/**
 * Moves the session to another company this person belongs to.
 *
 * A server action because only the server can rewrite the httpOnly cookies. The API issues a
 * token pair for exactly the chosen company — never one spanning two — and revokes the refresh
 * token handed in, so the session left behind is dead rather than merely forgotten by the browser.
 */
export async function switchCompany(tenantId: string): Promise<ActionResult> {
  const jar = await cookies();
  const refreshToken = jar.get(REFRESH_COOKIE)?.value;
  const result = await runAction(() =>
    serverFetch<TokenPair>('/auth/switch', {
      method: 'POST',
      body: { tenant_id: tenantId, ...(refreshToken ? { refresh_token: refreshToken } : {}) },
    }),
  );
  if (!result.ok || !result.data) return { ok: false, error: result.error, code: result.code };

  const secure = process.env.NODE_ENV === 'production';
  jar.set(ACCESS_COOKIE, result.data.access_token, {
    httpOnly: true,
    sameSite: 'lax',
    secure,
    path: '/',
    maxAge: result.data.expires_in,
  });
  jar.set(REFRESH_COOKIE, result.data.refresh_token, {
    httpOnly: true,
    sameSite: 'lax',
    secure,
    path: '/',
    maxAge: 30 * 24 * 60 * 60,
  });
  // Everything on screen belonged to the other company.
  revalidatePath('/', 'layout');
  return { ok: true };
}
