'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { GoogleAuthProvider, signInWithPopup } from 'firebase/auth';
import { Loader2, Unlink } from 'lucide-react';
import { toast } from 'sonner';
import { firebaseAuth, isFirebaseConfigured } from '@/lib/firebase';
import { linkGoogle, unlinkGoogle } from '@/lib/actions';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { useLanguage } from '@/components/language-provider';

const DEV_AUTH_BYPASS =
  process.env.NODE_ENV !== 'production' && process.env['NEXT_PUBLIC_DEV_AUTH_BYPASS'] === 'true';

/**
 * Linking a Google account to this user, so it can be used to sign in.
 *
 * The address is never typed. The popup returns a token, the token goes to the API, and the API
 * reads the address out of it — which means the only account anybody can attach is one they can
 * already sign in to. Typing it would let somebody claim a colleague's address and quietly receive
 * their sign-ins.
 */
export function GoogleLink({ email }: { email: string | null }) {
  const { t } = useLanguage();
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function link() {
    setBusy(true);
    try {
      let token: string;
      if (DEV_AUTH_BYPASS || !isFirebaseConfigured()) {
        // Development has no popup to open. Compiled out of a production bundle.
        const typed = window.prompt('Dev link — Google address to link to this account');
        if (!typed) return;
        token = `dev:${typed.trim()}`;
      } else {
        const credential = await signInWithPopup(firebaseAuth(), new GoogleAuthProvider());
        token = await credential.user.getIdToken();
      }

      const result = await linkGoogle(token);
      if (!result.ok) {
        toast.error(result.error ?? 'Could not link that account');
        return;
      }
      toast.success(result.data ? `Linked ${result.data.email}` : 'Google account linked');
      router.refresh();
    } catch (cause) {
      // A closed popup is somebody changing their mind, not a failure to report.
      const code = (cause as { code?: string } | null)?.code;
      if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') return;
      toast.error(cause instanceof Error ? cause.message : 'Could not link that account');
    } finally {
      setBusy(false);
    }
  }

  if (!email) {
    return (
      <Button size="sm" variant="secondary" disabled={busy} onClick={() => void link()}>
        {busy ? <Loader2 className="size-4 animate-spin" /> : <GoogleMark />}
        {t('Link a Google account')}
      </Button>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="flex items-center gap-2 rounded-btn border border-line bg-raised px-3 py-1.5 text-[13.5px]">
        <GoogleMark />
        <span className="font-medium">{email}</span>
      </span>
      <ConfirmDialog
        title={t('Unlink this Google account?')}
        body={
          <>
            {t('Signing in with')} {email} will stop working. Your mobile number still signs you in, so
            you will not be locked out.
          </>
        }
        confirmLabel={t('Unlink')}
        successMessage="Unlinked"
        onConfirm={() => unlinkGoogle()}
        trigger={
          <Button size="sm" variant="ghost" className="text-ink-muted">
            <Unlink className="size-3.5" /> {t('Unlink')}
          </Button>
        }
      />
    </div>
  );
}

function GoogleMark() {
  return (
    <svg viewBox="0 0 48 48" aria-hidden className="size-4">
      <path
        fill="#EA4335"
        d="M24 9.5c3.5 0 6.6 1.2 9 3.6l6.7-6.7C35.6 2.6 30.2.5 24 .5 14.6.5 6.5 5.9 2.6 13.7l7.8 6.1C12.3 14 17.6 9.5 24 9.5z"
      />
      <path
        fill="#4285F4"
        d="M46.5 24.5c0-1.6-.15-3.2-.43-4.7H24v9h12.7c-.55 2.9-2.2 5.4-4.7 7.1l7.6 5.9c4.4-4.1 6.9-10.2 6.9-17.3z"
      />
      <path
        fill="#FBBC05"
        d="M10.4 28.2a14.6 14.6 0 0 1 0-8.4l-7.8-6.1a23.6 23.6 0 0 0 0 20.6l7.8-6.1z"
      />
      <path
        fill="#34A853"
        d="M24 47.5c6.2 0 11.5-2 15.3-5.6l-7.6-5.9c-2.1 1.4-4.8 2.3-7.7 2.3-6.4 0-11.7-4.5-13.6-10.4l-7.8 6.1C6.5 42.1 14.6 47.5 24 47.5z"
      />
    </svg>
  );
}
