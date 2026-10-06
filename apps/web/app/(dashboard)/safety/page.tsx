import Link from 'next/link';
import { Download, ShieldCheck } from 'lucide-react';
import {
  SAFETY_ACTION_AGE_BUCKETS,
  SAFETY_CATEGORIES,
  SAFETY_CATEGORY_LABELS,
  SAFETY_INCIDENT_TYPES,
  SAFETY_INCIDENT_TYPE_LABELS,
} from '@sitebook/shared';
import { serverFetch } from '@/lib/server-api';
import { requireSelf } from '@/lib/session';
import { getFormat } from '@/lib/format-server';
import { getT } from '@/lib/i18n-server';
import type { Page, ProjectSummary } from '@/lib/api-types';
import type {
  SafetyCoverage,
  SafetyIncidentSummary,
  SafetyKpis,
  SafetyObservationSummary,
  SafetyPermitSummary,
  SafetyTalkSummary,
} from '@/lib/safety-types';
import { FadeIn } from '@/components/motion';
import { ExportMenu } from '@/components/export-menu';
import { StatTile } from '@/components/stat-tile';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { cn } from '@/lib/utils';
import { CountBars } from './count-bars';
import { daysSinceTone } from './labels';
import { QuickObservationDialog } from './quick-observation-dialog';
import { ReportIncidentDialog } from './report-incident-dialog';
import { RequestPermitDialog } from './request-permit-dialog';
import { IncidentsTable, ObservationsTable, PermitsTable, TalksTable } from './safety-registers';
import { ToolboxTalkDialog } from './toolbox-talk-dialog';

export const metadata = { title: 'Safety · BUILDR' };

const TABS = ['incidents', 'permits', 'talks', 'observations'] as const;
type TabKey = (typeof TABS)[number];

/**
 * Safety across every site the caller can see (roadmap Phase 2, module 8).
 *
 * The tiles answer what an owner opens this page to ask — how long since somebody was hurt, how the
 * injury rates compare with the hours worked, and what is still open — and the registers below are
 * where a supervisor reports from a phone.
 */
export default async function SafetyPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; from?: string; to?: string }>;
}) {
  const t = await getT();
  const { count, shortDate } = await getFormat();
  const me = await requireSelf();
  const params = await searchParams;
  const active: TabKey = (TABS as readonly string[]).includes(params.tab ?? '') ? (params.tab as TabKey) : 'incidents';
  const canView = me.permissions.includes('safety.view');
  const canReport = me.permissions.includes('safety.report');
  const range = new URLSearchParams();
  if (params.from) range.set('from', params.from);
  if (params.to) range.set('to', params.to);

  const sites = (await serverFetch<Page<ProjectSummary>>('/projects?limit=200')).items
    .filter((site) => site.status !== 'completed')
    .map((site) => ({ id: site.id, name: site.name }));

  const actions = canReport && sites.length > 0 && (
    <div className="flex flex-wrap gap-2">
      <ReportIncidentDialog sites={sites} />
      <QuickObservationDialog sites={sites} />
      <ToolboxTalkDialog sites={sites} />
      <RequestPermitDialog sites={sites} />
    </div>
  );

  if (!canView) {
    return (
      <FadeIn className="flex flex-col gap-5">
        <h2 className="text-[21px] font-semibold leading-tight">{t('Safety')}</h2>
        {actions}
      </FadeIn>
    );
  }

  const [kpis, coverage, incidents, permits, talks, observations] = await Promise.all([
    serverFetch<SafetyKpis>(`/safety/kpis?${range.toString()}`),
    serverFetch<SafetyCoverage>('/safety/toolbox-talks/coverage'),
    active === 'incidents' ? serverFetch<{ items: SafetyIncidentSummary[] }>('/safety/incidents?limit=200') : null,
    active === 'permits' ? serverFetch<{ items: SafetyPermitSummary[] }>('/safety/permits?limit=200') : null,
    active === 'talks' ? serverFetch<{ items: SafetyTalkSummary[] }>('/safety/toolbox-talks?limit=200') : null,
    active === 'observations'
      ? serverFetch<{ items: SafetyObservationSummary[] }>('/safety/observations?limit=200')
      : null,
  ]);
  const rate = (value: number | null) => (value === null ? '—' : value.toFixed(2));
  const onRoll = coverage.sites.reduce((sum, site) => sum + site.on_roll, 0);
  const covered = coverage.sites.filter((site) => site.talks > 0).length;
  const tabLabel: Record<TabKey, string> = {
    incidents: t('Incidents'),
    permits: t('Permits to work'),
    talks: t('Toolbox talks'),
    observations: t('Observations'),
  };
  const exportKind: Record<TabKey, string> = {
    incidents: 'incidents',
    permits: 'permits',
    talks: 'toolbox_talks',
    observations: 'observations',
  };
  // The shared Excel export's name for each register.
  const excelKind: Record<TabKey, string> = {
    incidents: 'safety_incidents',
    permits: 'safety_permits',
    talks: 'safety_talks',
    observations: 'safety_observations',
  };

  return (
    <FadeIn className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h2 className="text-[21px] font-semibold leading-tight">{t('Safety')}</h2>
          <p className="text-[13.5px] text-ink-muted">
            {t('Incidents, permits to work, toolbox talks and observations across your sites.')}{' '}
            {shortDate(kpis.from)} – {shortDate(kpis.to)}
          </p>
        </div>
        {actions}
      </div>

      <div className="grid gap-3.5 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile
          label={t('Days since last LTI')}
          value={kpis.days_since_lti === null ? '—' : String(kpis.days_since_lti)}
          animate={kpis.days_since_lti !== null}
          noteTone={daysSinceTone(kpis.days_since_lti, kpis.last_lti_on !== null)}
          note={kpis.last_lti_on ? `${t('Last')} ${shortDate(kpis.last_lti_on)}` : t('No lost-time injury recorded')}
        />
        <StatTile
          label={t('LTIFR')}
          value={rate(kpis.ltifr)}
          note={`${kpis.lti_count} ${t('LTIs per million hours')}`}
          noteTone={kpis.lti_count > 0 ? 'blocked' : 'done'}
        />
        <StatTile
          label={t('TRIR')}
          value={rate(kpis.trir)}
          note={`${kpis.recordable_count} ${t('recordables per 200,000 hours')}`}
          noteTone={kpis.recordable_count > 0 ? 'pending' : 'done'}
        />
        <StatTile
          label={t('Man-hours')}
          value={count(Math.round(kpis.man_hours))}
          note={`${t('From the roll call,')} ${kpis.shift_hours} ${t('h a shift plus overtime')}`}
        />
        <StatTile
          label={t('Open actions')}
          value={String(kpis.actions.open)}
          animate
          noteTone={kpis.actions.overdue > 0 ? 'blocked' : 'done'}
          note={kpis.actions.overdue > 0 ? `${kpis.actions.overdue} ${t('overdue')}` : t('None overdue')}
        />
        <StatTile
          label={t('Active permits')}
          value={String(kpis.permits.active)}
          animate
          noteTone={kpis.permits.expired_open > 0 ? 'blocked' : 'neutral'}
          note={
            kpis.permits.expired_open > 0
              ? `${kpis.permits.expired_open} ${t('expired and still open')}`
              : `${kpis.permits.requested} ${t('awaiting signatures')}`
          }
          href="/safety?tab=permits"
          hrefLabel={t('Permits to work')}
        />
        <StatTile
          label={t('Toolbox talks this week')}
          value={String(coverage.talks)}
          animate
          noteTone={coverage.sites.length > 0 && covered < coverage.sites.length ? 'pending' : 'done'}
          note={`${covered}/${coverage.sites.length} ${t('sites')} · ${onRoll} ${t('on the roll')}`}
          href="/safety?tab=talks"
          hrefLabel={t('Toolbox talks')}
        />
        <StatTile
          label={t('Open observations')}
          value={String(kpis.observations.open)}
          animate
          note={`${kpis.observations.total} ${t('in the period')}`}
          href="/safety?tab=observations"
          hrefLabel={t('Observations')}
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.4fr_1fr_1fr]">
        <Card className="flex flex-col gap-3 p-4">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-[14px] font-semibold">{t('By site')}</h3>
            <a
              href={`/safety/export?kind=sites&${range.toString()}`}
              className="inline-flex items-center gap-1 text-[12.5px] text-accent hover:underline"
            >
              <Download className="size-3.5" /> CSV
            </a>
          </div>
          {kpis.sites.length === 0 ? (
            <p className="text-[13px] text-ink-muted">{t('No sites yet.')}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="text-start text-[12px] text-ink-muted">
                    <th className="py-1.5 text-start font-medium">{t('Site')}</th>
                    <th className="py-1.5 text-end font-medium">{t('Days since LTI')}</th>
                    <th className="py-1.5 text-end font-medium">{t('Man-hours')}</th>
                    <th className="py-1.5 text-end font-medium">{t('LTIFR')}</th>
                    <th className="py-1.5 text-end font-medium">{t('Open actions')}</th>
                  </tr>
                </thead>
                <tbody>
                  {kpis.sites.map((site) => (
                    <tr key={site.project_id} className="border-t border-line">
                      <td className="py-2">
                        <Link href={`/projects/${site.project_id}?tab=safety`} className="hover:underline">
                          {site.project_name}
                        </Link>
                      </td>
                      <td className="py-2 text-end">
                        <Badge tone={daysSinceTone(site.days_since_lti, site.has_lti)}>
                          {site.days_since_lti ?? '—'}
                        </Badge>
                      </td>
                      <td className="py-2 text-end font-mono">{count(Math.round(site.man_hours))}</td>
                      <td className="py-2 text-end font-mono">{rate(site.ltifr)}</td>
                      <td className={cn('py-2 text-end font-mono', site.overdue_actions > 0 && 'text-blocked-fg')}>
                        {site.open_actions}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
        <Card className="flex flex-col gap-3 p-4">
          <h3 className="text-[14px] font-semibold">{t('Observations by category')}</h3>
          <CountBars
            emptyLabel={t('No observations in the period.')}
            rows={SAFETY_CATEGORIES.map((key) => ({
              key,
              label: t(SAFETY_CATEGORY_LABELS[key]),
              count: kpis.observations.by_category[key] ?? 0,
            }))
              .filter((row) => row.count > 0)
              .sort((a, b) => b.count - a.count)}
          />
        </Card>
        <div className="flex flex-col gap-4">
          <Card className="flex flex-col gap-3 p-4">
            <h3 className="text-[14px] font-semibold">{t('Open actions by age')}</h3>
            <CountBars
              emptyLabel={t('No open actions.')}
              rows={SAFETY_ACTION_AGE_BUCKETS.map((bucket) => ({
                key: bucket.key,
                label: t(bucket.label),
                count: kpis.actions.by_age[bucket.key],
              }))}
            />
          </Card>
          <Card className="flex flex-col gap-3 p-4">
            <h3 className="text-[14px] font-semibold">{t('Incidents by type')}</h3>
            <CountBars
              emptyLabel={t('Nothing reported in the period.')}
              rows={SAFETY_INCIDENT_TYPES.map((key) => ({
                key,
                label: t(SAFETY_INCIDENT_TYPE_LABELS[key]),
                count: kpis.incidents_by_type[key],
              })).filter((row) => row.count > 0)}
            />
          </Card>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line">
        <nav className="flex gap-1 overflow-x-auto">
          {TABS.map((key) => (
            <Link
              key={key}
              href={`/safety?tab=${key}`}
              aria-current={key === active ? 'page' : undefined}
              className={cn(
                '-mb-px border-b-[2.5px] px-3.5 py-2.5 text-[13.5px] leading-tight whitespace-nowrap transition',
                key === active
                  ? 'border-accent font-semibold text-ink'
                  : 'border-transparent font-medium text-ink-muted hover:text-ink',
              )}
            >
              {tabLabel[key]}
            </Link>
          ))}
        </nav>
        <div className="pb-1.5">
          <ExportMenu
            kind={excelKind[active]}
            filters={Object.fromEntries(range)}
            csvHref={`/safety/export?kind=${exportKind[active]}&${range.toString()}`}
          />
        </div>
      </div>

      {sites.length === 0 ? (
        <EmptyState
          icon={<ShieldCheck />}
          title={t('No sites yet')}
          body={t('Safety records belong to a site. Add a site first.')}
        />
      ) : (
        <>
          {incidents && <IncidentsTable items={incidents.items} />}
          {permits && <PermitsTable items={permits.items} />}
          {talks && (
            <div className="flex flex-col gap-3">
              <CoverageStrip coverage={coverage} labels={{ week: t('This week'), none: t('No talk yet') }} />
              <TalksTable items={talks.items} />
            </div>
          )}
          {observations && <ObservationsTable items={observations.items} />}
        </>
      )}
    </FadeIn>
  );
}

/** Talks this week, a chip per site: green with coverage when one was given, amber when not. */
function CoverageStrip({ coverage, labels }: { coverage: SafetyCoverage; labels: { week: string; none: string } }) {
  return (
    <div className="flex flex-wrap items-center gap-2 text-[12.5px]">
      <span className="text-ink-muted">{labels.week}:</span>
      {coverage.sites.map((site) => (
        <Badge key={site.project_id} tone={site.talks > 0 ? 'done' : 'pending'}>
          {site.project_name} ·{' '}
          {site.talks > 0
            ? `${site.talks}${site.coverage_percent === null ? '' : ` · ${site.coverage_percent}%`}`
            : labels.none}
        </Badge>
      ))}
    </div>
  );
}
