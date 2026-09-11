import { serverFetch } from '@/lib/server-api';
import { CalendarCheck } from 'lucide-react';
import type { AttendanceDay, Page, ProjectSummary, Worker } from '@/lib/api-types';
import { todayIso } from '@/lib/format';
import { EmptyState } from '@/components/ui/empty-state';
import { FadeIn } from '@/components/motion';
import { RollCall } from './roll-call';

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
  const params = await searchParams;
  const projects = await serverFetch<Page<ProjectSummary>>('/projects?limit=200');

  if (projects.items.length === 0) {
    return (
      <EmptyState
        icon={<CalendarCheck />}
        title="No sites yet"
        body="Attendance is recorded per site. Create a project first."
      />
    );
  }

  const projectId = params.project ?? projects.items[0]!.id;
  const date = params.date ?? todayIso();

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
