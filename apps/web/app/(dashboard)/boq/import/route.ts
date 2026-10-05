import type { NextRequest } from 'next/server';
import { API_URL } from '@/lib/api';
import { currentAccessToken } from '@/lib/session';

/**
 * BOQ import, relayed to the API: `?project_id=…&step=preview|import`.
 *
 * A route handler rather than a server action because a server action's body is capped at 1 MB,
 * and a priced BOQ as base64 can be more than that. The session token lives in an httpOnly cookie,
 * so the browser cannot call the API itself; this passes the body through and the API answers —
 * permissions, validation and all.
 */
export async function POST(request: NextRequest): Promise<Response> {
  const token = await currentAccessToken();
  if (!token) return Response.json({ code: 'UNAUTHENTICATED', message: 'Sign in again to import.' }, { status: 401 });

  const projectId = request.nextUrl.searchParams.get('project_id') ?? '';
  const step = request.nextUrl.searchParams.get('step') === 'import' ? 'import' : 'import/preview';
  if (!/^[0-9a-f-]{36}$/i.test(projectId)) {
    return Response.json({ code: 'VALIDATION_FAILED', message: 'Which site?' }, { status: 400 });
  }

  const upstream = await fetch(`${API_URL}/projects/${projectId}/boq/${step}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: await request.text(),
    cache: 'no-store',
  });
  return new Response(upstream.body, {
    status: upstream.status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}
