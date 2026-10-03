'use client';

import { useRouter } from 'next/navigation';
import { useRef, useState, type FormEvent } from 'react';
import { ArrowRight, Loader2, Lock, ShieldCheck, Smartphone } from 'lucide-react';
import {
  GoogleAuthProvider,
  RecaptchaVerifier,
  signInWithPhoneNumber,
  signInWithPopup,
  type ConfirmationResult,
} from 'firebase/auth';
import { toE164Indian } from '@sitebook/shared';
import { firebaseAuth, isFirebaseConfigured } from '@/lib/firebase';
import { platformLogin } from '@/lib/platform-actions';
import { Button } from '@/components/ui/button';
import { GoogleMark } from '@/components/ui/google-mark';
import { Input } from '@/components/ui/input';
import { useLanguage } from '@/components/language-provider';


/**
 * Whether to skip Firebase and post a `dev:<phone>` token straight to the API.
 *
 * Written out here, rather than imported from a shared module, so that both halves are literals in
 * this file's scope and the bundler folds the whole thing to `false` — which deletes the branch
 * below instead of shipping it behind a condition that happens to be false. An exported `const`
 * does not survive that: webpack leaves the import as a runtime lookup.
 *
 * `NODE_ENV` is the half that matters. `next build` always sets it to `production`, so a deployed
 * bundle is immune no matter where the flag came from — and it came from somewhere unexpected once
 * already: an `apps/web/.env.local` that reached a Docker build context and turned the real
 * sign-in into dead code. The API refused the tokens, but all a user saw was "Could not verify the
 * sign-in token", which describes the wrong half of the problem.
 */
const DEV_AUTH_BYPASS =
  process.env.NODE_ENV !== 'production' && process.env['NEXT_PUBLIC_DEV_AUTH_BYPASS'] === 'true';

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
  const { t } = useLanguage();
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

      if (DEV_AUTH_BYPASS || !isFirebaseConfigured()) {
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

  /**
   * Signing in with a linked Google address.
   *
   * Lands in the same `/admin/auth/login` as the OTP does — Firebase is the vendor for both and
   * the API decides what the token proves. What differs is the lookup behind it: the address is
   * resolved to the operator's *phone* before a session is issued, so a Google sign-in and an SMS
   * sign-in by the same person are the same identity in the audit trail.
   *
   * An address nobody has linked gets the same refusal as a number that is not on the allowlist.
   * Deliberately: the console's URL is not a secret, and who may open it should not be enumerable
   * through it.
   */
  async function handleGoogle(): Promise<void> {
    setError(null);
    setBusy(true);
    try {
      /*
       * The real popup whenever Firebase is configured — including in development.
       *
       * This used to check `DEV_AUTH_BYPASS` first, which meant a machine with Firebase fully set
       * up still got a `window.prompt` asking an operator to type their own address. The dev
       * bypass exists because an SMS costs money and takes a minute; a Google popup costs nothing
       * and is instant, so there was never a reason to skip it. Firebase being absent is the only
       * thing that justifies the fallback, so that is the only thing that triggers it.
       */
      if (isFirebaseConfigured()) {
        const credential = await signInWithPopup(firebaseAuth(), new GoogleAuthProvider());
        await exchange(await credential.user.getIdToken());
        return;
      }

      if (DEV_AUTH_BYPASS) {
        // No Firebase at all, so there is no popup to show. Compiled out of a production bundle,
        // which is why a `prompt` is good enough for what is left.
        const email = window.prompt('Dev sign-in — Google address to sign in as');
        if (!email) return;
        await exchange(`dev:${email.trim()}`);
        return;
      }

      throw new Error('Google sign-in is not configured on this deployment');
    } catch (cause) {
      // Closing the popup is somebody changing their mind, not an error worth a red box.
      if (isPopupDismissal(cause)) return;
      setError(googleMessage(cause));
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
    <div className="flex flex-col gap-5 rounded-[22px] bg-surface p-7 shadow-[0_32px_80px_-28px_rgba(10,6,30,0.75)] sm:p-8">
      <div className="flex flex-col gap-2">
        <span className="flex items-center gap-2 text-[11.5px] font-bold uppercase tracking-[0.16em] text-accent">
          <Lock className="size-3.5" />
          {t('Restricted access')}
        </span>
        <h2 className="text-[26px] font-semibold leading-tight tracking-[-0.02em]">
          {step === 'phone' ? 'Operator sign in' : t('Enter the code')}
        </h2>
        <p className="text-[13.5px] leading-relaxed text-ink-muted">
          {step === 'phone'
            ? 'Only numbers on the operator allowlist can get in. Everyone else is turned away without explanation.'
            : `Sent to ${phone}. It expires in a few minutes.`}
        </p>
      </div>

      {step === 'phone' ? (
        <form onSubmit={submitPhone} className="flex flex-col gap-4">
          <label className="flex flex-col gap-1.5">
            <span className="text-[13px] font-semibold">{t('Mobile number')}</span>
            {/*
              The country code sits inside the field rather than beside it. `prefixText` on an
              input is invisible until the field has focus, which had people typing +91 again in
              front of it — the mobile app hit the same thing and fixed it the same way.
            */}
            <div className="flex items-center gap-2.5 rounded-control border border-line-strong bg-surface px-3.5 transition focus-within:border-accent focus-within:ring-4 focus-within:ring-accent/10">
              <Smartphone className="size-[18px] flex-none text-accent" />
              <span className="font-mono text-[14px] text-ink-muted">+91</span>
              <input
                value={phone}
                onChange={(event) => setPhone(event.target.value)}
                placeholder="98765 43210"
                inputMode="numeric"
                autoComplete="tel"
                autoFocus
                className="h-12 flex-1 border-0 bg-transparent font-mono text-[16px] tracking-[0.02em] outline-none placeholder:font-sans placeholder:tracking-normal placeholder:text-ink-faint"
              />
            </div>
          </label>

          <Button type="submit" size="lg" disabled={busy} className="h-12 w-full text-[15px]">
            {busy ? <Loader2 className="size-4 animate-spin" /> : null}
            {DEV_AUTH_BYPASS ? 'Sign in' : 'Send code'}
            {!busy && <ArrowRight className="size-4" />}
          </Button>

          <div className="flex items-center gap-3">
            <span className="h-px flex-1 bg-line" />
            <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-faint">
              {t('or')}
            </span>
            <span className="h-px flex-1 bg-line" />
          </div>

          {/*
            Second, not first. The console's identity is the number — the token carries it and
            every audit row is keyed by it — and an address only works for an operator who has had
            one linked to their row by a root operator. So it is the convenience, not the way in,
            and it is placed as such.
          */}
          <button
            type="button"
            onClick={() => void handleGoogle()}
            disabled={busy}
            className="flex h-12 w-full items-center justify-center gap-3 rounded-btn border border-line-strong bg-raised text-[14.5px] font-semibold text-ink transition hover:bg-surface hover:shadow-sm disabled:opacity-60"
          >
            <GoogleMark />
            {t('Continue with Google')}
          </button>
        </form>
      ) : (
        <form onSubmit={submitCode} className="flex flex-col gap-3">
          <label className="flex flex-col gap-1.5">
            <span className="text-[13px] font-semibold">{t('Six digit code')}</span>
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
              {t('Verify')}
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
              {t('Back')}
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
      <p className="flex items-start gap-2.5 rounded-btn bg-accent-soft px-3.5 py-3 text-[12.5px] leading-relaxed text-ink-soft">
        <ShieldCheck className="mt-px size-4 flex-none text-accent" />
        {t('Every action you take here is written to the platform audit trail against your number.')}
      </p>

      <div id="platform-recaptcha" ref={recaptchaHost} />
    </div>
  );
}

/**
 * Firebase's auth codes, turned into something an operator can act on.
 *
 * The raw messages name the SDK rather than the thing to go and fix — `auth/operation-not-allowed`
 * arrives as "The given sign-in provider is disabled for this Firebase project", which is true and
 * does not say that the fix is one toggle in the Firebase console. Somebody locked out of their own
 * platform at the time they most need in should be told where to go.
 */
function googleMessage(cause: unknown): string {
  const code = (cause as { code?: string } | null)?.code;
  switch (code) {
    case 'auth/operation-not-allowed':
      return 'Google sign-in is switched off for this Firebase project. Turn it on under Authentication → Sign-in method, then try again.';
    case 'auth/unauthorized-domain':
      return 'This address is not an authorised domain in Firebase. Add it under Authentication → Settings → Authorised domains.';
    case 'auth/popup-blocked':
      return 'The browser blocked the sign-in popup. Allow popups for this page and try again.';
    case 'auth/network-request-failed':
      return 'Could not reach Google. Check the connection and try again.';
    default:
      return cause instanceof Error ? cause.message : 'Could not sign in with Google';
  }
}

function isPopupDismissal(cause: unknown): boolean {
  const code = (cause as { code?: string } | null)?.code;
  return (
    code === 'auth/popup-closed-by-user' ||
    code === 'auth/cancelled-popup-request' ||
    code === 'auth/user-cancelled'
  );
}
