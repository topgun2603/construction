import { Injectable } from '@nestjs/common';
import { lookup as dnsLookup, type LookupAddress } from 'node:dns';
import { request as httpRequest, type IncomingMessage } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { isIP, type LookupFunction } from 'node:net';
import {
  WEBHOOK_MAX_RESPONSE_BYTES,
  WEBHOOK_TIMEOUT_MS,
  webhookAddressAllowed,
  webhookUrlProblem,
  type WebhookUrlProblem,
} from '@sitebook/shared';
import { env } from '../../config/env';

/** How much of a receiver's answer is kept in the delivery log. */
const SNIPPET_BYTES = 1024;

export interface SendResult {
  ok: boolean;
  /** Null when nothing came back: refused, timed out, or the address was not allowed. */
  statusCode: number | null;
  latencyMs: number;
  error: string | null;
  snippet: string | null;
}

/** A URL that may not receive webhooks, and why. */
export class WebhookTargetRefused extends Error {
  constructor(
    readonly problem: WebhookUrlProblem | 'unresolvable',
    readonly address?: string,
  ) {
    super(address ? `${problem} (${address})` : problem);
  }
}

/**
 * Sends one webhook, and is the one place that decides where a webhook may go (SSRF protection).
 *
 * The URL is judged three times, because each catches what the others cannot:
 *
 * 1. Its text (`webhookUrlProblem`): https only, no credentials, no IP literal or name that can only
 *    mean something inside a network.
 * 2. Every address its name resolves to, at registration *and at every send*. A name that pointed at
 *    a public address when it was registered can be re-pointed at 169.254.169.254 a minute later.
 * 3. The connection itself is pinned to an address that passed (2): the socket is opened through a
 *    `lookup` that hands back only the vetted address, so a second DNS answer between the check and
 *    the connect (DNS rebinding) is never used. TLS still verifies the certificate against the name.
 *
 * Redirects are not followed (a 3xx is a failed delivery), the answer is read up to 64 KB and then
 * dropped, and the whole exchange is cut off after ten seconds.
 */
@Injectable()
export class WebhookSender {
  /**
   * Plain http to this machine's loopback, for local development and the e2e suite. From
   * WEBHOOK_ALLOW_LOOPBACK (refused in production); a test flips it to check the refusals.
   */
  allowLoopback = env().WEBHOOK_ALLOW_LOOPBACK;

  /** Throws `WebhookTargetRefused` unless the URL and every address it resolves to may receive webhooks. */
  async assertDeliverable(url: string): Promise<void> {
    await this.resolveTarget(url);
  }

  async send(url: string, body: string, headers: Record<string, string>): Promise<SendResult> {
    const started = Date.now();
    let target: { url: URL; address: LookupAddress };
    try {
      target = await this.resolveTarget(url);
    } catch (error) {
      const message =
        error instanceof WebhookTargetRefused
          ? `Refused: ${error.message}`
          : `Could not resolve the address: ${(error as Error).message}`;
      return { ok: false, statusCode: null, latencyMs: Date.now() - started, error: message, snippet: null };
    }

    return new Promise<SendResult>((resolve) => {
      let settled = false;
      const finish = (result: Omit<SendResult, 'latencyMs'>) => {
        if (settled) return;
        settled = true;
        clearTimeout(deadline);
        resolve({ ...result, latencyMs: Date.now() - started });
      };

      // Only ever the address that passed the check — see (3) above.
      const pinned: LookupFunction = (_hostname, options, callback) => {
        if ((options as { all?: boolean }).all) {
          (callback as unknown as (err: null, addresses: LookupAddress[]) => void)(null, [target.address]);
        } else {
          callback(null, target.address.address, target.address.family);
        }
      };

      const send = target.url.protocol === 'https:' ? httpsRequest : httpRequest;
      const req = send(
        target.url,
        {
          method: 'POST',
          headers: { ...headers, 'Content-Length': String(Buffer.byteLength(body)) },
          lookup: pinned,
          // No keep-alive pool: every send is resolved and checked afresh.
          agent: false,
        },
        (res: IncomingMessage) => {
          const chunks: Buffer[] = [];
          let received = 0;
          res.on('data', (chunk: Buffer) => {
            received += chunk.length;
            if (received <= WEBHOOK_MAX_RESPONSE_BYTES) chunks.push(chunk);
            // Anything bigger is not an acknowledgement; stop reading rather than buffer it.
            else res.destroy();
          });
          const done = () => {
            const status = res.statusCode ?? 0;
            const snippet = Buffer.concat(chunks).subarray(0, SNIPPET_BYTES).toString('utf8');
            const ok = status >= 200 && status < 300;
            finish({
              ok,
              statusCode: status,
              error: ok ? null : status >= 300 && status < 400 ? 'Redirects are not followed' : `HTTP ${status}`,
              snippet: snippet || null,
            });
          };
          res.on('end', done);
          res.on('close', done);
          res.on('error', done);
        },
      );

      const deadline = setTimeout(() => {
        req.destroy(new Error('timed out'));
        finish({ ok: false, statusCode: null, error: `No answer within ${WEBHOOK_TIMEOUT_MS / 1000} seconds`, snippet: null });
      }, WEBHOOK_TIMEOUT_MS);

      req.on('error', (error) => {
        finish({ ok: false, statusCode: null, error: error.message.slice(0, 300), snippet: null });
      });
      req.end(body);
    });
  }

  private async resolveTarget(raw: string): Promise<{ url: URL; address: LookupAddress }> {
    const problem = webhookUrlProblem(raw, { allowLoopback: this.allowLoopback });
    if (problem) throw new WebhookTargetRefused(problem);

    const url = new URL(raw);
    const host = url.hostname.replace(/^\[|\]$/g, '');
    const family = isIP(host);
    const addresses: LookupAddress[] =
      family !== 0 ? [{ address: host, family }] : await lookupAll(host);
    if (addresses.length === 0) throw new WebhookTargetRefused('unresolvable');

    // Every address, not just the first: the connection could be made to any of them.
    for (const entry of addresses) {
      if (!webhookAddressAllowed(entry.address, { allowLoopback: this.allowLoopback })) {
        throw new WebhookTargetRefused('blocked_address', entry.address);
      }
    }
    return { url, address: addresses[0]! };
  }
}

function lookupAll(host: string): Promise<LookupAddress[]> {
  return new Promise((resolve, reject) => {
    dnsLookup(host, { all: true, verbatim: true }, (error, addresses) => {
      if (error) {
        if (error.code === 'ENOTFOUND' || error.code === 'ENODATA') resolve([]);
        else reject(error);
        return;
      }
      resolve(addresses);
    });
  });
}
