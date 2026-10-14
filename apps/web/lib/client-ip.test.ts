import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/headers', () => ({ headers: async () => new Headers() }));

import { clientIpHeadersOf, lastForwarded } from './client-ip';

describe('passing the browser’s address to the API', () => {
  afterEach(() => {
    delete process.env['WEB_CLIENT_IP_SECRET'];
  });

  it('takes the entry the nearest proxy wrote, not one the client typed', () => {
    expect(lastForwarded('203.0.113.9')).toBe('203.0.113.9');
    expect(lastForwarded('10.0.0.1, 198.51.100.4')).toBe('198.51.100.4');
    expect(lastForwarded(' , ')).toBeNull();
    expect(lastForwarded(null)).toBeNull();
  });

  it('forwards nothing without the shared secret', () => {
    const request = { headers: new Headers({ 'x-forwarded-for': '198.51.100.4' }) };
    expect(clientIpHeadersOf(request)).toEqual({});
  });

  it('forwards the address beside the secret when configured', () => {
    process.env['WEB_CLIENT_IP_SECRET'] = 'x'.repeat(32);
    const request = { headers: new Headers({ 'x-forwarded-for': '1.2.3.4, 198.51.100.4' }) };
    expect(clientIpHeadersOf(request)).toEqual({
      'X-Buildr-Client-Ip': '198.51.100.4',
      'X-Buildr-Proxy-Secret': 'x'.repeat(32),
    });
    expect(clientIpHeadersOf({ headers: new Headers() })).toEqual({});
  });
});
