'use client';

import { useRouter } from 'next/navigation';
import {
  useEffect,
  useRef,
  useState,
  type ClipboardEvent,
  type FormEvent,
  type KeyboardEvent,
} from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ArrowLeft, ArrowRight, Loader2, Lock, Mail, ShieldCheck } from 'lucide-react';
import {
  GoogleAuthProvider,
  RecaptchaVerifier,
  TotpMultiFactorGenerator,
  getMultiFactorResolver,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPhoneNumber,
  signInWithPopup,
  type ConfirmationResult,
  type MultiFactorError,
  type MultiFactorResolver,
  type User,
} from 'firebase/auth';
import {
  COUNTRY_PRESETS,
  countryOfPhone,
  displayPhone,
  phoneCountry,
  presetFor,
  toE164,
} from '@sitebook/shared';
import { firebaseAuth, isFirebaseConfigured } from '@/lib/firebase';
import { authErrorCode, authErrorMessage } from '@/lib/auth-errors';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { useLanguage } from '@/components/language-provider';
import { GoogleMark } from '@/components/ui/google-mark';
import { CallingCodeSelect } from '@/components/phone-input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

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

/** `email` and `mfa` are the email-and-password way in and its authenticator-app step. */
type Step = 'phone' | 'code' | 'email' | 'mfa' | 'onboard';

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
  /** Good news that still needs the reader to do something — "check your inbox". */
  const [notice, setNotice] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [country, setCountry] = useState('IN');
  /** The calling code in front of the number. India until the browser's zone says otherwise. */
  const [phoneCode, setPhoneCode] = useState('IN');
  /** The number as it will be stored, once it has passed the check. */
  const [signedInPhone, setSignedInPhone] = useState<string | null>(null);
  // The same number for code that runs before the state update lands (`exchange`, same tick).
  const signedInPhoneRef = useRef<string | null>(null);

  // After mount, not in the initial state: the server has no time zone to guess from, and a
  // different first render in the browser would be a hydration mismatch.
  useEffect(() => setPhoneCode(guessCountry()), []);

  const confirmation = useRef<ConfirmationResult | null>(null);
  /** The half-finished email sign-in waiting on its authenticator code. */
  const secondFactor = useRef<{ resolver: MultiFactorResolver; hintUid: string } | null>(null);
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
      // The country of the number that just signed in is the best guess for the company's.
      setCountry(countryOfPhone(signedInPhoneRef.current ?? '')?.country ?? guessCountry());
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
      const e164 = toE164(phone, phoneCode);
      if (!e164) throw new Error('Enter a mobile number for the country selected');
      signedInPhoneRef.current = e164;
      setSignedInPhone(e164);

      if (DEV_AUTH_BYPASS || !isFirebaseConfigured()) {
        await exchange(`dev:${e164}`);
        return;
      }

      const auth = firebaseAuth();
      // Firebase needs a live reCAPTCHA widget anchored in the DOM; it is created
      // lazily so the invisible challenge is not armed before it is needed.
      const verifier = new RecaptchaVerifier(auth, recaptchaHost.current ?? 'recaptcha-host', {
        size: 'invisible',
      });
      confirmation.current = await signInWithPhoneNumber(auth, `+${e164}`, verifier);
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
      /*
       * The real popup whenever Firebase is configured, development included.
       *
       * The dev bypass is there because an SMS costs money and takes a minute. A Google popup
       * costs nothing and is instant, so skipping it bought nothing and cost a `window.prompt`
       * asking somebody to type the address they were about to pick from a list.
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
      // Closing the popup is not an error worth a red box — it is somebody changing their mind.
      if (isPopupDismissal(cause)) return;
      setError(messageOf(cause));
    } finally {
      setBusy(false);
    }
  }

  /**
   * Email and password, for somebody who set it up under Your account.
   *
   * Like Google, it only signs in an address already linked to a user — the API says so in words
   * otherwise. An account with two-factor on stops half-way with `multi-factor-auth-required`,
   * which is not a failure: it is Firebase asking for the authenticator code.
   */
  async function handleEmailSubmit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      const address = email.trim();
      if (isFirebaseConfigured()) {
        const auth = firebaseAuth();
        let user: User;
        try {
          user = (await signInWithEmailAndPassword(auth, address, password)).user;
        } catch (cause) {
          if (authErrorCode(cause) !== 'auth/multi-factor-auth-required') throw cause;
          const resolver = getMultiFactorResolver(auth, cause as MultiFactorError);
          const hint = resolver.hints.find(
            (candidate) => candidate.factorId === TotpMultiFactorGenerator.FACTOR_ID,
          );
          // The only second factor this app enrols. Anything else was set up somewhere else.
          if (!hint) throw new Error('This account’s second step is not an authenticator app.');
          secondFactor.current = { resolver, hintUid: hint.uid };
          setCode(Array(OTP_LENGTH).fill(''));
          setStep('mfa');
          setTimeout(() => otpRefs.current[0]?.focus(), 60);
          return;
        }
        await finishEmailSignIn(user);
        return;
      }

      if (DEV_AUTH_BYPASS) {
        // No Firebase, so there is no password to check. Compiled out of a production bundle.
        await exchange(`dev:${address}`);
        return;
      }

      throw new Error('Email sign-in is not configured on this deployment');
    } catch (cause) {
      setError(t(authErrorMessage(cause)));
    } finally {
      setBusy(false);
    }
  }

  /**
   * The last step of an email sign-in, with or without the authenticator code.
   *
   * An unverified address gets a fresh link instead of a session. The API would refuse the token
   * anyway — it trusts an address only once its owner has shown they read its mail — and "check
   * your inbox" is a better thing to be told than "could not verify".
   */
  async function finishEmailSignIn(user: User): Promise<void> {
    if (!user.emailVerified) {
      await sendEmailVerification(user);
      setNotice(
        `${t('We sent a verification link to')} ${user.email ?? email.trim()}. ${t('Open it, then sign in again.')}`,
      );
      return;
    }
    await exchange(await user.getIdToken());
  }

  async function handleForgotPassword(): Promise<void> {
    setError(null);
    setNotice(null);
    const address = email.trim();
    if (!address) {
      setError(t('Enter your email address first, then tap Forgot password.'));
      return;
    }
    if (!isFirebaseConfigured()) {
      setError(t('Password reset needs Firebase configured on this deployment.'));
      return;
    }
    setBusy(true);
    try {
      await sendPasswordResetEmail(firebaseAuth(), address);
      // Worded for the case Firebase will not reveal: whether anybody uses this address at all.
      setNotice(
        `${t('If an account uses')} ${address}, ${t('a link to reset its password is on its way.')}`,
      );
    } catch (cause) {
      setError(t(authErrorMessage(cause)));
    } finally {
      setBusy(false);
    }
  }

  /** The authenticator code that finishes an email sign-in with two-factor on. */
  async function submitTotp(value: string): Promise<void> {
    const pending = secondFactor.current;
    if (!pending) throw new Error('Sign in with email again');
    const assertion = TotpMultiFactorGenerator.assertionForSignIn(pending.hintUid, value);
    const credential = await pending.resolver.resolveSignIn(assertion);
    // A resolver is good for one sign-in. Whatever happens next, a retry starts from the password.
    secondFactor.current = null;
    try {
      await finishEmailSignIn(credential.user);
    } catch (cause) {
      setStep('email');
      throw cause;
    }
  }

  async function submitCode(value: string): Promise<void> {
    setError(null);
    setBusy(true);
    if (step === 'mfa') {
      try {
        await submitTotp(value);
      } catch (cause) {
        setError(t(authErrorMessage(cause)));
        setCode(Array(OTP_LENGTH).fill(''));
        otpRefs.current[0]?.focus();
      } finally {
        setBusy(false);
      }
      return;
    }
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
          // The country's preset fills currency, zone, format and tax; each is editable later in
          // Settings → Company. Currency is the one that matters now: it fixes how amounts are stored.
          ...localeBody(country),
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

  function backToPhone() {
    setStep('phone');
    setError(null);
    setNotice(null);
  }

  // Shared by the SMS code and the authenticator code: six digits either way.
  const otpBoxes = (
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
  );

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
                    <CallingCodeSelect
                      value={phoneCode}
                      onChange={setPhoneCode}
                      className="h-12 px-3.5 text-[15px]"
                    />
                    <input
                      id="phone"
                      autoFocus
                      inputMode="numeric"
                      autoComplete="tel-national"
                      placeholder={phoneCountry(phoneCode)?.example}
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

                {/* Third: an address and a password, for an office login with no phone to hand.
                    Like Google, it only works once it has been set up under Your account. */}
                <button
                  type="button"
                  onClick={() => {
                    setError(null);
                    setNotice(null);
                    setStep('email');
                  }}
                  disabled={busy}
                  className="-mt-3 flex h-12 w-full items-center justify-center gap-3 rounded-btn border border-line-strong bg-surface text-[14.5px] font-semibold text-ink transition hover:bg-raised disabled:opacity-60"
                >
                  <Mail className="size-4 text-ink-soft" />
                  {t('Sign in with email')}
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
                    {t('Sent to')} <span className="font-mono font-semibold text-ink">{signedInPhone ? displayPhone(signedInPhone) : phone}</span>
                  </p>
                </header>

                {otpBoxes}

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

            {step === 'email' && (
              <form onSubmit={handleEmailSubmit} className="flex flex-col gap-6">
                <header className="flex flex-col gap-2">
                  <span className="flex size-11 items-center justify-center rounded-card bg-accent-soft text-accent">
                    <Mail className="size-5" />
                  </span>
                  <h1 className="mt-1 text-[30px] font-bold leading-tight tracking-[-0.02em]">
                    {t('Sign in with email')}
                  </h1>
                  <p className="text-[14.5px] leading-relaxed text-ink-muted">
                    {t('Use the email and password you set up under Your account.')}
                  </p>
                </header>

                <Field label={t('Email')} htmlFor="email">
                  <Input
                    id="email"
                    type="email"
                    autoFocus
                    autoComplete="username"
                    required
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    className="h-12 text-[16px]"
                  />
                </Field>
                <div className="flex flex-col gap-2">
                  <Field label={t('Password')} htmlFor="password">
                    <Input
                      id="password"
                      type="password"
                      autoComplete="current-password"
                      // Nothing checks it without Firebase, so nothing should demand it.
                      required={isFirebaseConfigured()}
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      className="h-12 text-[16px]"
                    />
                  </Field>
                  <button
                    type="button"
                    onClick={() => void handleForgotPassword()}
                    disabled={busy}
                    className="self-end text-[13px] font-medium text-accent underline-offset-4 hover:underline disabled:opacity-60"
                  >
                    {t('Forgot password?')}
                  </button>
                </div>

                <Submit busy={busy}>{t('Sign in')}</Submit>

                {DEV_AUTH_BYPASS && !isFirebaseConfigured() && (
                  <p className="rounded-btn border border-pending-line bg-pending-bg px-3.5 py-2.5 text-[12.5px] leading-relaxed text-pending-fg">
                    <span className="font-semibold">{t('Developer / demo access.')}</span>{' '}
                    {t('No password is checked — any email linked to a user signs in.')}
                  </p>
                )}

                <button
                  type="button"
                  onClick={backToPhone}
                  className="flex min-h-0 items-center gap-1.5 self-start text-[13.5px] font-medium text-ink-muted transition hover:text-ink"
                >
                  <ArrowLeft className="size-3.5" /> {t('Use your mobile number instead')}
                </button>
              </form>
            )}

            {step === 'mfa' && (
              <div className="flex flex-col gap-6">
                <header className="flex flex-col gap-2">
                  <span className="flex size-11 items-center justify-center rounded-card bg-accent-soft text-accent">
                    <ShieldCheck className="size-5" />
                  </span>
                  <h1 className="mt-1 text-[30px] font-bold leading-tight tracking-[-0.02em]">
                    {t('Two-factor code')}
                  </h1>
                  <p className="text-[14.5px] leading-relaxed text-ink-muted">
                    {t('Enter the 6-digit code from your authenticator app.')}
                  </p>
                </header>

                {otpBoxes}

                {busy && (
                  <p className="flex items-center gap-2 text-[13.5px] text-ink-muted">
                    <Loader2 className="size-4 animate-spin" /> {t('Verifying…')}
                  </p>
                )}

                <button
                  type="button"
                  onClick={() => {
                    setStep('email');
                    setCode(Array(OTP_LENGTH).fill(''));
                    secondFactor.current = null;
                    setError(null);
                  }}
                  className="flex min-h-0 items-center gap-1.5 self-start text-[13.5px] font-medium text-ink-muted transition hover:text-ink"
                >
                  <ArrowLeft className="size-3.5" /> {t('Back to email sign-in')}
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
                <Field
                  label={t('Country')}
                  htmlFor="country"
                  hint={`${t('Amounts will be in')} ${presetFor(country)?.currency ?? 'INR'}. ${t('Time zone and tax can be changed later in Settings.')}`}
                >
                  <Select value={country} onValueChange={setCountry}>
                    <SelectTrigger id="country" className="h-12 text-[16px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {COUNTRY_PRESETS.map((preset) => (
                        <SelectItem key={preset.country} value={preset.country}>
                          {preset.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
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

        <AnimatePresence>
          {notice && (
            <motion.p
              role="status"
              initial={{ opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="mt-5 rounded-btn border border-line bg-raised px-3.5 py-2.5 text-[13.5px] leading-relaxed text-ink-soft"
            >
              {notice}
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

/**
 * The country whose preset zone is the browser's, or India.
 *
 * Only a default for the picker: somebody signing up from Dubai starts on the UAE, and anybody
 * the guess gets wrong changes it in one tap.
 */
function guessCountry(): string {
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return COUNTRY_PRESETS.find((preset) => preset.timezone === zone)?.country ?? 'IN';
}

/** The onboarding fields for a country, in the API's names. */
function localeBody(country: string) {
  const preset = presetFor(country) ?? COUNTRY_PRESETS[0]!;
  return {
    country: preset.country,
    currency: preset.currency,
    timezone: preset.timezone,
    locale: preset.locale,
    tax_regime: preset.taxRegime,
  };
}
