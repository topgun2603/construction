import { serverFetch } from '@/lib/server-api';
import { Building2 } from 'lucide-react';
import { requireSelf } from '@/lib/session';
import type { Page, ProjectListItem } from '@/lib/api-types';
import { EmptyState } from '@/components/ui/empty-state';
import { FadeIn } from '@/components/motion';
import { ExportMenu } from '@/components/export-menu';
import { ImportWizard } from '@/components/import-wizard';
import { NewProjectDialog } from './new-project-dialog';
import { SitesView } from './sites-view';
import { getT } from '@/lib/i18n-server';

export const metadata = { title: 'Projects · BUILDR' };

export default async function ProjectsPage() {
  const t = await getT();
  const [projects, me] = await Promise.all([
    serverFetch<Page<ProjectListItem>>('/projects?limit=200'),
    requireSelf(),
  ]);

  const canCreate = ['owner', 'project_manager'].includes(me.user.role);

  if (projects.items.length === 0) {
    return (
      <EmptyState
        icon={<Building2 />}
        title={t('No projects yet')}
        illustration="illus_contractors"
        body={t('Create the first site to start filing daily reports, attendance and indents.')}
        action={
          canCreate ? (
            <div className="flex flex-wrap items-center justify-center gap-2">
              {/* A company moving in has its sites in a spreadsheet already. */}
              {me.permissions.includes('projects.manage') && <ImportWizard kind="projects" />}
              <NewProjectDialog />
            </div>
          ) : undefined
        }
      />
    );
  }

  return (
    <FadeIn className="flex flex-col gap-4">
      <SitesView
        projects={projects.items}
        canDelete={me.user.role === 'owner'}
        action={
          <div className="flex items-center gap-2">
            <ExportMenu kind="projects" />
            {me.permissions.includes('projects.manage') && <ImportWizard kind="projects" />}
            {canCreate && <NewProjectDialog />}
          </div>
        }
      />
    </FadeIn>
  );
}
