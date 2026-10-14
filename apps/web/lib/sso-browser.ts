/**
 * The browser half of "Sign in with SSO".
 *
 * The login page makes a random binding, keeps it in session storage (this tab only, gone when it
 * closes) and sends it to the API at the start; the callback page sends it again with the ticket.
 * A sign-in link that ends up in another browser — sent to a victim to sign them in as somebody
 * else — therefore cannot be finished there.
 */
const BINDING_KEY = 'sb_sso_binding';

export function newSsoBinding(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  const binding = btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  try {
    sessionStorage.setItem(BINDING_KEY, binding);
  } catch {
    // Storage blocked: the finish will fail with a clear message rather than silently succeed.
  }
  return binding;
}

/** The binding for this tab's sign-in, read once — a second attempt starts over. */
export function takeSsoBinding(): string | null {
  try {
    const binding = sessionStorage.getItem(BINDING_KEY);
    sessionStorage.removeItem(BINDING_KEY);
    return binding;
  } catch {
    return null;
  }
}

/** `#ticket=…` or `#error=…` from the callback URL. */
export function readSsoFragment(hash: string): { ticket: string | null; error: string | null } {
  const params = new URLSearchParams(hash.replace(/^#/, ''));
  return { ticket: params.get('ticket'), error: params.get('error') };
}
