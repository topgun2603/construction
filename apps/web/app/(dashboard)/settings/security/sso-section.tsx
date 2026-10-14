'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition, type FormEvent, type ReactNode } from 'react';
import { Check, Copy, Download, KeyRound, Loader2, ShieldCheck, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import {
  SSO_DEFAULT_SCOPES,
  SSO_PRESETS,
  SSO_PRESET_GUIDES,
  type SsoConnectionInput,
  type SsoPreset,
  type SsoProtocol,
} from '@sitebook/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useLanguage } from '@/components/language-provider';
import { useFormat } from '@/components/format-provider';
import type { ActionResult } from '@/lib/server-api';
import {
  addScimRoleMapping,
  addSsoDomain,
  createScimToken,
  importSsoSamlMetadata,
  removeScimRoleMapping,
  removeSsoDomain,
  revokeScimTokens,
  saveSsoConnection,
  verifySsoDomain,
} from '@/lib/sso-actions';
import type { SsoSettings } from '@/lib/sso-types';

/**
 * Settings → Security → Single sign-on: the connection to the company's identity provider, the
 * email domains it vouches for, and SCIM provisioning. Three cards, each saving on its own, so a
 * half-finished connection never blocks claiming a domain and the other way round.
 */
export function SsoSection({ settings }: { settings: SsoSettings }) {
  const { t } = useLanguage();
  return (
    <section aria-labelledby="sso-heading" className="flex flex-col gap-4">
      <header className="flex flex-col gap-1">
        <h2 id="sso-heading" className="text-[17px] font-semibold">
          {t('Single sign-on')}
        </h2>
        <p className="max-w-2xl text-[13.5px] leading-relaxed text-ink-muted">
          {t(
            'Let your people sign in with Microsoft Entra ID, Google Workspace, Okta or any OpenID Connect or SAML 2.0 provider, and let that provider add and switch off accounts.',
          )}
        </p>
      </header>
      {!settings.deployment.urls_configured && (
        <p className="rounded-btn border border-pending-line bg-pending-bg px-3.5 py-2.5 text-[13px] leading-relaxed text-pending-fg">
          {t('Single sign-on is not configured on this deployment yet (API_PUBLIC_URL and WEB_BASE_URL). You can prepare the settings, but not switch them on.')}
        </p>
      )}
      <DomainsCard settings={settings} />
      <ConnectionCard settings={settings} />
      <ProvisioningCard settings={settings} />
    </section>
  );
}

// --- shared bits ---------------------------------------------------------------------------------

function useSubmit() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  function run<T>(action: () => Promise<ActionResult<T>>, success: string | null, after?: (data: T | undefined) => void) {
    setError(null);
    start(async () => {
      const result = await action();
      if (!result.ok) {
        setError(result.error ?? 'That did not work. Try again.');
        return;
      }
      if (success) toast.success(success);
      after?.(result.data);
      router.refresh();
    });
  }
  return { pending, error, run };
}

function FormError({ error }: { error: string | null }) {
  if (!error) return null;
  return (
    <p role="alert" className="rounded-btn bg-blocked-bg px-3 py-2 text-[13px] leading-snug text-blocked-fg">
      {error}
    </p>
  );
}

/** A value to paste into the provider's console, with a copy button. */
function CopyValue({ label, value }: { label: string; value: string }) {
  const { t } = useLanguage();
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <span className="text-[12px] font-medium text-ink-muted">{label}</span>
      <div className="flex min-w-0 items-center gap-2">
        <code className="min-w-0 flex-1 truncate rounded-btn border border-line bg-raised px-2.5 py-1.5 font-mono text-[12.5px]">
          {value}
        </code>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-label={t('Copy')}
          onClick={() => {
            void navigator.clipboard.writeText(value).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            });
          }}
        >
          {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
        </Button>
      </div>
    </div>
  );
}

function Toggle({
  id,
  checked,
  onChange,
  label,
  hint,
  disabled,
}: {
  id: string;
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
  hint?: ReactNode;
  disabled?: boolean;
}) {
  return (
    <label htmlFor={id} className="flex items-start gap-3">
      <input
        id={id}
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
        className="mt-0.5 size-4 flex-none accent-accent"
      />
      <span className="flex flex-col gap-0.5">
        <span className="text-[14px] font-medium">{label}</span>
        {hint && <span className="text-[12.5px] leading-relaxed text-ink-muted">{hint}</span>}
      </span>
    </label>
  );
}

// --- domains -------------------------------------------------------------------------------------

function DomainsCard({ settings }: { settings: SsoSettings }) {
  const { t } = useLanguage();
  const { shortDate } = useFormat();
  const { pending, error, run } = useSubmit();
  const [domain, setDomain] = useState('');

  function onAdd(event: FormEvent) {
    event.preventDefault();
    run(() => addSsoDomain(domain), t('Domain added'), () => setDomain(''));
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('Verified email domains')}</CardTitle>
        <CardDescription>
          {t('Single sign-on only signs in addresses on domains you have proved are yours. Add a TXT record to the domain’s DNS, then press Verify. A domain can belong to one company only.')}
        </CardDescription>
      </CardHeader>
      <div className="flex flex-col gap-4 border-t border-line-soft p-4">
        {settings.domains.length > 0 && (
          <ul className="flex flex-col divide-y divide-line-soft">
            {settings.domains.map((row) => (
              <li key={row.id} className="flex flex-col gap-2 py-3 first:pt-0">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-[14px] font-medium">{row.domain}</span>
                    {row.verified_at ? (
                      <Badge tone="done">{t('Verified')}</Badge>
                    ) : (
                      <Badge tone="pending">{t('Not verified')}</Badge>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    {!row.verified_at && (
                      <Button size="sm" variant="secondary" disabled={pending} onClick={() => run(() => verifySsoDomain(row.id), t('Domain verified'))}>
                        {t('Verify')}
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-label={t('Remove')}
                      disabled={pending}
                      onClick={() => run(() => removeSsoDomain(row.id), t('Domain removed'))}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                </div>
                {row.verified_at ? (
                  <span className="text-[12.5px] text-ink-muted">
                    {t('Verified')} {shortDate(row.verified_at.slice(0, 10))}
                  </span>
                ) : (
                  <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
                    <CopyValue label={t('TXT record on')} value={row.txt_name} />
                    <CopyValue label={t('Value')} value={row.txt_value} />
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
        <form onSubmit={onAdd} className="flex flex-wrap items-end gap-2">
          <Field label={t('Domain')} htmlFor="sso-domain" className="min-w-[220px] flex-1">
            <Input id="sso-domain" placeholder="alnoor.ae" value={domain} onChange={(event) => setDomain(event.target.value)} required />
          </Field>
          <Button type="submit" variant="secondary" disabled={pending || !domain.trim()}>
            {pending ? <Loader2 className="size-4 animate-spin" /> : null}
            {t('Add domain')}
          </Button>
        </form>
        <FormError error={error} />
      </div>
    </Card>
  );
}

// --- connection ----------------------------------------------------------------------------------

function ConnectionCard({ settings }: { settings: SsoSettings }) {
  const { t } = useLanguage();
  const { pending, error, run } = useSubmit();
  const current = settings.connection;
  const sp = settings.service_provider;
  const hasVerifiedDomain = settings.domains.some((row) => row.verified_at);

  const [protocol, setProtocol] = useState<SsoProtocol>(current?.protocol ?? 'oidc');
  const [preset, setPreset] = useState<SsoPreset>(current?.preset ?? 'entra');
  const [enabled, setEnabled] = useState(current?.enabled ?? false);
  const [issuer, setIssuer] = useState(current?.oidc_issuer ?? '');
  const [clientId, setClientId] = useState(current?.oidc_client_id ?? '');
  const [clientSecret, setClientSecret] = useState('');
  const [scopes, setScopes] = useState(current?.oidc_scopes ?? SSO_DEFAULT_SCOPES);
  const [entityId, setEntityId] = useState(current?.saml_idp_entity_id ?? '');
  const [ssoUrl, setSsoUrl] = useState(current?.saml_idp_sso_url ?? '');
  const [certificate, setCertificate] = useState(current?.saml_idp_certificate ?? '');
  const [metadataUrl, setMetadataUrl] = useState(current?.saml_idp_metadata_url ?? '');
  const [metadataXml, setMetadataXml] = useState('');
  const [jit, setJit] = useState(current?.jit_enabled ?? false);
  const [jitRole, setJitRole] = useState(current?.jit_role_id ?? '');
  const [enforce, setEnforce] = useState(current?.enforce_sso ?? false);
  const [importing, startImport] = useTransition();
  const [importError, setImportError] = useState<string | null>(null);
  const guide = SSO_PRESET_GUIDES[preset];

  function onImport() {
    setImportError(null);
    startImport(async () => {
      const result = await importSsoSamlMetadata(metadataXml.trim() ? { xml: metadataXml } : { url: metadataUrl });
      if (!result.ok || !result.data) {
        setImportError(result.error ?? t('Could not read that metadata.'));
        return;
      }
      setEntityId(result.data.saml_idp_entity_id);
      setSsoUrl(result.data.saml_idp_sso_url);
      setCertificate(result.data.saml_idp_certificate);
      setMetadataXml('');
      toast.success(t('Metadata read — check the values, then save.'));
    });
  }

  function onSave(event: FormEvent) {
    event.preventDefault();
    const input: SsoConnectionInput = {
      protocol,
      preset,
      enabled,
      jit_enabled: jit,
      jit_role_id: jitRole || null,
      enforce_sso: enforce,
      ...(protocol === 'oidc'
        ? {
            oidc_issuer: issuer.trim() || null,
            oidc_client_id: clientId.trim() || null,
            oidc_scopes: scopes.trim() || SSO_DEFAULT_SCOPES,
            // Left empty, the stored secret is kept — the API never sends it back to show.
            ...(clientSecret ? { oidc_client_secret: clientSecret } : {}),
          }
        : {
            saml_idp_entity_id: entityId.trim() || null,
            saml_idp_sso_url: ssoUrl.trim() || null,
            saml_idp_certificate: certificate.trim() || null,
            saml_idp_metadata_url: metadataUrl.trim() || null,
          }),
    };
    run(() => saveSsoConnection(input), t('Single sign-on saved'), () => setClientSecret(''));
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle>{t('Identity provider')}</CardTitle>
          {current?.enabled ? <Badge tone="done">{t('On')}</Badge> : <Badge tone="neutral">{t('Off')}</Badge>}
        </div>
        <CardDescription>{t('Choose your provider and protocol, copy our values into its console, then copy its values here.')}</CardDescription>
      </CardHeader>
      <form onSubmit={onSave} className="flex flex-col gap-5 border-t border-line-soft p-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('Provider')} htmlFor="sso-preset">
            <Select value={preset} onValueChange={(value) => setPreset(value as SsoPreset)}>
              <SelectTrigger id="sso-preset">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SSO_PRESETS.map((value) => (
                  <SelectItem key={value} value={value}>
                    {t(SSO_PRESET_GUIDES[value].label)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label={t('Protocol')} htmlFor="sso-protocol">
            <Select value={protocol} onValueChange={(value) => setProtocol(value as SsoProtocol)}>
              <SelectTrigger id="sso-protocol">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="oidc">OpenID Connect</SelectItem>
                <SelectItem value="saml">SAML 2.0</SelectItem>
              </SelectContent>
            </Select>
          </Field>
        </div>

        <p className="rounded-btn border border-line bg-raised px-3.5 py-2.5 text-[13px] leading-relaxed text-ink-soft">
          {t(protocol === 'oidc' ? guide.oidcHint : guide.samlHint)}
        </p>

        {sp && (
          <div className="flex flex-col gap-3">
            <span className="text-[13px] font-semibold">{t('Copy into your provider')}</span>
            {protocol === 'oidc' ? (
              <CopyValue label={t('Redirect URI')} value={sp.oidc_redirect_uri} />
            ) : (
              <>
                <CopyValue label={t('Entity ID (audience)')} value={sp.saml_entity_id} />
                <CopyValue label={t('ACS URL (reply URL)')} value={sp.saml_acs_url} />
                <a
                  href={sp.saml_metadata_url}
                  download="buildr-sp-metadata.xml"
                  className="flex items-center gap-1.5 self-start text-[13px] font-medium text-accent underline-offset-4 hover:underline"
                >
                  <Download className="size-3.5" /> {t('Download SP metadata')}
                </a>
              </>
            )}
          </div>
        )}

        {protocol === 'oidc' ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t('Issuer URL')} htmlFor="sso-issuer" hint={guide.issuerHint} className="sm:col-span-2">
              <Input id="sso-issuer" value={issuer} onChange={(event) => setIssuer(event.target.value)} placeholder={guide.issuerHint} />
            </Field>
            <Field label={t('Client ID')} htmlFor="sso-client-id">
              <Input id="sso-client-id" value={clientId} onChange={(event) => setClientId(event.target.value)} />
            </Field>
            <Field
              label={t('Client secret')}
              htmlFor="sso-client-secret"
              hint={current?.has_client_secret ? t('A secret is stored. Leave empty to keep it.') : t('Stored encrypted; never shown again.')}
            >
              <Input
                id="sso-client-secret"
                type="password"
                autoComplete="new-password"
                value={clientSecret}
                onChange={(event) => setClientSecret(event.target.value)}
              />
            </Field>
            <Field label={t('Scopes')} htmlFor="sso-scopes" className="sm:col-span-2">
              <Input id="sso-scopes" value={scopes} onChange={(event) => setScopes(event.target.value)} />
            </Field>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-2 rounded-card border border-line p-3">
              <span className="text-[13px] font-semibold">{t('Fill in from metadata')}</span>
              <div className="flex flex-wrap items-end gap-2">
                <Field label={t('Metadata URL')} htmlFor="sso-metadata-url" className="min-w-[240px] flex-1">
                  <Input id="sso-metadata-url" value={metadataUrl} onChange={(event) => setMetadataUrl(event.target.value)} />
                </Field>
                <Button type="button" variant="secondary" disabled={importing || (!metadataUrl.trim() && !metadataXml.trim())} onClick={onImport}>
                  {importing ? <Loader2 className="size-4 animate-spin" /> : null}
                  {t('Read metadata')}
                </Button>
              </div>
              <Field label={t('…or paste the metadata XML')} htmlFor="sso-metadata-xml" optional>
                <textarea
                  id="sso-metadata-xml"
                  rows={3}
                  value={metadataXml}
                  onChange={(event) => setMetadataXml(event.target.value)}
                  className="rounded-btn border border-line-strong bg-surface px-3 py-2 font-mono text-[12px] outline-none focus:border-accent"
                />
              </Field>
              <FormError error={importError} />
            </div>
            <Field label={t('IdP entity ID')} htmlFor="sso-entity-id">
              <Input id="sso-entity-id" value={entityId} onChange={(event) => setEntityId(event.target.value)} />
            </Field>
            <Field label={t('IdP sign-in URL')} htmlFor="sso-sso-url">
              <Input id="sso-sso-url" value={ssoUrl} onChange={(event) => setSsoUrl(event.target.value)} />
            </Field>
            <Field label={t('Signing certificate')} htmlFor="sso-cert">
              <textarea
                id="sso-cert"
                rows={4}
                value={certificate}
                onChange={(event) => setCertificate(event.target.value)}
                className="rounded-btn border border-line-strong bg-surface px-3 py-2 font-mono text-[12px] outline-none focus:border-accent"
              />
            </Field>
          </div>
        )}

        <div className="flex flex-col gap-4 border-t border-line-soft pt-4">
          <Toggle
            id="sso-jit"
            checked={jit}
            onChange={setJit}
            label={t('Create accounts at first sign-in')}
            hint={t('Somebody on a verified domain who is not on the team yet gets an account with the role below. Off: they are refused until somebody adds them.')}
          />
          <Field
            label={t('Default role for new people')}
            htmlFor="sso-jit-role"
            hint={t('Also used for people your provider creates over SCIM. Never an owner.')}
          >
            <Select value={jitRole || undefined} onValueChange={setJitRole}>
              <SelectTrigger id="sso-jit-role">
                <SelectValue placeholder={t('Choose a role')} />
              </SelectTrigger>
              <SelectContent>
                {settings.roles.map((role) => (
                  <SelectItem key={role.id} value={role.id}>
                    {role.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Toggle
            id="sso-enforce"
            checked={enforce}
            onChange={setEnforce}
            disabled={!hasVerifiedDomain}
            label={t('Require single sign-on')}
            hint={
              <>
                {t('People with an address on a verified domain must use single sign-on; phone, Google and password sign-in are refused for them, and their other sessions end within 15 minutes.')}{' '}
                <strong className="font-semibold text-ink-soft">
                  {t('Owners can always still sign in with their mobile number, so a broken provider cannot lock the company out.')}
                </strong>
              </>
            }
          />
          <Toggle
            id="sso-enabled"
            checked={enabled}
            onChange={setEnabled}
            label={t('Single sign-on is on')}
            hint={t('Shows “Sign in with SSO” to people on your verified domains.')}
          />
        </div>

        <FormError error={error} />
        <Button type="submit" disabled={pending} className="gap-2 self-start">
          {pending ? <Loader2 className="size-4 animate-spin" /> : <ShieldCheck className="size-4" />}
          {t('Save')}
        </Button>
      </form>
    </Card>
  );
}

// --- provisioning --------------------------------------------------------------------------------

function ProvisioningCard({ settings }: { settings: SsoSettings }) {
  const { t } = useLanguage();
  const { shortDate } = useFormat();
  const { pending, error, run } = useSubmit();
  const [freshToken, setFreshToken] = useState<string | null>(null);
  const [groupName, setGroupName] = useState('');
  const [roleId, setRoleId] = useState('');
  const preset = settings.connection?.preset ?? 'entra';
  const live = settings.scim_tokens[0];

  function onMapping(event: FormEvent) {
    event.preventDefault();
    run(() => addScimRoleMapping({ group_name: groupName, role_id: roleId }), t('Group mapped'), () => setGroupName(''));
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('User provisioning (SCIM)')}</CardTitle>
        <CardDescription>{t(SSO_PRESET_GUIDES[preset].scimHint)}</CardDescription>
      </CardHeader>
      <div className="flex flex-col gap-4 border-t border-line-soft p-4">
        {settings.service_provider && <CopyValue label={t('SCIM base URL')} value={settings.service_provider.scim_base_url} />}

        {freshToken && (
          <div className="flex flex-col gap-2 rounded-card border border-pending-line bg-pending-bg p-3">
            <span className="text-[13px] font-semibold text-pending-fg">
              {t('Copy this token now — it will not be shown again.')}
            </span>
            <CopyValue label={t('Bearer token')} value={freshToken} />
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className="text-[13.5px] text-ink-soft">
            {live
              ? `${t('Token ending')} …${live.hint} · ${t('created')} ${shortDate(live.created_at.slice(0, 10))}${
                  live.last_used_at ? ` · ${t('last used')} ${shortDate(live.last_used_at.slice(0, 10))}` : ''
                }`
              : t('No token yet.')}
          </span>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="secondary"
              disabled={pending}
              className="gap-2"
              onClick={() => run(() => createScimToken(), null, (data) => setFreshToken(data?.token ?? null))}
            >
              <KeyRound className="size-4" />
              {live ? t('Rotate token') : t('Generate token')}
            </Button>
            {live && (
              <Button type="button" variant="destructive" disabled={pending} onClick={() => run(() => revokeScimTokens(), t('Token revoked'), () => setFreshToken(null))}>
                {t('Revoke')}
              </Button>
            )}
          </div>
        </div>

        <div className="flex flex-col gap-3 border-t border-line-soft pt-4">
          <span className="text-[13px] font-semibold">{t('Groups to roles')}</span>
          <p className="text-[12.5px] leading-relaxed text-ink-muted">
            {t('People your provider puts in a group get that group’s role. Owners are never changed.')}
          </p>
          {settings.role_mappings.length > 0 && (
            <ul className="flex flex-col divide-y divide-line-soft">
              {settings.role_mappings.map((mapping) => (
                <li key={mapping.id} className="flex items-center justify-between gap-2 py-2">
                  <span className="text-[13.5px]">
                    <span className="font-medium">{mapping.group_name}</span> → {mapping.role_name}
                  </span>
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label={t('Remove')}
                    disabled={pending}
                    onClick={() => run(() => removeScimRoleMapping(mapping.id), t('Mapping removed'))}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </li>
              ))}
            </ul>
          )}
          <form onSubmit={onMapping} className="flex flex-wrap items-end gap-2">
            <Field label={t('Group name')} htmlFor="scim-group" className="min-w-[180px] flex-1">
              <Input id="scim-group" value={groupName} onChange={(event) => setGroupName(event.target.value)} required />
            </Field>
            <Field label={t('Role')} htmlFor="scim-role" className="min-w-[180px] flex-1">
              <Select value={roleId || undefined} onValueChange={setRoleId}>
                <SelectTrigger id="scim-role">
                  <SelectValue placeholder={t('Choose a role')} />
                </SelectTrigger>
                <SelectContent>
                  {settings.roles.map((role) => (
                    <SelectItem key={role.id} value={role.id}>
                      {role.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Button type="submit" variant="secondary" disabled={pending || !groupName.trim() || !roleId}>
              {t('Add')}
            </Button>
          </form>
        </div>
        <FormError error={error} />
      </div>
    </Card>
  );
}
