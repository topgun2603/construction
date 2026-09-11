import { NextResponse, type NextRequest } from 'next/server';
import { apiFetch, ApiRequestError } from '@/lib/api';
import { ACCESS_COOKIE, REFRESH_COOKIE } from '@/lib/session';

interface TokenPair {
  access_token: string;
  refresh_token: string;
  expires_in: number;
}

/**
 * Rotates the session using the refresh cookie.
 *
 * This lives in a route handler rather than in `loadSelf` because only a route
 * handler or server action may write cookies — a server component that tried would
 * throw. The new refresh token replaces the old one on the API side, so the cookies
 * must be updated together with it or the next refresh looks like a replay.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const refreshToken = request.cookies.get(REFRESH_COOKIE)?.value;
  if (!refreshToken) {
    return NextResponse.json({ code: 'UNAUTHENTICATED', message: 'No session' }, { status: 401 });
  }

  try {
    const tokens = await apiFetch<TokenPair>('/auth/refresh', {
      method: 'POST',
      body: { refresh_token: refreshToken },
    });

    const secure = process.env.NODE_ENV === 'production';
    const response = NextResponse.json({ ok: true });
    response.cookies.set(ACCESS_COOKIE, tokens.access_token, {
      httpOnly: true,
      sameSite: 'lax',
      secure,
      path: '/',
      maxAge: tokens.expires_in,
    });
    response.cookies.set(REFRESH_COOKIE, tokens.refresh_token, {
      httpOnly: true,
      sameSite: 'lax',
      secure,
      path: '/',
      maxAge: 30 * 24 * 60 * 60,
    });
    return response;
  } catch (error) {
    // A rejected refresh means the session is gone for good — clear the cookies so
    // the browser stops retrying with a token the API has already revoked.
    const status = error instanceof ApiRequestError ? error.status : 500;
    const response = NextResponse.json(
      { code: 'UNAUTHENTICATED', message: 'Session expired' },
      { status: status === 401 ? 401 : 500 },
    );
    response.cookies.delete(ACCESS_COOKIE);
    response.cookies.delete(REFRESH_COOKIE);
    return response;
  }
}
