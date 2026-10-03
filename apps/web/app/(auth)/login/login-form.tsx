'use client';

import { useRouter } from 'next/navigation';
import { useRef, useState, type ClipboardEvent, type FormEvent, type KeyboardEvent } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ArrowLeft, ArrowRight, Loader2, Lock, ShieldCheck } from 'lucide-react';
import {
  GoogleAuthProvider,
  RecaptchaVerifier,
  signInWithPhoneNumber,
  signInWithPopup,
  type ConfirmationResult,
} from 'firebase/auth';
import { toE164Indian } from '@sitebook/shared';
import { firebaseAuth, isFirebaseConfigured } from '@/lib/firebase';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { useLanguage } from '@/components/language-provider';
import { GoogleMark } from '@/components/ui/google-mark';

const API_URL = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:3000/v1';
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

const OTP_LENGTH = 6;
const EASE = [0.22, 0.61, 0.36, 1] as const;

type Step = 'phone' | 'code' | 'onboard';

interface TokenPair {
  access_token: string;
  refresh_token: string;
  expires_in: number;
}

interface ExchangeResponse extends Partial<TokenPair> {
  onboarding_required?: true;
  onboarding_token?: string;
  tenant_choice_required?: true;
}

export function LoginForm() {
  const { t } = useLanguage();
  const router = useRouter();
  const [step, setStep] = useState<Step>('phone');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState<string[]>(Array(OTP_LENGTH).fill(''));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const confirmation = useRef<ConfirmationResult | null>(null);
  const onboardingToken = useRef<string | null>(null);
  const recaptchaHost = useRef<HTMLDivElement>(null);
  const otpRefs = useRef<Array<HTMLInputElement | null>>([]);

  async function exchange(firebaseToken: string): Promise<void> {
    const response = await fetch(`${API_URL}/auth/exchange`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ firebase_token: firebaseToken }),
    });
    const payload = (await response.json()) as ExchangeResponse & { message?: string };
    if (!response.ok) throw new Error(payload.message ?? 'Could not sign in');

    if (payload.onboarding_required && payload.onboarding_token) {
      // A number nobody has registered yet is a new builder, not a failed login.
      onboardingToken.current = payload.onboarding_token;
      setStep('onboard');
      return;
    }
    if (payload.tenant_choice_required) {
      throw new Error('This number belongs to more than one builder — contact support.');
    }
    await establishSession(payload as TokenPair);
  }

  async function establishSession(tokens: TokenPair): Promise<void> {
    // Hand the tokens straight to the server so they land in httpOnly cookies and
    // never sit anywhere a script on this page could read them.
    const stored = await fetch('/api/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(tokens),
    });
    if (!stored.ok) throw new Error('Could not start the session');
    // The root route decides where this person belongs — a client has no overview to land on.
    router.replace('/');
  }

  async function handlePhoneSubmit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      // The shared helper, not a local regex: this is the same normalisation the
      // API uses to look the person up, so the two must not drift.
      const e164 = toE164Indian(phone);
      if (!e164) throw new Error('Enter a 10-digit mobile number');
      const digits = e164.slice(2);

      if (DEV_AUTH_BYPASS || !isFirebaseConfigured()) {
        await exchange(`dev:91${digits}`);
        return;
      }

      const auth = firebaseAuth();
      // Firebase needs a live reCAPTCHA widget anchored in the DOM; it is created
      // lazily so the invisible challenge is not armed before it is needed.
      const verifier = new RecaptchaVerifier(auth, recaptchaHost.current ?? 'recaptcha-host', {
        size: 'invisible',
      });
      confirmation.current = await signInWithPhoneNumber(auth, `+91${digits}`, verifier);
      setStep('code');
      setTimeout(() => otpRefs.current[0]?.focus(), 60);
    } catch (cause) {
      setError(messageOf(cause));
    } finally {
      setBusy(false);
    }
  }

  /**
   * Google, for whoever is at a desk rather than on a slab.
   *
   * It lands in the same `/auth/exchange` as the OTP does — Firebase is the vendor for both, and
   * the API decides what the token proves. The difference is what happens when nobody recognises
   * it: an unknown phone starts an account, an unknown Google address cannot, because an account
   * is built around a mobile number. The API says so in words and they are shown as-is.
   */
  async function handleGoogle(): Promise<void> {
    setError(null);
    setBusy(true);
    try {
      if (DEV_AUTH_BYPASS || !isFirebaseConfigured()) {
        // No popup without Firebase, so development asks for the address directly. `prompt` is
        // deliberate: this branch is compiled out of a production bundle, and a bespoke dialog for
        // it would be code nobody but a developer ever sees.
        const email = window.prompt('Dev sign-in — Google address to sign in as');
        if (!email) return;
        await exchange(`dev:${email.trim()}`);
        return;
      }

      const credential = await signInWithPopup(firebaseAuth(), new GoogleAuthProvider());
      await exchange(await credential.user.getIdToken());
    } catch (cause) {
      // Closing the popup is not an error worth a red box — it is somebody changing their mind.
      if (isPopupDismissal(cause)) return;
      setError(messageOf(cause));
    } finally {
      setBusy(false);
    }
  }

  async function submitCode(value: string): Promise<void> {
    setError(null);
    setBusy(true);
    try {
      if (!confirmation.current) throw new Error('Request a new code');
      const credential = await confirmation.current.confirm(value);
      await exchange(await credential.user.getIdToken());
    } catch (cause) {
      setError(messageOf(cause));
      setCode(Array(OTP_LENGTH).fill(''));
      otpRefs.current[0]?.focus();
    } finally {
      setBusy(false);
    }
  }

  function setDigit(index: number, value: string) {
    const digit = value.replace(/\D/g, '').slice(-1);
    const next = [...code];
    next[index] = digit;
    setCode(next);

    if (digit && index < OTP_LENGTH - 1) otpRefs.current[index + 1]?.focus();
    // Submit the moment the last box is filled — nobody wants to hunt for a button
    // with a code they are holding in short-term memory.
    if (digit && index === OTP_LENGTH - 1 && next.every(Boolean)) {
      void submitCode(next.join(''));
    }
  }

  function onOtpKeyDown(index: number, event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Backspace' && !code[index] && index > 0) {
      otpRefs.current[index - 1]?.focus();
    }
  }

  function onOtpPaste(event: ClipboardEvent<HTMLInputElement>) {
    const pasted = event.clipboardData.getData('text').replace(/\D/g, '').slice(0, OTP_LENGTH);
    if (pasted.length === 0) return;
    event.preventDefault();
    const next = Array(OTP_LENGTH)
      .fill('')
      .map((_, i) => pasted[i] ?? '');
    setCode(next);
    if (next.every(Boolean)) void submitCode(next.join(''));
    else otpRefs.current[pasted.length]?.focus();
  }

  async function handleOnboardSubmit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const token = onboardingToken.current;
      if (!token) throw new Error('Start again');
      const form = new FormData(event.target as HTMLFormElement);

      const response = await fetch(`${API_URL}/tenants`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Onboarding-Token': token },
        // No plan. The server picks the term from the catalogue — a signup that could name its
        // own plan could name the lifetime one and be given it.
        body: JSON.stringify({
          name: String(form.get('company') ?? ''),
          owner_name: String(form.get('owner') ?? ''),
        }),
      });
      const payload = (await response.json()) as { tokens?: TokenPair; message?: string };
      if (!response.ok || !payload.tokens) {
        throw new Error(payload.message ?? 'Could not create the account');
      }
      await establishSession(payload.tokens);
    } catch (cause) {
      setError(messageOf(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="relative flex flex-col justify-center bg-canvas px-6 py-10 lg:px-12">
      {/* The wordmark only appears where the dark panel does not. */}
      <div className="mb-8 flex items-center gap-3 lg:hidden">
        <span className="flex size-10 items-center justify-center rounded-[11px] bg-accent text-[15px] font-bold text-white">
          B
        </span>
        <span className="text-[17px] font-semibold">BUILDR</span>
      </div>

      <div className="mx-auto w-full max-w-[440px] rounded-[18px] border border-line bg-surface p-7 shadow-[0_18px_50px_-24px_rgba(27,26,46,0.28)] sm:p-9">

        <AnimatePresence mode="wait">
          <motion.div
            key={step}
            initial={{ opacity: 0, x: 16 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -16 }}
            transition={{ duration: 0.3, ease: EASE }}
          >
            {step === 'phone' && (
              <form onSubmit={handlePhoneSubmit} className="flex flex-col gap-6">
                <header className="flex flex-col gap-1.5">
                  <h1 className="text-[30px] font-bold leading-[1.1] tracking-[-0.025em]">
                    {t('Welcome back')}
                  </h1>
                  <p className="text-[19px] font-medium leading-snug text-ink-soft">
                    {t('Sign in to your workspace')}
                  </p>
                  <p className="mt-1.5 text-[13.5px] leading-relaxed text-ink-muted">
                    {t('Enter the mobile number your builder registered and we’ll send you a secure code. There is no password to remember.')}
                  </p>
                </header>

                <Field label={t('Mobile number')} htmlFor="phone">
                  <div className="flex items-center gap-0 overflow-hidden rounded-btn border border-line-strong bg-surface transition focus-within:border-accent">
                    <span className="flex h-12 select-none items-center border-r border-line px-3.5 font-mono text-[15px] text-ink-muted">
                      +91
                    </span>
                    <input
                      id="phone"
                      autoFocus
                      inputMode="numeric"
                      autoComplete="tel-national"
                      placeholder="98765 43210"
                      value={phone}
                      onChange={(event) => setPhone(event.target.value)}
                      required
                      // 17px keeps iOS from zooming the viewport on focus.
                      className="h-12 flex-1 bg-transparent px-3.5 font-mono text-[17px] tracking-[0.04em] outline-none placeholder:font-sans placeholder:tracking-normal placeholder:text-ink-faint"
                    />
                  </div>
                </Field>

                <div className="-mt-2 flex flex-col gap-4">
                  <Submit busy={busy}>{DEV_AUTH_BYPASS ? 'Sign in' : 'Continue'}</Submit>

                  <p className="flex items-start gap-2.5 text-[12.5px] leading-relaxed text-ink-muted">
                    <Lock className="mt-0.5 size-3.5 flex-none text-ink-faint" />
                    {t('We’ll send a one-time code to your mobile. No password needed.')}
                  </p>
                </div>

                <div className="flex items-center gap-3">
                  <span className="h-px flex-1 bg-line" />
                  <span className="text-[11.5px] font-medium uppercase tracking-[0.12em] text-ink-faint">
                    or
                  </span>
                  <span className="h-px flex-1 bg-line" />
                </div>

                {/* Second, not first: the phone is the identity this product is built around, and
                    Google only works for somebody who has already linked it to their account. */}
                <button
                  type="button"
                  onClick={() => void handleGoogle()}
                  disabled={busy}
                  className="flex h-12 w-full items-center justify-center gap-3 rounded-btn border border-line-strong bg-surface text-[14.5px] font-semibold text-ink transition hover:bg-raised disabled:opacity-60"
                >
                  <GoogleMark />
                  {t('Continue with Google')}
                </button>

                {/*
                  No numbers printed here any more.

                  It used to name two seeded accounts, which stopped being true the moment the
                  seed changed or the data was cleared — and a sign-in page confidently offering a
                  number that no longer exists is worse than one that offers none. Any number
                  works in this mode; which ones have data in them is a question for whoever
                  seeded the database, not for a hardcoded line in the UI.
                */}
                {DEV_AUTH_BYPASS && (
                  <p className="rounded-btn border border-pending-line bg-pending-bg px-3.5 py-2.5 text-[12.5px] leading-relaxed text-pending-fg">
                    <span className="font-semibold">{t('Developer / demo access.')}</span>{' '}
                    {t('No SMS is sent — any mobile number signs in, and an unknown one starts a new account.')}
                  </p>
                )}
              </form>
            )}

            {step === 'code' && (
              <div className="flex flex-col gap-6">
                <header className="flex flex-col gap-2">
                  <span className="flex size-11 items-center justify-center rounded-card bg-accent-soft text-accent">
                    <ShieldCheck className="size-5" />
                  </span>
                  <h1 className="mt-1 text-[30px] font-bold leading-tight tracking-[-0.02em]">
                    {t('Enter the code')}
                  </h1>
                  <p className="text-[14.5px] leading-relaxed text-ink-muted">
                    {t('Sent to')} <span className="font-mono font-semibold text-ink">+91 {phone}</span>
                  </p>
                </header>

                <div className="flex gap-2" onPaste={onOtpPaste}>
                  {code.map((digit, index) => (
                    <input
                      key={index}
                      ref={(element) => {
                        otpRefs.current[index] = element;
                      }}
                      value={digit}
                      onChange={(event) => setDigit(index, event.target.value)}
                      onKeyDown={(event) => onOtpKeyDown(index, event)}
                      inputMode="numeric"
                      maxLength={1}
                      autoComplete={index === 0 ? 'one-time-code' : 'off'}
                      aria-label={`Digit ${index + 1}`}
                      disabled={busy}
                      className={cn(
                        // Capped rather than purely `flex-1`: six boxes sharing a 400px card come
                        // out 60px wide against 56px tall, which reads as a row of text fields
                        // rather than a row of digits. 48px keeps each one slightly taller than it
                        // is wide, and the flex basis still lets them shrink on a narrow phone.
                        'h-14 min-w-0 max-w-[48px] flex-1 rounded-btn border bg-surface text-center font-mono text-[20px] font-semibold outline-none transition',
                        digit ? 'border-accent' : 'border-line-strong',
                        'focus:border-accent focus:ring-2 focus:ring-accent/20',
                      )}
                    />
                  ))}
                </div>

                {busy && (
                  <p className="flex items-center gap-2 text-[13.5px] text-ink-muted">
                    <Loader2 className="size-4 animate-spin" /> {t('Verifying…')}
                  </p>
                )}

                <button
                  type="button"
                  onClick={() => {
                    setStep('phone');
                    setCode(Array(OTP_LENGTH).fill(''));
                    setError(null);
                  }}
                  className="flex min-h-0 items-center gap-1.5 self-start text-[13.5px] font-medium text-ink-muted transition hover:text-ink"
                >
                  <ArrowLeft className="size-3.5" /> {t('Use a different number')}
                </button>
              </div>
            )}

            {step === 'onboard' && (
              <form onSubmit={handleOnboardSubmit} className="flex flex-col gap-6">
                <header className="flex flex-col gap-2">
                  <span className="font-mono text-[11.5px] uppercase tracking-[0.16em] text-accent">
                    {t('New account')}
                  </span>
                  <h1 className="text-[30px] font-bold leading-tight tracking-[-0.02em]">
                    {t('Set up your company')}
                  </h1>
                  <p className="text-[14.5px] leading-relaxed text-ink-muted">
                    {t('This number isn’t on a team yet. Create the account and you’ll be the owner — sites, team and plan come next.')}
                  </p>
                </header>

                <Field label={t('Company name')} htmlFor="company">
                  <Input id="company" name="company" required minLength={2} placeholder="ARK Constructions" className="h-12 text-[16px]" />
                </Field>
                <Field label={t('Your name')} htmlFor="owner">
                  <Input id="owner" name="owner" required placeholder="Gowtham Kumar" className="h-12 text-[16px]" />
                </Field>

                <Submit busy={busy}>{t('Create account')}</Submit>
              </form>
            )}
          </motion.div>
        </AnimatePresence>

        <AnimatePresence>
          {error && (
            <motion.p
              role="alert"
              initial={{ opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="mt-5 rounded-btn border border-blocked/30 bg-blocked-bg px-3.5 py-2.5 text-[13.5px] leading-relaxed text-blocked-fg"
            >
              {error}
            </motion.p>
          )}
        </AnimatePresence>

        <div ref={recaptchaHost} id="recaptcha-host" />
      </div>

      <footer className="mx-auto mt-8 flex w-full max-w-[440px] flex-wrap items-center justify-between gap-2 text-[12px] text-ink-faint">
        <span>© {new Date().getFullYear()} {t('BUILDR. All rights reserved.')}</span>
        <span className="flex items-center gap-1.5">
          <span aria-hidden className="size-2 rounded-[3px] bg-accent" />
          {t('Powered by Trusta Technologies')}
        </span>
      </footer>
    </section>
  );
}


function Submit({ busy, children }: { busy: boolean; children: React.ReactNode }) {
  const { t } = useLanguage();
  return (
    <Button type="submit" size="lg" disabled={busy} className="w-full gap-2">
      {busy ? (
        <>
          <Loader2 className="animate-spin" /> {t('Please wait…')}
        </>
      ) : (
        <>
          {children} <ArrowRight />
        </>
      )}
    </Button>
  );
}

/** Firebase's own codes for "the user closed the popup", which is not a failure. */
function isPopupDismissal(cause: unknown): boolean {
  const code = (cause as { code?: string } | null)?.code;
  return (
    code === 'auth/popup-closed-by-user' ||
    code === 'auth/cancelled-popup-request' ||
    code === 'auth/user-cancelled'
  );
}

function messageOf(cause: unknown): string {
  if (cause instanceof Error) return cause.message;
  return 'Something went wrong';
}
