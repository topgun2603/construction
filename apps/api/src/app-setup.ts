import { json, type Express, type Request } from 'express';
import type { INestApplication, NestApplicationOptions } from '@nestjs/common';

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
   * Keep the raw request bytes on `req.rawBody` for webhook signature verification.
   *
   * Razorpay signs an HMAC over exactly what it sent. Verifying against a re-serialised object cannot
   * work reliably: `JSON.parse` then `JSON.stringify` may reorder keys and normalise whitespace, and
   * the signature then fails for reasons indistinguishable from a forgery.
   */
  app.use(
    json({
      limit: '2mb',
      verify: (req, _res, buffer) => {
        if (buffer.length > 0) (req as Request & { rawBody?: Buffer }).rawBody = Buffer.from(buffer);
      },
    }),
  );

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
