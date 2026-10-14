import type { AddressInfo } from 'node:net';
import request from 'supertest';
import { resetEnvCache } from '../../src/config/env';
import { MockMicrosoft } from './m365-mocks';
import type { TestApp } from './test-app';

/**
 * The deployment settings the Microsoft 365 suites need, pointed at a local `MockMicrosoft`.
 *
 * Unlike `sso-env`, these cannot be set at import: the stand-in's port is only known once it is
 * listening. So the suite calls this in `beforeAll` *before* `createTestApp()`, and the env cache is
 * dropped — every service reads `env()` when the app constructs it, after this. Restored afterwards
 * so the next file sees what it always did (no WEB_BASE_URL, Microsoft 365 not set up).
 */
const KEYS = [
  'MS_GRAPH_CLIENT_ID',
  'MS_GRAPH_CLIENT_SECRET',
  'MS_GRAPH_REDIRECT_URI',
  'MS_GRAPH_LOGIN_URL',
  'MS_GRAPH_API_URL',
  'M365_ENCRYPTION_KEY',
  'WEB_BASE_URL',
] as const;
const previous = new Map<string, string | undefined>(KEYS.map((key) => [key, process.env[key]]));

export const M365_TEST_WEB = 'https://app.buildr.test';
export const M365_TEST_REDIRECT = `${M365_TEST_WEB}/settings/integrations/microsoft/callback`;

export async function startM365Env(): Promise<MockMicrosoft> {
  const microsoft = await new MockMicrosoft().start();
  microsoft.redirectUri = M365_TEST_REDIRECT;
  process.env['MS_GRAPH_CLIENT_ID'] = microsoft.clientId;
  process.env['MS_GRAPH_CLIENT_SECRET'] = microsoft.clientSecret;
  process.env['MS_GRAPH_REDIRECT_URI'] = M365_TEST_REDIRECT;
  process.env['MS_GRAPH_LOGIN_URL'] = microsoft.baseUrl;
  process.env['MS_GRAPH_API_URL'] = `${microsoft.baseUrl}/v1.0`;
  process.env['M365_ENCRYPTION_KEY'] = Buffer.alloc(32, 3).toString('base64');
  process.env['WEB_BASE_URL'] = M365_TEST_WEB;
  resetEnvCache();
  return microsoft;
}

/**
 * One listening socket for the whole file, on IPv6 loopback, and every request (the shared
 * onboarding helpers included) sent to it. supertest otherwise listens and closes a server per
 * request on 127.0.0.1, and several suites running at once on one machine can run that address's
 * ephemeral ports dry — which shows up as `connect ETIMEDOUT 127.0.0.1` in whatever test is unlucky.
 */
export async function listenOnIpv6(test: TestApp): Promise<void> {
  // createTestApp now listens once for every suite (on 127.0.0.1); reuse that socket rather than
  // binding a second time, which Nest refuses.
  const server = test.app.getHttpServer() as import('node:http').Server;
  if (!server.listening) await test.app.listen(0, '::1');
  const address = server.address() as AddressInfo;
  const host = address.family === 'IPv6' ? `[${address.address}]` : address.address;
  const base = `http://${host}:${address.port}`;
  test.http = () => request(base);
}

export function restoreM365Env(): void {
  for (const [key, value] of previous) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  resetEnvCache();
}
