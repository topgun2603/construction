'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Loader2, ShieldAlert } from 'lucide-react';
import { useLanguage } from '@/components/language-provider';
import { readSsoFragment, takeSsoBinding } from '@/lib/sso-browser';

const API_URL = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:3000/v1';

/**
 * Where the API sends the browser after the identity provider: `#ticket=…` or `#error=…`.
 *
 * In the fragment, so it never reaches a server log or a Referer header. The ticket is swapped for
 * a token pair together with this tab's browser binding, then the pair goes straight into httpOnly
 * cookies exactly as the other sign-ins do. The fragment is wiped first so a reload or the back
 * button cannot replay it.
 */
export default function SsoCallbackPage() {
  const { t } = useLanguage();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  useEffect(() => {
    // Strict mode runs effects twice in development; a ticket is good for one swap.
    if (started.current) return;
    started.current = true;

    const { ticket, error: reason } = readSsoFragment(window.location.hash);
    window.history.replaceState(null, '', window.location.pathname);
    const binding = takeSsoBinding();

    if (reason) {
      setError(reason);
      return;
    }
    if (!ticket || !binding) {
      setError(t('This sign-in could not be finished in this browser tab. Start again from the sign-in page.'));
      return;
    }

    void (async () => {
      try {
        const response = await fetch(`${API_URL}/auth/sso/complete`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ticket, binding }),
        });
        const payload = (await response.json()) as { access_token?: string; message?: string };
        if (!response.ok || !payload.access_token) throw new Error(payload.message ?? 'Could not sign in');
        const stored = await fetch('/api/session', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        if (!stored.ok) throw new Error('Could not start the session');
        router.replace('/');
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'Something went wrong');
      }
    })();
  }, [router, t]);

  return (
    <main className="flex min-h-screen items-center justify-center bg-canvas px-4 py-10">
      <div className="w-full max-w-[440px] rounded-[18px] border border-line bg-surface p-7 sm:p-9">
        {error ? (
          <div className="flex flex-col gap-5">
            <span className="flex size-11 items-center justify-center rounded-card bg-blocked-bg text-blocked-fg">
              <ShieldAlert className="size-5" />
            </span>
            <h1 className="text-[24px] font-bold leading-tight">{t('Single sign-on did not finish')}</h1>
            <p role="alert" className="text-[14px] leading-relaxed text-ink-soft">
              {error}
            </p>
            <Link
              href="/login"
              className="flex items-center gap-1.5 self-start text-[13.5px] font-medium text-accent underline-offset-4 hover:underline"
            >
              <ArrowLeft className="size-3.5" /> {t('Back to sign-in')}
            </Link>
          </div>
        ) : (
          <p className="flex items-center gap-2 text-[14px] text-ink-muted">
            <Loader2 className="size-4 animate-spin" /> {t('Signing you in…')}
          </p>
        )}
      </div>
    </main>
  );
}
