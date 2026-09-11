import { cache } from 'react';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { apiFetch, ApiRequestError } from './api';

export const ACCESS_COOKIE = 'sb_access';
export const REFRESH_COOKIE = 'sb_refresh';

export interface SelfResponse {
  user: { id: string; name: string; phone: string; role: string; status: string };
  tenant: { id: string; name: string; logo_url: string | null; plan: string };
  enabled_modules: string[];
  /** What this person may do. Gate UI on these, never on the role name. */
  permissions: string[];
  /** The role's display name — for a custom role, whatever the owner called it. */
  role_name: string;
  project_ids: string[];
  sees_all_projects: boolean;
  unread_notifications: number;
}

/**
 * Tokens live in httpOnly cookies rather than localStorage, so a script injected
 * into the dashboard cannot read them and server components can call the API
 * without shipping a token to the browser.
 */
export async function currentAccessToken(): Promise<string | null> {
  return (await cookies()).get(ACCESS_COOKIE)?.value ?? null;
}

/**
 * `/me` for the signed-in user, or null when there is no usable session. An expired
 * access token is treated as "not signed in" and the caller redirects to login —
 * the refresh rotation happens in the `/api/session/refresh` route handler, which
 * can actually write cookies.
 */
export const loadSelf = cache(async (): Promise<SelfResponse | null> => {
  const accessToken = await currentAccessToken();
  if (!accessToken) return null;

  try {
    return await apiFetch<SelfResponse>('/me', { accessToken });
  } catch (error) {
    // Any refusal on `/me` means the cookie cannot be used: expired (401), a
    // suspended tenant (403), or a token whose user has since been deleted (404).
    // All of them are "sign in again", never a server error — letting one through
    // turns a stale cookie into a crashed page for every route in the shell.
    if (error instanceof ApiRequestError && error.status >= 400 && error.status < 500) {
      return null;
    }
    throw error;
  }
});

/**
 * `/me` for a page that needs the role, guaranteed to reuse the layout's call.
 *
 * The dashboard layout already loads `/me` on every navigation; a page asking for
 * it again was a second round trip for bytes we had. `cache()` scopes the result
 * to one server render, so both callers share a single request while nothing is
 * cached across requests — this is per-user data and must never be.
 *
 * A dead session redirects rather than throwing. Pages and their layout render
 * concurrently, so when the cookie is stale the layout is already redirecting
 * while the page is still going; throwing there filled the server log with
 * errors for a render that was about to be discarded, which buries the failures
 * that actually matter. `redirect()` is control flow Next understands.
 */
export const requireSelf = cache(async (): Promise<SelfResponse> => {
  const self = await loadSelf();
  if (!self) redirect('/login');
  return self;
});

/**
 * Where this person belongs when they have not asked for a page.
 *
 * A client has no overview — that screen is cost and approvals, and the API refuses it to them.
 * Sending them to it and letting it fail would make signing in look broken on the one account type
 * least able to work out why.
 */
export function homePathFor(permissions: readonly string[]): string {
  return permissions.includes('expenses.view') ? '/overview' : '/projects';
}
