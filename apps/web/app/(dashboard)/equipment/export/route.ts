import type { NextRequest } from 'next/server';
import { API_URL } from '@/lib/api';
import { currentAccessToken } from '@/lib/session';

const FILTER_KEYS = ['kind', 'project_id', 'equipment_id', 'from', 'to'];

/**
 * An equipment register or report as a CSV download. Relayed through a route handler for the same
 * reason as the safety export: the session token lives in an httpOnly cookie a cross-origin download
 * would not carry. The API checks `equipment.view`; this only passes the file through.
 */
export async function GET(request: NextRequest): Promise<Response> {
  const token = await currentAccessToken();
  if (!token) return new Response('Sign in again to export.', { status: 401 });

  const query = new URLSearchParams();
  for (const key of FILTER_KEYS) {
    const value = request.nextUrl.searchParams.get(key);
    if (value) query.set(key, value);
  }

  const upstream = await fetch(`${API_URL}/equipment/export?${query.toString()}`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: 'no-store',
  });
  if (!upstream.ok) {
    const body = (await upstream.json().catch(() => null)) as { message?: string } | null;
    return new Response(body?.message ?? 'Export failed.', { status: upstream.status });
  }

  const stamp = new Date().toISOString().slice(0, 10);
  const kind = (query.get('kind') ?? 'equipment').replace(/[^a-z_]/g, '');
  return new Response(upstream.body, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="equipment-${kind}-${stamp}.csv"`,
      'Cache-Control': 'no-store',
    },
  });
}
