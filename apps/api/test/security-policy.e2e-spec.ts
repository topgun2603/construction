// Must come first: the proxy and SSO settings have to be in the environment before the app loads.
import { TEST_WEB_CLIENT_IP_SECRET, restoreSecurityEnv } from './utils/security-env';
import { restoreSsoEnv } from './utils/sso-env';
import { randomBytes, randomUUID } from 'node:crypto';
import { promises as dns } from 'node:dns';
import { mfaBase32Decode, mfaHotp, mfaTotpStep } from '@sitebook/shared';
import {
  createTestApp,
  destroyTenant,
  onboardTenant,
  uniquePhone,
  type OnboardedTenant,
  type TestApp,
} from './utils/test-app';
import { MockOidcProvider } from './utils/sso-mocks';
import { TenantCache } from '../src/common/auth/tenant-cache.service';

/**
 * Enforced two-factor, session timeouts and IP allow-lists per company (roadmap Phase 3, item 2),
 * end to end against a real database: what a company with no rules sees (nothing new), required
 * two-factor and every way of meeting it, idle and absolute timeouts, signing out, the allow-list
 * on requests and at sign-in with its break-glass paths, the platform console, and that one
 * company's rules never reach another.
 */
describe('Security policies', () => {
  let test: TestApp;
  const tenants: string[] = [];
  const providers: MockOidcProvider[] = [];
  const ADMIN_PHONE = '919000000071';
  const originalAllowlist = process.env['PLATFORM_ADMIN_PHONES'];

  beforeAll(async () => {
    process.env['PLATFORM_ADMIN_PHONES'] = ADMIN_PHONE;
    test = await createTestApp();
  });

  afterAll(async () => {
    for (const id of tenants) await destroyTenant(test, id);
    for (const provider of providers) await provider.stop();
    await test.close();
    if (originalAllowlist === undefined) delete process.env['PLATFORM_ADMIN_PHONES'];
    else process.env['PLATFORM_ADMIN_PHONES'] = originalAllowlist;
    restoreSecurityEnv();
    restoreSsoEnv();
  });

  afterEach(() => jest.restoreAllMocks());

  type Session = { accessToken: string; refreshToken: string };
  const auth = (session: { accessToken: string }) => ({ Authorization: `Bearer ${session.accessToken}` });
  const from = (ip: string) => ({ 'X-Forwarded-For': ip });
  const claimsOf = (token: string) =>
    JSON.parse(Buffer.from(token.split('.')[1] as string, 'base64url').toString('utf8')) as Record<string, unknown>;

  async function company(name: string): Promise<OnboardedTenant> {
    const tenant = await onboardTenant(test, { name, phone: uniquePhone() });
    tenants.push(tenant.tenantId);
    return tenant;
  }

  /** Invites somebody and returns their id and stored phone. */
  async function addMember(owner: Session, role = 'site_supervisor') {
    const invited = await test
      .http()
      .post('/v1/tenants/current/invite')
      .set(auth(owner))
      .send({ phone: uniquePhone(), name: `Member ${role}`, role })
      .expect(201);
    return { id: invited.body.id as string, phone: invited.body.phone as string };
  }

  /** A fresh sign-in. `deviceId` makes it a mobile-app session. */
  async function signIn(phone: string, options: { ip?: string; deviceId?: string } = {}): Promise<Session> {
    const response = await test
      .http()
      .post('/v1/auth/exchange')
      .set(options.ip ? from(options.ip) : {})
      .send({ firebase_token: `dev:${phone}`, ...(options.deviceId ? { device_id: options.deviceId } : {}) })
      .expect(200);
    return { accessToken: response.body.access_token, refreshToken: response.body.refresh_token };
  }

  /**
   * Codes are one 30-second step each, and a code is accepted once. Tests pick steps explicitly and
   * stay clear of a step boundary, so the clock moving on mid-test cannot fail them.
   */
  async function awayFromStepEdge(): Promise<void> {
    const into = (Date.now() / 1000) % 30;
    if (into > 24) await new Promise((resolve) => setTimeout(resolve, (31 - into) * 1000));
  }
  const codeAt = (secret: string, offset: number) =>
    mfaHotp(mfaBase32Decode(secret) as Uint8Array, mfaTotpStep(Date.now()) + offset);

  /** Enrols an authenticator on this session; returns the secret, recovery codes and mfa session. */
  async function enrol(session: Session) {
    await awayFromStepEdge();
    const started = await test.http().post('/v1/auth/mfa/enrol').set(auth(session)).expect(200);
    const secret = started.body.secret as string;
    const confirmed = await test
      .http()
      .post('/v1/auth/mfa/enrol/confirm')
      .set(auth(session))
      .send({ code: codeAt(secret, -1) })
      .expect(200);
    return {
      secret,
      recoveryCodes: confirmed.body.recovery_codes as string[],
      session: {
        accessToken: confirmed.body.tokens.access_token as string,
        refreshToken: confirmed.body.tokens.refresh_token as string,
      },
    };
  }

  async function verify(session: Session, code: string) {
    return test.http().post('/v1/auth/mfa/verify').set(auth(session)).send({ code });
  }

  async function auditActions(tenantId: string, action: string) {
    return test.tenantDb.transaction(tenantId, (tx) => tx.auditLog.findMany({ where: { action } }));
  }

  /** An owner whose session has shown a second factor, as requiring two-factor demands. */
  async function verifiedOwner(name: string) {
    const owner = await company(name);
    const enrolled = await enrol(owner);
    return { ...owner, ...enrolled.session, secret: enrolled.secret, recoveryCodes: enrolled.recoveryCodes };
  }

  // --------------------------------------------------------------------------------------------

  describe('with no rules', () => {
    it('changes nothing: tokens work, refresh works, and the session is listed', async () => {
      const owner = await company('Plain Co');
      const claims = claimsOf(owner.accessToken);
      expect(typeof claims['sid']).toBe('string');
      expect(claims['mfa']).toBeUndefined();

      await test.http().get('/v1/me').set(auth(owner)).expect(200);
      await test.http().get('/v1/me').set(auth(owner)).set(from('198.51.100.1')).expect(200);
      const refreshed = await test.http().post('/v1/auth/refresh').send({ refresh_token: owner.refreshToken }).expect(200);
      expect(refreshed.body.expires_in).toBeGreaterThan(60);
      expect(claimsOf(refreshed.body.access_token)['sid']).toBe(claims['sid']);

      const sessions = await test.http().get('/v1/auth/sessions').set(auth(owner)).expect(200);
      expect(sessions.body.items).toHaveLength(1);
      expect(sessions.body.items[0]).toMatchObject({ current: true, client: 'web', method: 'phone', two_factor: false });

      const settings = await test.http().get('/v1/security/settings').set(auth(owner)).set(from('198.51.100.1')).expect(200);
      expect(settings.body).toMatchObject({
        current_ip: '198.51.100.1',
        mfa: { policy: 'off', trust_idp_mfa: true },
        sessions: { idle_timeout_minutes: null, absolute_lifetime_hours: null },
        ip: { mode: 'off', rules: [], exempt_owners: true },
        deployment: { mfa_configured: true },
      });
    });

    it('ignores X-Forwarded-For entries beyond the one trusted proxy', async () => {
      const owner = await company('Spoof Co');
      // The client wrote the first entry; the proxy appended the second. Only the second counts.
      const settings = await test
        .http()
        .get('/v1/security/settings')
        .set(auth(owner))
        .set('X-Forwarded-For', '203.0.113.50, 198.51.100.77')
        .expect(200);
      expect(settings.body.current_ip).toBe('198.51.100.77');
    });

    it('believes the web server’s client address only with the shared secret', async () => {
      const owner = await company('Forward Co');
      const vouched = await test
        .http()
        .get('/v1/security/settings')
        .set(auth(owner))
        .set({ 'X-Buildr-Client-Ip': '2001:db8::7', 'X-Buildr-Proxy-Secret': TEST_WEB_CLIENT_IP_SECRET })
        .expect(200);
      expect(vouched.body.current_ip).toBe('2001:db8::7');

      const forged = await test
        .http()
        .get('/v1/security/settings')
        .set(auth(owner))
        .set(from('198.51.100.3'))
        .set({ 'X-Buildr-Client-Ip': '2001:db8::7', 'X-Buildr-Proxy-Secret': 'not-the-secret' })
        .expect(200);
      expect(forged.body.current_ip).toBe('198.51.100.3');
    });
  });

  // --------------------------------------------------------------------------------------------

  describe('required two-factor', () => {
    it('will not let an owner require it before showing a second factor themselves', async () => {
      const owner = await company('Eager Co');
      const refused = await test
        .http()
        .put('/v1/security/mfa-policy')
        .set(auth(owner))
        .send({ mfa_policy: 'admins' })
        .expect(409);
      expect(refused.body.details.reason).toBe('owner_not_verified');
    });

    it('enrols an authenticator, refusing a wrong first code', async () => {
      const owner = await company('Enrol Co');
      await awayFromStepEdge();
      const started = await test.http().post('/v1/auth/mfa/enrol').set(auth(owner)).expect(200);
      expect(started.body.otpauth_uri).toMatch(/^otpauth:\/\/totp\/BUILDR/);
      expect(started.body.otpauth_uri).toContain(`secret=${started.body.secret}`);

      const wrong = codeAt(started.body.secret, -1) === '000000' ? '111111' : '000000';
      await test.http().post('/v1/auth/mfa/enrol/confirm').set(auth(owner)).send({ code: wrong }).expect(422);

      const confirmed = await test
        .http()
        .post('/v1/auth/mfa/enrol/confirm')
        .set(auth(owner))
        .send({ code: codeAt(started.body.secret, 0) })
        .expect(200);
      expect(confirmed.body.recovery_codes).toHaveLength(10);
      expect(confirmed.body.recovery_codes[0]).toMatch(/^[a-z2-9]{5}-[a-z2-9]{5}$/);
      expect(claimsOf(confirmed.body.tokens.access_token)['mfa']).toBe(true);

      // The secret is stored encrypted, and the audit log never shows it.
      const row = await test.tenantDb.transaction(owner.tenantId, (tx) =>
        tx.mfaFactor.findUniqueOrThrow({ where: { userId: owner.ownerId } }),
      );
      expect(row.secretCipher.startsWith('v1:')).toBe(true);
      expect(row.secretCipher).not.toContain(started.body.secret);
      const logged = await test.tenantDb.transaction(owner.tenantId, (tx) =>
        tx.auditLog.findMany({ where: { entity: 'mfa_factors' } }),
      );
      expect(JSON.stringify(logged)).not.toContain(started.body.secret);
      expect(logged.some((entry) => entry.action === 'mfa.enrolled')).toBe(true);

      // Enrolling again is refused while one exists.
      await test.http().post('/v1/auth/mfa/enrol').set(auth({ accessToken: confirmed.body.tokens.access_token })).expect(409);
    });

    it('requires it of admins only, and lets an admin through once the factor is shown', async () => {
      const owner = await verifiedOwner('Admins Co');
      const supervisor = await addMember(owner);

      await test.http().put('/v1/security/mfa-policy').set(auth(owner)).send({ mfa_policy: 'admins' }).expect(200);

      // The supervisor holds no tenant.manage: nothing changes for them.
      const staff = await signIn(supervisor.phone);
      await test.http().get('/v1/me').set(auth(staff)).expect(200);

      // A fresh owner sign-in is one factor, and is stopped at everything but the two-factor step.
      await awayFromStepEdge();
      const fresh = await signIn(owner.phone.slice(2));
      const blocked = await test.http().get('/v1/me').set(auth(fresh)).expect(403);
      expect(blocked.body.code).toBe('MFA_REQUIRED');
      await test.http().get('/v1/projects').set(auth(fresh)).expect(403);
      const status = await test.http().get('/v1/auth/mfa').set(auth(fresh)).expect(200);
      expect(status.body).toMatchObject({ required: true, enrolled: true, session_verified: false, recovery_codes_left: 10 });

      const verified = await verify(fresh, codeAt(owner.secret, 0));
      expect(verified.status).toBe(200);
      expect(verified.body.method).toBe('totp');
      const upgraded = { accessToken: verified.body.tokens.access_token, refreshToken: verified.body.tokens.refresh_token };
      expect(claimsOf(upgraded.accessToken)['mfa']).toBe(true);
      await test.http().get('/v1/me').set(auth(upgraded)).expect(200);

      // The same code cannot be used twice, even within its window.
      const replay = await signIn(owner.phone.slice(2));
      expect((await verify(replay, codeAt(owner.secret, 0))).status).toBe(422);

      // Refreshing keeps the second factor: it lives on the session, not the token.
      const refreshed = await test.http().post('/v1/auth/refresh').send({ refresh_token: upgraded.refreshToken }).expect(200);
      expect(claimsOf(refreshed.body.access_token)['mfa']).toBe(true);
      // And the refresh token the client held before verifying was retired into the new one.
      await test.http().post('/v1/auth/refresh').send({ refresh_token: fresh.refreshToken }).expect(401);
    });

    it('takes each recovery code once', async () => {
      const owner = await verifiedOwner('Recovery Co');
      await test.http().put('/v1/security/mfa-policy').set(auth(owner)).send({ mfa_policy: 'admins' }).expect(200);
      const code = owner.recoveryCodes[3] as string;

      const first = await signIn(owner.phone.slice(2));
      const used = await verify(first, code.toUpperCase());
      expect(used.status).toBe(200);
      expect(used.body).toMatchObject({ method: 'recovery_code', recovery_codes_left: 9 });

      const second = await signIn(owner.phone.slice(2));
      expect((await verify(second, code)).status).toBe(422);
    });

    it('locks the factor after five wrong codes, and logs it', async () => {
      const owner = await verifiedOwner('Lockout Co');
      await test.http().put('/v1/security/mfa-policy').set(auth(owner)).send({ mfa_policy: 'admins' }).expect(200);
      const session = await signIn(owner.phone.slice(2));
      const right = codeAt(owner.secret, 1);
      const wrong = right === '123456' ? '654321' : '123456';

      for (let i = 0; i < 5; i++) expect((await verify(session, wrong)).status).toBe(422);
      const locked = await verify(session, right);
      expect(locked.status).toBe(429);
      expect(locked.body.code).toBe('RATE_LIMITED');
      expect(await auditActions(owner.tenantId, 'mfa.locked')).toHaveLength(1);
      expect((await auditActions(owner.tenantId, 'mfa.verify_failed')).length).toBeGreaterThanOrEqual(4);
    });

    it('requires it of everyone, and taking the authenticator away ends the second factor', async () => {
      const owner = await verifiedOwner('Everyone Co');
      const supervisor = await addMember(owner);
      await test.http().put('/v1/security/mfa-policy').set(auth(owner)).send({ mfa_policy: 'everyone' }).expect(200);

      // A phone sign-in is one factor, so a supervisor must enrol too — the interstitial lets them.
      const staff = await signIn(supervisor.phone);
      expect((await test.http().get('/v1/me').set(auth(staff)).expect(403)).body.code).toBe('MFA_REQUIRED');
      const enrolled = await enrol(staff);
      await test.http().get('/v1/me').set(auth(enrolled.session)).expect(200);

      // Removing it (from a verified session) takes the second factor off every session at refresh.
      await test.http().delete('/v1/auth/mfa').set(auth(enrolled.session)).expect(204);
      const after = await test.http().post('/v1/auth/refresh').send({ refresh_token: enrolled.session.refreshToken }).expect(200);
      expect(claimsOf(after.body.access_token)['mfa']).toBeUndefined();
      await test.http().get('/v1/me').set(auth({ accessToken: after.body.access_token })).expect(403);
    });

    it('accepts a second factor Firebase checked itself on an email sign-in', async () => {
      const owner = await verifiedOwner('Firebase Co');
      await test.http().put('/v1/security/mfa-policy').set(auth(owner)).send({ mfa_policy: 'admins' }).expect(200);
      const email = `owner-${randomBytes(4).toString('hex')}@firebase-mfa.example`;
      await test.tenantDb.transaction(owner.tenantId, (tx) =>
        tx.user.update({ where: { id: owner.ownerId }, data: { email } }),
      );

      const plain = await test.http().post('/v1/auth/exchange').send({ firebase_token: `dev:${email}` }).expect(200);
      expect(claimsOf(plain.body.access_token)['mfa']).toBeUndefined();

      const withFactor = await test.http().post('/v1/auth/exchange').send({ firebase_token: `dev:${email}#mfa` }).expect(200);
      expect(claimsOf(withFactor.body.access_token)['mfa']).toBe(true);
      await test.http().get('/v1/me').set(auth({ accessToken: withFactor.body.access_token })).expect(200);
    });

    it('trusts the company’s identity provider for two-factor, until told not to', async () => {
      const owner = await verifiedOwner('IdP Trust Co');
      const domain = `trust-${randomBytes(4).toString('hex')}.example`;
      const added = await test.http().post('/v1/sso/domains').set(auth(owner)).send({ domain }).expect(201);
      jest.spyOn(dns, 'resolveTxt').mockResolvedValueOnce([[added.body.domains[0].txt_value]]);
      await test.http().post(`/v1/sso/domains/${added.body.domains[0].id}/verify`).set(auth(owner)).expect(200);
      const idp = await new MockOidcProvider().start();
      providers.push(idp);
      await test
        .http()
        .put('/v1/sso/connection')
        .set(auth(owner))
        .send({ protocol: 'oidc', preset: 'okta', enabled: true, oidc_issuer: idp.issuer, oidc_client_id: idp.clientId, oidc_client_secret: idp.clientSecret })
        .expect(200);
      const member = await addMember(owner);
      const email = `crew@${domain}`;
      await test.tenantDb.transaction(owner.tenantId, (tx) => tx.user.update({ where: { id: member.id }, data: { email } }));
      await test.http().put('/v1/security/mfa-policy').set(auth(owner)).send({ mfa_policy: 'everyone' }).expect(200);

      async function ssoSignIn() {
        const browser = randomBytes(24).toString('base64url');
        const started = await test.http().post('/v1/auth/sso/start').send({ email, binding: browser }).expect(200);
        const url = new URL(started.body.redirect_url);
        idp.expectedChallenge = url.searchParams.get('code_challenge');
        const nonce = url.searchParams.get('nonce') as string;
        idp.nextIdToken = () => idp.idToken({ nonce, email });
        const callback = await test
          .http()
          .get('/v1/auth/sso/oidc/callback')
          .query({ code: `code-${randomUUID()}`, state: url.searchParams.get('state') })
          .expect(303);
        const ticket = new URLSearchParams((callback.headers.location as string).split('#')[1]).get('ticket');
        const done = await test.http().post('/v1/auth/sso/complete').send({ ticket, binding: browser }).expect(200);
        return { accessToken: done.body.access_token as string, refreshToken: done.body.refresh_token as string };
      }

      const trusted = await ssoSignIn();
      expect(claimsOf(trusted.accessToken)['mfa']).toBe(true);
      await test.http().get('/v1/me').set(auth(trusted)).expect(200);

      await test
        .http()
        .put('/v1/security/mfa-policy')
        .set(auth(owner))
        .send({ mfa_policy: 'everyone', trust_idp_mfa: false })
        .expect(200);
      const untrusted = await ssoSignIn();
      expect(claimsOf(untrusted.accessToken)['mfa']).toBeUndefined();
      expect((await test.http().get('/v1/me').set(auth(untrusted)).expect(403)).body.code).toBe('MFA_REQUIRED');
    });

    it('lets the platform console reset a person’s two-factor, and logs it on both sides', async () => {
      const owner = await verifiedOwner('Reset Co');
      const login = await test.http().post('/v1/admin/auth/login').send({ firebase_token: `dev:${ADMIN_PHONE}` }).expect(201);
      const consoleAuth = { Authorization: `Bearer ${login.body.access_token}` };

      // The console is outside every company's rules: its own token, its own guard.
      await test.http().put('/v1/security/mfa-policy').set(auth(owner)).send({ mfa_policy: 'everyone' }).expect(200);
      await test.http().get('/v1/admin/me').set(consoleAuth).expect(200);

      const reset = await test
        .http()
        .post(`/v1/admin/tenants/${owner.tenantId}/users/${owner.ownerId}/mfa-reset`)
        .set(consoleAuth)
        .expect(200);
      expect(reset.body.reset).toBe(true);
      // The owner's sessions ended with it.
      await test.http().post('/v1/auth/refresh').send({ refresh_token: owner.refreshToken }).expect(401);

      const platformLog = await test.prisma.platformAuditLog.findFirst({
        where: { action: 'user.mfa_reset', tenantId: owner.tenantId },
      });
      expect(platformLog?.actorPhone).toBe(ADMIN_PHONE);
      const companyLog = await test.tenantDb.transaction(owner.tenantId, (tx) =>
        tx.auditLog.findFirst({ where: { entity: 'mfa_factors', action: 'delete', actorType: 'platform' } }),
      );
      expect(companyLog).not.toBeNull();

      // Signing in again, the owner sets up a new authenticator through the interstitial.
      const again = await signIn(owner.phone.slice(2));
      const status = await test.http().get('/v1/auth/mfa').set(auth(again)).expect(200);
      expect(status.body).toMatchObject({ required: true, enrolled: false });
      const enrolled = await enrol(again);
      await test.http().get('/v1/me').set(auth(enrolled.session)).expect(200);

      // A person in another company cannot be reset through this one.
      const other = await company('Reset Other Co');
      await test
        .http()
        .post(`/v1/admin/tenants/${owner.tenantId}/users/${other.ownerId}/mfa-reset`)
        .set(consoleAuth)
        .expect(404);
    });
  });

  // --------------------------------------------------------------------------------------------

  describe('session timeouts', () => {
    async function sessionIdOf(session: Session): Promise<string> {
      return claimsOf(session.accessToken)['sid'] as string;
    }

    it('ends a session idle past the limit, and only with a limit set', async () => {
      const owner = await company('Idle Co');
      const member = await addMember(owner);
      const session = await signIn(member.phone);
      const sid = await sessionIdOf(session);
      const age = async (minutes: number) =>
        test.tenantDb.transaction(owner.tenantId, (tx) =>
          tx.userSession.update({ where: { id: sid }, data: { lastActiveAt: new Date(Date.now() - minutes * 60_000) } }),
        );

      // No limit: a day of silence changes nothing.
      await age(24 * 60);
      const quiet = await test.http().post('/v1/auth/refresh').send({ refresh_token: session.refreshToken }).expect(200);

      await test
        .http()
        .put('/v1/security/session-policy')
        .set(auth(owner))
        .send({ idle_timeout_minutes: 30, absolute_lifetime_hours: null })
        .expect(200);
      await age(29);
      const recent = await test.http().post('/v1/auth/refresh').send({ refresh_token: quiet.body.refresh_token }).expect(200);

      await age(31);
      const expired = await test.http().post('/v1/auth/refresh').send({ refresh_token: recent.body.refresh_token }).expect(401);
      expect(expired.body).toMatchObject({ code: 'SESSION_EXPIRED', details: { reason: 'idle' } });

      const row = await test.tenantDb.transaction(owner.tenantId, (tx) => tx.userSession.findUniqueOrThrow({ where: { id: sid } }));
      expect(row.revokedReason).toBe('idle_timeout');
      expect(await auditActions(owner.tenantId, 'security.session_timed_out')).toHaveLength(1);
    });

    it('ends a session past its absolute lifetime, and cuts access tokens to it', async () => {
      const owner = await company('Absolute Co');
      const member = await addMember(owner);
      await test
        .http()
        .put('/v1/security/session-policy')
        .set(auth(owner))
        .send({ idle_timeout_minutes: null, absolute_lifetime_hours: 8 })
        .expect(200);
      const session = await signIn(member.phone);
      const sid = await sessionIdOf(session);
      const startedHoursAgo = async (hours: number) =>
        test.tenantDb.transaction(owner.tenantId, (tx) =>
          tx.userSession.update({ where: { id: sid }, data: { startedAt: new Date(Date.now() - hours * 3_600_000) } }),
        );

      // Five minutes left: the new access token lasts five minutes, not fifteen.
      await startedHoursAgo(8 - 5 / 60);
      const nearly = await test.http().post('/v1/auth/refresh').send({ refresh_token: session.refreshToken }).expect(200);
      expect(nearly.body.expires_in).toBeLessThanOrEqual(5 * 60);
      expect(nearly.body.expires_in).toBeGreaterThan(4 * 60);

      // Activity does not extend it.
      await startedHoursAgo(9);
      const over = await test.http().post('/v1/auth/refresh').send({ refresh_token: nearly.body.refresh_token }).expect(401);
      expect(over.body).toMatchObject({ code: 'SESSION_EXPIRED', details: { reason: 'expired' } });
    });
  });

  // --------------------------------------------------------------------------------------------

  describe('signing out', () => {
    it('signs out of one session, of every other, and everywhere', async () => {
      const owner = await company('Sign Out Co');
      const member = await addMember(owner);
      const laptop = await signIn(member.phone);
      const phone = await signIn(member.phone, { deviceId: 'phone-1' });
      const tablet = await signIn(member.phone, { deviceId: 'tablet-1' });

      const listed = await test.http().get('/v1/auth/sessions').set(auth(laptop)).expect(200);
      expect(listed.body.items).toHaveLength(3);
      expect(listed.body.items.filter((item: { current: boolean }) => item.current)).toHaveLength(1);

      // One session: the phone. Its refresh is over — and plainly, not as a replayed token that
      // would sign the laptop out too.
      const phoneId = claimsOf(phone.accessToken)['sid'];
      await test.http().delete(`/v1/auth/sessions/${phoneId}`).set(auth(laptop)).expect(204);
      await test.http().post('/v1/auth/refresh').send({ refresh_token: phone.refreshToken }).expect(401);
      const stillHere = await test.http().post('/v1/auth/refresh').send({ refresh_token: laptop.refreshToken }).expect(200);
      const laptopNow = { accessToken: stillHere.body.access_token, refreshToken: stillHere.body.refresh_token };

      // Every other: the tablet goes, the laptop stays.
      const others = await test.http().post('/v1/auth/sessions/sign-out-others').set(auth(laptopNow)).expect(200);
      expect(others.body.ended).toBe(1);
      await test.http().post('/v1/auth/refresh').send({ refresh_token: tablet.refreshToken }).expect(401);

      // Everywhere.
      await test.http().post('/v1/auth/logout').set(auth(laptopNow)).expect(204);
      await test.http().post('/v1/auth/refresh').send({ refresh_token: laptopNow.refreshToken }).expect(401);
      const after = await test.tenantDb.transaction(owner.tenantId, (tx) =>
        tx.userSession.count({ where: { userId: member.id, revokedAt: null } }),
      );
      expect(after).toBe(0);
    });

    it('lets an owner sign a team member out, and nobody else', async () => {
      const owner = await company('Owner Revoke Co');
      const member = await addMember(owner);
      const manager = await addMember(owner, 'project_manager');
      const session = await signIn(member.phone);
      const managerSession = await signIn(manager.phone);

      const company_ = await test.http().get('/v1/security/sessions').set(auth(owner)).expect(200);
      expect(company_.body.items.some((row: { user_id: string }) => row.user_id === member.id)).toBe(true);

      await test.http().post(`/v1/security/members/${member.id}/sign-out`).set(auth(managerSession)).expect(403);
      const ended = await test.http().post(`/v1/security/members/${member.id}/sign-out`).set(auth(owner)).expect(200);
      expect(ended.body.ended).toBe(1);
      await test.http().post('/v1/auth/refresh').send({ refresh_token: session.refreshToken }).expect(401);
      expect(await auditActions(owner.tenantId, 'security.sessions_revoked')).toHaveLength(1);
    });
  });

  // --------------------------------------------------------------------------------------------

  describe('IP allow-list', () => {
    const OFFICE = '203.0.113.0/24';
    const INSIDE = '203.0.113.40';
    const OUTSIDE = '198.51.100.9';

    it('refuses requests and sign-ins from outside, owners exempt', async () => {
      const owner = await company('Office Co');
      const member = await addMember(owner, 'accounts');
      const before = await signIn(member.phone, { ip: OUTSIDE });

      const saved = await allowList(owner, { ip_mode: 'everyone', ip_rules: [{ cidr: '203.0.113.77/24', label: 'Head office' }] });
      expect(saved.status).toBe(200);
      expect(saved.body.ip.rules).toEqual([{ cidr: OFFICE, label: 'Head office' }]);

      // An existing session from outside is stopped at its next request and at refresh.
      const refused = await test.http().get('/v1/me').set(auth(before)).set(from(OUTSIDE)).expect(403);
      expect(refused.body).toMatchObject({ code: 'IP_NOT_ALLOWED', details: { ip: OUTSIDE } });
      await test.http().get('/v1/me').set(auth(before)).set(from(INSIDE)).expect(200);
      await test.http().post('/v1/auth/refresh').set(from(OUTSIDE)).send({ refresh_token: before.refreshToken }).expect(403);
      // Signing out works from anywhere.
      await test.http().post('/v1/auth/logout').set(auth(before)).set(from(OUTSIDE)).expect(204);

      // A new sign-in from outside is refused and logged; from inside it works.
      const outside = await test
        .http()
        .post('/v1/auth/exchange')
        .set(from(OUTSIDE))
        .send({ firebase_token: `dev:${member.phone}` })
        .expect(403);
      expect(outside.body.code).toBe('IP_NOT_ALLOWED');
      const logged = await auditActions(owner.tenantId, 'security.sign_in_refused');
      expect(logged[0]?.after).toMatchObject({ reason: 'ip_not_allowed', ip: OUTSIDE });
      const inside = await signIn(member.phone, { ip: INSIDE });
      await test.http().get('/v1/me').set(auth(inside)).set(from(INSIDE)).expect(200);

      // The owner is exempt by default, anywhere.
      await test.http().get('/v1/me').set(auth(owner)).set(from(OUTSIDE)).expect(200);
      await signIn(owner.phone.slice(2), { ip: OUTSIDE });
    });

    it('refuses to save a list that shuts out the owner saving it, unless confirmed', async () => {
      const owner = await company('Lockout Guard Co');
      const body = { ip_mode: 'everyone', ip_rules: [{ cidr: OFFICE }], ip_exempt_owners: false };

      const refused = await allowList(owner, body, OUTSIDE);
      expect(refused.status).toBe(409);
      expect(refused.body.details).toEqual({ reason: 'self_lockout', current_ip: OUTSIDE });

      // From inside the list it saves without a question.
      expect((await allowList(owner, body, INSIDE)).status).toBe(200);
      await test.http().get('/v1/me').set(auth(owner)).set(from(OUTSIDE)).expect(403);

      // Confirmed, it saves even from outside (and the owner is then outside it).
      const confirmed = await allowList(owner, { ...body, ip_rules: [{ cidr: '192.0.2.0/24' }], confirm_self_lockout: true }, INSIDE);
      expect(confirmed.status).toBe(200);
    });

    it('exempts chosen roles, skips app sessions in web mode, and matches IPv6', async () => {
      const owner = await company('Modes Co');
      const supervisor = await addMember(owner, 'site_supervisor');
      const accounts = await addMember(owner, 'accounts');

      await allowList(owner, {
        ip_mode: 'web',
        ip_rules: [{ cidr: OFFICE }, { cidr: '2001:db8:aa::/48', label: 'Office v6' }],
        ip_exempt_roles: ['site_supervisor'],
      }).then((response) => expect(response.status).toBe(200));

      // A supervisor is exempt from anywhere.
      const crew = await signIn(supervisor.phone, { ip: OUTSIDE });
      await test.http().get('/v1/me').set(auth(crew)).set(from(OUTSIDE)).expect(200);

      // Accounts on the web: only from the office, IPv4 or IPv6.
      await test.http().post('/v1/auth/exchange').set(from(OUTSIDE)).send({ firebase_token: `dev:${accounts.phone}` }).expect(403);
      const v6 = await signIn(accounts.phone, { ip: '2001:db8:aa:1::5' });
      await test.http().get('/v1/me').set(auth(v6)).set(from('2001:db8:aa:1::5')).expect(200);
      await test.http().get('/v1/me').set(auth(v6)).set(from('2001:db8:bb::5')).expect(403);

      // Accounts in the mobile app: web mode leaves the app alone, wherever it is.
      const app = await signIn(accounts.phone, { ip: OUTSIDE, deviceId: 'accounts-phone' });
      expect(claimsOf(app.accessToken)['app']).toBe(true);
      await test.http().get('/v1/me').set(auth(app)).set(from(OUTSIDE)).expect(200);
      await test.http().post('/v1/auth/refresh').set(from(OUTSIDE)).send({ refresh_token: app.refreshToken }).expect(200);
    });

    it('validates what it is given', async () => {
      const owner = await company('Validate Co');
      expect((await allowList(owner, { ip_mode: 'everyone', ip_rules: [] })).status).toBe(422);
      expect((await allowList(owner, { ip_mode: 'everyone', ip_rules: [{ cidr: '10.0.0.0/33' }] })).status).toBe(422);
      expect((await allowList(owner, { ip_mode: 'sometimes', ip_rules: [] })).status).toBe(422);
    });
  });

  // --------------------------------------------------------------------------------------------

  describe('isolation', () => {
    it('keeps one company’s rules, sessions and authenticators to itself', async () => {
      const strict = await verifiedOwner('Strict Co');
      const relaxed = await company('Relaxed Co');
      await test.http().put('/v1/security/mfa-policy').set(auth(strict)).send({ mfa_policy: 'everyone' }).expect(200);
      await allowList(strict, { ip_mode: 'everyone', ip_rules: [{ cidr: '203.0.113.0/24' }], ip_exempt_owners: false });
      test.app.get(TenantCache).invalidate(relaxed.tenantId);

      // The other company is untouched.
      await test.http().get('/v1/me').set(auth(relaxed)).set(from('198.51.100.200')).expect(200);
      const settings = await test.http().get('/v1/security/settings').set(auth(relaxed)).expect(200);
      expect(settings.body.mfa.policy).toBe('off');
      expect(settings.body.ip.mode).toBe('off');

      // Neither can reach into the other's sessions or people.
      const strictSession = claimsOf(strict.accessToken)['sid'];
      await test.http().delete(`/v1/auth/sessions/${strictSession}`).set(auth(relaxed)).expect(404);
      await test.http().post(`/v1/security/members/${strict.ownerId}/sign-out`).set(auth(relaxed)).expect(404);
      const company_ = await test.http().get('/v1/security/sessions').set(auth(relaxed)).expect(200);
      expect(company_.body.items.every((row: { user_id: string }) => row.user_id !== strict.ownerId)).toBe(true);

      // Under the other company's RLS context the authenticator rows simply do not exist.
      const seen = await test.tenantDb.transaction(relaxed.tenantId, (tx) =>
        Promise.all([
          tx.mfaFactor.count({ where: { userId: strict.ownerId } }),
          tx.mfaRecoveryCode.count({ where: { userId: strict.ownerId } }),
          tx.userSession.count({ where: { userId: strict.ownerId } }),
          tx.tenantSecuritySettings.count({ where: { tenantId: strict.tenantId } }),
        ]),
      );
      expect(seen).toEqual([0, 0, 0, 0]);
    });

    it('never carries a second factor into another company on switch', async () => {
      const home = await verifiedOwner('Home Co');
      const elsewhere = await company('Elsewhere Co');
      // The same person, invited into a second company.
      await test
        .http()
        .post('/v1/tenants/current/invite')
        .set(auth(elsewhere))
        .send({ phone: home.phone, name: 'Visiting owner', role: 'project_manager' })
        .expect(201);
      expect(claimsOf(home.accessToken)['mfa']).toBe(true);

      const switched = await test
        .http()
        .post('/v1/auth/switch')
        .set(auth(home))
        .send({ tenant_id: elsewhere.tenantId })
        .expect(200);
      expect(claimsOf(switched.body.access_token)['tenant_id']).toBe(elsewhere.tenantId);
      expect(claimsOf(switched.body.access_token)['mfa']).toBeUndefined();
    });
  });

  async function allowList(owner: Session, body: Record<string, unknown>, ip = '203.0.113.40') {
    return test.http().put('/v1/security/ip-policy').set(auth(owner)).set(from(ip)).send(body);
  }
});
