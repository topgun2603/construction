import type { NextRequest } from 'next/server';
import { API_URL } from '@/lib/api';
import { currentAccessToken } from '@/lib/session';

const STEPS = {
  preview: 'imports/preview',
  commit: 'imports',
  'error-report': 'imports/error-report',
} as const;

/**
 * Spreadsheet import, relayed to the API: `?step=preview|commit|error-report`.
 *
 * A route handler rather than a server action because a server action's body is capped at 1 MB and
 * an import may be a 5 MB workbook (as base64, more) — the BOQ import's reasoning. The token lives
 * in an httpOnly cookie, so the browser cannot call the API itself; this passes the body through
 * and the API answers, permissions, validation and all.
 */
export async function POST(request: NextRequest): Promise<Response> {
  const token = await currentAccessToken();
  if (!token) return Response.json({ code: 'UNAUTHENTICATED', message: 'Sign in again to import.' }, { status: 401 });

  const step = request.nextUrl.searchParams.get('step') ?? 'preview';
  const path = STEPS[step as keyof typeof STEPS];
  if (!path) return Response.json({ code: 'VALIDATION_FAILED', message: 'Unknown step.' }, { status: 400 });

  const upstream = await fetch(`${API_URL}/${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: await request.text(),
    cache: 'no-store',
  });
  return new Response(upstream.body, {
    status: upstream.status,
    headers: {
      'Content-Type': upstream.headers.get('content-type') ?? 'application/json',
      ...(upstream.headers.get('content-disposition')
        ? { 'Content-Disposition': upstream.headers.get('content-disposition')! }
        : {}),
      'Cache-Control': 'no-store',
    },
  });
}
