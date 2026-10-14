'use client';

import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { Loader2, Send } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { useLanguage } from '@/components/language-provider';
import { emailChangeOrder } from '@/lib/m365-actions';

/**
 * "Email the client": the change order is already in their approvals once it was sent; this tells
 * them so by email from the company's Microsoft 365 mailbox, with the link to where they decide.
 * Only drawn while it waits on the client and a mailbox is connected.
 */
export function EmailClientButton({ id }: { id: string }) {
  const { t } = useLanguage();
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button
      size="sm"
      variant="secondary"
      disabled={pending}
      className="gap-2"
      onClick={() =>
        start(async () => {
          const result = await emailChangeOrder(id);
          if (!result.ok || !result.data) {
            toast.error(result.error ?? t('The email was not sent'));
            return;
          }
          toast.success(`${t('Emailed to')} ${result.data.delivery.to.join(', ')}`);
          router.refresh();
        })
      }
    >
      {pending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
      {t('Email the client')}
    </Button>
  );
}
