import { describe, expect, it } from 'vitest';
import {
  ipAllowed,
  ipCidrParse,
  ipFormat,
  ipInCidr,
  ipNormaliseCidr,
  ipParse,
  mfaBase32Decode,
  mfaBase32Encode,
  mfaFormatRecoveryCode,
  mfaHotp,
  mfaNormaliseRecoveryCode,
  mfaOtpauthUri,
  mfaTotp,
  mfaTotpStep,
  mfaTotpVerify,
  securityAbsoluteDeadline,
  securityIpApplies,
  securityMfaRequired,
  securitySessionVerdict,
} from './security';
import { securityIpPolicySchema, securitySessionPolicySchema, mfaConfirmSchema } from './schemas/security';

const ascii = (text: string) => new TextEncoder().encode(text);

describe('IP addresses', () => {
  it('parses IPv4 strictly', () => {
    expect(ipFormat(ipParse('203.0.113.7')!)).toBe('203.0.113.7');
    expect(ipParse('0.0.0.0')?.version).toBe(4);
    expect(ipParse('256.1.1.1')).toBeNull();
    expect(ipParse('1.2.3')).toBeNull();
    // Leading zeros mean octal to some parsers and decimal to others — refused, not guessed.
    expect(ipParse('010.0.0.1')).toBeNull();
    expect(ipParse('1.2.3.4.5')).toBeNull();
    expect(ipParse('')).toBeNull();
    expect(ipParse('example.com')).toBeNull();
  });

  it('parses IPv6 in every legal spelling and prints RFC 5952 form', () => {
    expect(ipFormat(ipParse('2001:0db8:0000:0000:0000:ff00:0042:8329')!)).toBe('2001:db8::ff00:42:8329');
    expect(ipFormat(ipParse('2001:DB8::1')!)).toBe('2001:db8::1');
    expect(ipFormat(ipParse('::1')!)).toBe('::1');
    expect(ipFormat(ipParse('::')!)).toBe('::');
    expect(ipFormat(ipParse('fe80::1%eth0')!)).toBe('fe80::1');
    expect(ipFormat(ipParse('[2001:db8::5]')!)).toBe('2001:db8::5');
    // One lone zero group is not compressed; the longer run wins.
    expect(ipFormat(ipParse('2001:db8:0:1:0:0:0:1')!)).toBe('2001:db8:0:1::1');
    expect(ipParse('2001:db8::1::2')).toBeNull();
    expect(ipParse('1:2:3:4:5:6:7:8:9')).toBeNull();
    expect(ipParse('1:2:3:4:5:6:7')).toBeNull();
    expect(ipParse('12345::')).toBeNull();
    expect(ipParse('1:2:3:4:5:6:7::8')).toBeNull();
  });

  it('reads an IPv4-mapped IPv6 address as the IPv4 address it carries', () => {
    const mapped = ipParse('::ffff:192.168.1.20')!;
    expect(mapped.version).toBe(4);
    expect(ipFormat(mapped)).toBe('192.168.1.20');
    expect(ipFormat(ipParse('::ffff:c0a8:0114')!)).toBe('192.168.1.20');
  });
});

describe('CIDR blocks', () => {
  it('normalises blocks and clears host bits', () => {
    expect(ipNormaliseCidr('192.168.1.77/24')).toBe('192.168.1.0/24');
    expect(ipNormaliseCidr('10.1.2.3')).toBe('10.1.2.3/32');
    expect(ipNormaliseCidr('2001:db8:abcd:12::1/48')).toBe('2001:db8:abcd::/48');
    expect(ipNormaliseCidr('2001:db8::1')).toBe('2001:db8::1/128');
    expect(ipNormaliseCidr('0.0.0.0/0')).toBe('0.0.0.0/0');
    expect(ipNormaliseCidr('::ffff:10.0.0.0/104')).toBe('10.0.0.0/8');
    expect(ipNormaliseCidr('10.0.0.0/33')).toBeNull();
    expect(ipNormaliseCidr('2001:db8::/129')).toBeNull();
    expect(ipNormaliseCidr('10.0.0.0/')).toBeNull();
    expect(ipNormaliseCidr('10.0.0.0/-1')).toBeNull();
    expect(ipNormaliseCidr('nonsense/8')).toBeNull();
  });

  it('matches addresses inside a block, on odd prefixes too', () => {
    const block = ipCidrParse('203.0.113.0/27')!;
    expect(ipInCidr(ipParse('203.0.113.31')!, block)).toBe(true);
    expect(ipInCidr(ipParse('203.0.113.32')!, block)).toBe(false);
    const v6 = ipCidrParse('2001:db8:8000::/33')!;
    expect(ipInCidr(ipParse('2001:db8:ffff::1')!, v6)).toBe(true);
    expect(ipInCidr(ipParse('2001:db8:7fff::1')!, v6)).toBe(false);
  });

  it('never matches across versions, and refuses what it cannot parse', () => {
    expect(ipAllowed('2001:db8::1', ['0.0.0.0/0'])).toBe(false);
    expect(ipAllowed('10.0.0.1', ['::/0'])).toBe(false);
    expect(ipAllowed('::ffff:10.0.0.1', ['10.0.0.0/8'])).toBe(true);
    expect(ipAllowed('not-an-ip', ['0.0.0.0/0'])).toBe(false);
    expect(ipAllowed('10.0.0.1', [])).toBe(false);
    expect(ipAllowed('10.0.0.1', ['garbage', '10.0.0.0/8'])).toBe(true);
  });
});

describe('TOTP', () => {
  // RFC 6238 Appendix B: SHA-1 seed "12345678901234567890", eight digits.
  const seed = ascii('12345678901234567890');
  it.each([
    [59, '94287082'],
    [1111111109, '07081804'],
    [1111111111, '14050471'],
    [1234567890, '89005924'],
    [2000000000, '69279037'],
    [20000000000, '65353130'],
  ])('matches the RFC 6238 vector at T=%i', (seconds, code) => {
    expect(mfaTotp(seed, seconds * 1000, 8)).toBe(code);
  });

  it('matches the RFC 4226 HOTP vectors', () => {
    const expected = ['755224', '287082', '359152', '969429', '338314', '254676', '287922', '162583', '399871', '520489'];
    expected.forEach((code, counter) => expect(mfaHotp(seed, counter)).toBe(code));
  });

  it('round-trips base32 the way authenticator apps write it', () => {
    expect(mfaBase32Encode(ascii('12345678901234567890'))).toBe('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
    expect(mfaBase32Encode(ascii('f'))).toBe('MY');
    expect(mfaBase32Encode(ascii('foobar'))).toBe('MZXW6YTBOI');
    expect(Array.from(mfaBase32Decode('mzxw 6ytb-oi======')!)).toEqual(Array.from(ascii('foobar')));
    expect(mfaBase32Decode('MZXW1')).toBeNull();
  });

  it('accepts one step either side and nothing further', () => {
    const now = 1_700_000_000_000;
    const step = mfaTotpStep(now);
    expect(mfaTotpVerify(seed, mfaHotp(seed, step), now)).toBe(step);
    expect(mfaTotpVerify(seed, mfaHotp(seed, step - 1), now)).toBe(step - 1);
    expect(mfaTotpVerify(seed, mfaHotp(seed, step + 1), now)).toBe(step + 1);
    expect(mfaTotpVerify(seed, mfaHotp(seed, step - 2), now)).toBeNull();
    expect(mfaTotpVerify(seed, mfaHotp(seed, step + 2), now)).toBeNull();
  });

  it('refuses a code from a step already used, and malformed input', () => {
    const now = 1_700_000_000_000;
    const step = mfaTotpStep(now);
    const code = mfaHotp(seed, step);
    expect(mfaTotpVerify(seed, code, now, { afterStep: step })).toBeNull();
    expect(mfaTotpVerify(seed, code, now, { afterStep: step - 1 })).toBe(step);
    expect(mfaTotpVerify(seed, '12345', now)).toBeNull();
    expect(mfaTotpVerify(seed, 'abcdef', now)).toBeNull();
    expect(mfaTotpVerify(seed, `${code.slice(0, 3)} ${code.slice(3)}`, now)).toBe(step);
  });

  it('builds an otpauth URI an authenticator can read', () => {
    const uri = mfaOtpauthUri({ secret: 'JBSWY3DPEHPK3PXP', account: '+919876543210', company: 'Al Noor' });
    expect(uri.startsWith('otpauth://totp/BUILDR%20-%20Al%20Noor:%2B919876543210?')).toBe(true);
    const params = new URL(uri.replace('otpauth://', 'https://')).searchParams;
    expect(params.get('secret')).toBe('JBSWY3DPEHPK3PXP');
    expect(params.get('issuer')).toBe('BUILDR - Al Noor');
    expect(params.get('digits')).toBe('6');
    expect(params.get('period')).toBe('30');
  });

  it('formats and reads recovery codes, and never mistakes a TOTP code for one', () => {
    expect(mfaFormatRecoveryCode('abcdefghjk')).toBe('abcde-fghjk');
    expect(mfaNormaliseRecoveryCode('ABCDE-FGHJK')).toBe('abcdefghjk');
    expect(mfaNormaliseRecoveryCode(' abcde fghjk ')).toBe('abcdefghjk');
    expect(mfaNormaliseRecoveryCode('123456')).toBeNull();
    expect(mfaNormaliseRecoveryCode('abcde-fghj0')).toBeNull();
  });
});

describe('policy', () => {
  it('requires a second factor of admins by permission, not role name', () => {
    expect(securityMfaRequired('off', { permissions: ['tenant.manage'] })).toBe(false);
    expect(securityMfaRequired('admins', { permissions: ['tenant.manage'] })).toBe(true);
    expect(securityMfaRequired('admins', { permissions: ['dpr.file'] })).toBe(false);
    expect(securityMfaRequired('everyone', { permissions: [] })).toBe(true);
  });

  it('applies the IP list by mode, with the owner and role exemptions', () => {
    const rule = { mode: 'everyone' as const, exemptOwners: true, exemptRoles: ['site_supervisor'] };
    expect(securityIpApplies(rule, { role: 'owner', app: false })).toBe(false);
    expect(securityIpApplies({ ...rule, exemptOwners: false }, { role: 'owner', app: false })).toBe(true);
    expect(securityIpApplies(rule, { role: 'site_supervisor', app: false })).toBe(false);
    expect(securityIpApplies(rule, { role: 'accounts', app: true })).toBe(true);
    expect(securityIpApplies({ ...rule, mode: 'web' }, { role: 'accounts', app: true })).toBe(false);
    expect(securityIpApplies({ ...rule, mode: 'web' }, { role: 'accounts', app: false })).toBe(true);
    expect(securityIpApplies({ ...rule, mode: 'off' }, { role: 'accounts', app: false })).toBe(false);
  });
});

describe('session timeouts', () => {
  const start = new Date('2026-10-06T08:00:00Z');
  const at = (minutes: number) => new Date(start.getTime() + minutes * 60_000);

  it('expires on idle and on absolute lifetime, absolute first', () => {
    const base = { startedAt: start, idleMinutes: 30, absoluteHours: 8 };
    expect(securitySessionVerdict({ ...base, lastActiveAt: at(100), now: at(129) })).toBe('active');
    expect(securitySessionVerdict({ ...base, lastActiveAt: at(100), now: at(130) })).toBe('idle');
    expect(securitySessionVerdict({ ...base, lastActiveAt: at(479), now: at(480) })).toBe('expired');
    expect(securitySessionVerdict({ ...base, lastActiveAt: at(0), now: at(600) })).toBe('expired');
  });

  it('does nothing with both limits off', () => {
    expect(
      securitySessionVerdict({ startedAt: start, lastActiveAt: start, now: at(60 * 24 * 365), idleMinutes: null, absoluteHours: null }),
    ).toBe('active');
    expect(securityAbsoluteDeadline(start, null)).toBeNull();
    expect(securityAbsoluteDeadline(start, 8)?.toISOString()).toBe('2026-10-06T16:00:00.000Z');
  });
});

describe('schemas', () => {
  it('keeps timeouts inside their ranges', () => {
    expect(securitySessionPolicySchema.safeParse({ idle_timeout_minutes: 30, absolute_lifetime_hours: null }).success).toBe(true);
    expect(securitySessionPolicySchema.safeParse({ idle_timeout_minutes: 5, absolute_lifetime_hours: null }).success).toBe(false);
    expect(securitySessionPolicySchema.safeParse({ idle_timeout_minutes: null, absolute_lifetime_hours: 721 }).success).toBe(false);
  });

  it('normalises allow-list entries and refuses an empty list that is switched on', () => {
    const parsed = securityIpPolicySchema.parse({
      ip_mode: 'everyone',
      ip_rules: [{ cidr: '192.168.1.77/24', label: 'Office' }],
    });
    expect(parsed.ip_rules[0]?.cidr).toBe('192.168.1.0/24');
    expect(parsed.ip_exempt_owners).toBe(true);
    expect(securityIpPolicySchema.safeParse({ ip_mode: 'web', ip_rules: [] }).success).toBe(false);
    expect(securityIpPolicySchema.safeParse({ ip_mode: 'off', ip_rules: [] }).success).toBe(true);
    expect(securityIpPolicySchema.safeParse({ ip_mode: 'web', ip_rules: [{ cidr: 'x' }] }).success).toBe(false);
  });

  it('takes a six-digit code with spaces', () => {
    expect(mfaConfirmSchema.parse({ code: '123 456' }).code).toBe('123456');
    expect(mfaConfirmSchema.safeParse({ code: '12345' }).success).toBe(false);
  });
});
