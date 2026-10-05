import type { NextRequest } from 'next/server';
import { API_URL } from '@/lib/api';
import { currentAccessToken } from '@/lib/session';

/**
 * The BOQ, or its abstract, as an Excel or CSV download: `?project_id=…&format=xlsx|csv&report=items|abstract`.
 *
 * Relayed for the same reason as the purchase-order export: the session token is in an httpOnly
 * cookie a cross-origin download would not carry. The API checks `boq.view` and names the file.
 */
export async function GET(request: NextRequest): Promise<Response> {
  const token = await currentAccessToken();
  if (!token) return new Response('Sign in again to export.', { status: 401 });

  const params = request.nextUrl.searchParams;
  const projectId = params.get('project_id') ?? '';
  if (!/^[0-9a-f-]{36}$/i.test(projectId)) return new Response('Which site?', { status: 400 });
  const query = new URLSearchParams({
    format: params.get('format') === 'xlsx' ? 'xlsx' : 'csv',
    report: params.get('report') === 'abstract' ? 'abstract' : 'items',
  });

  const upstream = await fetch(`${API_URL}/projects/${projectId}/boq/export?${query.toString()}`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: 'no-store',
  });
  if (!upstream.ok) {
    const body = (await upstream.json().catch(() => null)) as { message?: string } | null;
    return new Response(body?.message ?? 'Export failed.', { status: upstream.status });
  }
  return new Response(upstream.body, {
    headers: {
      'Content-Type': upstream.headers.get('content-type') ?? 'application/octet-stream',
      'Content-Disposition': upstream.headers.get('content-disposition') ?? 'attachment; filename="boq"',
      'Cache-Control': 'no-store',
    },
  });
}
