import { describe, expect, it } from 'vitest';
import {
  scimBoolean,
  scimParseFilter,
  ssoDomainOf,
  ssoIsDomain,
  ssoIsPlaceholderPhone,
  ssoNormaliseDomain,
  ssoTxtRecordValue,
} from './sso';
import { ssoConnectionSchema, ssoDomainSchema, ssoStartSchema } from './schemas/sso';

describe('SSO domains', () => {
  it('reads the domain an address is on, whole and lower case', () => {
    expect(ssoDomainOf('Rajesh@AlNoor.ae')).toBe('alnoor.ae');
    expect(ssoDomainOf('a@mail.alnoor.ae')).toBe('mail.alnoor.ae');
    expect(ssoDomainOf('no-at-sign')).toBeNull();
    expect(ssoDomainOf('a@localhost')).toBeNull();
    expect(ssoDomainOf('a@')).toBeNull();
  });

  it('accepts bare DNS names only', () => {
    expect(ssoIsDomain('alnoor.ae')).toBe(true);
    expect(ssoIsDomain('x-y.co.uk')).toBe(true);
    expect(ssoIsDomain('alnoor')).toBe(false);
    expect(ssoIsDomain('10.0.0.1')).toBe(false);
    expect(ssoIsDomain('*.alnoor.ae')).toBe(false);
    expect(ssoIsDomain('-bad.ae')).toBe(false);
  });

  it('tidies what an admin types', () => {
    expect(ssoNormaliseDomain('https://www.AlNoor.ae/about')).toBe('www.alnoor.ae');
    expect(ssoNormaliseDomain(' @alnoor.ae ')).toBe('alnoor.ae');
    expect(ssoNormaliseDomain('alnoor.ae.')).toBe('alnoor.ae');
    expect(ssoNormaliseDomain('not a domain')).toBeNull();
    expect(ssoDomainSchema.parse({ domain: 'AlNoor.AE' }).domain).toBe('alnoor.ae');
    expect(ssoDomainSchema.safeParse({ domain: 'nope' }).success).toBe(false);
  });

  it('names the TXT record', () => {
    expect(ssoTxtRecordValue('abc')).toBe('buildr-verification=abc');
  });

  it('recognises the stand-in phone of a provisioned person', () => {
    expect(ssoIsPlaceholderPhone('sso:0123abcd')).toBe(true);
    expect(ssoIsPlaceholderPhone('971501234567')).toBe(false);
    expect(ssoIsPlaceholderPhone(null)).toBe(false);
  });
});

describe('SSO schemas', () => {
  it('lower-cases the work email at the start of a sign-in', () => {
    const parsed = ssoStartSchema.parse({ email: ' Rajesh@AlNoor.ae ', binding: 'a'.repeat(32) });
    expect(parsed.email).toBe('rajesh@alnoor.ae');
    expect(ssoStartSchema.safeParse({ email: 'x@y.ae', binding: 'short' }).success).toBe(false);
  });

  it('defaults a connection to off, with no JIT and no enforcement', () => {
    const parsed = ssoConnectionSchema.parse({ protocol: 'oidc' });
    expect(parsed).toMatchObject({ enabled: false, jit_enabled: false, enforce_sso: false, preset: 'other' });
    expect(ssoConnectionSchema.safeParse({ protocol: 'ldap' }).success).toBe(false);
    expect(ssoConnectionSchema.safeParse({ protocol: 'oidc', oidc_scopes: 'openid;drop' }).success).toBe(false);
  });
});

describe('SCIM helpers', () => {
  it('parses the filters Entra ID and Okta send', () => {
    expect(scimParseFilter('userName eq "a@b.com"')).toEqual({ attribute: 'userName', value: 'a@b.com' });
    expect(scimParseFilter('externalId EQ "x\\"y"')).toEqual({ attribute: 'externalId', value: 'x"y' });
    expect(scimParseFilter('displayName eq "Site Managers"')).toEqual({
      attribute: 'displayName',
      value: 'Site Managers',
    });
    expect(scimParseFilter('userName sw "a"')).toBeNull();
    expect(scimParseFilter('userName eq "a" and active eq true')).toBeNull();
  });

  it('reads booleans the way Entra ID spells them', () => {
    expect(scimBoolean('False')).toBe(false);
    expect(scimBoolean('true')).toBe(true);
    expect(scimBoolean(true)).toBe(true);
    expect(scimBoolean('no')).toBeNull();
  });
});
