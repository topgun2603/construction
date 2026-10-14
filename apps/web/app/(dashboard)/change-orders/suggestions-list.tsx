'use client';

import { useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Lightbulb, Loader2, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { useFormat } from '@/components/format-provider';
import { useLanguage } from '@/components/language-provider';
import { dismissChangeOrderSuggestion } from '@/lib/change-order-actions';
import type { ChangeOrderSuggestion } from '@/lib/change-order-types';
import { ChangeOrderDialog } from './change-order-dialog';

/**
 * The scope-creep catcher's finds: sentences in daily reports and site messages that read like
 * extra work nobody has priced. Each is one click from a draft change order — or dismissed, and
 * never suggested again.
 */
export function SuggestionsList({
  suggestions,
  showSite = true,
}: {
  suggestions: ChangeOrderSuggestion[];
  showSite?: boolean;
}) {
  const { t } = useLanguage();
  if (suggestions.length === 0) return null;

  return (
    <Card className="flex flex-col gap-1 p-4">
      <div className="flex items-center gap-2">
        <Lightbulb className="size-4 text-pending-fg" />
        <span className="text-[12px] font-semibold uppercase tracking-[0.08em] text-ink-muted">
          {t('Looks like extra work')}
        </span>
      </div>
      <p className="text-[12.5px] text-ink-muted">
        {t('Picked up from daily reports and site messages. Raise a change order before the work is done and forgotten.')}
      </p>
      <ul className="mt-2 flex flex-col divide-y divide-line-soft">
        {suggestions.map((suggestion) => (
          <SuggestionRow key={suggestion.id} suggestion={suggestion} showSite={showSite} />
        ))}
      </ul>
    </Card>
  );
}

function SuggestionRow({ suggestion, showSite }: { suggestion: ChangeOrderSuggestion; showSite: boolean }) {
  const { t } = useLanguage();
  const { shortDate, instantDate } = useFormat();
  const router = useRouter();
  const [pending, start] = useTransition();
  const fromReport = suggestion.source_kind === 'daily_report';
  const when = suggestion.source_date
    ? fromReport
      ? shortDate(suggestion.source_date)
      : instantDate(suggestion.source_date)
    : '';

  function dismiss() {
    start(async () => {
      const result = await dismissChangeOrderSuggestion(suggestion.id, suggestion.project.id);
      if (!result.ok) {
        toast.error(result.error ?? t('Could not dismiss that'));
        return;
      }
      router.refresh();
    });
  }

  return (
    <li className="flex flex-wrap items-start justify-between gap-3 py-3">
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <p className="text-[14px] leading-relaxed">“{suggestion.excerpt}”</p>
        {suggestion.summary && <p className="text-[12.5px] text-ink-soft">{suggestion.summary}</p>}
        <span className="text-[12px] text-ink-muted" suppressHydrationWarning>
          {fromReport ? t('Daily report') : t('Site message')}
          {when && ` · ${when}`}
          {suggestion.source_author && ` · ${suggestion.source_author}`}
          {showSite && (
            <>
              {' · '}
              <Link href={`/projects/${suggestion.project.id}?tab=${fromReport ? 'reports' : 'conversation'}`} className="hover:underline">
                {suggestion.project.name}
              </Link>
            </>
          )}
        </span>
      </div>
      <div className="flex flex-none items-center gap-2">
        {pending && <Loader2 className="size-4 animate-spin text-ink-faint" />}
        <Button size="sm" variant="ghost" onClick={dismiss} disabled={pending} aria-label={t('Not extra work')}>
          <X className="size-4" />
          {t('Dismiss')}
        </Button>
        <ChangeOrderDialog
          sites={[suggestion.project]}
          suggestion={{
            id: suggestion.id,
            projectId: suggestion.project.id,
            title: (suggestion.summary ?? suggestion.excerpt).slice(0, 160),
            description: suggestion.excerpt,
          }}
          trigger={<Button size="sm">{t('Raise change order')}</Button>}
        />
      </div>
    </li>
  );
}
