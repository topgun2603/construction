import { serverFetch } from '@/lib/server-api';
import { CalendarCheck } from 'lucide-react';
import type { AttendanceDay, Page, ProjectSummary, Worker } from '@/lib/api-types';
import { getFormat } from '@/lib/format-server';
import { EmptyState } from '@/components/ui/empty-state';
import { FadeIn } from '@/components/motion';
import { RollCall } from './roll-call';
import { getT } from '@/lib/i18n-server';

export const metadata = { title: 'Attendance · BUILDR' };

/**
 * The roll call for one site on one day.
 *
 * Site and date live in the URL rather than in component state, so a supervisor can
 * bookmark yesterday's sheet and a PM can paste a link to the day being queried.
 */
export default async function AttendancePage({
  searchParams,
}: {
  searchParams: Promise<{ project?: string; date?: string }>;
}) {
  const t = await getT();
  const params = await searchParams;
  const projects = await serverFetch<Page<ProjectSummary>>('/projects?limit=200');

  if (projects.items.length === 0) {
    return (
      <EmptyState
        icon={<CalendarCheck />}
        title={t('No sites yet')}
        body={t('Attendance is recorded per site. Create a project first.')}
      />
    );
  }

  const projectId = params.project ?? projects.items[0]!.id;
  // Today at the chosen site, on its own clock — a Dubai site of a Mumbai company is still on
  // yesterday for ninety minutes after Mumbai's midnight.
  const site = projects.items.find((project) => project.id === projectId);
  const date = params.date ?? site?.today ?? (await getFormat()).todayIso();

  const [roster, recorded] = await Promise.all([
    serverFetch<Page<Worker>>(
      `/workers?project_id=${projectId}&on_date=${date}&status=active&limit=500`,
    ),
    serverFetch<AttendanceDay>(`/attendance?project_id=${projectId}&date=${date}`),
  ]);

  return (
    <FadeIn>
      <RollCall
        projects={projects.items}
        projectId={projectId}
        date={date}
        roster={roster.items}
        recorded={recorded}
      />
    </FadeIn>
  );
}
