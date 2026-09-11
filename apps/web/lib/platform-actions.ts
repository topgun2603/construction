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
