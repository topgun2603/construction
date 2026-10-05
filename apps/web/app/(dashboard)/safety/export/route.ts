import type { NextRequest } from 'next/server';
import { API_URL } from '@/lib/api';
import { currentAccessToken } from '@/lib/session';

const FILTER_KEYS = ['kind', 'project_id', 'from', 'to'];

/**
 * A safety register as a CSV download. Relayed through a route handler for the same reason as the
 * purchase-order export: the session token lives in an httpOnly cookie a cross-origin download would
 * not carry. The API checks `safety.view`; this only passes the file through.
 */
export async function GET(request: NextRequest): Promise<Response> {
  const token = await currentAccessToken();
  if (!token) return new Response('Sign in again to export.', { status: 401 });

  const query = new URLSearchParams();
  for (const key of FILTER_KEYS) {
    const value = request.nextUrl.searchParams.get(key);
    if (value) query.set(key, value);
  }

  const upstream = await fetch(`${API_URL}/safety/export?${query.toString()}`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: 'no-store',
  });
  if (!upstream.ok) {
    const body = (await upstream.json().catch(() => null)) as { message?: string } | null;
    return new Response(body?.message ?? 'Export failed.', { status: upstream.status });
  }

  const stamp = new Date().toISOString().slice(0, 10);
  const kind = (query.get('kind') ?? 'safety').replace(/[^a-z_]/g, '');
  return new Response(upstream.body, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="safety-${kind}-${stamp}.csv"`,
      'Cache-Control': 'no-store',
    },
  });
}
