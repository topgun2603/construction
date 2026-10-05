import { createHmac } from 'node:crypto';
import { verifyStripeSignature } from './stripe.service';

describe('verifyStripeSignature', () => {
  const secret = 'whsec_test_secret';
  const body = Buffer.from('{"id":"evt_1","type":"checkout.session.completed"}');
  const now = 1_790_000_000_000;
  const t = Math.floor(now / 1000);
  const sign = (timestamp: number, payload = body, key = secret) =>
    createHmac('sha256', key).update(`${timestamp}.`).update(payload).digest('hex');

  it('accepts a correctly signed, fresh event', () => {
    expect(verifyStripeSignature(body, `t=${t},v1=${sign(t)}`, secret, now)).toBe(true);
  });

  it('accepts it among several signatures, as during a secret rotation', () => {
    expect(verifyStripeSignature(body, `t=${t},v1=deadbeef,v1=${sign(t)}`, secret, now)).toBe(true);
  });

  it('refuses a tampered body, a wrong secret, or a missing signature', () => {
    expect(verifyStripeSignature(Buffer.from('{}'), `t=${t},v1=${sign(t)}`, secret, now)).toBe(
      false,
    );
    expect(verifyStripeSignature(body, `t=${t},v1=${sign(t, body, 'other')}`, secret, now)).toBe(
      false,
    );
    expect(verifyStripeSignature(body, `t=${t}`, secret, now)).toBe(false);
  });

  it('refuses a replay older than five minutes', () => {
    const old = t - 301;
    expect(verifyStripeSignature(body, `t=${old},v1=${sign(old)}`, secret, now)).toBe(false);
  });
});
