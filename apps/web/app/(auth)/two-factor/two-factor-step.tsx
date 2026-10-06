'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition, type FormEvent } from 'react';
import { Loader2, LogOut } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/ui/label';
import { AuthenticatorSetup } from '@/components/authenticator-setup';
import { useLanguage } from '@/components/language-provider';
import { signOut } from '@/lib/actions';
import { verifyMfa } from '@/lib/security-actions';
import type { MfaStatus } from '@/lib/security-types';

/**
 * The form half of the two-factor screen: a code box for somebody with an authenticator (which
 * also takes a recovery code), the set-up steps for somebody without one, and always a way out.
 */
export function TwoFactorStep({ status }: { status: MfaStatus }) {
  const { t } = useLanguage();
  const router = useRouter();
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [recovery, setRecovery] = useState(false);
  const [pending, start] = useTransition();

  function onVerify(event: FormEvent) {
    event.preventDefault();
    setError(null);
    start(async () => {
      const result = await verifyMfa(code);
      if (!result.ok) {
        setError(result.error ?? t('That code is not right. Check the app and try again.'));
        return;
      }
      router.replace('/');
      router.refresh();
    });
  }

  if (!status.configured) {
    return (
      <p className="rounded-btn bg-blocked-bg px-3 py-2 text-[13px] leading-snug text-blocked-fg">
        {t('Two-factor authentication is not set up on this server. Ask your administrator.')}
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      {status.enrolled ? (
        <form onSubmit={onVerify} className="flex flex-col gap-4">
          <Field
            label={recovery ? t('Recovery code') : t('Code from your authenticator app')}
            htmlFor="mfa-code"
            hint={recovery ? t('One of the codes you saved when you set up the app. Each works once.') : undefined}
          >
            <Input
              id="mfa-code"
              dir="ltr"
              inputMode={recovery ? 'text' : 'numeric'}
              autoComplete="one-time-code"
              autoFocus
              maxLength={recovery ? 16 : 7}
              value={code}
              onChange={(event) => setCode(event.target.value)}
              placeholder={recovery ? 'xxxxx-xxxxx' : '123456'}
              className="max-w-[220px] font-mono text-[18px] tracking-[0.2em]"
              required
            />
          </Field>
          {status.locked_until && (
            <p className="text-[13px] text-pending-fg">{t('Too many wrong codes. Wait 15 minutes and try again.')}</p>
          )}
          {error && (
            <p role="alert" className="rounded-btn bg-blocked-bg px-3 py-2 text-[13px] leading-snug text-blocked-fg">
              {error}
            </p>
          )}
          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" disabled={pending || code.trim().length < 6} className="gap-2">
              {pending ? <Loader2 className="size-4 animate-spin" /> : null}
              {t('Continue')}
            </Button>
            <button
              type="button"
              className="text-[13px] font-medium text-accent underline-offset-4 hover:underline"
              onClick={() => {
                setRecovery((value) => !value);
                setCode('');
                setError(null);
              }}
            >
              {recovery ? t('Use the authenticator app instead') : t('Lost your phone? Use a recovery code')}
            </button>
          </div>
          {recovery && status.recovery_codes_left === 0 && (
            <p className="text-[13px] leading-relaxed text-ink-muted">
              {t('You have no recovery codes left. Ask BUILDR support to reset your two-factor.')}
            </p>
          )}
        </form>
      ) : (
        <AuthenticatorSetup
          onFinished={() => {
            router.replace('/');
            router.refresh();
          }}
        />
      )}

      <div className="border-t border-line-soft pt-4">
        <form action={signOut}>
          <Button type="submit" variant="ghost" size="sm" className="gap-2 text-ink-muted">
            <LogOut className="size-4" />
            {t('Sign out')}
          </Button>
        </form>
      </div>
    </div>
  );
}
