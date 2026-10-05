import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, Sparkles } from 'lucide-react';
import { SAFETY_CATEGORY_LABELS, SAFETY_OBSERVATION_TYPE_LABELS, type SafetyCategory } from '@sitebook/shared';
import { ApiRequestError } from '@/lib/api';
import { serverFetch } from '@/lib/server-api';
import { requireSelf } from '@/lib/session';
import { getFormat } from '@/lib/format-server';
import { getT } from '@/lib/i18n-server';
import type { SafetyObservationDetail } from '@/lib/safety-types';
import { FadeIn } from '@/components/motion';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { ActionsPanel } from '../../actions-panel';
import { OBSERVATION_STATUS, SEVERITY } from '../../labels';
import { PhotoStrip } from '../../photo-strip';
import { CloseObservation } from './close-observation';

export const metadata = { title: 'Observation · Safety · BUILDR' };

/** One safety observation: what was seen, the fix, and the photos before and after. */
export default async function ObservationPage({ params }: { params: Promise<{ id: string }> }) {
  const t = await getT();
  const { instantDate, timeOfDay } = await getFormat();
  const { id } = await params;
  const me = await requireSelf();

  let observation: SafetyObservationDetail;
  try {
    observation = await serverFetch<SafetyObservationDetail>(`/safety/observations/${id}`);
  } catch (error) {
    if (error instanceof ApiRequestError && (error.status === 404 || error.status === 403)) notFound();
    throw error;
  }
  const canManage = me.permissions.includes('safety.manage');
  const open = observation.status === 'open';
  const assignee = observation.actions.some((a) => a.status === 'open' && a.assignee?.id === me.user.id);
  const status = OBSERVATION_STATUS[observation.status];

  return (
    <FadeIn className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-1.5">
          <Link
            href="/safety?tab=observations"
            className="inline-flex items-center gap-1 text-[12.5px] text-ink-faint hover:underline"
          >
            <ArrowLeft className="size-3 rtl:rotate-180" /> {t('Observations')}
          </Link>
          <div className="flex flex-wrap items-center gap-2.5">
            <h2 className="text-[21px] font-semibold leading-tight">
              {t(SAFETY_OBSERVATION_TYPE_LABELS[observation.type])} ·{' '}
              {t(SAFETY_CATEGORY_LABELS[observation.category as SafetyCategory] ?? observation.category)}
            </h2>
            <Badge tone={status.tone}>{t(status.label)}</Badge>
            {observation.type !== 'positive' && (
              <Badge tone={SEVERITY[observation.severity].tone}>{t(SEVERITY[observation.severity].label)}</Badge>
            )}
          </div>
          <span className="text-[13px] text-ink-muted">
            <span className="font-mono" dir="ltr">
              {observation.number}
            </span>{' '}
            ·{' '}
            <Link href={`/projects/${observation.project.id}?tab=safety`} className="hover:underline">
              {observation.project.name}
            </Link>{' '}
            · {instantDate(observation.observed_at)}, {timeOfDay(observation.observed_at)}
            {observation.location && ` · ${observation.location}`} · {observation.reported_by?.name}
          </span>
        </div>
        {open && (canManage || assignee) && <CloseObservation id={observation.id} projectId={observation.project.id} />}
      </div>

      {observation.suggested_by && (
        <p className="inline-flex items-center gap-2 text-[12.5px] text-ink-muted">
          <Sparkles className="size-3.5" />
          {observation.suggested_by === 'ai'
            ? t('Type, category and severity were suggested by AI from the note.')
            : t('Type, category and severity were suggested from the words in the note.')}
        </p>
      )}

      <div className="grid gap-4 xl:grid-cols-[1.2fr_1fr]">
        <div className="flex flex-col gap-4">
          <Card className="flex flex-col gap-3 p-4 text-[13.5px]">
            <p className="whitespace-pre-line">{observation.description}</p>
            {observation.transcript && (
              <p className="text-[12.5px] italic text-ink-muted">“{observation.transcript}”</p>
            )}
            {observation.closed_at && (
              <p className="text-[13px]">
                {t('Closed by')} {observation.closed_by?.name ?? '—'}, {instantDate(observation.closed_at)}
                {observation.close_note && ` — ${observation.close_note}`}
              </p>
            )}
          </Card>
          <Card className="flex flex-col gap-3 p-4">
            <h3 className="text-[14px] font-semibold">{t('Photos')}</h3>
            <PhotoStrip
              photos={observation.photos}
              projectId={observation.project.id}
              parent={{ observation_id: observation.id }}
              canAdd={me.permissions.includes('safety.report') && open}
            />
          </Card>
        </div>
        {observation.type !== 'positive' && (
          <ActionsPanel
            parent={{ observationId: observation.id }}
            actions={observation.actions}
            canManage={canManage}
            meId={me.user.id}
            locked={!open}
          />
        )}
      </div>
    </FadeIn>
  );
}
