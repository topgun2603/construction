import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, Printer } from 'lucide-react';
import { SAFETY_INCIDENT_TYPE_LABELS } from '@sitebook/shared';
import { ApiRequestError } from '@/lib/api';
import { serverFetch } from '@/lib/server-api';
import { requireSelf } from '@/lib/session';
import { getFormat } from '@/lib/format-server';
import { getT } from '@/lib/i18n-server';
import type { SafetyIncidentDetail } from '@/lib/safety-types';
import { FadeIn } from '@/components/motion';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { ActionsPanel } from '../../actions-panel';
import { INCIDENT_STATUS, PERSON_ROLE, SEVERITY } from '../../labels';
import { PhotoStrip } from '../../photo-strip';
import { IncidentStatusButtons, InvestigationForm } from './incident-controls';

export const metadata = { title: 'Incident · Safety · BUILDR' };

/** One incident: what happened, who was involved, the investigation, the actions and the photos. */
export default async function IncidentPage({ params }: { params: Promise<{ id: string }> }) {
  const t = await getT();
  const { instantDate, timeOfDay } = await getFormat();
  const { id } = await params;
  const me = await requireSelf();

  let incident: SafetyIncidentDetail;
  try {
    incident = await serverFetch<SafetyIncidentDetail>(`/safety/incidents/${id}`);
  } catch (error) {
    if (error instanceof ApiRequestError && (error.status === 404 || error.status === 403)) notFound();
    throw error;
  }
  const canManage = me.permissions.includes('safety.manage');
  const canReport = me.permissions.includes('safety.report');
  const status = INCIDENT_STATUS[incident.status];
  const closed = incident.status === 'closed';

  return (
    <FadeIn className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-1.5">
          <Link href="/safety" className="inline-flex items-center gap-1 text-[12.5px] text-ink-faint hover:underline">
            <ArrowLeft className="size-3 rtl:rotate-180" /> {t('Safety')}
          </Link>
          <div className="flex flex-wrap items-center gap-2.5">
            <h2 className="text-[21px] font-semibold leading-tight">{incident.title}</h2>
            <Badge tone={status.tone}>{t(status.label)}</Badge>
            <Badge tone={SEVERITY[incident.severity].tone}>{t(SEVERITY[incident.severity].label)}</Badge>
          </div>
          <span className="text-[13px] text-ink-muted">
            <span className="font-mono" dir="ltr">
              {incident.number}
            </span>{' '}
            · {t(SAFETY_INCIDENT_TYPE_LABELS[incident.type])} ·{' '}
            <Link href={`/projects/${incident.project.id}?tab=safety`} className="hover:underline">
              {incident.project.name}
            </Link>{' '}
            · {instantDate(incident.occurred_at)}, {timeOfDay(incident.occurred_at)}
            {incident.location && ` · ${incident.location}`}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {canManage && <IncidentStatusButtons incident={incident} />}
          <Link
            href={`/safety/incidents/${incident.id}/print`}
            className="inline-flex h-9 items-center gap-2 rounded-[8px] border border-line-strong bg-surface px-3 text-[13px] font-semibold hover:bg-raised"
          >
            <Printer className="size-4" /> {t('Print')}
          </Link>
        </div>
      </div>

      {incident.serious && (
        <p className="rounded-btn border border-blocked/40 bg-blocked-bg px-3 py-2 text-[13px] text-blocked-fg">
          {t('Serious incident.')}{' '}
          {incident.serious_notified_at
            ? `${t('The owners were alerted at')} ${timeOfDay(incident.serious_notified_at)}, ${instantDate(incident.serious_notified_at)}.`
            : ''}
        </p>
      )}

      <div className="grid gap-4 xl:grid-cols-[1.2fr_1fr]">
        <div className="flex flex-col gap-4">
          <Card className="flex flex-col gap-3 p-4 text-[13.5px]">
            <h3 className="text-[14px] font-semibold">{t('What happened')}</h3>
            <p className="whitespace-pre-line">{incident.description ?? '—'}</p>
            <div>
              <span className="text-[12.5px] text-ink-muted">{t('Done on the spot')}</span>
              <p className="whitespace-pre-line">{incident.immediate_action ?? '—'}</p>
            </div>
            <span className="text-[12.5px] text-ink-muted">
              {t('Reported by')} {incident.reported_by?.name ?? '—'}
              {incident.investigated_by && ` · ${t('investigated by')} ${incident.investigated_by.name}`}
              {incident.closed_by && ` · ${t('closed by')} ${incident.closed_by.name}`}
            </span>
            {incident.closure_note && <p className="text-[13px]">{incident.closure_note}</p>}
          </Card>

          <Card className="flex flex-col gap-3 p-4">
            <h3 className="text-[14px] font-semibold">{t('People')}</h3>
            {incident.people.length === 0 ? (
              <p className="text-[13px] text-ink-muted">{t('Nobody recorded.')}</p>
            ) : (
              <ul className="flex flex-col divide-y divide-line text-[13.5px]">
                {incident.people.map((person) => (
                  <li key={person.id} className="flex flex-col gap-0.5 py-2">
                    <span className="flex items-center gap-2">
                      <span className="font-medium">{person.name}</span>
                      <Badge tone={person.role === 'injured' ? 'blocked' : 'neutral'} dot={false}>
                        {t(PERSON_ROLE[person.role])}
                      </Badge>
                      {!person.worker_id && <span className="text-[12px] text-ink-muted">{t('not on the roster')}</span>}
                    </span>
                    {(person.body_part || person.injury_nature) && (
                      <span className="text-[12.5px] text-ink-muted">
                        {[person.body_part, person.injury_nature].filter(Boolean).join(' · ')}
                      </span>
                    )}
                    {person.statement && <p className="text-[13px] italic">“{person.statement}”</p>}
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card className="flex flex-col gap-3 p-4">
            <h3 className="text-[14px] font-semibold">{t('Photos and statements')}</h3>
            <PhotoStrip
              photos={incident.photos}
              projectId={incident.project.id}
              parent={{ incident_id: incident.id }}
              canAdd={canReport && !closed}
              purposes={['evidence', 'witness_statement']}
            />
          </Card>
        </div>

        <div className="flex flex-col gap-4">
          <InvestigationForm incident={incident} canEdit={canManage && !closed} />
          <ActionsPanel
            parent={{ incidentId: incident.id }}
            actions={incident.actions}
            canManage={canManage}
            meId={me.user.id}
            locked={closed}
          />
        </div>
      </div>
    </FadeIn>
  );
}
