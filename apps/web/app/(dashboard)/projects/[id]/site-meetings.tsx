import Link from 'next/link';
import { CalendarCheck, CalendarDays, Plus } from 'lucide-react';
import { MEETING_STATUS_LABELS } from '@sitebook/shared';
import { serverFetch } from '@/lib/server-api';
import type { SelfResponse } from '@/lib/session';
import type { TeamMember } from '@/lib/api-types';
import type { MeetingSummary } from '@/lib/m365-types';
import { getFormat } from '@/lib/format-server';
import { getT } from '@/lib/i18n-server';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { MEETING_STATUS_TONE } from '../../meetings/labels';
import { MeetingDialog } from '../../meetings/meeting-dialog';

/**
 * The site's Meetings tab: coordination meetings, design reviews, client walk-rounds — when, how
 * many were asked, open actions, and whether the invite and the minutes went out. Rendered only when
 * the tab is open, so its fetches happen only then.
 */
export async function SiteMeetings({ projectId, me }: { projectId: string; me: SelfResponse }) {
  const t = await getT();
  const { instantDate, timeOfDay } = await getFormat();
  const canManage = me.permissions.includes('meetings.manage');
  // The attendee picker reads the team list, which only some roles may read.
  const canListTeam = ['team.manage', 'projects.manage', 'wages.view', 'audit.view'].some((p) => me.permissions.includes(p));
  const [meetings, team] = await Promise.all([
    serverFetch<MeetingSummary[]>(`/meetings?project_id=${projectId}`),
    canManage && canListTeam
      ? serverFetch<TeamMember[]>('/tenants/current/team').catch(() => [] as TeamMember[])
      : Promise.resolve([] as TeamMember[]),
  ]);
  const people = team
    .filter((person) => person.status === 'active' && person.role !== 'client')
    .map((person) => ({ id: person.id, name: person.name, email: person.email ?? null }));

  return (
    <div className="flex flex-col gap-3">
      {canManage && (
        <div className="flex justify-end">
          <MeetingDialog
            projectId={projectId}
            people={people}
            trigger={
              <Button size="sm" className="gap-2">
                <Plus className="size-4" />
                {t('New meeting')}
              </Button>
            }
          />
        </div>
      )}
      {meetings.length === 0 ? (
        <EmptyState
          icon={<CalendarDays />}
          title={t('No meetings yet')}
          body={t('Book the weekly coordination meeting here: the agenda, who comes, then the minutes and who does what by when.')}
        />
      ) : (
        <Card>
          <ul className="divide-y divide-line-soft">
            {meetings.map((meeting) => (
              <li key={meeting.id}>
                <Link
                  href={`/meetings/${meeting.id}`}
                  className="flex flex-col gap-1.5 px-4 py-3 transition hover:bg-raised sm:flex-row sm:items-center sm:gap-4"
                >
                  <span className="w-36 flex-none text-[13px] text-ink-muted">
                    {instantDate(meeting.starts_at)}, {timeOfDay(meeting.starts_at)}
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-[14px] font-medium">{meeting.title}</span>
                    <span className="text-[12.5px] text-ink-muted">
                      {meeting.attendee_count ?? 0} {t('asked')}
                      {meeting.location ? ` · ${meeting.location}` : ''}
                      {meeting.open_actions ? ` · ${meeting.open_actions} ${t('open actions')}` : ''}
                    </span>
                  </span>
                  <span className="flex flex-none flex-wrap items-center gap-2">
                    {meeting.in_calendar && (
                      <span className="inline-flex items-center gap-1 text-[12px] text-ink-muted">
                        <CalendarCheck className="size-3.5" aria-hidden />
                        {t('Invited')}
                      </span>
                    )}
                    {meeting.minutes_sent_at && (
                      <span className="text-[12px] text-ink-muted">{t('Minutes sent')}</span>
                    )}
                    <Badge tone={MEETING_STATUS_TONE[meeting.status]}>{t(MEETING_STATUS_LABELS[meeting.status])}</Badge>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
