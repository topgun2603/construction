import { describe, expect, it } from 'vitest';
import { authErrorCode, authErrorMessage } from './auth-errors';

function firebaseError(code: string): Error & { code: string } {
  return Object.assign(new Error(`Firebase: Error (${code}).`), { code });
}

describe('authErrorMessage', () => {
  it('turns a wrong password into a sentence', () => {
    expect(authErrorMessage(firebaseError('auth/invalid-credential'))).toBe(
      'That email and password do not match.',
    );
    expect(authErrorMessage(firebaseError('auth/wrong-password'))).toBe(
      'That email and password do not match.',
    );
  });

  it('names a bad two-factor code', () => {
    expect(authErrorMessage(firebaseError('auth/invalid-verification-code'))).toMatch(/code/);
  });

  it('passes through anything it does not know, such as an API refusal', () => {
    expect(authErrorMessage(new Error('No account uses this email'))).toBe(
      'No account uses this email',
    );
    expect(authErrorMessage(firebaseError('auth/something-new'))).toBe(
      'Firebase: Error (auth/something-new).',
    );
  });

  it('survives a thrown non-error', () => {
    expect(authErrorMessage(null)).toBe('Something went wrong');
    expect(authErrorMessage('nope')).toBe('Something went wrong');
    expect(authErrorCode({ code: 42 })).toBeUndefined();
  });
});
