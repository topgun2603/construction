'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { Loader2, LogOut, Undo2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { useLanguage } from '@/components/language-provider';
import { signOut } from '@/lib/actions';
import { cancelCompanyDeletion } from '@/lib/data-portability-actions';

/** Cancel the deletion (owner), or sign out. */
export function CancelDeletion({ canCancel }: { canCancel: boolean }) {
  const { t } = useLanguage();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function cancel() {
    setError(null);
    start(async () => {
      const result = await cancelCompanyDeletion();
      if (!result.ok) {
        setError(result.error ?? t('That did not work. Try again.'));
        return;
      }
      toast.success(t('Deletion cancelled. Your company is back.'));
      router.replace('/');
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-4">
      {error && (
        <p role="alert" className="rounded-btn bg-blocked-bg px-3 py-2 text-[13px] leading-snug text-blocked-fg">
          {error}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-3">
        {canCancel && (
          <Button onClick={cancel} disabled={pending} className="gap-2">
            {pending ? <Loader2 className="size-4 animate-spin" /> : <Undo2 className="size-4" />}
            {t('Cancel the deletion')}
          </Button>
        )}
        <form action={signOut}>
          <Button type="submit" variant="ghost" size="sm" className="gap-2 text-ink-muted">
            <LogOut className="size-4" />
            {t('Sign out')}
          </Button>
        </form>
      </div>
    </div>
  );
}
