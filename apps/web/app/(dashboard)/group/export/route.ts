import type { NextRequest } from 'next/server';
import { API_URL } from '@/lib/api';
import { currentAccessToken } from '@/lib/session';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Hands the consolidated group report to the browser as a file.
 *
 * A route handler rather than a link at the API, like the audit export: the session token is in an
 * httpOnly cookie a cross-origin download would not carry. The API checks the group grant; this
 * only relays.
 */
export async function GET(request: NextRequest): Promise<Response> {
  const token = await currentAccessToken();
  if (!token) return new Response('Sign in again to export.', { status: 401 });

  const query = new URLSearchParams();
  for (const key of ['from', 'to']) {
    const value = request.nextUrl.searchParams.get(key);
    if (value && ISO_DATE.test(value)) query.set(key, value);
  }

  const upstream = await fetch(`${API_URL}/company-groups/current/report/export?${query.toString()}`, {
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
      'Content-Disposition': `attachment; filename="group-report-${stamp}.csv"`,
      'Cache-Control': 'no-store',
    },
  });
}
