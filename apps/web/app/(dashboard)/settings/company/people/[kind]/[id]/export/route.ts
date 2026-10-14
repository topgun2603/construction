import type { NextRequest } from 'next/server';
import { API_URL } from '@/lib/api';
import { currentAccessToken } from '@/lib/session';

/**
 * Hands one person's data to the browser as a ZIP.
 *
 * A route handler rather than a link straight at the API, for the same reason as the audit-log
 * export: the session token is in an httpOnly cookie the browser will not attach to a cross-origin
 * request. The API checks that the caller is an owner; this only relays, streaming the body through.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ kind: string; id: string }> },
): Promise<Response> {
  const { kind, id } = await params;
  if ((kind !== 'worker' && kind !== 'user') || !/^[0-9a-f-]{36}$/i.test(id)) {
    return new Response('Not found.', { status: 404 });
  }
  const token = await currentAccessToken();
  if (!token) return new Response('Sign in again to download.', { status: 401 });

  const upstream = await fetch(`${API_URL}/people-data/${kind === 'worker' ? 'workers' : 'users'}/${id}/export`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: 'no-store',
  });
  if (!upstream.ok) {
    const body = (await upstream.json().catch(() => null)) as { message?: string } | null;
    return new Response(body?.message ?? 'Export failed.', { status: upstream.status });
  }

  return new Response(upstream.body, {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': upstream.headers.get('content-disposition') ?? `attachment; filename="${kind}-data.zip"`,
      // Everything held about one person. No cache between here and the disk.
      'Cache-Control': 'no-store',
    },
  });
}
