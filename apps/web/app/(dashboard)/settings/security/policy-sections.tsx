'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useTransition, type FormEvent, type ReactNode } from 'react';
import { Loader2, Plus, ShieldCheck, Trash2, Users } from 'lucide-react';
import { toast } from 'sonner';
import {
  SECURITY_ABSOLUTE_LIFETIME_HOURS,
  SECURITY_IDLE_TIMEOUT_MINUTES,
  ipNormaliseCidr,
  type SecurityIpMode,
  type SecurityMfaPolicy,
  type UserRole,
} from '@sitebook/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useLanguage } from '@/components/language-provider';
import { titleCase } from '@/lib/format';
import { saveIpPolicy, saveMfaPolicy, saveSessionPolicy, signOutMember } from '@/lib/security-actions';
import type { CompanySessions, SecuritySettings } from '@/lib/security-types';
import { SessionRow } from '../../account/account-security';

/**
 * Settings → Security, below single sign-on: required two-factor, session timeouts, the IP
 * allow-list, and who is signed in. Each card saves on its own, like the SSO cards above.
 */
export function SecurityPolicySections({
  settings,
  sessions,
}: {
  settings: SecuritySettings;
  sessions: CompanySessions;
}) {
  const { t } = useLanguage();
  return (
    <section aria-labelledby="sign-in-rules-heading" className="flex flex-col gap-4">
      <header className="flex flex-col gap-1">
        <h2 id="sign-in-rules-heading" className="text-[17px] font-semibold">
          {t('Sign-in rules')}
        </h2>
        <p className="max-w-2xl text-[13.5px] leading-relaxed text-ink-muted">
          {t('Ask for a second factor, end idle sessions, and keep sign-in to your own networks. Every change is recorded in the audit log.')}
        </p>
      </header>
      <TwoFactorPolicyCard settings={settings} />
      <SessionPolicyCard settings={settings} />
      <IpAllowListCard settings={settings} />
      <CompanySessionsCard sessions={sessions} />
    </section>
  );
}

// --- shared bits -----------------------------------------------------------------------------------

function FormError({ error }: { error: string | null }) {
  if (!error) return null;
  return (
    <p role="alert" className="rounded-btn bg-blocked-bg px-3 py-2 text-[13px] leading-snug text-blocked-fg">
      {error}
    </p>
  );
}

function Notice({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-btn border border-pending-line bg-pending-bg px-3.5 py-2.5 text-[13px] leading-relaxed text-pending-fg">
      {children}
    </p>
  );
}

function Choice<T extends string>({
  name,
  value,
  current,
  onChange,
  label,
  hint,
  disabled,
}: {
  name: string;
  value: T;
  current: T;
  onChange: (value: T) => void;
  label: string;
  hint: ReactNode;
  disabled?: boolean;
}) {
  const id = `${name}-${value}`;
  return (
    <label htmlFor={id} className="flex items-start gap-3">
      <input
        id={id}
        type="radio"
        name={name}
        value={value}
        checked={current === value}
        disabled={disabled}
        onChange={() => onChange(value)}
        className="mt-0.5 size-4 flex-none accent-accent"
      />
      <span className="flex flex-col gap-0.5">
        <span className="text-[14px] font-medium">{label}</span>
        <span className="text-[12.5px] leading-relaxed text-ink-muted">{hint}</span>
      </span>
    </label>
  );
}

function Check({
  id,
  checked,
  onChange,
  label,
  hint,
}: {
  id: string;
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
  hint?: ReactNode;
}) {
  return (
    <label htmlFor={id} className="flex items-start gap-3">
      <input
        id={id}
        type="checkbox"
        checked={checked}
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

function useSave() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return { pending, error, setError, start, refresh: () => router.refresh() };
}

// --- two-factor ------------------------------------------------------------------------------------

function TwoFactorPolicyCard({ settings }: { settings: SecuritySettings }) {
  const { t } = useLanguage();
  const { pending, error, setError, start, refresh } = useSave();
  const [policy, setPolicy] = useState<SecurityMfaPolicy>(settings.mfa.policy);
  const [trustIdp, setTrustIdp] = useState(settings.mfa.trust_idp_mfa);
  const canRequire = settings.deployment.mfa_configured && settings.me.session_verified;

  function onSave(event: FormEvent) {
    event.preventDefault();
    setError(null);
    start(async () => {
      const result = await saveMfaPolicy({ mfa_policy: policy, trust_idp_mfa: trustIdp });
      if (!result.ok) {
        setError(result.error ?? t('That did not work. Try again.'));
        return;
      }
      toast.success(t('Two-factor rule saved'));
      refresh();
    });
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle>{t('Two-factor authentication')}</CardTitle>
          {settings.mfa.policy === 'off' ? (
            <Badge tone="neutral">{t('Not required')}</Badge>
          ) : (
            <Badge tone="done">{settings.mfa.policy === 'admins' ? t('Owners and admins') : t('Everyone')}</Badge>
          )}
        </div>
        <CardDescription>
          {t('People set up an authenticator app (Google Authenticator, Microsoft Authenticator, 1Password…) and type its code after signing in. A mobile-number sign-in counts as one factor, so phone users set one up too.')}
        </CardDescription>
      </CardHeader>
      <form onSubmit={onSave} className="flex flex-col gap-4 border-t border-line-soft p-4">
        {!settings.deployment.mfa_configured && (
          <Notice>{t('Authenticator apps are not set up on this server (MFA_ENCRYPTION_KEY), so two-factor cannot be required yet.')}</Notice>
        )}
        {settings.deployment.mfa_configured && !settings.me.session_verified && (
          <Notice>
            {t('Set up two-factor for yourself first, so you are not the first person it stops.')}{' '}
            <Link href="/account#security" className="font-semibold underline underline-offset-4">
              {t('Your account → Security')}
            </Link>
          </Notice>
        )}
        <fieldset className="flex flex-col gap-3">
          <legend className="sr-only">{t('Who must use two-factor')}</legend>
          <Choice name="mfa-policy" value="off" current={policy} onChange={setPolicy} label={t('Not required')} hint={t('Anyone can turn it on for their own account.')} />
          <Choice
            name="mfa-policy"
            value="admins"
            current={policy}
            onChange={setPolicy}
            disabled={!canRequire && settings.mfa.policy !== 'admins'}
            label={t('Owners and admins')}
            hint={t('Everyone whose role can change company settings. Site staff are not asked.')}
          />
          <Choice
            name="mfa-policy"
            value="everyone"
            current={policy}
            onChange={setPolicy}
            disabled={!canRequire && settings.mfa.policy !== 'everyone'}
            label={t('Everyone')}
            hint={t('Every person, on the web and in the mobile app. The mobile app cannot ask for the code yet, so people who work only in the app will be stopped there — choose “Owners and admins” if your site staff use the app.')}
          />
        </fieldset>
        <Check
          id="mfa-trust-idp"
          checked={trustIdp}
          onChange={setTrustIdp}
          label={t('Trust our identity provider for two-factor')}
          hint={
            settings.mfa.sso_enabled
              ? t('People who sign in with single sign-on are not asked again: your provider (Entra ID, Okta, Google) is trusted to have checked their second factor. Turn off if it does not enforce one.')
              : t('Applies once single sign-on is on: sign-ins through your provider count as two-factor.')
          }
        />
        <p className="text-[12.5px] leading-relaxed text-ink-muted">
          {t('Lost phone: each person has ten single-use recovery codes. If those are gone too, BUILDR support can reset their two-factor; it is recorded in your audit log.')}
        </p>
        <FormError error={error} />
        <Button type="submit" disabled={pending} className="gap-2 self-start">
          {pending ? <Loader2 className="size-4 animate-spin" /> : <ShieldCheck className="size-4" />}
          {t('Save')}
        </Button>
      </form>
    </Card>
  );
}

// --- session timeouts ------------------------------------------------------------------------------

const OFF = 'off';

function minutesLabel(minutes: number, t: (english: string) => string): string {
  return minutes < 60 ? `${minutes} ${t('minutes')}` : minutes === 60 ? `1 ${t('hour')}` : `${minutes / 60} ${t('hours')}`;
}

function hoursLabel(hours: number, t: (english: string) => string): string {
  if (hours < 24) return `${hours} ${t('hours')}`;
  const days = hours / 24;
  return days === 1 ? `1 ${t('day')}` : `${days} ${t('days')}`;
}

function SessionPolicyCard({ settings }: { settings: SecuritySettings }) {
  const { t } = useLanguage();
  const { pending, error, setError, start, refresh } = useSave();
  const [idle, setIdle] = useState(settings.sessions.idle_timeout_minutes?.toString() ?? OFF);
  const [absolute, setAbsolute] = useState(settings.sessions.absolute_lifetime_hours?.toString() ?? OFF);

  function onSave(event: FormEvent) {
    event.preventDefault();
    setError(null);
    start(async () => {
      const result = await saveSessionPolicy({
        idle_timeout_minutes: idle === OFF ? null : Number(idle),
        absolute_lifetime_hours: absolute === OFF ? null : Number(absolute),
      });
      if (!result.ok) {
        setError(result.error ?? t('That did not work. Try again.'));
        return;
      }
      toast.success(t('Session timeouts saved'));
      refresh();
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('Session timeouts')}</CardTitle>
        <CardDescription>
          {t('End sessions nobody is using, and make everyone sign in again after a while whatever they are doing. Applies to the web and the mobile app; a session that times out is signed out at its next use.')}
        </CardDescription>
      </CardHeader>
      <form onSubmit={onSave} className="flex flex-col gap-4 border-t border-line-soft p-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('Sign out after inactivity')} htmlFor="session-idle">
            <Select value={idle} onValueChange={setIdle}>
              <SelectTrigger id="session-idle">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={OFF}>{t('Never')}</SelectItem>
                {SECURITY_IDLE_TIMEOUT_MINUTES.map((minutes) => (
                  <SelectItem key={minutes} value={String(minutes)}>
                    {minutesLabel(minutes, t)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label={t('Sign in again after')} htmlFor="session-absolute">
            <Select value={absolute} onValueChange={setAbsolute}>
              <SelectTrigger id="session-absolute">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={OFF}>{t('30 days (the most)')}</SelectItem>
                {SECURITY_ABSOLUTE_LIFETIME_HOURS.map((hours) => (
                  <SelectItem key={hours} value={String(hours)}>
                    {hoursLabel(hours, t)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        </div>
        <p className="text-[12.5px] leading-relaxed text-ink-muted">
          {t('Supervisors on site keep the app open all day — a short inactivity limit there means signing in again after every break.')}
        </p>
        <FormError error={error} />
        <Button type="submit" disabled={pending} className="gap-2 self-start">
          {pending ? <Loader2 className="size-4 animate-spin" /> : null}
          {t('Save')}
        </Button>
      </form>
    </Card>
  );
}

// --- IP allow-list ---------------------------------------------------------------------------------

function IpAllowListCard({ settings }: { settings: SecuritySettings }) {
  const { t } = useLanguage();
  const { pending, error, setError, start, refresh } = useSave();
  const [mode, setMode] = useState<SecurityIpMode>(settings.ip.mode);
  const [rules, setRules] = useState(settings.ip.rules);
  const [exemptOwners, setExemptOwners] = useState(settings.ip.exempt_owners);
  const [exemptRoles, setExemptRoles] = useState<UserRole[]>(settings.ip.exempt_roles);
  const [cidr, setCidr] = useState('');
  const [label, setLabel] = useState('');
  const [lockout, setLockout] = useState(false);
  const typed = cidr.trim() ? ipNormaliseCidr(cidr) : null;
  const currentIp = settings.current_ip;

  function add(block: string, name: string) {
    const normalised = ipNormaliseCidr(block);
    if (!normalised) return;
    setRules((existing) =>
      existing.some((rule) => rule.cidr === normalised) ? existing : [...existing, { cidr: normalised, label: name.trim() }],
    );
    setCidr('');
    setLabel('');
  }

  function save(confirm: boolean) {
    setError(null);
    start(async () => {
      const result = await saveIpPolicy({
        ip_mode: mode,
        ip_rules: rules,
        ip_exempt_owners: exemptOwners,
        ip_exempt_roles: exemptRoles,
        confirm_self_lockout: confirm,
      });
      if (!result.ok) {
        setLockout(Boolean(result.lockout));
        setError(result.error ?? t('That did not work. Try again.'));
        return;
      }
      setLockout(false);
      toast.success(t('IP allow-list saved'));
      refresh();
    });
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle>{t('IP allow-list')}</CardTitle>
          {settings.ip.mode === 'off' ? (
            <Badge tone="neutral">{t('Off')}</Badge>
          ) : (
            <Badge tone="done">{settings.ip.mode === 'web' ? t('Web only') : t('Web and app')}</Badge>
          )}
        </div>
        <CardDescription>
          {t('Only allow sign-in and use from your offices’ networks. Requests from anywhere else are refused.')}
        </CardDescription>
      </CardHeader>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          save(false);
        }}
        className="flex flex-col gap-4 border-t border-line-soft p-4"
      >
        <div className="flex flex-wrap items-center gap-2 rounded-btn border border-line bg-raised px-3.5 py-2.5 text-[13px]">
          <span className="text-ink-muted">{t('Your current IP address is')}</span>
          <code dir="ltr" className="font-mono font-semibold">
            {currentIp || '—'}
          </code>
          {currentIp && !rules.some((rule) => ipNormaliseCidr(rule.cidr) && rule.cidr === ipNormaliseCidr(currentIp)) && (
            <Button type="button" variant="ghost" size="sm" className="ms-auto gap-1" onClick={() => add(currentIp, t('This office'))}>
              <Plus className="size-3.5" />
              {t('Add it')}
            </Button>
          )}
        </div>
        {!settings.deployment.client_ip_forwarding && (
          <p className="text-[12.5px] leading-relaxed text-ink-muted">
            {t('This server is not passing browsers’ addresses to the API (WEB_CLIENT_IP_SECRET), so the address above may be the web server’s own. Check it before switching the list on.')}
          </p>
        )}

        <fieldset className="flex flex-col gap-3">
          <legend className="sr-only">{t('Where the list applies')}</legend>
          <Choice name="ip-mode" value="off" current={mode} onChange={setMode} label={t('Off')} hint={t('Sign in from anywhere.')} />
          <Choice
            name="ip-mode"
            value="web"
            current={mode}
            onChange={setMode}
            label={t('Web only')}
            hint={t('The dashboard only from these networks; the mobile app from anywhere. Site staff on mobile data change address every few minutes, so this is the usual choice. It keeps office screens on the office network, but it is not a hard wall: anyone with a valid sign-in can still use the app.')}
          />
          <Choice
            name="ip-mode"
            value="everyone"
            current={mode}
            onChange={setMode}
            label={t('Web and app')}
            hint={t('Everything only from these networks, the mobile app included — people on mobile data will be refused. Exempt site roles below if they work away from the office.')}
          />
        </fieldset>

        <div className="flex flex-col gap-2">
          <span className="text-[13px] font-semibold">{t('Allowed networks')}</span>
          {rules.length === 0 ? (
            <p className="text-[13px] text-ink-muted">{t('None yet. Add an address or a block such as 203.0.113.0/24 or 2001:db8::/48.')}</p>
          ) : (
            <ul className="flex flex-col divide-y divide-line-soft rounded-card border border-line">
              {rules.map((rule) => (
                <li key={rule.cidr} className="flex items-center gap-3 px-3 py-2">
                  <code dir="ltr" className="font-mono text-[13.5px]">
                    {rule.cidr}
                  </code>
                  <span className="min-w-0 flex-1 truncate text-[13px] text-ink-muted">{rule.label}</span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    aria-label={t('Remove')}
                    onClick={() => setRules((existing) => existing.filter((entry) => entry.cidr !== rule.cidr))}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </li>
              ))}
            </ul>
          )}
          <div className="flex flex-wrap items-end gap-2">
            <Field
              label={t('Address or block')}
              htmlFor="ip-cidr"
              className="min-w-[200px] flex-1"
              error={cidr.trim() && !typed ? t('Not an IPv4 or IPv6 address or block') : undefined}
            >
              <Input id="ip-cidr" dir="ltr" placeholder="203.0.113.0/24" value={cidr} onChange={(event) => setCidr(event.target.value)} />
            </Field>
            <Field label={t('Label')} htmlFor="ip-label" optional className="min-w-[160px] flex-1">
              <Input id="ip-label" placeholder={t('Head office')} value={label} maxLength={80} onChange={(event) => setLabel(event.target.value)} />
            </Field>
            <Button type="button" variant="secondary" disabled={!typed} onClick={() => add(cidr, label)} className="gap-1">
              <Plus className="size-4" />
              {t('Add')}
            </Button>
          </div>
        </div>

        <div className="flex flex-col gap-3 border-t border-line-soft pt-4">
          <Check
            id="ip-exempt-owners"
            checked={exemptOwners}
            onChange={setExemptOwners}
            label={t('Owners can sign in from anywhere')}
            hint={
              exemptOwners
                ? t('Recommended: a mistyped list can then never lock out the people who can fix it.')
                : t('Owners are held to the list too. If it is wrong, nobody may be able to get in to correct it.')
            }
          />
          <div className="flex flex-col gap-2">
            <span className="text-[13px] font-semibold">{t('Roles that can sign in from anywhere')}</span>
            <div className="flex flex-wrap gap-x-5 gap-y-2">
              {settings.roles.map((role) => (
                <Check
                  key={role}
                  id={`ip-exempt-${role}`}
                  checked={exemptRoles.includes(role)}
                  onChange={(checked) =>
                    setExemptRoles((existing) => (checked ? [...existing, role] : existing.filter((entry) => entry !== role)))
                  }
                  label={t(titleCase(role.replace(/_/g, ' ')))}
                />
              ))}
            </div>
            <span className="text-[12.5px] text-ink-muted">{t('Custom roles follow the role they are based on.')}</span>
          </div>
        </div>

        <FormError error={error} />
        {lockout && (
          <Button type="button" variant="destructive" disabled={pending} className="self-start" onClick={() => save(true)}>
            {t('Save anyway — I understand I will be signed out')}
          </Button>
        )}
        <Button type="submit" disabled={pending} className="gap-2 self-start">
          {pending ? <Loader2 className="size-4 animate-spin" /> : null}
          {t('Save')}
        </Button>
      </form>
    </Card>
  );
}

// --- who is signed in ------------------------------------------------------------------------------

function CompanySessionsCard({ sessions }: { sessions: CompanySessions }) {
  const { t } = useLanguage();
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Users className="size-4 text-ink-soft" />
          {t('Who is signed in')}
        </CardTitle>
        <CardDescription>
          {t('Sign a person out of every device at once — a lost phone, somebody leaving. They can sign in again unless you also remove them from the team.')}
        </CardDescription>
      </CardHeader>
      {sessions.items.length === 0 ? (
        <p className="border-t border-line-soft px-4 py-3 text-[13px] text-ink-muted">{t('Nobody is signed in right now.')}</p>
      ) : (
        <ul className="flex flex-col divide-y divide-line-soft border-t border-line-soft">
          {sessions.items.map((person) => (
            <li key={person.user_id} className="flex flex-col">
              <div className="flex flex-wrap items-center gap-2 px-4 pt-3">
                <span className="text-[14px] font-semibold">{person.name}</span>
                <span className="text-[12.5px] text-ink-muted">{person.role_name}</span>
                <span className="ms-auto">
                  <ConfirmDialog
                    trigger={
                      <Button type="button" variant="ghost" size="sm">
                        {t('Sign out everywhere')}
                      </Button>
                    }
                    title={t('Sign this person out everywhere?')}
                    body={`${person.name} · ${person.sessions.length} ${t('sessions')}`}
                    confirmLabel={t('Sign out')}
                    onConfirm={() => signOutMember(person.user_id)}
                    successMessage={t('Signed out')}
                  />
                </span>
              </div>
              <ul className="flex flex-col">
                {person.sessions.map((session) => (
                  <SessionRow key={session.id} session={session} canEnd={false} />
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
