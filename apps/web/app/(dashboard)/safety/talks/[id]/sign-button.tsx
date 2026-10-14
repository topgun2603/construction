'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { PenLine } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { useLanguage } from '@/components/language-provider';
import { signToolboxTalk } from '@/lib/safety-actions';

/** An attendee who has not signed yet signs now, on the supervisor's phone. */
export function SignButton({ talkId, workerId }: { talkId: string; workerId: string }) {
  const { t } = useLanguage();
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button
      size="sm"
      variant="secondary"
      disabled={pending}
      onClick={() =>
        start(async () => {
          const result = await signToolboxTalk(talkId, workerId);
          if (!result.ok) return void toast.error(result.error ?? t('Could not record the signature'));
          router.refresh();
        })
      }
    >
      <PenLine className="size-4" /> {t('Sign')}
    </Button>
  );
}
