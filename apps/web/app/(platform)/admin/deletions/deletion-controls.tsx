'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { Loader2, Trash2, Undo2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useLanguage } from '@/components/language-provider';
import { cancelCompanyDeletionFromConsole, expediteCompanyDeletion } from '@/lib/platform-actions';

/**
 * Cancel, or delete now. "Delete now" asks for the company's name typed back, like the console's
 * immediate delete: it is the moment the data stops existing.
 */
export function DeletionControls({ tenantId, tenantName }: { tenantId: string; tenantName: string }) {
  const { t } = useLanguage();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [confirming, setConfirming] = useState(false);
  const [confirmName, setConfirmName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const armed = confirmName.trim() === tenantName.trim();

  function cancel() {
    setError(null);
    start(async () => {
      const result = await cancelCompanyDeletionFromConsole(tenantId);
      if (!result.ok) {
        setError(result.error ?? t('That did not work. Try again.'));
        return;
      }
      toast.success(`${tenantName} ${t('restored')}`);
      router.refresh();
    });
  }

  function expedite() {
    setError(null);
    start(async () => {
      const result = await expediteCompanyDeletion({ tenantId, confirmName: confirmName.trim() });
      if (!result.ok) {
        setError(result.error ?? t('That did not work. Try again.'));
        return;
      }
      toast.success(`${tenantName} ${t('deleted')}`);
      router.refresh();
    });
  }

  return (
    <div className="ms-auto flex flex-wrap items-center gap-2">
      {confirming ? (
        <>
          <Input
            aria-label={t('Type the company name to confirm')}
            value={confirmName}
            onChange={(event) => setConfirmName(event.target.value)}
            placeholder={tenantName}
            autoComplete="off"
            className="h-9 w-[220px]"
          />
          <Button size="sm" variant="destructive" disabled={!armed || pending} onClick={expedite} className="gap-2">
            {pending ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
            {t('Delete permanently')}
          </Button>
          <Button size="sm" variant="ghost" disabled={pending} onClick={() => setConfirming(false)}>
            {t('Back')}
          </Button>
        </>
      ) : (
        <>
          <Button size="sm" variant="secondary" disabled={pending} onClick={cancel} className="gap-2">
            {pending ? <Loader2 className="size-4 animate-spin" /> : <Undo2 className="size-4" />}
            {t('Cancel deletion')}
          </Button>
          <Button size="sm" variant="ghost" className="gap-2 text-blocked-fg" onClick={() => setConfirming(true)}>
            <Trash2 className="size-4" />
            {t('Delete now')}
          </Button>
        </>
      )}
      {error && (
        <p role="alert" className="w-full text-[12.5px] text-blocked-fg">
          {error}
        </p>
      )}
    </div>
  );
}
