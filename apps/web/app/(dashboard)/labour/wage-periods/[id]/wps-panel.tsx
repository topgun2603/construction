'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { Download, FileSpreadsheet } from 'lucide-react';
import { toast } from 'sonner';
import { wpsFile } from '@/lib/actions';
import type { WpsFile } from '@/lib/api-types';
import { useLanguage } from '@/components/language-provider';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';

/**
 * The UAE WPS salary file (SIF) for this period (roadmap Phase 1, item 1).
 *
 * Asked for on a click rather than on page load: building it reads every worker's bank details,
 * and most visits to a wage period are not to pay it. What comes back says what still stands in
 * the way — company ids not set, a period still open — and which workers are left out for want of
 * their own details, each linked to where they can be filled in.
 */
export function WpsPanel({ periodId }: { periodId: string }) {
  const { t } = useLanguage();
  const [file, setFile] = useState<WpsFile | null>(null);
  const [pending, start] = useTransition();

  function prepare() {
    start(async () => {
      const result = await wpsFile(periodId);
      if (!result.ok || !result.data) {
        toast.error(result.error ?? t('Could not prepare the salary file'));
        return;
      }
      setFile(result.data);
    });
  }

  function download() {
    if (!file?.content || !file.file_name) return;
    const url = URL.createObjectURL(new Blob([file.content], { type: 'text/plain' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = file.file_name;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  return (
    <Card className="flex flex-col gap-3 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <span className="flex items-center gap-2 text-[12px] font-semibold uppercase tracking-[0.08em] text-ink-muted">
            <FileSpreadsheet className="size-3.5" />
            {t('WPS salary file')}
          </span>
          <span className="text-[13px] text-ink-muted">
            {t('The file your bank or exchange house needs to pay this period through WPS.')}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="secondary" size="sm" onClick={prepare} disabled={pending}>
            {pending ? t('Preparing…') : file ? t('Check again') : t('Prepare file')}
          </Button>
          {file?.content && (
            <Button size="sm" onClick={download}>
              <Download className="size-3.5" /> {t('Download')}
            </Button>
          )}
        </div>
      </div>

      {file && file.problems.length > 0 && (
        <ul
          role="alert"
          className="flex list-disc flex-col gap-1 rounded-btn bg-blocked-bg py-2 pl-7 pr-3 text-[13px] text-blocked-fg"
        >
          {file.problems.map((problem) => (
            <li key={problem}>{t(problem)}</li>
          ))}
        </ul>
      )}

      {file?.content && (
        <p className="text-[13px] text-ink-muted">
          {file.included === 1
            ? t('1 worker in the file')
            : `${file.included} ${t('workers in the file')}`}{' '}
          · <span className="font-mono">{file.file_name}</span>
        </p>
      )}

      {file && file.missing.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <span className="text-[13px] font-medium text-pending-fg">
            {t('Left out until their WPS details are added:')}
          </span>
          <ul className="flex flex-col divide-y divide-line-soft text-[13px]">
            {file.missing.map((row) => (
              <li
                key={row.worker_id}
                className="flex flex-wrap items-center justify-between gap-2 py-1.5"
              >
                <Link
                  href={`/labour/workers/${row.worker_id}`}
                  className="font-medium hover:underline"
                >
                  {row.worker_name}
                </Link>
                <span className="text-ink-muted">
                  {t('Needs')} {row.missing.map((item) => t(item)).join(', ')}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}
