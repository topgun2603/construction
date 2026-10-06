'use client';

import { useState, useTransition, type FormEvent } from 'react';
import { Check, Copy, Download, Loader2, QrCode as QrIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/ui/label';
import { QrCode } from '@/components/qr-code';
import { useLanguage } from '@/components/language-provider';
import { confirmMfaEnrolment, startMfaEnrolment } from '@/lib/security-actions';
import type { MfaEnrolment } from '@/lib/security-types';

/**
 * Setting up an authenticator app, in three steps: scan the QR code (or type the key), type back
 * the code it shows, save the recovery codes. Shared by Your account and the two-factor screen
 * after sign-in, so both say exactly the same thing.
 *
 * The confirm step also counts as this session's second factor (the action swaps the cookies), so
 * finishing here never asks for a code again straight away.
 */
export function AuthenticatorSetup({ onFinished }: { onFinished: () => void }) {
  const { t } = useLanguage();
  const [enrolment, setEnrolment] = useState<MfaEnrolment | null>(null);
  const [codes, setCodes] = useState<string[] | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function begin() {
    setError(null);
    start(async () => {
      const result = await startMfaEnrolment();
      if (!result.ok || !result.data) {
        setError(result.error ?? t('Could not start. Try again.'));
        return;
      }
      setEnrolment(result.data);
    });
  }

  function confirm(event: FormEvent) {
    event.preventDefault();
    setError(null);
    start(async () => {
      const result = await confirmMfaEnrolment(code);
      if (!result.ok || !result.data) {
        setError(result.error ?? t('That code is not right. Check the app and try again.'));
        return;
      }
      setCodes(result.data.recovery_codes);
    });
  }

  if (codes) {
    return (
      <div className="flex flex-col gap-4">
        <RecoveryCodes codes={codes} />
        <Button type="button" className="self-start" onClick={onFinished}>
          {t('I have saved my recovery codes')}
        </Button>
      </div>
    );
  }

  if (!enrolment) {
    return (
      <div className="flex flex-col gap-3">
        <Button type="button" onClick={begin} disabled={pending} className="gap-2 self-start">
          {pending ? <Loader2 className="size-4 animate-spin" /> : <QrIcon className="size-4" />}
          {t('Set up an authenticator app')}
        </Button>
        {error && <ErrorLine error={error} />}
      </div>
    );
  }

  return (
    <form onSubmit={confirm} className="flex flex-col gap-4">
      <ol className="flex list-decimal flex-col gap-1 ps-5 text-[13.5px] leading-relaxed text-ink-soft">
        <li>{t('Open Google Authenticator, Microsoft Authenticator, 1Password or any authenticator app.')}</li>
        <li>{t('Scan this code, or type the key below.')}</li>
        <li>{t('Enter the 6-digit code the app shows.')}</li>
      </ol>
      <div className="flex flex-wrap items-start gap-5">
        <QrCode value={enrolment.otpauth_uri} label={t('QR code for your authenticator app')} className="size-44 flex-none border border-line" />
        <div className="flex min-w-0 flex-1 flex-col gap-3">
          <SecretKey secret={enrolment.secret} />
          <Field label={t('Code from the app')} htmlFor="mfa-enrol-code">
            <Input
              id="mfa-enrol-code"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9 ]{6,7}"
              maxLength={7}
              value={code}
              onChange={(event) => setCode(event.target.value)}
              className="max-w-[180px] font-mono text-[18px] tracking-[0.3em]"
              required
            />
          </Field>
          {error && <ErrorLine error={error} />}
          <Button type="submit" disabled={pending || code.replace(/\s/g, '').length !== 6} className="gap-2 self-start">
            {pending ? <Loader2 className="size-4 animate-spin" /> : null}
            {t('Turn on two-factor')}
          </Button>
        </div>
      </div>
    </form>
  );
}

function SecretKey({ secret }: { secret: string }) {
  const { t } = useLanguage();
  const [copied, setCopied] = useState(false);
  // In groups of four, the way apps that take a typed key show it.
  const grouped = secret.match(/.{1,4}/g)?.join(' ') ?? secret;
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[12px] font-medium text-ink-muted">{t('Key, if you cannot scan')}</span>
      <div className="flex items-center gap-2">
        <code dir="ltr" className="min-w-0 break-all rounded-btn border border-line bg-raised px-2.5 py-1.5 font-mono text-[12.5px]">
          {grouped}
        </code>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-label={t('Copy')}
          onClick={() => {
            void navigator.clipboard.writeText(secret).then(() => {
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

/**
 * The recovery codes, shown once. Download is a plain text file made in the browser — the codes
 * never travel anywhere else.
 */
export function RecoveryCodes({ codes }: { codes: string[] }) {
  const { t } = useLanguage();
  const [copied, setCopied] = useState(false);
  const text = codes.join('\n');

  function download() {
    const blob = new Blob(
      [`BUILDR recovery codes\n${t('Each code works once. Keep them somewhere safe.')}\n\n${text}\n`],
      { type: 'text/plain' },
    );
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'buildr-recovery-codes.txt';
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="flex flex-col gap-3 rounded-card border border-pending-line bg-pending-bg p-4">
      <div className="flex flex-col gap-1">
        <span className="text-[14px] font-semibold text-pending-fg">{t('Save your recovery codes')}</span>
        <span className="text-[13px] leading-relaxed text-pending-fg">
          {t('If you lose your phone, each of these lets you in once instead of a code from the app. They will not be shown again.')}
        </span>
      </div>
      <ul dir="ltr" className="grid grid-cols-2 gap-x-6 gap-y-1 font-mono text-[14px] sm:grid-cols-5">
        {codes.map((code) => (
          <li key={code}>{code}</li>
        ))}
      </ul>
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="secondary" size="sm" className="gap-2" onClick={download}>
          <Download className="size-4" />
          {t('Download')}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="gap-2"
          onClick={() => {
            void navigator.clipboard.writeText(text).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            });
          }}
        >
          {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
          {t('Copy')}
        </Button>
      </div>
    </div>
  );
}

function ErrorLine({ error }: { error: string }) {
  return (
    <p role="alert" className="rounded-btn bg-blocked-bg px-3 py-2 text-[13px] leading-snug text-blocked-fg">
      {error}
    </p>
  );
}
