import { describe, expect, it } from 'vitest';
import {
  PUBLIC_API_KEY_PATTERN,
  WEBHOOK_MAX_ATTEMPTS,
  WEBHOOK_RETRY_DELAYS_SECONDS,
  publicApiKeyState,
  publicApiLooksLikeKey,
  webhookAddressAllowed,
  webhookRetryDelaySeconds,
  webhookUrlProblem,
} from './public-api';
import { publicApiExpenseCreateSchema, publicApiKeyCreateSchema } from './schemas/public-api';

describe('API keys', () => {
  it('recognises the key shape', () => {
    const key = `bk_live_${'A'.repeat(43)}`;
    expect(PUBLIC_API_KEY_PATTERN.test(key)).toBe(true);
    expect(publicApiLooksLikeKey(key)).toBe(true);
    expect(publicApiLooksLikeKey('eyJhbGciOi.jwt.token')).toBe(false);
  });

  it('reads expiry and revocation as states', () => {
    const now = new Date('2026-10-06T10:00:00Z');
    expect(publicApiKeyState({ revokedAt: null, expiresAt: null }, now)).toBe('active');
    expect(publicApiKeyState({ revokedAt: null, expiresAt: new Date('2026-10-06T09:59:59Z') }, now)).toBe('expired');
    expect(publicApiKeyState({ revokedAt: now, expiresAt: null }, now)).toBe('revoked');
  });

  it('validates a new key: scopes de-duplicated, blocks normalised', () => {
    const parsed = publicApiKeyCreateSchema.parse({
      name: ' Tally ',
      scopes: ['expenses:read', 'expenses:read'],
      allowed_cidrs: ['192.168.1.77/24'],
    });
    expect(parsed).toEqual({ name: 'Tally', scopes: ['expenses:read'], allowed_cidrs: ['192.168.1.0/24'] });
    expect(publicApiKeyCreateSchema.safeParse({ name: 'x', scopes: ['everything'] }).success).toBe(false);
    expect(publicApiKeyCreateSchema.safeParse({ name: 'x', scopes: [] }).success).toBe(false);
  });

  it('takes money as integer minor units, never a fraction', () => {
    const base = { project_id: '7f0c1a8e-3f43-4a51-9d2e-1a1f8f1f0a11', category: 'fuel', spent_on: '2026-10-01' };
    expect(publicApiExpenseCreateSchema.parse({ ...base, amount: 125050 }).amount).toBe(125050n);
    expect(publicApiExpenseCreateSchema.parse({ ...base, amount: '125050' }).amount).toBe(125050n);
    expect(publicApiExpenseCreateSchema.safeParse({ ...base, amount: 12.5 }).success).toBe(false);
    expect(publicApiExpenseCreateSchema.safeParse({ ...base, amount: 0 }).success).toBe(false);
    expect(publicApiExpenseCreateSchema.safeParse({ ...base, amount: 100, tax_amount: 101 }).success).toBe(false);
  });
});

describe('webhook retries', () => {
  it('tries eight times over about a day', () => {
    expect(WEBHOOK_MAX_ATTEMPTS).toBe(8);
    const total = WEBHOOK_RETRY_DELAYS_SECONDS.reduce((sum, wait) => sum + wait, 0);
    expect(total).toBeGreaterThan(20 * 3600);
    expect(total).toBeLessThan(26 * 3600);
  });

  it('backs off exponentially-ish and stops after the last try', () => {
    expect(webhookRetryDelaySeconds(1)).toBe(60);
    expect(webhookRetryDelaySeconds(2)).toBe(300);
    expect(webhookRetryDelaySeconds(7)).toBe(28_800);
    expect(webhookRetryDelaySeconds(8)).toBeNull();
    expect(webhookRetryDelaySeconds(0)).toBeNull();
  });

  it('jitters by at most ten per cent', () => {
    expect(webhookRetryDelaySeconds(1, 0)).toBe(54);
    expect(webhookRetryDelaySeconds(1, 1)).toBe(66);
  });
});

describe('webhook targets (SSRF)', () => {
  it.each([
    '127.0.0.1',
    '10.1.2.3',
    '172.16.0.1',
    '172.31.255.255',
    '192.168.0.10',
    '169.254.169.254',
    '100.64.0.1',
    '0.0.0.0',
    '224.0.0.1',
    '255.255.255.255',
    '::1',
    '::',
    'fe80::1',
    'fd00::1',
    '::ffff:127.0.0.1',
    '::ffff:10.0.0.1',
    '64:ff9b::a00:1',
    'not-an-address',
  ])('refuses %s', (address) => {
    expect(webhookAddressAllowed(address)).toBe(false);
  });

  it.each(['8.8.8.8', '1.1.1.1', '172.32.0.1', '2606:4700:4700::1111', '::ffff:8.8.8.8'])('allows %s', (address) => {
    expect(webhookAddressAllowed(address)).toBe(true);
  });

  it('lets loopback through only when asked, and nothing else private', () => {
    expect(webhookAddressAllowed('127.0.0.1', { allowLoopback: true })).toBe(true);
    expect(webhookAddressAllowed('::1', { allowLoopback: true })).toBe(true);
    expect(webhookAddressAllowed('10.0.0.1', { allowLoopback: true })).toBe(false);
  });

  it('judges URLs before any lookup', () => {
    expect(webhookUrlProblem('https://hooks.example.com/buildr')).toBeNull();
    expect(webhookUrlProblem('http://hooks.example.com/buildr')).toBe('not_https');
    expect(webhookUrlProblem('ftp://hooks.example.com')).toBe('not_https');
    expect(webhookUrlProblem('https://user:pw@hooks.example.com')).toBe('credentials');
    expect(webhookUrlProblem('https://localhost/x')).toBe('internal_host');
    expect(webhookUrlProblem('https://printer.local/x')).toBe('internal_host');
    expect(webhookUrlProblem('https://intranet/x')).toBe('internal_host');
    expect(webhookUrlProblem('https://127.0.0.1/x')).toBe('blocked_address');
    expect(webhookUrlProblem('https://[::1]/x')).toBe('blocked_address');
    expect(webhookUrlProblem('https://169.254.169.254/latest/meta-data')).toBe('blocked_address');
    expect(webhookUrlProblem('https://0x7f000001/x')).not.toBeNull();
    expect(webhookUrlProblem('not a url')).toBe('invalid');
  });

  it('allows plain http to loopback for local development only', () => {
    expect(webhookUrlProblem('http://127.0.0.1:4567/hook', { allowLoopback: true })).toBeNull();
    expect(webhookUrlProblem('http://localhost:4567/hook', { allowLoopback: true })).toBeNull();
    expect(webhookUrlProblem('http://10.0.0.5/hook', { allowLoopback: true })).toBe('not_https');
    expect(webhookUrlProblem('http://127.0.0.1:4567/hook')).toBe('not_https');
  });
});
