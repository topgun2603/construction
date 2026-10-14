import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { ApiRequestError } from '@/lib/api';
import { serverFetch } from '@/lib/server-api';
import { requireSelf } from '@/lib/session';
import { getFormat } from '@/lib/format-server';
import { getT } from '@/lib/i18n-server';
import type { SafetyTalkDetail } from '@/lib/safety-types';
import { FadeIn } from '@/components/motion';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { PhotoStrip } from '../../photo-strip';
import { SignButton } from './sign-button';

export const metadata = { title: 'Toolbox talk · Safety · BUILDR' };

/** One toolbox talk: the topic, who gave it, who heard it and who has signed. */
export default async function TalkPage({ params }: { params: Promise<{ id: string }> }) {
  const t = await getT();
  const { longDate, timeOfDay } = await getFormat();
  const { id } = await params;
  const me = await requireSelf();

  let talk: SafetyTalkDetail;
  try {
    talk = await serverFetch<SafetyTalkDetail>(`/safety/toolbox-talks/${id}`);
  } catch (error) {
    if (error instanceof ApiRequestError && (error.status === 404 || error.status === 403)) notFound();
    throw error;
  }
  const canReport = me.permissions.includes('safety.report');
  const signed = talk.attendees.filter((a) => a.signed_at).length;

  return (
    <FadeIn className="flex flex-col gap-5">
      <div className="flex flex-col gap-1.5">
        <Link href="/safety?tab=talks" className="inline-flex items-center gap-1 text-[12.5px] text-ink-faint hover:underline">
          <ArrowLeft className="size-3 rtl:rotate-180" /> {t('Toolbox talks')}
        </Link>
        <h2 className="text-[21px] font-semibold leading-tight">{t(talk.topic)}</h2>
        <span className="text-[13px] text-ink-muted">
          <Link href={`/projects/${talk.project.id}?tab=safety`} className="hover:underline">
            {talk.project.name}
          </Link>{' '}
          · {longDate(talk.talk_date)} · {talk.duration_minutes} {t('min')} · {t('given by')}{' '}
          {talk.presenter?.name ?? '—'}
        </span>
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.2fr_1fr]">
        <Card className="flex flex-col gap-3 p-4">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-[14px] font-semibold">
              {t('Attendees')} ({talk.attendees.length})
            </h3>
            <Badge tone={signed === talk.attendees.length ? 'done' : 'pending'}>
              {signed}/{talk.attendees.length} {t('signed')}
            </Badge>
          </div>
          {talk.attendees.length === 0 ? (
            <p className="text-[13px] text-ink-muted">{t('Nobody recorded.')}</p>
          ) : (
            <ul className="flex flex-col divide-y divide-line text-[13.5px]">
              {talk.attendees.map((attendee) => (
                <li key={attendee.worker_id} className="flex items-center justify-between gap-3 py-2">
                  <span>
                    {attendee.name}
                    {attendee.trade && <span className="text-ink-muted"> · {attendee.trade}</span>}
                  </span>
                  {attendee.signed_at ? (
                    <span className="text-[12.5px] text-done-fg">
                      {t('Signed')} {timeOfDay(attendee.signed_at)}
                    </span>
                  ) : canReport ? (
                    <SignButton talkId={talk.id} workerId={attendee.worker_id} />
                  ) : (
                    <span className="text-[12.5px] text-ink-muted">{t('Not signed')}</span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>
        <div className="flex flex-col gap-4">
          {talk.notes && (
            <Card className="flex flex-col gap-2 p-4 text-[13.5px]">
              <h3 className="text-[14px] font-semibold">{t('Points covered')}</h3>
              <p className="whitespace-pre-line">{talk.notes}</p>
            </Card>
          )}
          <Card className="flex flex-col gap-3 p-4">
            <h3 className="text-[14px] font-semibold">{t('Photos')}</h3>
            <PhotoStrip
              photos={talk.photos}
              projectId={talk.project.id}
              parent={{ toolbox_talk_id: talk.id }}
              canAdd={canReport}
              purposes={['attendance']}
            />
          </Card>
        </div>
      </div>
    </FadeIn>
  );
}
