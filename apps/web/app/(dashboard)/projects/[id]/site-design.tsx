'use client';

import { Button } from '@/components/ui/button';
import { useLanguage } from '@/components/language-provider';
import type { SiteDocument } from '@/lib/api-types';
import type { RfiStats, RfiSummary, SubmittalStats, SubmittalSummary } from '@/lib/rfi-types';
import { RfiDialog } from '../../rfis/rfi-dialog';
import { RfisTable } from '../../rfis/rfis-table';
import { SubmittalDialog } from '../../submittals/submittal-dialog';
import { SubmittalsTable } from '../../submittals/submittals-table';

/**
 * A site's Design tab (roadmap Phase 2, module 9): its RFIs and its submittals together, because
 * both are the conversation with the design team and one tab keeps the site's tab bar from growing.
 */
export function SiteDesign({
  site,
  rfis,
  submittals,
  documents,
  parties,
  aiEnabled,
  canRaiseRfi,
  canSubmit,
}: {
  site: { id: string; name: string };
  rfis: { items: RfiSummary[]; stats: RfiStats } | null;
  submittals: { items: SubmittalSummary[]; stats: SubmittalStats } | null;
  documents: SiteDocument[];
  parties: { contractors: Array<{ id: string; name: string }>; vendors: Array<{ id: string; name: string }> };
  aiEnabled: boolean;
  canRaiseRfi: boolean;
  canSubmit: boolean;
}) {
  const { t } = useLanguage();
  return (
    <div className="flex flex-col gap-6">
      {rfis && (
        <section className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-col gap-0.5">
              <span className="text-[12px] font-semibold uppercase tracking-[0.08em] text-ink-muted">{t('RFIs')}</span>
              <span className="text-[13px] text-ink-muted">
                {rfis.stats.open} {t('open')} · {rfis.stats.overdue} {t('overdue')} ·{' '}
                {rfis.stats.avg_response_days === null
                  ? t('no answers yet')
                  : `${rfis.stats.avg_response_days} ${t('days to answer on average')}`}
              </span>
            </div>
            <div className="flex items-center gap-2">
              {rfis.items.length > 0 && (
                <Button asChild variant="secondary" size="sm">
                  <a href={`/rfis/export?kind=rfis&project_id=${site.id}`} download>
                    {t('Export CSV')}
                  </a>
                </Button>
              )}
              {canRaiseRfi && (
                <RfiDialog sites={[site]} fixedSiteId={site.id} documents={documents} aiEnabled={aiEnabled} />
              )}
            </div>
          </div>
          <RfisTable items={rfis.items} showSite={false} />
        </section>
      )}
      {submittals && (
        <section className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-col gap-0.5">
              <span className="text-[12px] font-semibold uppercase tracking-[0.08em] text-ink-muted">
                {t('Submittals')}
              </span>
              <span className="text-[13px] text-ink-muted">
                {submittals.stats.in_review} {t('with reviewers')} · {submittals.stats.overdue} {t('overdue')} ·{' '}
                {submittals.stats.returned} {t('to revise')}
              </span>
            </div>
            <div className="flex items-center gap-2">
              {submittals.items.length > 0 && (
                <Button asChild variant="secondary" size="sm">
                  <a href={`/rfis/export?kind=submittals&project_id=${site.id}`} download>
                    {t('Export CSV')}
                  </a>
                </Button>
              )}
              {canSubmit && (
                <SubmittalDialog sites={[site]} fixedSiteId={site.id} documents={documents} parties={parties} />
              )}
            </div>
          </div>
          <SubmittalsTable items={submittals.items} showSite={false} />
        </section>
      )}
    </div>
  );
}
