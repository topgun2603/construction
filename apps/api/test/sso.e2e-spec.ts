// Must come first: the SSO settings have to be in the environment before the app loads `env()`.
import { SSO_TEST_API, SSO_TEST_WEB_CALLBACK, restoreSsoEnv } from './utils/sso-env';
import { randomBytes, randomUUID } from 'node:crypto';
import { promises as dns } from 'node:dns';
import { ssoIsPlaceholderPhone } from '@sitebook/shared';
import {
  createTestApp,
  destroyTenant,
  onboardTenant,
  uniquePhone,
  type OnboardedTenant,
  type TestApp,
} from './utils/test-app';
import { MockOidcProvider, idpKeys, samlRequestIdOf, samlResponse, type TestIdpKeys } from './utils/sso-mocks';

/**
 * Single sign-on (roadmap Phase 3, item 1), end to end against a real database and local stand-ins
 * for the identity providers: verified domains, OIDC and SAML sign-in and everything they must
 * refuse, just-in-time accounts, enforcement with the owner's break-glass path, and that one
 * company's provider can never sign anybody into another company.
 */
describe('Single sign-on', () => {
  let test: TestApp;
  const tenants: string[] = [];
  const providers: MockOidcProvider[] = [];

  beforeAll(async () => {
    test = await createTestApp();
  });

  afterAll(async () => {
    for (const id of tenants) await destroyTenant(test, id);
    for (const provider of providers) await provider.stop();
    await test.close();
    restoreSsoEnv();
  });

  afterEach(() => jest.restoreAllMocks());

  const auth = (tenant: { accessToken: string }) => ({ Authorization: `Bearer ${tenant.accessToken}` });
  const uniqueDomain = (label: string) => `${label}-${randomBytes(4).toString('hex')}.example`;
  const binding = () => randomBytes(24).toString('base64url');

  async function company(name: string): Promise<OnboardedTenant> {
    const tenant = await onboardTenant(test, { name, phone: uniquePhone() });
    tenants.push(tenant.tenantId);
    return tenant;
  }

  async function provider(): Promise<MockOidcProvider> {
    const started = await new MockOidcProvider().start();
    providers.push(started);
    return started;
  }

  /** Claims a domain and passes the DNS check with a stubbed TXT lookup. */
  async function verifyDomain(tenant: OnboardedTenant, domain: string): Promise<void> {
    const added = await test.http().post('/v1/sso/domains').set(auth(tenant)).send({ domain }).expect(201);
    const row = added.body.domains.find((entry: { domain: string }) => entry.domain === domain);
    jest.spyOn(dns, 'resolveTxt').mockResolvedValueOnce([['v=spf1 -all'], [row.txt_value]]);
    await test.http().post(`/v1/sso/domains/${row.id}/verify`).set(auth(tenant)).expect(200);
  }

  async function defaultRoleId(tenant: OnboardedTenant, base = 'site_supervisor'): Promise<string> {
    const settings = await test.http().get('/v1/sso/settings').set(auth(tenant)).expect(200);
    return settings.body.roles.find((role: { base_role: string }) => role.base_role === base).id;
  }

  async function connectOidc(
    tenant: OnboardedTenant,
    idp: MockOidcProvider,
    extra: Record<string, unknown> = {},
  ): Promise<void> {
    await test
      .http()
      .put('/v1/sso/connection')
      .set(auth(tenant))
      .send({
        protocol: 'oidc',
        preset: 'okta',
        enabled: true,
        oidc_issuer: idp.issuer,
        oidc_client_id: idp.clientId,
        oidc_client_secret: idp.clientSecret,
        ...extra,
      })
      .expect(200);
  }

  async function connectSaml(tenant: OnboardedTenant, keys: TestIdpKeys, extra: Record<string, unknown> = {}) {
    await test
      .http()
      .put('/v1/sso/connection')
      .set(auth(tenant))
      .send({
        protocol: 'saml',
        preset: 'entra',
        enabled: true,
        saml_idp_entity_id: `https://idp.test/${tenant.tenantId}`,
        saml_idp_sso_url: 'https://idp.test/saml/sso',
        saml_idp_certificate: keys.cert,
        ...extra,
      })
      .expect(200);
  }

  /** Where the callback sent the browser: a ticket, or a reason. */
  function outcomeOf(location: string): { ticket?: string; error?: string } {
    expect(location.startsWith(`${SSO_TEST_WEB_CALLBACK}#`)).toBe(true);
    const fragment = new URLSearchParams(location.split('#')[1]);
    return { ticket: fragment.get('ticket') ?? undefined, error: fragment.get('error') ?? undefined };
  }

  /** Runs an OIDC sign-in up to the callback; returns the outcome and the browser binding. */
  async function oidcCallback(
    idp: MockOidcProvider,
    email: string,
    token: (nonce: string) => Promise<string>,
  ): Promise<{ ticket?: string; error?: string; binding: string; state: string }> {
    const browser = binding();
    const started = await test.http().post('/v1/auth/sso/start').send({ email, binding: browser }).expect(200);
    const url = new URL(started.body.redirect_url);
    expect(url.origin).toBe(idp.issuer);
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('redirect_uri')).toBe(`${SSO_TEST_API}/auth/sso/oidc/callback`);
    const nonce = url.searchParams.get('nonce') as string;
    const state = url.searchParams.get('state') as string;
    idp.expectedChallenge = url.searchParams.get('code_challenge');
    idp.nextIdToken = () => token(nonce);

    const callback = await test
      .http()
      .get('/v1/auth/sso/oidc/callback')
      .query({ code: `code-${randomUUID()}`, state })
      .expect(303);
    return { ...outcomeOf(callback.headers.location as string), binding: browser, state };
  }

  async function complete(ticket: string, browser: string) {
    return test.http().post('/v1/auth/sso/complete').send({ ticket, binding: browser });
  }

  async function addMember(tenant: OnboardedTenant, email: string | null, role = 'site_supervisor') {
    const phone = uniquePhone();
    const invited = await test
      .http()
      .post('/v1/tenants/current/invite')
      .set(auth(tenant))
      .send({ phone, name: 'Member', role })
      .expect(201);
    if (email) {
      await test.tenantDb.transaction(tenant.tenantId, (tx) =>
        tx.user.update({ where: { id: invited.body.id }, data: { email } }),
      );
    }
    return { id: invited.body.id as string, phone: invited.body.phone as string };
  }

  // --------------------------------------------------------------------------------------------

  describe('verified domains', () => {
    it('verifies a domain only when its TXT record carries this company’s token', async () => {
      const owner = await company('Domain Co');
      const domain = uniqueDomain('dom');
      const added = await test.http().post('/v1/sso/domains').set(auth(owner)).send({ domain: `https://${domain}/` }).expect(201);
      const row = added.body.domains[0];
      expect(row.domain).toBe(domain);
      expect(row.txt_value).toMatch(/^buildr-verification=/);

      jest.spyOn(dns, 'resolveTxt').mockResolvedValueOnce([['buildr-verification=somebody-else']]);
      await test.http().post(`/v1/sso/domains/${row.id}/verify`).set(auth(owner)).expect(422);

      // A record split into chunks, as long TXT records are, still counts.
      const value: string = row.txt_value;
      jest.spyOn(dns, 'resolveTxt').mockResolvedValueOnce([[value.slice(0, 10), value.slice(10)]]);
      const verified = await test.http().post(`/v1/sso/domains/${row.id}/verify`).set(auth(owner)).expect(200);
      expect(verified.body.domains[0].verified_at).not.toBeNull();

      const directory = await test.prisma.ssoDomainDirectory.findUnique({ where: { domain } });
      expect(directory?.tenantId).toBe(owner.tenantId);
    });

    it('lets only one company verify a domain', async () => {
      const first = await company('First Claimant');
      const second = await company('Second Claimant');
      const domain = uniqueDomain('claim');
      await verifyDomain(first, domain);

      const added = await test.http().post('/v1/sso/domains').set(auth(second)).send({ domain }).expect(201);
      const row = added.body.domains[0];
      // Even with its own token in DNS, the domain stays with the company that proved it first.
      jest.spyOn(dns, 'resolveTxt').mockResolvedValue([[row.txt_value]]);
      const refused = await test.http().post(`/v1/sso/domains/${row.id}/verify`).set(auth(second)).expect(409);
      expect(refused.body.message).toMatch(/already verified by another company/);
    });

    it('keeps single sign-on settings to owners', async () => {
      const owner = await company('Owner Only Co');
      const manager = await addMember(owner, null, 'project_manager');
      const session = await test.http().post('/v1/auth/exchange').send({ firebase_token: `dev:${manager.phone}` }).expect(200);
      await test.http().get('/v1/sso/settings').set(auth({ accessToken: session.body.access_token })).expect(403);
    });

    it('says plainly when a domain has no single sign-on', async () => {
      const refused = await test
        .http()
        .post('/v1/auth/sso/start')
        .send({ email: `someone@${uniqueDomain('none')}`, binding: binding() })
        .expect(404);
      expect(refused.body.message).toMatch(/not set up/);
    });
  });

  describe('OpenID Connect', () => {
    let owner: OnboardedTenant;
    let idp: MockOidcProvider;
    let domain: string;

    beforeAll(async () => {
      owner = await company('OIDC Co');
      idp = await provider();
      domain = uniqueDomain('oidc');
      await verifyDomain(owner, domain);
      await connectOidc(owner, idp);
    });

    it('signs in a team member and issues the usual token pair with an email identity', async () => {
      const email = `rajesh@${domain}`;
      const member = await addMember(owner, email);

      const result = await oidcCallback(idp, email, (nonce) => idp.idToken({ nonce, email }));
      expect(result.error).toBeUndefined();
      const session = await complete(result.ticket as string, result.binding);
      expect(session.status).toBe(200);
      expect(session.body.access_token).toBeTruthy();

      const me = await test.http().get('/v1/me').set(auth({ accessToken: session.body.access_token })).expect(200);
      expect(me.body.user.id).toBe(member.id);
      expect(me.body.user.status).toBe('active');
      const [, payload] = (session.body.access_token as string).split('.');
      const claims = JSON.parse(Buffer.from(payload as string, 'base64url').toString('utf8'));
      expect(claims.idn).toBe(`email:${email}`);
      expect(claims.via).toBe('sso');

      // The refresh token carries both forward.
      const refreshed = await test.http().post('/v1/auth/refresh').send({ refresh_token: session.body.refresh_token }).expect(200);
      expect(refreshed.body.access_token).toBeTruthy();

      const logged = await test.tenantDb.transaction(owner.tenantId, (tx) =>
        tx.auditLog.findFirst({ where: { action: 'sso.sign_in', entityId: member.id } }),
      );
      expect(logged).not.toBeNull();
    });

    it('refuses a ticket from another browser, and a ticket used twice', async () => {
      const email = `twice@${domain}`;
      await addMember(owner, email);
      const result = await oidcCallback(idp, email, (nonce) => idp.idToken({ nonce, email }));

      expect((await complete(result.ticket as string, binding())).status).toBe(401);
      // The mismatch spent it: not even the right browser can use it now.
      expect((await complete(result.ticket as string, result.binding)).status).toBe(401);

      const again = await oidcCallback(idp, email, (nonce) => idp.idToken({ nonce, email }));
      expect((await complete(again.ticket as string, again.binding)).status).toBe(200);
      expect((await complete(again.ticket as string, again.binding)).status).toBe(401);
    });

    it('refuses a replayed callback', async () => {
      const email = `replay@${domain}`;
      await addMember(owner, email);
      const first = await oidcCallback(idp, email, (nonce) => idp.idToken({ nonce, email }));
      expect(first.ticket).toBeTruthy();
      const replay = await test.http().get('/v1/auth/sso/oidc/callback').query({ code: 'again', state: first.state }).expect(303);
      expect(outcomeOf(replay.headers.location as string).error).toMatch(/expired or was already used/);
    });

    it.each([
      ['a bad signature', async (nonce: string, email: string) => idp.idToken({ nonce, email, signWith: await idp.impostorKey() })],
      ['the wrong audience', (nonce: string, email: string) => idp.idToken({ nonce, email, claims: { aud: 'someone-else' } })],
      ['the wrong nonce', (_nonce: string, email: string) => idp.idToken({ nonce: 'not-the-nonce', email })],
      ['an expired token', (nonce: string, email: string) => idp.idToken({ nonce, email, expiresIn: -120 })],
      ['the wrong issuer', (nonce: string, email: string) => idp.idToken({ nonce, email, claims: { iss: 'https://evil.test' } })],
      ['an unverified email', (nonce: string, email: string) => idp.idToken({ nonce, email, claims: { email_verified: false } })],
    ])('refuses %s', async (_label, make) => {
      const email = `refuse-${randomBytes(3).toString('hex')}@${domain}`;
      await addMember(owner, email);
      const result = await oidcCallback(idp, email, (nonce) => make(nonce, email));
      expect(result.ticket).toBeUndefined();
      expect(result.error).toBeTruthy();
    });

    it('refuses somebody who is not on the team while just-in-time accounts are off', async () => {
      const result = await oidcCallback(idp, `stranger@${domain}`, (nonce) =>
        idp.idToken({ nonce, email: `stranger@${domain}` }),
      );
      expect(result.error).toMatch(/not on this company’s team/);
      const refusal = await test.tenantDb.transaction(owner.tenantId, (tx) =>
        tx.auditLog.findFirst({ where: { action: 'sso.sign_in_refused' }, orderBy: { createdAt: 'desc' } }),
      );
      expect(refusal?.after).toMatchObject({ email: `stranger@${domain}` });
    });

    it('creates the account at first sign-in when just-in-time accounts are on, never as an owner', async () => {
      const ownerRole = await defaultRoleId(owner, 'owner').catch(() => null);
      expect(ownerRole).toBeNull(); // owner roles are not even offered

      const ownerRoleRow = await test.tenantDb.transaction(owner.tenantId, (tx) =>
        tx.role.findFirstOrThrow({ where: { baseRole: 'owner' }, select: { id: true } }),
      );
      await test
        .http()
        .put('/v1/sso/connection')
        .set(auth(owner))
        .send({ protocol: 'oidc', enabled: true, jit_enabled: true, jit_role_id: ownerRoleRow.id })
        .expect(422);

      await connectOidc(owner, idp, { jit_enabled: true, jit_role_id: await defaultRoleId(owner) });
      const email = `newcomer@${domain}`;
      const result = await oidcCallback(idp, email, (nonce) => idp.idToken({ nonce, email, claims: { name: 'New Comer' } }));
      const session = await complete(result.ticket as string, result.binding);
      expect(session.status).toBe(200);
      const me = await test.http().get('/v1/me').set(auth({ accessToken: session.body.access_token })).expect(200);
      expect(me.body.user).toMatchObject({ email, name: 'New Comer', role: 'site_supervisor', status: 'active' });
      expect(ssoIsPlaceholderPhone(me.body.user.phone)).toBe(true);

      await connectOidc(owner, idp, { jit_enabled: false });
    });

    it('refuses an address on a domain the company has not verified', async () => {
      const email = `outsider@${uniqueDomain('unverified')}`;
      // Started with a verified address, answered by the provider with another one.
      const result = await oidcCallback(idp, `starter@${domain}`, (nonce) => idp.idToken({ nonce, email }));
      expect(result.error).toMatch(/not on a domain this company has verified/);
    });
  });

  describe('SAML 2.0', () => {
    let owner: OnboardedTenant;
    let domain: string;
    const keys = idpKeys('idp-a');
    const impostor = idpKeys('idp-b');

    beforeAll(async () => {
      owner = await company('SAML Co');
      domain = uniqueDomain('saml');
      await verifyDomain(owner, domain);
      await connectSaml(owner, keys);
      await addMember(owner, `saml-tamper@${domain}`);
      await addMember(owner, `ceo@${domain}`);
    });

    const acs = () => `${SSO_TEST_API}/auth/sso/saml/${owner.tenantId}/acs`;
    const entityId = () => `${SSO_TEST_API}/auth/sso/saml/${owner.tenantId}/metadata`;

    async function startSaml(email: string) {
      const browser = binding();
      const started = await test.http().post('/v1/auth/sso/start').send({ email, binding: browser }).expect(200);
      const url = new URL(started.body.redirect_url);
      expect(url.origin + url.pathname).toBe('https://idp.test/saml/sso');
      return {
        browser,
        relayState: url.searchParams.get('RelayState') as string,
        requestId: samlRequestIdOf(started.body.redirect_url),
      };
    }

    async function post(tenantId: string, relayState: string, response: string) {
      const res = await test
        .http()
        .post(`/v1/auth/sso/saml/${tenantId}/acs`)
        .type('form')
        .send({ SAMLResponse: response, RelayState: relayState })
        .expect(303);
      return outcomeOf(res.headers.location as string);
    }

    function response(requestId: string, email: string, overrides: Partial<Parameters<typeof samlResponse>[0]> = {}) {
      return samlResponse({
        keys,
        issuer: `https://idp.test/${owner.tenantId}`,
        audience: entityId(),
        acsUrl: acs(),
        inResponseTo: requestId,
        email,
        ...overrides,
      });
    }

    it('serves SP metadata with this company’s entity id and ACS URL', async () => {
      const metadata = await test.http().get(`/v1/auth/sso/saml/${owner.tenantId}/metadata`).expect(200);
      expect(metadata.text).toContain(`entityID="${entityId()}"`);
      expect(metadata.text).toContain(`Location="${acs()}"`);
    });

    it.each(['assertion', 'response'] as const)('signs in with a signed %s', async (sign) => {
      const email = `saml-${sign}@${domain}`;
      const member = await addMember(owner, email);
      const flow = await startSaml(email);
      const outcome = await post(owner.tenantId, flow.relayState, response(flow.requestId, email, { sign }));
      expect(outcome.error).toBeUndefined();
      const session = await complete(outcome.ticket as string, flow.browser);
      expect(session.status).toBe(200);
      const me = await test.http().get('/v1/me').set(auth({ accessToken: session.body.access_token })).expect(200);
      expect(me.body.user.id).toBe(member.id);
    });

    it('refuses a replayed response', async () => {
      const email = `saml-replay@${domain}`;
      await addMember(owner, email);
      const flow = await startSaml(email);
      const signed = response(flow.requestId, email);
      expect((await post(owner.tenantId, flow.relayState, signed)).ticket).toBeTruthy();
      expect((await post(owner.tenantId, flow.relayState, signed)).error).toMatch(/expired or was already used/);
    });

    it.each([
      ['unsigned', { sign: 'none' as const }],
      ['tampered after signing', { tamper: (xml: string) => xml.replace(/saml-tamper@/g, 'ceo@') }],
      ['signed by another certificate', { keys: impostor }],
      ['for another audience', { audience: 'https://someone-else.test/sp' }],
      ['expired', { validMinutes: -10 }],
      ['addressed to another ACS', { acsUrl: 'https://elsewhere.test/acs' }],
      ['from another issuer', { issuer: 'https://idp.test/somebody-else' }],
    ])('refuses a response that is %s', async (_label, overrides) => {
      // Both addresses are real team members, so only the response itself can be the reason.
      const email = `saml-tamper@${domain}`;
      const flow = await startSaml(email);
      const outcome = await post(owner.tenantId, flow.relayState, response(flow.requestId, email, overrides));
      expect(outcome.ticket).toBeUndefined();
      expect(outcome.error).toBeTruthy();
    });

    it('refuses a response to a different request', async () => {
      const email = `saml-other@${domain}`;
      await addMember(owner, email);
      const flow = await startSaml(email);
      const outcome = await post(owner.tenantId, flow.relayState, response('_not-our-request', email));
      expect(outcome.error).toBeTruthy();
    });
  });

  describe('company isolation', () => {
    it('never lets one company’s identity provider sign anybody into another company', async () => {
      const alpha = await company('Alpha Builders');
      const beta = await company('Beta Builders');
      const alphaDomain = uniqueDomain('alpha');
      const betaDomain = uniqueDomain('beta');
      await verifyDomain(alpha, alphaDomain);
      await verifyDomain(beta, betaDomain);
      const alphaKeys = idpKeys('idp-a');
      const betaKeys = idpKeys('idp-b');
      await connectSaml(alpha, alphaKeys);
      await connectSaml(beta, betaKeys, { jit_enabled: true, jit_role_id: await defaultRoleId(beta) });
      const victim = `ceo@${alphaDomain}`;
      await addMember(alpha, victim, 'project_manager');

      const startFor = async (email: string) => {
        const browser = binding();
        const started = await test.http().post('/v1/auth/sso/start').send({ email, binding: browser }).expect(200);
        const url = new URL(started.body.redirect_url);
        return {
          browser,
          relayState: url.searchParams.get('RelayState') as string,
          requestId: samlRequestIdOf(started.body.redirect_url),
        };
      };
      const postTo = async (tenantId: string, relayState: string, xml: string) => {
        const res = await test
          .http()
          .post(`/v1/auth/sso/saml/${tenantId}/acs`)
          .type('form')
          .send({ SAMLResponse: xml, RelayState: relayState })
          .expect(303);
        return outcomeOf(res.headers.location as string);
      };
      const forTenant = (tenantId: string, keys: TestIdpKeys, requestId: string, email: string) =>
        samlResponse({
          keys,
          issuer: `https://idp.test/${tenantId}`,
          audience: `${SSO_TEST_API}/auth/sso/saml/${tenantId}/metadata`,
          acsUrl: `${SSO_TEST_API}/auth/sso/saml/${tenantId}/acs`,
          inResponseTo: requestId,
          email,
        });

      // 1. Beta's provider signs an answer to Alpha's sign-in: Alpha's certificate refuses it.
      const alphaFlow = await startFor(victim);
      const forged = samlResponse({
        keys: betaKeys,
        issuer: `https://idp.test/${alpha.tenantId}`,
        audience: `${SSO_TEST_API}/auth/sso/saml/${alpha.tenantId}/metadata`,
        acsUrl: `${SSO_TEST_API}/auth/sso/saml/${alpha.tenantId}/acs`,
        inResponseTo: alphaFlow.requestId,
        email: victim,
      });
      expect((await postTo(alpha.tenantId, alphaFlow.relayState, forged)).error).toBeTruthy();

      // 2. Beta's provider asserts Alpha's CEO inside Beta's own sign-in: Beta has not verified
      //    Alpha's domain, so no `email:` identity for that address is ever minted.
      const betaFlow = await startFor(`someone@${betaDomain}`);
      const spoof = await postTo(beta.tenantId, betaFlow.relayState, forTenant(beta.tenantId, betaKeys, betaFlow.requestId, victim));
      expect(spoof.error).toMatch(/not on a domain this company has verified/);

      // 3. Beta's answer posted to Alpha's ACS with Beta's state: the company in the URL and the
      //    state disagree.
      const betaFlow2 = await startFor(`other@${betaDomain}`);
      const spliced = await postTo(
        alpha.tenantId,
        betaFlow2.relayState,
        forTenant(beta.tenantId, betaKeys, betaFlow2.requestId, `other@${betaDomain}`),
      );
      expect(spliced.error).toMatch(/different company/);

      // Nobody at Alpha signed in, and nobody with Alpha's address was created at Beta.
      const created = await test.tenantDb.transaction(beta.tenantId, (tx) => tx.user.count({ where: { email: victim } }));
      expect(created).toBe(0);
    });
  });

  describe('enforcement and the owner’s break-glass path', () => {
    it('refuses every other way in for people on the domain, but keeps phone sign-in for the owner', async () => {
      const owner = await company('Enforced Co');
      const idp = await provider();
      const domain = uniqueDomain('enforced');
      await verifyDomain(owner, domain);

      // The owner has a work address on the domain too.
      await test.tenantDb.transaction(owner.tenantId, (tx) =>
        tx.user.update({ where: { id: owner.ownerId }, data: { email: `owner@${domain}` } }),
      );
      const member = await addMember(owner, `member@${domain}`);
      const siteHand = await addMember(owner, null);

      // A session from before enforcement, by phone.
      const before = await test.http().post('/v1/auth/exchange').send({ firebase_token: `dev:${member.phone}` }).expect(200);

      // Enforcing needs single sign-on switched on first.
      await test
        .http()
        .put('/v1/sso/connection')
        .set(auth(owner))
        .send({ protocol: 'oidc', enabled: false, enforce_sso: true })
        .expect(422);
      await connectOidc(owner, idp, { enforce_sso: true });

      const phone = await test.http().post('/v1/auth/exchange').send({ firebase_token: `dev:${member.phone}` }).expect(403);
      expect(phone.body.code).toBe('SSO_REQUIRED');
      const google = await test.http().post('/v1/auth/exchange').send({ firebase_token: `dev:member@${domain}` }).expect(403);
      expect(google.body.code).toBe('SSO_REQUIRED');
      const refresh = await test.http().post('/v1/auth/refresh').send({ refresh_token: before.body.refresh_token }).expect(401);
      expect(refresh.body.code).toBe('SSO_REQUIRED');

      // Break-glass: the owner's phone still works; their Google sign-in on the domain does not.
      await test.http().post('/v1/auth/exchange').send({ firebase_token: `dev:${owner.phone}` }).expect(200);
      await test.http().post('/v1/auth/exchange').send({ firebase_token: `dev:owner@${domain}` }).expect(403);

      // Somebody with no address on the domain is not affected at all.
      await test.http().post('/v1/auth/exchange').send({ firebase_token: `dev:${siteHand.phone}` }).expect(200);

      // And single sign-on itself works, refresh included.
      const result = await oidcCallback(idp, `member@${domain}`, (nonce) => idp.idToken({ nonce, email: `member@${domain}` }));
      const session = await complete(result.ticket as string, result.binding);
      expect(session.status).toBe(200);
      await test.http().post('/v1/auth/refresh').send({ refresh_token: session.body.refresh_token }).expect(200);
    });
  });
});
