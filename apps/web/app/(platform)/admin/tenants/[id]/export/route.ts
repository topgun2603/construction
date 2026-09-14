import { platformFetch } from '@/lib/platform-session';

/**
 * Streams a tenant's export to the operator's machine as a file.
 *
 * A route handler rather than a link straight at the API, because the console's token lives in an
 * httpOnly cookie that the browser will not attach to a cross-origin request — and making it
 * readable by a script on the page, so that a download could carry it, would hand the credential
 * that can suspend any account on the platform to anything running in the tab.
 *
 * So the server fetches it with the cookie it already holds and hands back the bytes.
 */
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const data = await platformFetch<Record<string, unknown>>(`/tenants/${id}/export`);

  const name =
    ((data['tenant'] as { name?: string } | undefined)?.name ?? id)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || id;
  const stamp = new Date().toISOString().slice(0, 10);

  return new Response(JSON.stringify(data, null, 2), {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="buildr-${name}-${stamp}.json"`,
      // A customer's entire account. Nothing between here and the operator's disk should keep a
      // copy of it.
      'Cache-Control': 'no-store',
    },
  });
}
