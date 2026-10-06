import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, CalendarCheck, MapPin } from 'lucide-react';
import { MEETING_STATUS_LABELS } from '@sitebook/shared';
import { ApiRequestError } from '@/lib/api';
import { serverFetch } from '@/lib/server-api';
import { requireSelf } from '@/lib/session';
import { getFormat } from '@/lib/format-server';
import { getT } from '@/lib/i18n-server';
import type { TeamMember } from '@/lib/api-types';
import type { MeetingDetail } from '@/lib/m365-types';
import { m365Status } from '@/lib/m365-status';
import { FadeIn } from '@/components/motion';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { EmailLog } from '@/components/email-log';
import { MEETING_STATUS_TONE } from '../labels';
import { MeetingView } from './meeting-view';

export const metadata = { title: 'Meeting · BUILDR' };

/** One site meeting: when and who, the agenda, then the minutes and the action items. */
export default async function MeetingPage({ params }: { params: Promise<{ id: string }> }) {
  const t = await getT();
  const { instantDate, timeOfDay } = await getFormat();
  const { id } = await params;
  const me = await requireSelf();

  let meeting: MeetingDetail;
  try {
    meeting = await serverFetch<MeetingDetail>(`/meetings/${id}`);
  } catch (error) {
    if (error instanceof ApiRequestError && (error.status === 404 || error.status === 403)) notFound();
    throw error;
  }
  const canManage = me.permissions.includes('meetings.manage');
  const canListTeam = ['team.manage', 'projects.manage', 'wages.view', 'audit.view'].some((p) => me.permissions.includes(p));
  const [team, m365] = await Promise.all([
    canManage && canListTeam
      ? serverFetch<TeamMember[]>('/tenants/current/team').catch(() => [] as TeamMember[])
      : Promise.resolve([] as TeamMember[]),
    canManage ? m365Status() : Promise.resolve({ connected: false, mailbox: null }),
  ]);
  const people = team
    .filter((person) => person.status === 'active' && person.role !== 'client')
    .map((person) => ({ id: person.id, name: person.name, email: person.email ?? null }));

  return (
    <FadeIn className="flex flex-col gap-5">
      <div className="flex flex-col gap-1.5">
        <Link
          href={`/projects/${meeting.project.id}?tab=meetings`}
          className="inline-flex items-center gap-1 text-[12.5px] text-ink-faint hover:underline"
        >
          <ArrowLeft className="size-3 rtl:rotate-180" /> {meeting.project.name}
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="text-[21px] font-semibold leading-tight">{meeting.title}</h2>
          <Badge tone={MEETING_STATUS_TONE[meeting.status]}>{t(MEETING_STATUS_LABELS[meeting.status])}</Badge>
        </div>
        <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-ink-muted">
          <span>
            {instantDate(meeting.starts_at)}, {timeOfDay(meeting.starts_at)} – {timeOfDay(meeting.ends_at)}
          </span>
          {meeting.location && (
            <span className="inline-flex items-center gap-1">
              <MapPin className="size-3.5" aria-hidden /> {meeting.location}
            </span>
          )}
          {meeting.in_calendar && (
            <span className="inline-flex items-center gap-1">
              <CalendarCheck className="size-3.5" aria-hidden /> {t('In Outlook')}
            </span>
          )}
        </span>
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.6fr_1fr]">
        <MeetingView meeting={meeting} people={people} canManage={canManage} m365={m365} />
        <Card className="flex h-fit flex-col gap-3 p-4">
          <h3 className="text-[14px] font-semibold">
            {t('Attendees')} <span className="font-normal text-ink-muted">({meeting.attendees.length})</span>
          </h3>
          {meeting.attendees.length === 0 ? (
            <p className="text-[13px] text-ink-muted">{t('Nobody asked yet.')}</p>
          ) : (
            <ul className="flex flex-col gap-2 text-[13px]">
              {meeting.attendees.map((attendee) => (
                <li key={attendee.id} className="flex flex-col">
                  <span className="flex items-center gap-2">
                    {attendee.name}
                    {attendee.external && <Badge tone="neutral">{t('Outside')}</Badge>}
                  </span>
                  <span className="text-[12px] text-ink-faint" dir="ltr">
                    {attendee.email ?? t('No email on their profile')}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <dl className="grid grid-cols-[8rem_1fr] gap-x-3 gap-y-2 border-t border-line-soft pt-3 text-[13px]">
            <dt className="text-ink-muted">{t('Booked by')}</dt>
            <dd>{meeting.created_by.name}</dd>
            <dt className="text-ink-muted">{t('Invite sent')}</dt>
            <dd>{meeting.invite_sent_at ? `${instantDate(meeting.invite_sent_at)}, ${timeOfDay(meeting.invite_sent_at)}` : '—'}</dd>
            <dt className="text-ink-muted">{t('Minutes sent')}</dt>
            <dd>{meeting.minutes_sent_at ? `${instantDate(meeting.minutes_sent_at)}, ${timeOfDay(meeting.minutes_sent_at)}` : '—'}</dd>
          </dl>
          <EmailLog deliveries={meeting.emails} />
        </Card>
      </div>
    </FadeIn>
  );
}
