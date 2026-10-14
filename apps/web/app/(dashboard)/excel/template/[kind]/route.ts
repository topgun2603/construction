import { API_URL } from '@/lib/api';
import { currentAccessToken } from '@/lib/session';

/**
 * An import template (.xlsx), relayed from the API — which fills its dropdowns with the company's
 * own sites, contractors, suppliers and materials, so it needs the person's session.
 */
export async function GET(_request: Request, context: { params: Promise<{ kind: string }> }): Promise<Response> {
  const { kind } = await context.params;
  if (!/^[a-z_]{1,40}$/.test(kind)) return new Response('Unknown import.', { status: 404 });
  const token = await currentAccessToken();
  if (!token) return new Response('Sign in again to download the template.', { status: 401 });

  const upstream = await fetch(`${API_URL}/imports/${kind}/template`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: 'no-store',
  });
  if (!upstream.ok) {
    const body = (await upstream.json().catch(() => null)) as { message?: string } | null;
    return new Response(body?.message ?? 'Could not make the template.', { status: upstream.status });
  }
  return new Response(upstream.body, {
    headers: {
      'Content-Type': upstream.headers.get('content-type') ?? 'application/octet-stream',
      'Content-Disposition': upstream.headers.get('content-disposition') ?? `attachment; filename="${kind}-template.xlsx"`,
      'Cache-Control': 'no-store',
    },
  });
}
