import { redirect } from 'next/navigation';
import { ShieldCheck } from 'lucide-react';
import { serverFetch } from '@/lib/server-api';
import { currentAccessToken } from '@/lib/session';
import { getT } from '@/lib/i18n-server';
import type { MfaStatus } from '@/lib/security-types';
import { TwoFactorStep } from './two-factor-step';

export const metadata = { title: 'Two-factor · BUILDR' };

/**
 * The step between signing in and the dashboard, when the company requires a second factor and
 * this session has not shown one. Every page that meets `MFA_REQUIRED` from the API sends people
 * here (`loadSelf`, `serverFetch`); this page asks only `/auth/mfa`, which answers either way.
 *
 * Somebody with an authenticator types its code (or a recovery code); somebody without one sets one
 * up here and then carries on — the first code they type proves both.
 */
export default async function TwoFactorPage() {
  if (!(await currentAccessToken())) redirect('/login');
  const t = await getT();
  const status = await serverFetch<MfaStatus>('/auth/mfa');
  // Nothing owed: straight on. `/` sends each person to their own home page.
  if (status.session_verified || !status.required) redirect('/');

  return (
    <main className="flex min-h-screen items-center justify-center bg-canvas px-4 py-10">
      <div className="flex w-full max-w-[560px] flex-col gap-6 rounded-sheet border border-line bg-surface p-6 shadow-panel sm:p-8">
        <div className="flex flex-col gap-2">
          <span className="flex size-11 items-center justify-center rounded-control bg-accent-soft">
            <ShieldCheck className="size-5 text-accent" />
          </span>
          <h1 className="text-h1">{t('Two-factor authentication')}</h1>
          <span className="text-[13.5px] font-medium text-ink-soft">{status.company_name}</span>
          <p className="text-[14px] leading-relaxed text-ink-muted">
            {status.enrolled
              ? t('Your company asks for a code from your authenticator app as well as your sign-in.')
              : t('Your company requires two-factor authentication. Set up an authenticator app to continue — it takes a minute.')}
          </p>
        </div>
        <TwoFactorStep status={status} />
      </div>
    </main>
  );
}
