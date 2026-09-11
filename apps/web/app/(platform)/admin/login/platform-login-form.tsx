'use client';

import { useRouter } from 'next/navigation';
import { useRef, useState, type FormEvent } from 'react';
import { ArrowRight, Loader2, Lock } from 'lucide-react';
import { RecaptchaVerifier, signInWithPhoneNumber, type ConfirmationResult } from 'firebase/auth';
import { toE164Indian } from '@sitebook/shared';
import { firebaseAuth, isFirebaseConfigured } from '@/lib/firebase';
import { platformLogin } from '@/lib/platform-actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

const DEV_BYPASS = process.env['NEXT_PUBLIC_DEV_AUTH_BYPASS'] === 'true';

/**
 * Phone OTP for the console.
 *
 * A white card on the dark stage — the one lit surface on the screen, which is the whole point: a key
 * to a locked door rather than a form on a page.
 *
 * No "forgot access" link and nothing about who is allowed in. The allowlist is an environment
 * variable on the API, so there is nothing this page could offer a stranger except confirmation that
 * they are not on it.
 */
export function PlatformLoginForm() {
  const router = useRouter();
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [step, setStep] = useState<'phone' | 'code'>('phone');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const confirmation = useRef<ConfirmationResult | null>(null);
  const recaptchaHost = useRef<HTMLDivElement | null>(null);

  async function exchange(firebaseToken: string) {
    const result = await platformLogin(firebaseToken);
    if (!result.ok) {
      // Deliberately the same message whether the number is unknown or simply not an operator.
      setError(result.error ?? 'That number cannot sign in here');
      setStep('phone');
      return;
    }
    router.replace('/admin');
  }

  async function submitPhone(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const e164 = toE164Indian(phone);
      if (!e164) throw new Error('Enter a 10-digit mobile number');

      if (DEV_BYPASS || !isFirebaseConfigured()) {
        await exchange(`dev:${e164}`);
        return;
      }

      const verifier = new RecaptchaVerifier(
        firebaseAuth(),
        recaptchaHost.current ?? 'platform-recaptcha',
        { size: 'invisible' },
      );
      confirmation.current = await signInWithPhoneNumber(firebaseAuth(), `+${e164}`, verifier);
      setStep('code');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not send the code');
    } finally {
      setBusy(false);
    }
  }

  async function submitCode(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (!confirmation.current) throw new Error('Start again');
      const credential = await confirmation.current.confirm(code);
      await exchange(await credential.user.getIdToken());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'That code did not work');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-4 rounded-sheet bg-surface p-6 shadow-float sm:p-7">
      <div className="flex flex-col gap-1.5">
        <span className="flex items-center gap-2 text-[12px] font-semibold uppercase tracking-[0.14em] text-ink-muted">
          <Lock className="size-3.5" />
          Restricted
        </span>
        <h2 className="text-[20px] font-semibold leading-tight">
          {step === 'phone' ? 'Operator sign in' : 'Enter the code'}
        </h2>
        <p className="text-[13.5px] leading-relaxed text-ink-muted">
          {step === 'phone'
            ? 'Only numbers on the operator allowlist can get in. Everyone else is turned away without explanation.'
            : `Sent to ${phone}. It expires in a few minutes.`}
        </p>
      </div>

      {step === 'phone' ? (
        <form onSubmit={submitPhone} className="flex flex-col gap-3">
          <label className="flex flex-col gap-1.5">
            <span className="text-[13px] font-semibold">Mobile number</span>
            <div className="flex items-center gap-2 rounded-control border border-line-strong bg-surface px-3 focus-within:border-accent">
              <span className="font-mono text-[14px] text-ink-muted">+91</span>
              <input
                value={phone}
                onChange={(event) => setPhone(event.target.value)}
                placeholder="98765 43210"
                inputMode="numeric"
                autoComplete="tel"
                autoFocus
                className="h-11 flex-1 border-0 bg-transparent font-mono text-[16px] tracking-[0.02em] outline-none placeholder:font-sans placeholder:tracking-normal placeholder:text-ink-faint"
              />
            </div>
          </label>

          <Button type="submit" size="lg" disabled={busy} className="w-full">
            {busy ? <Loader2 className="size-4 animate-spin" /> : null}
            {DEV_BYPASS ? 'Sign in' : 'Send code'}
            {!busy && <ArrowRight className="size-4" />}
          </Button>
        </form>
      ) : (
        <form onSubmit={submitCode} className="flex flex-col gap-3">
          <label className="flex flex-col gap-1.5">
            <span className="text-[13px] font-semibold">Six digit code</span>
            <Input
              value={code}
              onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
              inputMode="numeric"
              autoFocus
              className="h-12 text-center font-mono text-[20px] tracking-[0.42em]"
            />
          </label>

          <div className="flex items-center gap-2">
            <Button type="submit" size="lg" disabled={busy || code.length !== 6} className="flex-1">
              {busy && <Loader2 className="size-4 animate-spin" />}
              Verify
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="lg"
              onClick={() => {
                setStep('phone');
                setCode('');
              }}
              disabled={busy}
            >
              Back
            </Button>
          </div>
        </form>
      )}

      {error && (
        <p
          role="alert"
          className="rounded-btn bg-blocked-bg px-3 py-2.5 text-[13px] leading-snug text-blocked-fg"
        >
          {error}
        </p>
      )}

      {/*
        Said on the door rather than after they are inside. Somebody about to change another
        company's plan should read this before they sign in, not once they already have.
      */}
      <p className="border-t border-line-soft pt-3 text-[12.5px] leading-relaxed text-ink-muted">
        Every action you take here is written to the platform audit trail against your number.
      </p>

      <div id="platform-recaptcha" ref={recaptchaHost} />
    </div>
  );
}
