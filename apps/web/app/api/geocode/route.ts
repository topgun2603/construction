import { NextResponse } from 'next/server';
import { ApiRequestError } from '@/lib/api';
import { serverFetch } from '@/lib/server-api';

/**
 * The location picker's search, proxied to the API.
 *
 * A route handler rather than a server action: the search box fires per submit and wants a plain
 * JSON reply, and a server action would re-render the page around it.
 *
 * `onUnauthenticated: 'throw'` so a stale session comes back as JSON the picker can report, rather
 * than a redirect the browser's `fetch` would follow and then fail to parse as JSON.
 */
export async function GET(request: Request): Promise<NextResponse> {
  const query = new URL(request.url).searchParams.get('q') ?? '';
  if (query.trim().length < 3) return NextResponse.json({ results: [] });

  try {
    const body = await serverFetch<{ results: unknown[] }>(
      `/geocode?q=${encodeURIComponent(query.trim())}`,
      { onUnauthenticated: 'throw' },
    );
    return NextResponse.json(body);
  } catch (error) {
    const status = error instanceof ApiRequestError ? error.status : 502;
    // An empty list, not an error shape: the picker degrades to dropping a pin, which is the
    // interaction that works for a plot with no address anyway.
    return NextResponse.json({ results: [] }, { status: status === 401 ? 401 : 200 });
  }
}
