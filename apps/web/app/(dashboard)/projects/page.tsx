import { serverFetch } from '@/lib/server-api';
import { Building2 } from 'lucide-react';
import { requireSelf } from '@/lib/session';
import type { Page, ProjectListItem } from '@/lib/api-types';
import { EmptyState } from '@/components/ui/empty-state';
import { FadeIn } from '@/components/motion';
import { NewProjectDialog } from './new-project-dialog';
import { SitesView } from './sites-view';

export const metadata = { title: 'Projects · BUILDR' };

export default async function ProjectsPage() {
  const [projects, me] = await Promise.all([
    serverFetch<Page<ProjectListItem>>('/projects?limit=200'),
    requireSelf(),
  ]);

  const canCreate = ['owner', 'project_manager'].includes(me.user.role);

  if (projects.items.length === 0) {
    return (
      <EmptyState
        icon={<Building2 />}
        title="No projects yet"
        body="Create the first site to start filing daily reports, attendance and indents."
        action={canCreate ? <NewProjectDialog /> : undefined}
      />
    );
  }

  return (
    <FadeIn className="flex flex-col gap-4">
      <SitesView
        projects={projects.items}
        canDelete={me.user.role === 'owner'}
        action={canCreate ? <NewProjectDialog /> : undefined}
      />
    </FadeIn>
  );
}
