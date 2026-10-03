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
import { GoogleMark } from '@/components/ui/google-mark';

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

