import Link from 'next/link';
import { ShieldCheck } from 'lucide-react';
import { getFormat } from '@/lib/format-server';
import { getT } from '@/lib/i18n-server';
import type {
  SafetyIncidentSummary,
  SafetyKpis,
  SafetyObservationSummary,
  SafetyPermitSummary,
  SafetyTalkSummary,
} from '@/lib/safety-types';
import { StatTile } from '@/components/stat-tile';
import { Badge } from '@/components/ui/badge';
import { daysSinceTone } from '../../safety/labels';
import { QuickObservationDialog } from '../../safety/quick-observation-dialog';
import { ReportIncidentDialog } from '../../safety/report-incident-dialog';
import { RequestPermitDialog } from '../../safety/request-permit-dialog';
import { IncidentsTable, ObservationsTable, PermitsTable, TalksTable } from '../../safety/safety-registers';
import { ToolboxTalkDialog } from '../../safety/toolbox-talk-dialog';

/**
 * A site's Safety tab (roadmap Phase 2, module 8): how long since somebody was hurt here, what is
 * open, and the four registers for this site only. The report buttons are the phone-sized way in.
 */
export async function SiteSafety({
  site,
  kpis,
  incidents,
  permits,
  talks,
  observations,
  canReport,
}: {
  site: { id: string; name: string };
  kpis: SafetyKpis | null;
  incidents: SafetyIncidentSummary[];
  permits: SafetyPermitSummary[];
  talks: SafetyTalkSummary[];
  observations: SafetyObservationSummary[];
  canReport: boolean;
}) {
  const t = await getT();
  const { count, shortDate } = await getFormat();
  const figures = kpis?.sites[0] ?? null;
  const live = permits.filter((permit) => permit.status !== 'closed');
  const openObservations = observations.filter((row) => row.status === 'open');

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        {figures ? (
          <div className="flex items-center gap-3">
            <ShieldCheck className="size-5 text-ink-muted" />
            <Badge tone={daysSinceTone(figures.days_since_lti, figures.has_lti)} className="text-[13px]">
              {figures.days_since_lti ?? '—'} {t('days since last LTI')}
            </Badge>
            <span className="text-[12.5px] text-ink-muted">
              {figures.last_lti_on ? `${t('Last')} ${shortDate(figures.last_lti_on)}` : t('No lost-time injury on this site')}
            </span>
          </div>
        ) : (
          <span />
        )}
        {canReport && (
          <div className="flex flex-wrap gap-2">
            <ReportIncidentDialog sites={[site]} fixedSiteId={site.id} />
            <QuickObservationDialog sites={[site]} fixedSiteId={site.id} />
            <ToolboxTalkDialog sites={[site]} fixedSiteId={site.id} />
            <RequestPermitDialog sites={[site]} fixedSiteId={site.id} />
          </div>
        )}
      </div>

      {figures && kpis && (
        <div className="grid gap-3.5 sm:grid-cols-2 xl:grid-cols-4">
          <StatTile
            label={t('LTIFR this year')}
            value={figures.ltifr === null ? '—' : figures.ltifr.toFixed(2)}
            note={`${figures.lti_count} ${t('LTIs')} · ${count(Math.round(figures.man_hours))} ${t('man-hours')}`}
          />
          <StatTile
            label={t('Open actions')}
            value={String(figures.open_actions)}
            animate
            noteTone={figures.overdue_actions > 0 ? 'blocked' : 'done'}
            note={figures.overdue_actions > 0 ? `${figures.overdue_actions} ${t('overdue')}` : t('None overdue')}
          />
          <StatTile
            label={t('Live permits')}
            value={String(live.length)}
            animate
            noteTone={live.some((permit) => permit.expired) ? 'blocked' : 'neutral'}
            note={
              live.some((permit) => permit.expired) ? t('One has expired and is still open') : t('Requested, active or suspended')
            }
          />
          <StatTile
            label={t('Open observations')}
            value={String(openObservations.length)}
            animate
            note={`${talks.length} ${t('toolbox talks recorded')}`}
          />
        </div>
      )}

      <Section title={t('Incidents and near misses')} more="/safety?tab=incidents" moreLabel={t('All sites')}>
        <IncidentsTable items={incidents} showSite={false} />
      </Section>
      <Section title={t('Permits to work')} more="/safety?tab=permits" moreLabel={t('All sites')}>
        <PermitsTable items={permits} showSite={false} />
      </Section>
      <Section title={t('Observations')} more="/safety?tab=observations" moreLabel={t('All sites')}>
        <ObservationsTable items={observations} showSite={false} />
      </Section>
      <Section title={t('Toolbox talks')} more="/safety?tab=talks" moreLabel={t('All sites')}>
        <TalksTable items={talks} showSite={false} />
      </Section>
    </div>
  );
}

function Section({
  title,
  more,
  moreLabel,
  children,
}: {
  title: string;
  more: string;
  moreLabel: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-[14.5px] font-semibold">{title}</h3>
        <Link href={more} className="text-[12.5px] text-accent hover:underline">
          {moreLabel}
        </Link>
      </div>
      {children}
    </section>
  );
}
