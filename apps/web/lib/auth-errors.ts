/**
 * Firebase's error codes for email sign-in and two-factor, as sentences a person can act on.
 *
 * Firebase's own messages read "Firebase: Error (auth/invalid-credential)." — accurate, and no use
 * to somebody standing at a site office. These are English; callers pass them through `t()`, and
 * anything not listed here (an API refusal, say) is shown as it came.
 */
const MESSAGES: Record<string, string> = {
  // Newer projects return `invalid-credential` for both a wrong password and an unknown address,
  // so that the error cannot be used to discover who has an account. The sentence covers both.
  'auth/invalid-credential': 'That email and password do not match.',
  'auth/invalid-login-credentials': 'That email and password do not match.',
  'auth/wrong-password': 'That email and password do not match.',
  'auth/user-not-found':
    'No account uses that email. Set up email sign-in from Your account first.',
  'auth/invalid-email': 'Enter a valid email address.',
  'auth/missing-password': 'Enter your password.',
  'auth/weak-password': 'That password is too weak. Choose a longer one.',
  'auth/too-many-requests': 'Too many attempts. Wait a few minutes and try again.',
  'auth/invalid-verification-code': 'That code is not right. Enter the current code from the app.',
  'auth/missing-code': 'Enter the 6-digit code from your authenticator app.',
  'auth/code-expired': 'That code has expired. Enter the current one from the app.',
  'auth/requires-recent-login': 'For your security, sign in with email again, then try once more.',
  'auth/unverified-email': 'Verify your email address before turning on two-factor.',
  'auth/user-disabled': 'This sign-in has been turned off. Ask your company owner.',
  'auth/network-request-failed': 'No connection. Check your internet and try again.',
  'auth/operation-not-allowed': 'Email sign-in is not turned on for this deployment.',
  'auth/unsupported-first-factor':
    'Two-factor needs an email and password sign-in. Sign in with email first.',
};

export function authErrorCode(cause: unknown): string | undefined {
  const code = (cause as { code?: unknown } | null)?.code;
  return typeof code === 'string' ? code : undefined;
}

export function authErrorMessage(cause: unknown): string {
  const code = authErrorCode(cause);
  if (code && MESSAGES[code]) return MESSAGES[code];
  if (cause instanceof Error && cause.message) return cause.message;
  return 'Something went wrong';
}
