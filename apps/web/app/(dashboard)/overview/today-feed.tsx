import Link from 'next/link';
import { FileText } from 'lucide-react';
import type { DashboardToday } from '@/lib/api-types';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { timeOfDay } from '@/lib/format';
import { cn } from '@/lib/utils';
import { getT } from '@/lib/i18n-server';

/**
 * What came in from the sites today.
 *
 * It used to live at the bottom of the page and only appear when there was something in it, which
 * meant the one screen that is supposed to answer "what happened today" answered it below three
 * other sections, or not at all. It holds its place now — an empty feed at four in the afternoon
 * is itself the news.
 */
export async function TodayFeed({
  reports,
  className,
}: {
  reports: DashboardToday['reports'];
  className?: string;
}) {
  const t = await getT();
  return (
    <Card className={cn('flex flex-col', className)}>
      <div className="flex flex-none items-center justify-between gap-3 border-b border-line-soft px-4 py-3">
        <span className="text-[12px] font-semibold uppercase tracking-[0.08em] text-ink-muted">
          {t('Today’s reports')}
        </span>
        <span className="font-mono text-[13px] text-ink-muted">{reports.length}</span>
      </div>

      {reports.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 px-4 py-10 text-center">
          <span className="flex size-9 items-center justify-center rounded-full bg-neutral-bg text-ink-faint">
            <FileText className="size-4" />
          </span>
          <p className="text-[13.5px] text-ink-muted">
            {t('Nothing filed yet today. Reports land here as the sites send them.')}
          </p>
        </div>
      ) : (
        <ul className="divide-y divide-line-soft overflow-y-auto">
            {reports.map((report) => (
              <li key={report.id} className="flex flex-wrap items-start gap-3 px-4 py-3">
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link
                      href={`/projects/${report.project_id}?tab=reports`}
                      className="text-[14px] font-semibold hover:underline"
                    >
                      {report.project_name}
                    </Link>
                    <span className="text-[12.5px] text-ink-muted">
                      {report.submitted_by} · {timeOfDay(report.submitted_at)}
                    </span>
                  </div>
                  {report.work_done && (
                    <p className="line-clamp-2 text-[13.5px] leading-relaxed text-ink-soft">
                      {report.work_done}
                    </p>
                  )}
                  {report.issues && (
                    <p className="rounded-btn bg-blocked-bg px-2.5 py-1.5 text-[12.5px] leading-snug text-blocked-fg">
                      {report.issues}
                    </p>
                  )}
                </div>
                <div className="flex flex-none items-center gap-2">
                  <span className="font-mono text-[13px] text-ink-muted">
                    {report.headcount} on site
                  </span>
                  {report.photo_count > 0 && (
                    <span className="font-mono text-[13px] text-ink-faint">
                      {report.photo_count} photos
                    </span>
                  )}
                  <Badge tone={report.status === 'submitted' ? 'done' : 'pending'}>
                    {report.status === 'submitted' ? t('Submitted') : t('Draft')}
                  </Badge>
                </div>
              </li>
            ))}
        </ul>
      )}
    </Card>
  );
}
