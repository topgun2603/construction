'use server';

import { revalidatePath } from 'next/cache';
import { cookies } from 'next/headers';
import type {
  SecurityIpPolicyInput,
  SecurityMfaPolicyInput,
  SecuritySessionPolicyInput,
  TokenPair,
} from '@sitebook/shared';
import { ApiRequestError } from './api';
import { runAction, serverFetch, type ActionResult } from './server-api';
import { ACCESS_COOKIE, REFRESH_COOKIE } from './session';
import type { MfaConfirmed, MfaEnrolment, SecuritySettings } from './security-types';

/**
 * Two-factor, session timeouts and IP allow-lists: the owner's rules (Settings → Security), each
 * person's own authenticator and sessions (Your account), and the two-factor step after sign-in.
 * The API decides everything; these carry the form there and bring its answer back.
 */

/**
 * Swaps the session cookies for the pair the API just issued — after a second factor is shown, the
 * same session continues with a token that says so. Same cookie settings as `/api/session`.
 */
async function storeTokens(tokens: TokenPair): Promise<void> {
  const jar = await cookies();
  const secure = process.env.NODE_ENV === 'production';
  jar.set(ACCESS_COOKIE, tokens.access_token, { httpOnly: true, sameSite: 'lax', secure, path: '/', maxAge: tokens.expires_in });
  jar.set(REFRESH_COOKIE, tokens.refresh_token, {
    httpOnly: true,
    sameSite: 'lax',
    secure,
    path: '/',
    maxAge: 30 * 24 * 60 * 60,
  });
}

// --- the company's rules ---------------------------------------------------------------------------

async function saveRule(path: string, body: unknown): Promise<ActionResult<SecuritySettings>> {
  const result = await runAction(() => serverFetch<SecuritySettings>(path, { method: 'PUT', body }));
  if (result.ok) revalidatePath('/settings/security');
  return result;
}

export async function saveMfaPolicy(input: SecurityMfaPolicyInput): Promise<ActionResult<SecuritySettings>> {
  return saveRule('/security/mfa-policy', input);
}

export async function saveSessionPolicy(input: SecuritySessionPolicyInput): Promise<ActionResult<SecuritySettings>> {
  return saveRule('/security/session-policy', input);
}

/** Answers `code: CONFLICT` with `details.reason: 'self_lockout'` when the list would shut you out. */
export async function saveIpPolicy(
  input: SecurityIpPolicyInput,
): Promise<ActionResult<SecuritySettings> & { lockout?: boolean }> {
  let lockout = false;
  const result = await runAction(async () => {
    try {
      return await serverFetch<SecuritySettings>('/security/ip-policy', { method: 'PUT', body: input });
    } catch (error) {
      const details = error instanceof ApiRequestError ? (error.body.details as { reason?: string } | undefined) : undefined;
      lockout = details?.reason === 'self_lockout';
      throw error;
    }
  });
  if (result.ok) revalidatePath('/settings/security');
  return { ...result, lockout };
}

export async function signOutMember(userId: string): Promise<ActionResult<{ ended: number }>> {
  const result = await runAction(() =>
    serverFetch<{ ended: number }>(`/security/members/${userId}/sign-out`, { method: 'POST' }),
  );
  if (result.ok) revalidatePath('/settings/security');
  return result;
}

// --- my authenticator -------------------------------------------------------------------------------

export async function startMfaEnrolment(): Promise<ActionResult<MfaEnrolment>> {
  return runAction(() => serverFetch<MfaEnrolment>('/auth/mfa/enrol', { method: 'POST' }));
}

/** Confirms the authenticator; the session continues with two-factor shown. */
export async function confirmMfaEnrolment(code: string): Promise<ActionResult<{ recovery_codes: string[] }>> {
  const result = await runAction(() =>
    serverFetch<MfaConfirmed>('/auth/mfa/enrol/confirm', { method: 'POST', body: { code } }),
  );
  if (!result.ok || !result.data) return { ok: false, error: result.error, code: result.code };
  if (result.data.tokens) await storeTokens(result.data.tokens);
  revalidatePath('/account');
  return { ok: true, data: { recovery_codes: result.data.recovery_codes } };
}

/** The two-factor step after sign-in: an authenticator code or a recovery code. */
export async function verifyMfa(code: string): Promise<ActionResult<{ recovery_codes_left: number }>> {
  const result = await runAction(() =>
    serverFetch<{ method: string; recovery_codes_left: number; tokens: TokenPair }>('/auth/mfa/verify', {
      method: 'POST',
      body: { code },
    }),
  );
  if (!result.ok || !result.data) return { ok: false, error: result.error, code: result.code };
  await storeTokens(result.data.tokens);
  return { ok: true, data: { recovery_codes_left: result.data.recovery_codes_left } };
}

export async function regenerateRecoveryCodes(): Promise<ActionResult<{ recovery_codes: string[] }>> {
  return runAction(() => serverFetch<{ recovery_codes: string[] }>('/auth/mfa/recovery-codes', { method: 'POST' }));
}

export async function removeMfa(): Promise<ActionResult<void>> {
  const result = await runAction(() => serverFetch<void>('/auth/mfa', { method: 'DELETE' }));
  if (result.ok) revalidatePath('/account');
  return result;
}

// --- my sessions ------------------------------------------------------------------------------------

export async function endSession(id: string): Promise<ActionResult<void>> {
  const result = await runAction(() => serverFetch<void>(`/auth/sessions/${id}`, { method: 'DELETE' }));
  if (result.ok) revalidatePath('/account');
  return result;
}

export async function signOutOtherSessions(): Promise<ActionResult<{ ended: number }>> {
  const result = await runAction(() =>
    serverFetch<{ ended: number }>('/auth/sessions/sign-out-others', { method: 'POST' }),
  );
  if (result.ok) revalidatePath('/account');
  return result;
}
