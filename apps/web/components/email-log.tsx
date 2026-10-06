'use client';

import { Mail } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { useFormat } from '@/components/format-provider';
import { useLanguage } from '@/components/language-provider';
import type { M365Delivery } from '@/lib/m365-types';

/**
 * "Emailed to … from … on …" under a record that was sent through the company's Microsoft 365
 * mailbox — so whoever chases the designer next can see it went, and to which address. Renders
 * nothing when nothing was emailed.
 */
export function EmailLog({ deliveries }: { deliveries: M365Delivery[] }) {
  const { t } = useLanguage();
  const { instantDate, timeOfDay } = useFormat();
  if (deliveries.length === 0) return null;
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[12.5px] font-semibold text-ink-muted">{t('Emails sent')}</span>
      <ul className="flex flex-col gap-1.5">
        {deliveries.map((delivery) => (
          <li key={delivery.id} className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[12.5px]">
            <Mail className="size-3.5 text-ink-faint" aria-hidden />
            <span dir="ltr">{delivery.to.join(', ')}</span>
            <span className="text-ink-faint">
              {instantDate(delivery.created_at)}, {timeOfDay(delivery.created_at)}
            </span>
            {delivery.status === 'failed' && (
              <Badge tone="blocked" title={delivery.error ?? undefined}>
                {t('Failed')}
              </Badge>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
