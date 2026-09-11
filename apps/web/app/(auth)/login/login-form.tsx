'use client';

import { useRouter } from 'next/navigation';
import { useRef, useState, type ClipboardEvent, type FormEvent, type KeyboardEvent } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ArrowLeft, ArrowRight, Loader2, ShieldCheck } from 'lucide-react';
import { RecaptchaVerifier, signInWithPhoneNumber, type ConfirmationResult } from 'firebase/auth';
import { toE164Indian } from '@sitebook/shared';
import { firebaseAuth, isFirebaseConfigured } from '@/lib/firebase';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/ui/label';
import { cn } from '@/lib/utils';

const API_URL = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:3000/v1';
const DEV_BYPASS = process.env['NEXT_PUBLIC_DEV_AUTH_BYPASS'] === 'true';
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

      if (DEV_BYPASS || !isFirebaseConfigured()) {
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
        body: JSON.stringify({
          name: String(form.get('company') ?? ''),
          owner_name: String(form.get('owner') ?? ''),
          plan: 'starter',
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
    <section className="flex items-center justify-center bg-canvas px-6 py-10">
      <div className="w-full max-w-[400px]">
        {/* The wordmark only appears where the dark panel does not. */}
        <div className="mb-8 flex items-center gap-3 lg:hidden">
          <span className="flex size-10 items-center justify-center rounded-control bg-nav text-[14px] font-bold text-white">
            SB
          </span>
          <span className="text-[17px] font-semibold">BUILDR</span>
        </div>

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
                <header className="flex flex-col gap-2">
                  <h1 className="text-[30px] font-bold leading-tight tracking-[-0.02em]">
                    Sign in
                  </h1>
                  <p className="text-[14.5px] leading-relaxed text-ink-muted">
                    Use the mobile number your builder registered. We’ll text you a code —
                    there’s no password to remember.
                  </p>
                </header>

                <Field label="Mobile number" htmlFor="phone">
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

                <Submit busy={busy}>{DEV_BYPASS ? 'Sign in' : 'Send code'}</Submit>

                {DEV_BYPASS && (
                  <p className="rounded-btn border border-pending-line bg-pending-bg px-3.5 py-2.5 text-[12.5px] leading-relaxed text-pending-fg">
                    Dev sign-in is on — no SMS is sent. Try{' '}
                    <span className="font-mono font-semibold">9000000001</span> (owner) or{' '}
                    <span className="font-mono font-semibold">9000000003</span> (supervisor).
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
                    Enter the code
                  </h1>
                  <p className="text-[14.5px] leading-relaxed text-ink-muted">
                    Sent to <span className="font-mono font-semibold text-ink">+91 {phone}</span>
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
                        'h-14 flex-1 rounded-btn border bg-surface text-center font-mono text-[22px] font-semibold outline-none transition',
                        digit ? 'border-accent' : 'border-line-strong',
                        'focus:border-accent focus:ring-2 focus:ring-accent/20',
                      )}
                    />
                  ))}
                </div>

                {busy && (
                  <p className="flex items-center gap-2 text-[13.5px] text-ink-muted">
                    <Loader2 className="size-4 animate-spin" /> Verifying…
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
                  <ArrowLeft className="size-3.5" /> Use a different number
                </button>
              </div>
            )}

            {step === 'onboard' && (
              <form onSubmit={handleOnboardSubmit} className="flex flex-col gap-6">
                <header className="flex flex-col gap-2">
                  <span className="font-mono text-[11.5px] uppercase tracking-[0.16em] text-accent">
                    New account
                  </span>
                  <h1 className="text-[30px] font-bold leading-tight tracking-[-0.02em]">
                    Set up your company
                  </h1>
                  <p className="text-[14.5px] leading-relaxed text-ink-muted">
                    This number isn’t on a team yet. Create the account and you’ll be the owner —
                    sites, team and plan come next.
                  </p>
                </header>

                <Field label="Company name" htmlFor="company">
                  <Input id="company" name="company" required minLength={2} placeholder="ARK Constructions" className="h-12 text-[16px]" />
                </Field>
                <Field label="Your name" htmlFor="owner">
                  <Input id="owner" name="owner" required placeholder="Gowtham Kumar" className="h-12 text-[16px]" />
                </Field>

                <Submit busy={busy}>Create account</Submit>
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
    </section>
  );
}

function Submit({ busy, children }: { busy: boolean; children: React.ReactNode }) {
  return (
    <Button type="submit" size="lg" disabled={busy} className="w-full gap-2">
      {busy ? (
        <>
          <Loader2 className="animate-spin" /> Please wait…
        </>
      ) : (
        <>
          {children} <ArrowRight />
        </>
      )}
    </Button>
  );
}

function messageOf(cause: unknown): string {
  if (cause instanceof Error) return cause.message;
  return 'Something went wrong';
}
