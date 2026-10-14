import type { NextRequest } from 'next/server';
import { cookies } from 'next/headers';
import { API_URL } from '@/lib/api';
import { LANGUAGE_COOKIE } from '@/lib/i18n';
import { currentAccessToken } from '@/lib/session';

/**
 * Any table as an Excel (or CSV) download: `/excel/export/<kind>?<the screen's filters>`.
 *
 * A route handler for the reason every export here is one: the session token is in an httpOnly
 * cookie a plain download link would not carry to the API. The API checks the table's own
 * permission and applies the person's site scoping; this only relays — adding the interface
 * language, so an Arabic reader's sheet opens right to left.
 */
export async function GET(request: NextRequest, context: { params: Promise<{ kind: string }> }): Promise<Response> {
  const { kind } = await context.params;
  if (!/^[a-z_]{1,40}$/.test(kind)) return new Response('Unknown export.', { status: 404 });
  const token = await currentAccessToken();
  if (!token) return new Response('Sign in again to export.', { status: 401 });

  const query = new URLSearchParams(request.nextUrl.searchParams);
  const language = (await cookies()).get(LANGUAGE_COOKIE)?.value;
  if (language && /^[a-z]{2}$/.test(language)) query.set('lang', language);

  const upstream = await fetch(`${API_URL}/exports/${kind}?${query.toString()}`, {
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
      'Content-Disposition': upstream.headers.get('content-disposition') ?? `attachment; filename="${kind}.xlsx"`,
      // Wages, rates and phone numbers: no cache between here and the disk.
      'Cache-Control': 'no-store',
    },
  });
}
