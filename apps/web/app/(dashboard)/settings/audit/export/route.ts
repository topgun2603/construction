import type { NextRequest } from 'next/server';
import { API_URL } from '@/lib/api';
import { currentAccessToken } from '@/lib/session';

const FILTER_KEYS = ['from', 'to', 'actor_id', 'entity', 'entity_id', 'action'];

/**
 * Hands the filtered audit log to the browser as a file.
 *
 * A route handler rather than a link straight at the API, for the same reason as the console's
 * tenant export: the session token is in an httpOnly cookie the browser will not attach to a
 * cross-origin request, and making it readable by a script so a download could carry it would undo
 * the reason it is httpOnly. The API checks `audit.view`; this only relays.
 */
export async function GET(request: NextRequest): Promise<Response> {
  const token = await currentAccessToken();
  if (!token) return new Response('Sign in again to export.', { status: 401 });

  const query = new URLSearchParams();
  for (const key of FILTER_KEYS) {
    const value = request.nextUrl.searchParams.get(key);
    if (value) query.set(key, value);
  }

  const upstream = await fetch(`${API_URL}/audit/export?${query.toString()}`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: 'no-store',
  });
  if (!upstream.ok) {
    const body = (await upstream.json().catch(() => null)) as { message?: string } | null;
    return new Response(body?.message ?? 'Export failed.', { status: upstream.status });
  }

  const stamp = new Date().toISOString().slice(0, 10);
  return new Response(upstream.body, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="audit-log-${stamp}.csv"`,
      // A company's whole history of who changed what. No cache between here and the disk.
      'Cache-Control': 'no-store',
    },
  });
}
