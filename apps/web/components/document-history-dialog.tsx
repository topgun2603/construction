'use client';

import { useState, type ReactNode } from 'react';
import { Download, FileClock, Loader2 } from 'lucide-react';
import { documentHistory } from '@/lib/actions';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { instantDate, timeOfDay } from '@/lib/format';
import type { SiteDocument } from '@/lib/api-types';
import { useLanguage } from '@/components/language-provider';

/**
 * Every revision of one document, with the day and the time each one landed.
 *
 * The list screen shows only the current revision, which is right — "the slab drawing" means the
 * one in force today. But a drawing that was superseded is the drawing the slab was actually poured
 * from, and when something is disputed a year later the question is always "what was current on the
 * day", which needs the full sequence and the clock, not just the dates.
 *
 * Loaded when the dialog opens rather than with the list: most documents have one revision and
 * almost nobody opens this, so fetching it per row would charge every page for the rare case.
 */
export function DocumentHistoryDialog({
  familyId,
  title,
  trigger,
}: {
  familyId: string;
  title: string;
  trigger: ReactNode;
}) {
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<SiteDocument[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load(nowOpen: boolean) {
    setOpen(nowOpen);
    if (!nowOpen || rows) return;
    setError(null);
    const result = await documentHistory(familyId);
    if (!result.ok) {
      setError(result.error ?? 'Could not load the history');
      return;
    }
    setRows(result.data ?? []);
  }

  return (
    <Dialog open={open} onOpenChange={(next) => void load(next)}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-w-[560px]">
        <DialogHeader>
          <DialogTitle>{t('Revisions of')} {title}</DialogTitle>
          <DialogDescription>
            {t('Newest first. Every revision keeps its own file — opening an old one shows exactly what was issued that day.')}
          </DialogDescription>
        </DialogHeader>

        {error && (
          <p role="alert" className="rounded-btn bg-blocked-bg px-3 py-2 text-[13px] text-blocked-fg">
            {error}
          </p>
        )}

        {!rows && !error && (
          <div className="flex items-center justify-center gap-2 py-8 text-[13.5px] text-ink-muted">
            <Loader2 className="size-4 animate-spin" /> {t('Reading the history…')}
          </div>
        )}

        {rows && (
          <ol className="flex flex-col">
            {rows.map((row, index) => (
              <li key={row.id} className="flex gap-3">
                {/* A spine down the left, so the sequence reads as a sequence rather than as rows
                    that happen to be sorted. */}
                <div className="flex flex-none flex-col items-center">
                  <span
                    className={
                      index === 0
                        ? 'mt-1.5 size-2.5 rounded-full bg-accent ring-4 ring-accent-soft'
                        : 'mt-1.5 size-2.5 rounded-full bg-line-strong'
                    }
                  />
                  {index < rows.length - 1 && <span className="w-px flex-1 bg-line" />}
                </div>

                <div className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-3 gap-y-1 pb-5">
                  <span className="text-[14px] font-semibold">rev {row.version}</span>
                  {index === 0 && <Badge tone="done">{t('Current')}</Badge>}

                  {/* The date and the clock. Two revisions on the same day is the normal shape of a
                      drawing being corrected, and a date alone cannot tell them apart. */}
                  <span className="font-mono text-[12.5px] text-ink-soft">
                    {instantDate(row.created_at)} · {timeOfDay(row.created_at)}
                  </span>

                  <span className="text-[12.5px] text-ink-muted">by {row.uploaded_by.name}</span>

                  {row.url && (
                    <a
                      href={row.url}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="ml-auto flex items-center gap-1.5 text-[12.5px] font-medium text-accent hover:underline"
                    >
                      <Download className="size-3.5" /> {t('Open')}
                    </a>
                  )}
                </div>
              </li>
            ))}
          </ol>
        )}

        {rows?.length === 0 && (
          <p className="flex items-center gap-2 py-6 text-[13.5px] text-ink-muted">
            <FileClock className="size-4" /> {t('Only one revision so far.')}
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}
