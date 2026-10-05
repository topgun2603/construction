'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { runChecks } from '@/lib/actions';
import { useLanguage } from '@/components/language-provider';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/** Runs the night's checks now — after entering a backlog of roll calls, say. */
export function RunChecksButton() {
  const { t } = useLanguage();
  const router = useRouter();
  const [pending, start] = useTransition();

  return (
    <Button
      variant="secondary"
      size="sm"
      disabled={pending}
      onClick={() =>
        start(async () => {
          const result = await runChecks();
          if (!result.ok) {
            toast.error(result.error ?? t('Could not run the checks'));
            return;
          }
          const added = result.data?.added ?? 0;
          toast.success(added === 0 ? t('Nothing new found') : `${added} ${t('new to look at')}`);
          router.refresh();
        })
      }
    >
      <RefreshCw className={cn('size-3.5', pending && 'animate-spin')} />
      {t('Run checks now')}
    </Button>
  );
}
