'use server';

import { revalidatePath } from 'next/cache';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { apiFetch } from './api';
import { runAction, type ActionResult } from './server-api';
import { PLATFORM_COOKIE, platformFetch } from './platform-session';

/**
 * Server actions for the platform console.
 *
 * The console's token is written to an httpOnly cookie here rather than handed to the
 * browser, exactly as a tenant session is — a credential that can suspend any account
 * on the platform is the last thing that should be readable by a script on the page.
 */

export async function platformLogin(firebaseToken: string): Promise<ActionResult> {
  const result = await runAction(() =>
    apiFetch<{ access_token: string; expires_in: number; phone: string }>('/admin/auth/login', {
      method: 'POST',
      body: { firebase_token: firebaseToken },
    }),
  );
  if (!result.ok || !result.data) return result;

  const jar = await cookies();
  jar.set(PLATFORM_COOKIE, result.data.access_token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: result.data.expires_in,
  });
  return { ok: true };
}

export async function platformSignOut(): Promise<never> {
  // Nothing to revoke server-side: a console token is stateless by design, and its
  // authority is re-checked against the allowlist on every request anyway.
  (await cookies()).delete(PLATFORM_COOKIE);
  redirect('/admin/login');
}

export async function updateTenantPlan(input: {
  tenantId: string;
  plan?: string;
  status?: string;
  enabled_modules?: string[];
}): Promise<ActionResult> {
  const { tenantId, ...patch } = input;
  const result = await runAction(() =>
    platformFetch(`/tenants/${tenantId}`, { method: 'PATCH', body: patch }),
  );
  if (result.ok) {
    revalidatePath('/admin');
    revalidatePath(`/admin/tenants/${tenantId}`);
  }
  return result;
}

/**
 * Grants console access to a number that is not in the deployment config.
 *
 * Only an operator named in that config may do this, and the API enforces it — this action does
 * not re-check, because a permission decided in two places is a permission that will eventually
 * disagree with itself.
 */
export async function grantOperator(input: {
  phone: string;
  name?: string;
}): Promise<ActionResult> {
  const result = await runAction(() =>
    platformFetch('/operators', { method: 'POST', body: input }),
  );
  if (result.ok) revalidatePath('/admin/operators');
  return result;
}

export async function revokeOperator(phone: string): Promise<ActionResult> {
  const result = await runAction(() =>
    platformFetch(`/operators/${encodeURIComponent(phone)}`, { method: 'DELETE' }),
  );
  if (result.ok) revalidatePath('/admin/operators');
  return result;
}

/**
 * Removes an account and everything under it.
 *
 * `confirmName` is the tenant's own name, typed back. The API refuses anything else, so a
 * misdirected click on the wrong row cannot destroy a customer.
 */
export async function deleteTenant(input: {
  tenantId: string;
  confirmName: string;
}): Promise<ActionResult> {
  const result = await runAction(() =>
    platformFetch(`/tenants/${input.tenantId}`, {
      method: 'DELETE',
      body: { confirm_name: input.confirmName },
    }),
  );
  if (result.ok) {
    revalidatePath('/admin');
    revalidatePath('/admin/tenants');
  }
  return result;
}

/**
 * Creates an account from the console. Root operators only; the API enforces that.
 */
export async function createTenantFromConsole(input: {
  name: string;
  owner_name: string;
  owner_phone: string;
  plan: string;
}): Promise<ActionResult> {
  const result = await runAction(() =>
    platformFetch('/tenants', { method: 'POST', body: input }),
  );
  if (result.ok) {
    revalidatePath('/admin');
    revalidatePath('/admin/tenants');
  }
  return result;
}

/**
 * The plan catalogue. Root operators only; the API enforces that.
 *
 * Every write revalidates both console pages and the tenant plan page — a price change that did
 * not show on the page a builder is looking at is the one that causes an argument.
 */
export async function createPlan(input: {
  code: string;
  name: string;
  months: number | null;
  price: string;
  description: string | null;
  highlights: string[];
  is_active: boolean;
  sort_order: number;
}): Promise<ActionResult> {
  const result = await runAction(() => platformFetch('/plans', { method: 'POST', body: input }));
  if (result.ok) revalidatePath('/admin/plans');
  return result;
}

export async function updatePlan(
  id: string,
  input: {
    name?: string;
    months?: number | null;
    price?: string;
    description?: string | null;
    highlights?: string[];
    is_active?: boolean;
    sort_order?: number;
  },
): Promise<ActionResult> {
  const result = await runAction(() =>
    platformFetch(`/plans/${id}`, { method: 'PATCH', body: input }),
  );
  if (result.ok) revalidatePath('/admin/plans');
  return result;
}

export async function deletePlan(id: string): Promise<ActionResult> {
  const result = await runAction(() => platformFetch(`/plans/${id}`, { method: 'DELETE' }));
  if (result.ok) revalidatePath('/admin/plans');
  return result;
}
