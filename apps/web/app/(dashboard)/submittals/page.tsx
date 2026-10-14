import Link from 'next/link';
import { FileStack } from 'lucide-react';
import { SUBMITTAL_STATUSES, SUBMITTAL_STATUS_LABELS, SUBMITTAL_TYPES, SUBMITTAL_TYPE_LABELS } from '@sitebook/shared';
import { serverFetch } from '@/lib/server-api';
import { requireSelf } from '@/lib/session';
import { getT } from '@/lib/i18n-server';
import type { Page, ProjectSummary } from '@/lib/api-types';
import { submittalFormData } from '@/lib/rfi-form-data';
import type { SubmittalStats, SubmittalSummary } from '@/lib/rfi-types';
import { FadeIn } from '@/components/motion';
import { ExportMenu } from '@/components/export-menu';
import { StatTile } from '@/components/stat-tile';
import { EmptyState } from '@/components/ui/empty-state';
import { cn } from '@/lib/utils';
import { SubmittalDialog } from './submittal-dialog';
import { SubmittalsTable } from './submittals-table';

export const metadata = { title: 'Submittals · BUILDR' };

const FILTER_KEYS = ['project_id', 'status', 'type', 'overdue', 'party'] as const;

/**
 * The submittal log across every site the caller can see (roadmap Phase 2, module 9): what is with
 * the reviewers, what is late, what came back to be revised, and how long reviews take.
 */
export default async function SubmittalsPage({
  searchParams,
}: {
  searchParams: Promise<Partial<Record<(typeof FILTER_KEYS)[number], string>>>;
}) {
  const t = await getT();
  const me = await requireSelf();
  const params = await searchParams;
  const query = new URLSearchParams();
  for (const key of FILTER_KEYS) if (params[key]) query.set(key, params[key]!);
  const canManage = me.permissions.includes('submittals.manage');

  const [log, sites, form] = await Promise.all([
    serverFetch<{ items: SubmittalSummary[]; stats: SubmittalStats }>(`/submittals?${query.toString()}`),
    serverFetch<Page<ProjectSummary>>('/projects?limit=200'),
    canManage ? submittalFormData(me.permissions) : Promise.resolve(null),
  ]);
  const liveSites = sites.items.filter((site) => site.status !== 'completed').map((site) => ({ id: site.id, name: site.name }));
  const { stats } = log;
  const selectClass = 'h-9 rounded-btn border border-line-strong bg-surface px-2 text-[13.5px]';

  return (
    <FadeIn className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h2 className="text-[21px] font-semibold leading-tight">{t('Submittals')}</h2>
          <p className="text-[13.5px] text-ink-muted">
            {t('Documents sent to the consultant or the client for approval, with every revision.')}{' '}
            <Link href="/rfis" className="text-accent hover:underline">
              {t('RFIs')}
            </Link>
          </p>
        </div>
        {form && liveSites.length > 0 && (
          <SubmittalDialog sites={liveSites} documents={form.documents} parties={form.parties} />
        )}
      </div>

      <div className="grid gap-3.5 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile label={t('With reviewers')} value={String(stats.in_review)} animate />
        <StatTile
          label={t('Overdue')}
          value={String(stats.overdue)}
          animate
          noteTone={stats.overdue > 0 ? 'blocked' : 'done'}
          note={stats.overdue > 0 ? t('Past their review date') : t('None overdue')}
          href="/submittals?overdue=true"
          hrefLabel={t('Overdue')}
        />
        <StatTile
          label={t('Returned to revise')}
          value={String(stats.returned)}
          animate
          noteTone={stats.returned > 0 ? 'pending' : 'neutral'}
          note={`${stats.approved} ${t('approved')}`}
        />
        <StatTile
          label={t('Average days to review')}
          value={stats.avg_review_days === null ? '—' : String(stats.avg_review_days)}
          note={`${stats.total} ${t('in all')}`}
        />
      </div>

      <form className="flex flex-wrap items-end gap-2" action="/submittals">
        <select name="project_id" defaultValue={params.project_id ?? ''} className={selectClass} aria-label={t('Site')}>
          <option value="">{t('All sites')}</option>
          {sites.items.map((site) => (
            <option key={site.id} value={site.id}>
              {site.name}
            </option>
          ))}
        </select>
        <select name="status" defaultValue={params.status ?? ''} className={selectClass} aria-label={t('Status')}>
          <option value="">{t('Any status')}</option>
          {SUBMITTAL_STATUSES.map((status) => (
            <option key={status} value={status}>
              {t(SUBMITTAL_STATUS_LABELS[status])}
            </option>
          ))}
        </select>
        <select name="type" defaultValue={params.type ?? ''} className={selectClass} aria-label={t('Type')}>
          <option value="">{t('Any type')}</option>
          {SUBMITTAL_TYPES.map((type) => (
            <option key={type} value={type}>
              {t(SUBMITTAL_TYPE_LABELS[type])}
            </option>
          ))}
        </select>
        <input
          name="party"
          defaultValue={params.party ?? ''}
          placeholder={t('Reviewer, subcontractor or supplier')}
          className={cn(selectClass, 'w-56 px-3')}
          aria-label={t('Reviewer, subcontractor or supplier')}
        />
        <label className="flex h-9 items-center gap-1.5 text-[13px]">
          <input type="checkbox" name="overdue" value="true" defaultChecked={params.overdue === 'true'} />
          {t('Overdue only')}
        </label>
        <button type="submit" className="h-9 rounded-btn border border-line-strong px-3 text-[13px] font-medium hover:bg-raised">
          {t('Filter')}
        </button>
        <div className="ms-auto">
          <ExportMenu
            kind="submittals"
            filters={Object.fromEntries(query)}
            csvHref={`/rfis/export?kind=submittals&${query.toString()}`}
          />
        </div>
      </form>

      {liveSites.length === 0 && log.items.length === 0 ? (
        <EmptyState icon={<FileStack />} title={t('No sites yet')} body={t('Submittals belong to a site. Add a site first.')} />
      ) : (
        <SubmittalsTable items={log.items} />
      )}
    </FadeIn>
  );
}
