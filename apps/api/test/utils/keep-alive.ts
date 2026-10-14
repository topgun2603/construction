import { Agent } from 'node:http';
import type { AddressInfo } from 'node:net';
import request from 'supertest';
import type { TestApp } from './test-app';

/**
 * Points `test.http()` at one listening server over one pool of kept-alive connections.
 *
 * supertest's default — `request(app.getHttpServer())` — listens on a fresh ephemeral port and opens
 * a fresh connection for every request. A suite of a few hundred requests then leaves a few hundred
 * sockets in TIME_WAIT, and on a machine running several suites at once the ephemeral range runs out
 * and requests fail with `connect ETIMEDOUT` for reasons that have nothing to do with the code under
 * test. Reusing a handful of connections makes the suite's footprint constant.
 */
export async function useKeepAlive(test: TestApp): Promise<() => Promise<void>> {
  const server = test.app.getHttpServer() as import('node:http').Server;
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  const base = `http://127.0.0.1:${port}`;
  const agent = new Agent({ keepAlive: true, maxSockets: 8 });

  const methods = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options'] as const;
  const client = Object.fromEntries(
    methods.map((method) => [method, (path: string) => request(base)[method](path).agent(agent)]),
  );
  test.http = () => client as unknown as request.Agent;

  return async () => {
    agent.destroy();
  };
}
