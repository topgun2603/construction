import Link from 'next/link';
import { HelpCircle } from 'lucide-react';
import { RFI_DISCIPLINES, RFI_DISCIPLINE_LABELS, RFI_STATUSES, RFI_STATUS_LABELS } from '@sitebook/shared';
import { serverFetch } from '@/lib/server-api';
import { requireSelf } from '@/lib/session';
import { getT } from '@/lib/i18n-server';
import type { Page, ProjectSummary, SiteDocument } from '@/lib/api-types';
import { rfiDocuments } from '@/lib/rfi-form-data';
import type { RfiSettings, RfiStats, RfiSummary } from '@/lib/rfi-types';
import { FadeIn } from '@/components/motion';
import { ExportMenu } from '@/components/export-menu';
import { StatTile } from '@/components/stat-tile';
import { EmptyState } from '@/components/ui/empty-state';
import { cn } from '@/lib/utils';
import { RfiDialog } from './rfi-dialog';
import { RfisTable } from './rfis-table';
import { RfiSettingsDialog } from './settings-dialog';

export const metadata = { title: 'RFIs · BUILDR' };

const FILTER_KEYS = ['project_id', 'status', 'discipline', 'overdue', 'party'] as const;

/**
 * The RFI log across every site the caller can see (roadmap Phase 2, module 9): what is waiting on
 * the designers, what is late, and how long they take to answer.
 */
export default async function RfisPage({
  searchParams,
}: {
  searchParams: Promise<Partial<Record<(typeof FILTER_KEYS)[number], string>>>;
}) {
  const t = await getT();
  const me = await requireSelf();
  const params = await searchParams;
  const query = new URLSearchParams();
  for (const key of FILTER_KEYS) if (params[key]) query.set(key, params[key]!);

  const canManage = me.permissions.includes('rfis.manage');
  const [log, settings, sites, documents] = await Promise.all([
    serverFetch<{ items: RfiSummary[]; stats: RfiStats }>(`/rfis?${query.toString()}`),
    serverFetch<RfiSettings>('/rfis/settings'),
    serverFetch<Page<ProjectSummary>>('/projects?limit=200'),
    canManage ? rfiDocuments(me.permissions) : Promise.resolve([] as SiteDocument[]),
  ]);
  const liveSites = sites.items.filter((site) => site.status !== 'completed').map((site) => ({ id: site.id, name: site.name }));
  const { stats } = log;
  const chip = (overrides: Record<string, string | undefined>) => {
    const next = new URLSearchParams(query);
    for (const [key, value] of Object.entries(overrides)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    return `/rfis?${next.toString()}`;
  };
  const selectClass = 'h-9 rounded-btn border border-line-strong bg-surface px-2 text-[13.5px]';

  return (
    <FadeIn className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h2 className="text-[21px] font-semibold leading-tight">{t('RFIs')}</h2>
          <p className="text-[13.5px] text-ink-muted">
            {t('Questions to the designers, with due dates and their answers.')}{' '}
            <Link href="/submittals" className="text-accent hover:underline">
              {t('Submittals')}
            </Link>
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {me.permissions.includes('tenant.manage') && <RfiSettingsDialog settings={settings} />}
          {canManage && liveSites.length > 0 && (
            <RfiDialog sites={liveSites} documents={documents} aiEnabled={settings.ai_enabled} />
          )}
        </div>
      </div>

      <div className="grid gap-3.5 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile label={t('Open')} value={String(stats.open)} animate href={chip({ status: 'open', overdue: undefined })} hrefLabel={t('Open')} />
        <StatTile
          label={t('Overdue')}
          value={String(stats.overdue)}
          animate
          noteTone={stats.overdue > 0 ? 'blocked' : 'done'}
          note={stats.overdue > 0 ? t('Past their due date') : t('None overdue')}
          href={chip({ overdue: 'true', status: undefined })}
          hrefLabel={t('Overdue')}
        />
        <StatTile label={t('Answered, to close')} value={String(stats.answered)} animate />
        <StatTile
          label={t('Average days to answer')}
          value={stats.avg_response_days === null ? '—' : String(stats.avg_response_days)}
          note={`${stats.closed} ${t('closed')} · ${stats.total} ${t('in all')}`}
        />
      </div>

      <form className="flex flex-wrap items-end gap-2" action="/rfis">
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
          {RFI_STATUSES.map((status) => (
            <option key={status} value={status}>
              {t(RFI_STATUS_LABELS[status])}
            </option>
          ))}
        </select>
        <select name="discipline" defaultValue={params.discipline ?? ''} className={selectClass} aria-label={t('Discipline')}>
          <option value="">{t('Any discipline')}</option>
          {RFI_DISCIPLINES.map((discipline) => (
            <option key={discipline} value={discipline}>
              {t(RFI_DISCIPLINE_LABELS[discipline])}
            </option>
          ))}
        </select>
        <input
          name="party"
          defaultValue={params.party ?? ''}
          placeholder={t('Designer or company')}
          className={cn(selectClass, 'w-48 px-3')}
          aria-label={t('Designer or company')}
        />
        <label className="flex h-9 items-center gap-1.5 text-[13px]">
          <input type="checkbox" name="overdue" value="true" defaultChecked={params.overdue === 'true'} />
          {t('Overdue only')}
        </label>
        <button type="submit" className="h-9 rounded-btn border border-line-strong px-3 text-[13px] font-medium hover:bg-raised">
          {t('Filter')}
        </button>
        <div className="ms-auto">
          <ExportMenu kind="rfis" filters={Object.fromEntries(query)} csvHref={`/rfis/export?kind=rfis&${query.toString()}`} />
        </div>
      </form>

      {liveSites.length === 0 && log.items.length === 0 ? (
        <EmptyState icon={<HelpCircle />} title={t('No sites yet')} body={t('RFIs belong to a site. Add a site first.')} />
      ) : (
        <RfisTable items={log.items} />
      )}
    </FadeIn>
  );
}
