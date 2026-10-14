import { headers } from 'next/headers';

/**
 * Pass the browser's address on to the API when this server calls it on the browser's behalf.
 *
 * Dashboard pages and server actions run here, so to the API every one of their requests comes
 * from this server. A company's IP allow-list has to see the person instead, and so does its audit
 * log. With WEB_CLIENT_IP_SECRET set (the same value on the API), the address travels in
 * `X-Buildr-Client-Ip` beside the secret, which is what makes the API believe it.
 *
 * The address is the *last* X-Forwarded-For entry — the one the proxy directly in front of this
 * server (Caddy) wrote. Anything before it was written by the client and proves nothing. Without a
 * proxy in front (local development) there is no header and nothing is forwarded.
 *
 * Server-only: reads the incoming request's headers and a secret that must never reach a bundle.
 */
export async function clientIpHeaders(): Promise<Record<string, string>> {
  const secret = process.env['WEB_CLIENT_IP_SECRET'];
  if (!secret) return {};
  let incoming: Headers;
  try {
    incoming = await headers();
  } catch {
    // Outside a request (a build step): there is no browser to speak for.
    return {};
  }
  const ip = lastForwarded(incoming.get('x-forwarded-for')) ?? incoming.get('x-real-ip')?.trim();
  return ip ? { 'X-Buildr-Client-Ip': ip, 'X-Buildr-Proxy-Secret': secret } : {};
}

/** The same, for a route handler that has the request object in hand. */
export function clientIpHeadersOf(request: { headers: Headers }): Record<string, string> {
  const secret = process.env['WEB_CLIENT_IP_SECRET'];
  if (!secret) return {};
  const ip = lastForwarded(request.headers.get('x-forwarded-for')) ?? request.headers.get('x-real-ip')?.trim();
  return ip ? { 'X-Buildr-Client-Ip': ip, 'X-Buildr-Proxy-Secret': secret } : {};
}

export function lastForwarded(header: string | null): string | null {
  if (!header) return null;
  const parts = header
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
  return parts.length > 0 ? (parts[parts.length - 1] as string) : null;
}
