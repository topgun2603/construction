import { json, urlencoded, type Express, type Request } from 'express';
import type { INestApplication, NestApplicationOptions } from '@nestjs/common';
import { env } from './config/env';

/**
 * Everything the HTTP layer needs, in one place used by both entry points.
 *
 * It exists because there are two: `main.ts` for the real server and `test/utils/test-app.ts` for the
 * e2e suite. When the raw-body capture was wired only into `main.ts`, the Razorpay webhook rejected
 * every correctly signed request under test — the endpoint failed closed, which is right, but the
 * suite was testing an app configured differently from the one that ships. Anything that changes how
 * requests are read belongs here.
 */

/**
 * Nest's own body parser is turned off so ours is the only one.
 *
 * Express's `json()` skips a request whose body is already parsed, so a second parser added after
 * Nest's would never run its `verify` hook — the raw bytes would be gone by then and the signature
 * check would have nothing to check against.
 */
export const APP_OPTIONS: NestApplicationOptions = { bodyParser: false };

export function configureApp(app: INestApplication): void {
  app.setGlobalPrefix('v1');

  /*
   * Which proxy to believe about the client's address (TRUST_PROXY; see env.ts). Off by default, so
   * a local run reads the socket. Behind Caddy it is 1: Caddy replaces whatever X-Forwarded-For the
   * client sent with the address it saw, and Express takes that one entry. Set here, in the shared
   * setup, because the IP allow-list depends on it and the e2e suite must read addresses the way
   * the real server does.
   */
  (app.getHttpAdapter().getInstance() as Express).set('trust proxy', env().TRUST_PROXY);

  /*
   * Keep the raw request bytes on `req.rawBody` for webhook signature verification.
   *
   * Razorpay signs an HMAC over exactly what it sent. Verifying against a re-serialised object cannot
   * work reliably: `JSON.parse` then `JSON.stringify` may reorder keys and normalise whitespace, and
   * the signature then fails for reasons indistinguishable from a forgery.
   */
  /*
   * A spreadsheet import carries its file as base64 in JSON: 5 MB of workbook is about 6.7 MB on the
   * wire. Only these routes take that much — registered first, because the parser that reads a body
   * marks it read and the general 2 MB one below then leaves it alone. The import itself refuses a
   * decoded file over 5 MB with a message that says so.
   */
  app.use('/v1/imports', json({ limit: '8mb' }));

  app.use(
    json({
      limit: '2mb',
      // SCIM clients (Entra ID, Okta) send `application/scim+json`, which is JSON by another name.
      type: ['application/json', 'application/scim+json'],
      verify: (req, _res, buffer) => {
        if (buffer.length > 0) (req as Request & { rawBody?: Buffer }).rawBody = Buffer.from(buffer);
      },
    }),
  );

  /*
   * A SAML identity provider answers with an auto-submitted HTML form (HTTP-POST binding), so the
   * ACS endpoint alone reads form bodies. Scoped to that path: nothing else in the API takes forms,
   * and accepting them everywhere would widen what a cross-site form post could reach.
   */
  app.use('/v1/auth/sso/saml', urlencoded({ extended: false, limit: '2mb' }));

  configureJsonSerialisation(app.getHttpAdapter().getInstance() as Express);
}

/**
 * Money is `bigint` paise end to end (spec §17), and `JSON.stringify` throws on a bigint rather than
 * guessing. Serialising it as a decimal *string* keeps full precision on the wire; a JSON number
 * would silently lose paise above 2^53 and invites float arithmetic on the client.
 */
function configureJsonSerialisation(express: Express): void {
  express.set('json replacer', (_key: string, value: unknown) =>
    typeof value === 'bigint' ? value.toString() : value,
  );
}
