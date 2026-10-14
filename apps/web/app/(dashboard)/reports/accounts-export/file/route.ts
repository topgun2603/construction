import type { NextRequest } from 'next/server';
import { API_URL } from '@/lib/api';
import { currentAccessToken } from '@/lib/session';

const UUID = /^[0-9a-f-]{36}$/i;

/**
 * One file of an accounting export: `?batch=…&file=…`.
 *
 * Relayed for the same reason as the other downloads: the session token is in an httpOnly cookie a
 * cross-origin download would not carry. The API checks `accounting.export`, names the file, and
 * hands back exactly what the batch wrote — not a fresh render.
 */
export async function GET(request: NextRequest): Promise<Response> {
  const token = await currentAccessToken();
  if (!token) return new Response('Sign in again to download.', { status: 401 });

  const batch = request.nextUrl.searchParams.get('batch') ?? '';
  const file = request.nextUrl.searchParams.get('file') ?? '';
  if (!UUID.test(batch) || !UUID.test(file)) return new Response('Which file?', { status: 400 });

  const upstream = await fetch(`${API_URL}/accounting/exports/${batch}/files/${file}`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: 'no-store',
  });
  if (!upstream.ok) {
    const body = (await upstream.json().catch(() => null)) as { message?: string } | null;
    return new Response(body?.message ?? 'Download failed.', { status: upstream.status });
  }
  return new Response(upstream.body, {
    headers: {
      'Content-Type': upstream.headers.get('content-type') ?? 'application/octet-stream',
      'Content-Disposition': upstream.headers.get('content-disposition') ?? 'attachment; filename="export"',
      'Cache-Control': 'no-store',
    },
  });
}
