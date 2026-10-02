import { NextResponse, type NextRequest } from 'next/server';
import type { AskResult } from '@sitebook/shared';
import { ApiRequestError } from '@/lib/api';
import { serverFetch } from '@/lib/server-api';

/**
 * Backs "ask" in the command palette.
 *
 * A route handler rather than a server action, like the search beside it: this is a fetch from a
 * dialog, and an action would serialise behind the router and make the whole palette feel stuck
 * while an answer is being worked out.
 *
 * The session cookie is read here, so no API token reaches the browser — and the API computes
 * every figure under that session's own project scope, which is what stops a supervisor asking
 * about a site they are not on.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const body = (await request.json()) as { question?: string };
  const question = body.question?.trim() ?? '';
  if (question.length < 3) {
    return NextResponse.json({ error: 'Ask a longer question.' }, { status: 400 });
  }

  try {
    const answer = await serverFetch<AskResult>('/ask', { method: 'POST', body: { question } });
    return NextResponse.json(answer);
  } catch (error) {
    if (error instanceof ApiRequestError) {
      // The API's own words: "not configured on this deployment", "that is not something I can
      // look up yet". Both are more useful than a generic failure.
      return NextResponse.json({ error: error.body.message }, { status: error.status });
    }
    return NextResponse.json({ error: 'Could not answer that just now.' }, { status: 500 });
  }
}
