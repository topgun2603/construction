import type { NextRequest } from 'next/server';
import { QUALITY_EXPORT_KINDS, type QualityExportKind } from '@sitebook/shared';
import { API_URL } from '@/lib/api';
import { currentAccessToken } from '@/lib/session';

const FILTER_KEYS = ['project_id', 'from', 'to'];

/**
 * Hands a quality export (snags, inspections or tests) to the browser as a CSV file.
 *
 * A route handler rather than a link straight at the API, for the same reason as the audit log's
 * export: the session token is in an httpOnly cookie the browser will not attach to a cross-origin
 * request. The API checks `quality.view`; this only relays.
 */
export async function GET(request: NextRequest): Promise<Response> {
  const token = await currentAccessToken();
  if (!token) return new Response('Sign in again to export.', { status: 401 });

  const kind = request.nextUrl.searchParams.get('kind') ?? '';
  if (!(QUALITY_EXPORT_KINDS as readonly string[]).includes(kind)) {
    return new Response('Choose snags, inspections or tests to export.', { status: 400 });
  }

  const query = new URLSearchParams();
  for (const key of FILTER_KEYS) {
    const value = request.nextUrl.searchParams.get(key);
    if (value) query.set(key, value);
  }

  const upstream = await fetch(`${API_URL}/quality/export/${kind as QualityExportKind}?${query.toString()}`, {
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
      'Content-Disposition': `attachment; filename="quality-${kind}-${stamp}.csv"`,
      'Cache-Control': 'no-store',
    },
  });
}
