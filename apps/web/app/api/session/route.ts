import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { ACCESS_COOKIE, REFRESH_COOKIE } from '@/lib/session';

const bodySchema = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().min(1),
  expires_in: z.number().int().positive(),
});

/**
 * Turns an API token pair into httpOnly cookies.
 *
 * The login page runs in the browser — it has to, because Firebase's OTP flow needs
 * a real window — but the tokens it receives must not stay reachable from
 * JavaScript. Posting them here hands them to the server, which sets them as
 * httpOnly cookies and returns nothing.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ code: 'VALIDATION_FAILED', message: 'Bad token pair' }, { status: 422 });
  }

  const secure = process.env.NODE_ENV === 'production';
  const response = new NextResponse(null, { status: 204 });

  response.cookies.set(ACCESS_COOKIE, parsed.data.access_token, {
    httpOnly: true,
    sameSite: 'lax',
    secure,
    path: '/',
    maxAge: parsed.data.expires_in,
  });
  response.cookies.set(REFRESH_COOKIE, parsed.data.refresh_token, {
    httpOnly: true,
    sameSite: 'lax',
    secure,
    path: '/',
    maxAge: 30 * 24 * 60 * 60,
  });

  return response;
}

/** Clears the session cookies. The API-side revoke is done by the logout page. */
export async function DELETE(): Promise<NextResponse> {
  const response = new NextResponse(null, { status: 204 });
  response.cookies.delete(ACCESS_COOKIE);
  response.cookies.delete(REFRESH_COOKIE);
  return response;
}
