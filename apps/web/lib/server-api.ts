import { redirect } from 'next/navigation';
import { apiFetch, ApiRequestError, type ApiFetchOptions } from './api';
import { currentAccessToken } from './session';

export interface ServerFetchOptions extends ApiFetchOptions {
  /**
   * What to do when the API refuses the session.
   *
   * `redirect` (the default) sends the browser to /login. `throw` re-raises, for
   * the few callers that want to handle it themselves — a route handler answering
   * a background `fetch()` should return JSON, not a redirect the client will try
   * to parse as JSON.
   */
  onUnauthenticated?: 'redirect' | 'throw';
}

/**
 * Call the API as the signed-in user from a server component or server action.
 *
 * The access token is read from the httpOnly cookie here and never leaves the
 * server, which is the whole reason data fetching lives in server components
 * rather than in the browser.
 *
 * A dead session redirects instead of throwing. Next renders a layout and its page
 * concurrently, so when a cookie goes stale the page's own requests are already in
 * flight while the layout is deciding to redirect. Left as exceptions they filled
 * the server log with errors for renders that were about to be discarded — which
 * buries the failures that actually need reading.
 */
export async function serverFetch<T>(path: string, options: ServerFetchOptions = {}): Promise<T> {
  const { onUnauthenticated = 'redirect', ...rest } = options;
  const accessToken = await currentAccessToken();

  try {
    return await apiFetch<T>(path, { ...rest, accessToken: accessToken ?? undefined });
  } catch (error) {
    if (
      onUnauthenticated === 'redirect' &&
      error instanceof ApiRequestError &&
      error.status === 401
    ) {
      redirect('/login');
    }
    throw error;
  }
}

export interface ActionResult<T = unknown> {
  ok: boolean;
  data?: T;
  error?: string;
  code?: string;
}

/**
 * Wrap a mutation so a form gets `{ ok, error }` instead of a thrown exception.
 *
 * A failed write here is usually a domain rule doing its job — a finalised wage
 * period, a worker already on another site — and the message the API wrote is the
 * one the user needs to read. Unknown failures are not forwarded verbatim.
 */
export async function runAction<T>(fn: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    return { ok: true, data: await fn() };
  } catch (error) {
    if (error instanceof ApiRequestError) {
      return { ok: false, error: error.body.message, code: error.code };
    }
    // `redirect()` signals itself by throwing; it must reach Next, not be
    // swallowed here and reported to the user as a failed save.
    if (isRedirectError(error)) throw error;
    return { ok: false, error: 'Something went wrong. Try again.', code: 'INTERNAL' };
  }
}

function isRedirectError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'digest' in error &&
    typeof (error as { digest: unknown }).digest === 'string' &&
    (error as { digest: string }).digest.startsWith('NEXT_REDIRECT')
  );
}
