'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { KeyRound, Laptop, Loader2, LogOut, ShieldCheck, Smartphone } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { AuthenticatorSetup, RecoveryCodes } from '@/components/authenticator-setup';
import { useFormat } from '@/components/format-provider';
import { useLanguage } from '@/components/language-provider';
import { endSession, regenerateRecoveryCodes, removeMfa, signOutOtherSessions } from '@/lib/security-actions';
import type { MfaStatus, SessionView } from '@/lib/security-types';

/**
 * Your account → Security: your authenticator app and where you are signed in.
 *
 * This authenticator is BUILDR's own and works whichever way you sign in — phone, Google, email or
 * single sign-on. (The one on the email card below is Firebase's, for email-and-password sign-in
 * only.) A company that requires two-factor accepts either.
 */
export function TwoFactorCard({ status }: { status: MfaStatus }) {
  const { t } = useLanguage();
  const router = useRouter();
  const [codes, setCodes] = useState<string[] | null>(null);
  const [pending, start] = useTransition();

  function newCodes() {
    start(async () => {
      const result = await regenerateRecoveryCodes();
      if (!result.ok || !result.data) {
        toast.error(result.error ?? t('That did not work. Try again.'));
        return;
      }
      setCodes(result.data.recovery_codes);
    });
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2">
            <ShieldCheck className="size-4 text-ink-soft" />
            {t('Two-factor authentication')}
          </CardTitle>
          {status.enrolled ? <Badge tone="done">{t('On')}</Badge> : <Badge tone="neutral">{t('Off')}</Badge>}
        </div>
        <CardDescription>
          {status.required
            ? t('Your company requires a code from an authenticator app each time you sign in.')
            : t('A code from an authenticator app on top of your sign-in, so a stolen SMS code or password is not enough on its own.')}
        </CardDescription>
      </CardHeader>
      <div className="flex flex-col gap-4 border-t border-line-soft p-4">
        {!status.configured ? (
          <p className="text-[13px] text-ink-muted">{t('Authenticator apps are not set up on this server yet.')}</p>
        ) : !status.enrolled ? (
          <AuthenticatorSetup onFinished={() => router.refresh()} />
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-3">
              <span className="flex size-9 flex-none items-center justify-center rounded-control bg-neutral-bg">
                <KeyRound className="size-4 text-ink-soft" />
              </span>
              <div className="flex min-w-0 flex-col">
                <span className="text-[14px] font-medium">{t('Authenticator app')}</span>
                <span className="text-[12.5px] text-ink-muted">
                  {t('Recovery codes left')}: {status.recovery_codes_left}
                </span>
              </div>
              <div className="ms-auto flex flex-wrap gap-2">
                <Button type="button" variant="secondary" size="sm" disabled={pending || !status.session_verified} onClick={newCodes}>
                  {pending ? <Loader2 className="size-4 animate-spin" /> : null}
                  {t('New recovery codes')}
                </Button>
                <ConfirmDialog
                  trigger={
                    <Button type="button" variant="ghost" size="sm" disabled={!status.session_verified}>
                      {t('Remove')}
                    </Button>
                  }
                  title={t('Remove your authenticator app?')}
                  body={
                    status.required
                      ? t('Your company requires two-factor, so you will be asked to set up a new authenticator straight away. Use this to move to a new phone.')
                      : t('Signing in will no longer ask for a code. Your recovery codes stop working too.')
                  }
                  confirmLabel={t('Remove')}
                  onConfirm={removeMfa}
                  successMessage={t('Authenticator removed')}
                />
              </div>
            </div>
            {!status.session_verified && (
              <p className="text-[12.5px] leading-relaxed text-ink-muted">
                {t('This session has not shown a code from the app yet, so these controls are locked. Sign out and sign in again with a code to change them.')}
              </p>
            )}
            {codes && <RecoveryCodes codes={codes} />}
          </>
        )}
      </div>
    </Card>
  );
}

/** Where this person is signed in, newest activity first, with a way to end any of it. */
export function SessionsCard({ sessions }: { sessions: SessionView[] }) {
  const { t } = useLanguage();
  const router = useRouter();
  const [pending, start] = useTransition();
  const others = sessions.filter((session) => !session.current).length;

  function signOutOthers() {
    start(async () => {
      const result = await signOutOtherSessions();
      if (!result.ok) {
        toast.error(result.error ?? t('That did not work. Try again.'));
        return;
      }
      toast.success(t('Signed out everywhere else'));
      router.refresh();
    });
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle>{t('Where you are signed in')}</CardTitle>
          {others > 0 && (
            <Button type="button" variant="secondary" size="sm" className="gap-2" disabled={pending} onClick={signOutOthers}>
              {pending ? <Loader2 className="size-4 animate-spin" /> : <LogOut className="size-4" />}
              {t('Sign out everywhere else')}
            </Button>
          )}
        </div>
        <CardDescription>
          {t('Each sign-in on a phone or browser. Signing one out takes effect within 15 minutes.')}
        </CardDescription>
      </CardHeader>
      <ul className="flex flex-col divide-y divide-line-soft border-t border-line-soft">
        {sessions.map((session) => (
          <SessionRow key={session.id} session={session} />
        ))}
      </ul>
    </Card>
  );
}

/** One session. `canEnd` off where signing out is done per person instead (Settings → Security). */
export function SessionRow({ session, canEnd = true }: { session: SessionView; canEnd?: boolean }) {
  const { t } = useLanguage();
  const { relativeTime } = useFormat();
  const Icon = session.client === 'app' ? Smartphone : Laptop;
  return (
    <li className="flex flex-wrap items-center gap-3 px-4 py-3">
      <span className="flex size-9 flex-none items-center justify-center rounded-control bg-neutral-bg">
        <Icon className="size-4 text-ink-soft" />
      </span>
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="flex flex-wrap items-center gap-2 text-[14px] font-medium">
          {deviceName(session, t)}
          {session.current && <Badge tone="done">{t('This device')}</Badge>}
          {session.two_factor && <Badge tone="neutral">{t('2FA')}</Badge>}
        </span>
        <span className="text-[12.5px] text-ink-muted">
          <span dir="ltr">{session.ip ?? '—'}</span> · {t('active')} {relativeTime(session.last_active_at)} · {t(methodLabel(session.method))}
        </span>
      </div>
      {!session.current && canEnd && (
        <ConfirmDialog
          trigger={
            <Button type="button" variant="ghost" size="sm">
              {t('Sign out')}
            </Button>
          }
          title={t('Sign out of this session?')}
          body={`${deviceName(session, t)} · ${session.ip ?? ''}`}
          confirmLabel={t('Sign out')}
          onConfirm={() => endSession(session.id)}
          successMessage={t('Signed out')}
        />
      )}
    </li>
  );
}

function methodLabel(method: SessionView['method']): string {
  return method === 'sso' ? 'Single sign-on' : method === 'email' ? 'Google or email' : 'Mobile number';
}

/** "Chrome on Windows" from a user agent; the app says so; anything else is just a browser. */
function deviceName(session: SessionView, t: (english: string) => string): string {
  if (session.client === 'app') return t('BUILDR app');
  const agent = session.user_agent ?? '';
  const browser = /Edg\//.test(agent)
    ? 'Edge'
    : /OPR\//.test(agent)
      ? 'Opera'
      : /Chrome\//.test(agent)
        ? 'Chrome'
        : /Firefox\//.test(agent)
          ? 'Firefox'
          : /Safari\//.test(agent)
            ? 'Safari'
            : null;
  const system = /Windows/.test(agent)
    ? 'Windows'
    : /Android/.test(agent)
      ? 'Android'
      : /iPhone|iPad/.test(agent)
        ? 'iOS'
        : /Mac OS X/.test(agent)
          ? 'macOS'
          : /Linux/.test(agent)
            ? 'Linux'
            : null;
  if (browser && system) return `${browser} · ${system}`;
  return browser ?? system ?? t('Web browser');
}
