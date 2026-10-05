'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useReducer, useRef, useState, type FormEvent } from 'react';
import {
  TotpMultiFactorGenerator,
  createUserWithEmailAndPassword,
  getMultiFactorResolver,
  multiFactor,
  onAuthStateChanged,
  sendEmailVerification,
  signInWithEmailAndPassword,
  type MultiFactorError,
  type MultiFactorResolver,
  type TotpSecret,
  type User,
} from 'firebase/auth';
import { Copy, ExternalLink, Loader2, Mail, ShieldCheck, ShieldOff } from 'lucide-react';
import { toast } from 'sonner';
import { firebaseAuth, isFirebaseConfigured } from '@/lib/firebase';
import { authErrorCode, authErrorMessage } from '@/lib/auth-errors';
import { linkEmailSignIn } from '@/lib/actions';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/ui/label';
import { useLanguage } from '@/components/language-provider';

/**
 * What the card is in the middle of. `idle` shows the status; the rest are one step each:
 * the address-and-password form, its authenticator code, waiting on the verification link, and
 * scanning a new authenticator secret.
 */
type Phase = 'idle' | 'form' | 'mfa' | 'verify' | 'enroll';

/**
 * Email and password as a way in, and an authenticator app as a second step on top of it.
 *
 * Firebase owns the password and the second factor; BUILDR only ever learns the address, and only
 * once Firebase says its owner has opened a link sent to it. Linking goes through the same endpoint
 * as Google, which reads the verified address out of whatever token it is given — so the address
 * linked is always one this person has proved they read the mail of, never one they typed.
 *
 * Two-factor is managed on the Firebase sign-in that lives in this browser, which is why the
 * controls appear only after an email sign-in here (on this card or on the sign-in page).
 */
export function EmailSignIn({ linkedEmail }: { linkedEmail: string | null }) {
  const { t } = useLanguage();
  const router = useRouter();
  const configured = isFirebaseConfigured();

  const [user, setUser] = useState<User | null>(null);
  // `reload`, `enroll` and `unenroll` change the user in place, which React cannot see.
  const [, bump] = useReducer((n: number) => n + 1, 0);
  const [phase, setPhase] = useState<Phase>('idle');
  const [email, setEmail] = useState(linkedEmail ?? '');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [secret, setSecret] = useState<TotpSecret | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const secondFactor = useRef<{ resolver: MultiFactorResolver; hintUid: string } | null>(null);

  useEffect(() => {
    if (!configured) return;
    return onAuthStateChanged(firebaseAuth(), setUser);
  }, [configured]);

  // Only a password sign-in can carry an authenticator app — Firebase refuses one on a phone login.
  const emailUser = user?.providerData.some((info) => info.providerId === 'password') ? user : null;
  const totp = emailUser
    ? multiFactor(emailUser).enrolledFactors.filter(
        (factor) => factor.factorId === TotpMultiFactorGenerator.FACTOR_ID,
      )
    : [];

  /** Runs one step with the busy flag and the error box, and the recent-login detour. */
  async function run(step: () => Promise<void>): Promise<void> {
    setError(null);
    setBusy(true);
    try {
      await step();
    } catch (cause) {
      setError(t(authErrorMessage(cause)));
      if (authErrorCode(cause) === 'auth/requires-recent-login') reauthenticate();
    } finally {
      setBusy(false);
    }
  }

  /** Firebase wants a fresh password before changing the second factor. Back to the form. */
  function reauthenticate() {
    setEmail(emailUser?.email ?? email);
    setPassword('');
    setSecret(null);
    setPhase('form');
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    void run(async () => {
      const auth = firebaseAuth();
      const address = email.trim();
      let next: User;
      try {
        next = (await createUserWithEmailAndPassword(auth, address, password)).user;
      } catch (cause) {
        if (authErrorCode(cause) !== 'auth/email-already-in-use') throw cause;
        // A sign-in already exists for this address. The password decides whether it is theirs.
        try {
          next = (await signInWithEmailAndPassword(auth, address, password)).user;
        } catch (inner) {
          if (authErrorCode(inner) !== 'auth/multi-factor-auth-required') throw inner;
          const resolver = getMultiFactorResolver(auth, inner as MultiFactorError);
          const hint = resolver.hints.find(
            (candidate) => candidate.factorId === TotpMultiFactorGenerator.FACTOR_ID,
          );
          if (!hint) throw new Error('This account’s second step is not an authenticator app.');
          secondFactor.current = { resolver, hintUid: hint.uid };
          setCode('');
          setPhase('mfa');
          return;
        }
      }
      setPassword('');
      await afterSignIn(next);
    });
  }

  function handleSecondFactor(event: FormEvent) {
    event.preventDefault();
    void run(async () => {
      const pending = secondFactor.current;
      if (!pending) throw new Error('Sign in with email again');
      const assertion = TotpMultiFactorGenerator.assertionForSignIn(pending.hintUid, code.trim());
      const credential = await pending.resolver.resolveSignIn(assertion);
      secondFactor.current = null;
      setCode('');
      setPassword('');
      await afterSignIn(credential.user);
    });
  }

  /** Signed in to Firebase. An unverified address waits for its link; a verified one is linked. */
  async function afterSignIn(next: User): Promise<void> {
    if (!next.emailVerified) {
      await sendEmailVerification(next);
      setPhase('verify');
      return;
    }
    // Signing in again to an address that is already linked is a re-authentication, not a change.
    if (linkedEmail && next.email?.toLowerCase() === linkedEmail.toLowerCase()) {
      setPhase('idle');
      bump();
      return;
    }
    await link(next);
  }

  async function link(next: User): Promise<void> {
    // Forced, so the token carries `email_verified: true` rather than what it said an hour ago.
    const token = await next.getIdToken(true);
    const result = await linkEmailSignIn(token);
    if (!result.ok) throw new Error(result.error ?? 'Could not link that address');
    toast.success(`${t('Email sign-in is on for')} ${result.data?.email ?? next.email ?? ''}`);
    setPhase('idle');
    router.refresh();
  }

  function confirmVerified() {
    void run(async () => {
      const current = firebaseAuth().currentUser;
      if (!current) {
        setPhase('form');
        throw new Error('Sign in with email again');
      }
      await current.reload();
      bump();
      if (!current.emailVerified) {
        throw new Error(
          'That address is not verified yet. Open the link in the email, then try again.',
        );
      }
      await link(current);
    });
  }

  function resendVerification() {
    void run(async () => {
      const current = firebaseAuth().currentUser;
      if (!current) throw new Error('Sign in with email again');
      await sendEmailVerification(current);
      toast.success(t('Sent again'));
    });
  }

  function startEnrolment() {
    if (!emailUser) return;
    void run(async () => {
      const session = await multiFactor(emailUser).getSession();
      setSecret(await TotpMultiFactorGenerator.generateSecret(session));
      setCode('');
      setPhase('enroll');
    });
  }

  function handleEnrol(event: FormEvent) {
    event.preventDefault();
    if (!emailUser || !secret) return;
    void run(async () => {
      const assertion = TotpMultiFactorGenerator.assertionForEnrollment(secret, code.trim());
      await multiFactor(emailUser).enroll(assertion, 'Authenticator app');
      setSecret(null);
      setCode('');
      setPhase('idle');
      bump();
      toast.success(t('Two-factor is on'));
    });
  }

  async function turnOff(): Promise<{ ok: boolean; error?: string }> {
    if (!emailUser) return { ok: false, error: t('Sign in with email again') };
    try {
      for (const factor of totp) await multiFactor(emailUser).unenroll(factor);
      bump();
      return { ok: true };
    } catch (cause) {
      if (authErrorCode(cause) === 'auth/requires-recent-login') reauthenticate();
      return { ok: false, error: t(authErrorMessage(cause)) };
    }
  }

  async function copyKey(key: string) {
    try {
      await navigator.clipboard.writeText(key);
      toast.success(t('Key copied'));
    } catch {
      // Clipboard refused (insecure origin, permissions). The key is on screen to type.
    }
  }

  return (
    <Card className="flex flex-col gap-4 p-5">
      <div className="flex flex-wrap items-center gap-3">
        <span className="flex size-9 flex-none items-center justify-center rounded-control bg-neutral-bg">
          <Mail className="size-4 text-ink-soft" />
        </span>
        <div className="flex min-w-0 flex-col">
          <span className="text-[15px] font-semibold leading-tight">{t('Sign in with email')}</span>
          <span className="text-[13.5px] text-ink-soft">
            {linkedEmail ? (
              <>
                {t('Linked address')}: <span className="font-medium text-ink">{linkedEmail}</span>
              </>
            ) : (
              t('Optional. An email and password, with an authenticator app as a second step.')
            )}
          </span>
        </div>
        {configured && phase === 'idle' && !emailUser && (
          <div className="ms-auto">
            <Button size="sm" variant="secondary" onClick={() => setPhase('form')}>
              {t('Set up email sign-in')}
            </Button>
          </div>
        )}
      </div>

      {!configured && (
        <p className="rounded-btn border border-line bg-raised px-3.5 py-2.5 text-[13px] leading-relaxed text-ink-soft">
          {t(
            'Email sign-in needs Firebase configured on this deployment. Until then, link an address with the Google option above.',
          )}
        </p>
      )}

      {configured && phase === 'form' && (
        <form
          onSubmit={handleSubmit}
          className="flex flex-col gap-4 border-t border-line-soft pt-4"
        >
          <p className="text-[13px] leading-relaxed text-ink-muted">
            {t(
              'New here? We create the sign-in and email you a link to verify it. Already set up? Your password signs you in on this browser.',
            )}
          </p>
          {linkedEmail && email.trim().toLowerCase() !== linkedEmail.toLowerCase() && (
            <p className="text-[12.5px] leading-relaxed text-pending-fg">
              {t('A different address replaces')} {linkedEmail} {t('as the one you sign in with.')}
            </p>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t('Email')} htmlFor="email-sign-in-address">
              <Input
                id="email-sign-in-address"
                type="email"
                autoComplete="username"
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            </Field>
            <Field label={t('Password')} htmlFor="email-sign-in-password">
              <Input
                id="email-sign-in-password"
                type="password"
                // The browser offers to save a new one or fill a saved one; either is right here.
                autoComplete="new-password"
                required
                minLength={6}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </Field>
          </div>
          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={busy}>
              {busy && <Loader2 className="animate-spin" />}
              {t('Continue')}
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setPhase('idle')}>
              {t('Cancel')}
            </Button>
          </div>
        </form>
      )}

      {configured && phase === 'mfa' && (
        <form
          onSubmit={handleSecondFactor}
          className="flex flex-col gap-4 border-t border-line-soft pt-4"
        >
          <CodeField
            label={t('Code from your authenticator app')}
            value={code}
            onChange={setCode}
          />
          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={busy || code.length !== 6}>
              {busy && <Loader2 className="animate-spin" />}
              {t('Verify')}
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setPhase('form')}>
              {t('Back')}
            </Button>
          </div>
        </form>
      )}

      {configured && phase === 'verify' && (
        <div className="flex flex-col gap-3 border-t border-line-soft pt-4">
          <p className="text-[13.5px] leading-relaxed text-ink-soft">
            {t('We sent a verification link to')}{' '}
            <span className="font-medium text-ink">{user?.email ?? email}</span>.{' '}
            {t('Open it, then come back here.')}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" disabled={busy} onClick={confirmVerified}>
              {busy && <Loader2 className="animate-spin" />}
              {t('I’ve verified it')}
            </Button>
            <Button size="sm" variant="ghost" disabled={busy} onClick={resendVerification}>
              {t('Send the link again')}
            </Button>
          </div>
        </div>
      )}

      {configured && phase !== 'verify' && (
        <div className="flex flex-col gap-3 border-t border-line-soft pt-4">
          <div className="flex flex-wrap items-center gap-3">
            <span className="flex size-9 flex-none items-center justify-center rounded-control bg-neutral-bg">
              {totp.length > 0 ? (
                <ShieldCheck className="size-4 text-done-fg" />
              ) : (
                <ShieldOff className="size-4 text-ink-soft" />
              )}
            </span>
            <div className="flex min-w-0 flex-col">
              <span className="text-[12.5px] text-ink-muted">{t('Two-factor')}</span>
              <span className="text-[13.5px] text-ink-soft">
                {!emailUser
                  ? t('Sign in with email on this browser to turn it on or off.')
                  : totp.length > 0
                    ? t('On. Email sign-in asks for a code from your authenticator app.')
                    : t('Off. Add an authenticator app so a password alone cannot sign in.')}
              </span>
              {emailUser && (
                <span className="text-[12px] text-ink-faint">
                  {t('Signed in here as')} {emailUser.email}
                </span>
              )}
            </div>
            {emailUser && phase === 'idle' && (
              <div className="ms-auto">
                {totp.length > 0 ? (
                  <ConfirmDialog
                    title={t('Turn off two-factor?')}
                    body={t(
                      'Email sign-in will need only the password again. Your mobile number still signs you in either way.',
                    )}
                    confirmLabel={t('Turn off')}
                    successMessage={t('Two-factor is off')}
                    onConfirm={turnOff}
                    trigger={
                      <Button size="sm" variant="ghost" className="text-ink-muted">
                        {t('Turn off')}
                      </Button>
                    }
                  />
                ) : emailUser.emailVerified ? (
                  <Button size="sm" variant="secondary" disabled={busy} onClick={startEnrolment}>
                    {busy && <Loader2 className="animate-spin" />}
                    {t('Turn on two-factor')}
                  </Button>
                ) : null}
              </div>
            )}
          </div>

          {phase === 'enroll' && secret && emailUser && (
            <form
              onSubmit={handleEnrol}
              className="flex flex-col gap-4 rounded-card border border-line bg-raised p-4"
            >
              <ol className="flex list-decimal flex-col gap-1.5 ps-5 text-[13px] leading-relaxed text-ink-soft">
                <li>
                  {t(
                    'Open an authenticator app (Google Authenticator, Microsoft Authenticator, 1Password…).',
                  )}
                </li>
                <li>
                  {t(
                    'Add an account with this key, or open the link on the phone that has the app.',
                  )}
                </li>
                <li>{t('Enter the 6-digit code it shows.')}</li>
              </ol>
              <div className="flex flex-wrap items-center gap-2">
                <code className="select-all break-all rounded-btn border border-line bg-surface px-3 py-2 font-mono text-[14px] tracking-[0.08em]">
                  {groupKey(secret.secretKey)}
                </code>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => void copyKey(secret.secretKey)}
                >
                  <Copy className="size-3.5" /> {t('Copy')}
                </Button>
                {/* An `otpauth://` link: on a phone with an authenticator installed it opens
                    straight into "add account". No QR code — drawing one needs a library. */}
                <Button asChild size="sm" variant="link">
                  <a href={secret.generateQrCodeUrl(emailUser.email ?? undefined, 'BUILDR')}>
                    <ExternalLink className="size-3.5" /> {t('Open in authenticator app')}
                  </a>
                </Button>
              </div>
              <CodeField label={t('Code from the app')} value={code} onChange={setCode} />
              <div className="flex gap-2">
                <Button type="submit" size="sm" disabled={busy || code.length !== 6}>
                  {busy && <Loader2 className="animate-spin" />}
                  {t('Turn on')}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setSecret(null);
                    setPhase('idle');
                  }}
                >
                  {t('Cancel')}
                </Button>
              </div>
            </form>
          )}
        </div>
      )}

      {error && (
        <p
          role="alert"
          className="rounded-btn border border-blocked/30 bg-blocked-bg px-3.5 py-2.5 text-[13.5px] leading-relaxed text-blocked-fg"
        >
          {error}
        </p>
      )}
    </Card>
  );
}

function CodeField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <Field label={label} htmlFor="email-sign-in-code">
      <Input
        id="email-sign-in-code"
        inputMode="numeric"
        autoComplete="one-time-code"
        autoFocus
        maxLength={6}
        value={value}
        onChange={(event) => onChange(event.target.value.replace(/\D/g, '').slice(0, 6))}
        className="max-w-[180px] font-mono text-[17px] tracking-[0.3em]"
      />
    </Field>
  );
}

/** "JBSWY3DPEHPK3PXP" → "JBSW Y3DP EHPK 3PXP": easier to read across to a phone. */
function groupKey(key: string): string {
  return key.replace(/(.{4})(?=.)/g, '$1 ');
}
