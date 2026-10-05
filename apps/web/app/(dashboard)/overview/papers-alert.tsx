import Link from 'next/link';
import { IdCard } from 'lucide-react';
import { WORKER_DOCUMENT_LABELS } from '@sitebook/shared';
import type { WorkerDocument } from '@/lib/api-types';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { FadeIn } from '@/components/motion';
import { getT } from '@/lib/i18n-server';
import { getFormat } from '@/lib/format-server';

/**
 * Workers' papers lapsing within 30 days, or already lapsed.
 *
 * In the Gulf a worker on site with an expired residence visa or labour card is a fine for the
 * company, so this sits on the overview with the other things that need the owner today — and
 * only when there is something on it.
 */
export async function PapersAlert({ documents }: { documents: WorkerDocument[] }) {
  const t = await getT();
  const { shortDate } = await getFormat();
  if (documents.length === 0) return null;

  return (
    <FadeIn delay={0.06}>
      <Card className="flex flex-col gap-3 p-4">
        <span className="flex items-center gap-2 text-[12px] font-semibold uppercase tracking-[0.08em] text-ink-muted">
          <IdCard className="size-3.5 text-pending-fg" />
          {t('Papers about to lapse')} · {documents.length}
        </span>
        <ul className="flex flex-col divide-y divide-line-soft">
          {documents.slice(0, 5).map((document) => (
            <li
              key={document.id}
              className="flex flex-wrap items-center justify-between gap-2 py-2"
            >
              <Link
                href={`/labour/workers/${document.worker_id}`}
                className="text-[13.5px] font-medium hover:underline"
              >
                {document.worker_name} · {t(WORKER_DOCUMENT_LABELS[document.kind])}
              </Link>
              <Badge tone={document.standing === 'expired' ? 'blocked' : 'pending'}>
                {document.standing === 'expired' ? t('Expired') : t('Expires')}{' '}
                {document.expires_on ? shortDate(document.expires_on) : ''}
              </Badge>
            </li>
          ))}
        </ul>
      </Card>
    </FadeIn>
  );
}
