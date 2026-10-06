'use server';

import type {
  RfiExternalAnswerInput,
  RfiExternalPresignInput,
  SubmittalExternalReviewInput,
} from '@sitebook/shared';
import { apiFetch, ApiRequestError } from './api';
import type { ActionResult } from './server-api';
import type { ResponderView } from './rfi-types';

/**
 * The outside responder's writes — a designer answering an RFI, a consultant reviewing a submittal
 * (roadmap Phase 2, module 9). No session is sent, ever: the only credential is the signed token in
 * the body, so a builder who happens to be signed in on the same browser cannot lend the page their
 * account by accident.
 */

async function publicCall<T>(path: string, body: unknown): Promise<ActionResult<T>> {
  try {
    return { ok: true, data: await apiFetch<T>(path, { method: 'POST', body }) };
  } catch (error) {
    if (error instanceof ApiRequestError) {
      // A refused link reads the same whatever the reason, as on the page itself.
      return { ok: false, error: error.status === 404 ? 'This link has stopped working' : error.message, code: error.code };
    }
    return { ok: false, error: 'Something went wrong. Try again.' };
  }
}

export async function presignResponderUpload(
  input: RfiExternalPresignInput,
): Promise<ActionResult<{ url: string; s3_key: string; headers: Record<string, string> }>> {
  return publicCall('/rfi-links/presign', input);
}

export async function answerRfiByLink(input: RfiExternalAnswerInput): Promise<ActionResult<ResponderView>> {
  return publicCall('/rfi-links/answer', input);
}

export async function reviewSubmittalByLink(input: SubmittalExternalReviewInput): Promise<ActionResult<ResponderView>> {
  return publicCall('/rfi-links/review', input);
}
