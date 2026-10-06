import { serverFetch } from '@/lib/server-api';
import type { Contractor, Page, ProjectSummary, Worker } from '@/lib/api-types';
import { FadeIn } from '@/components/motion';
import { ExportMenu } from '@/components/export-menu';
import { ImportWizard } from '@/components/import-wizard';
import { requireSelf } from '@/lib/session';
import { StatTile } from '@/components/stat-tile';
import { getFormat } from '@/lib/format-server';
import { AddWorkerDialog } from './add-worker-dialog';
import { WorkersTable } from './workers-table';
import { getT } from '@/lib/i18n-server';

export const metadata = { title: 'Workers · BUILDR' };

export default async function WorkersPage() {
  const t = await getT();
  const { money } = await getFormat();
  const [workers, contractors, projects, me] = await Promise.all([
    serverFetch<Page<Worker>>('/workers?limit=500'),
    serverFetch<Page<Contractor>>('/contractors?limit=200'),
    serverFetch<Page<ProjectSummary>>('/projects?limit=200'),
    requireSelf(),
  ]);

  const active = workers.items.filter((worker) => worker.status === 'active');
  const dailyCost = active.reduce((sum, worker) => sum + BigInt(worker.daily_wage), 0n);
  const direct = active.filter((worker) => !worker.contractor_id).length;

  return (
    <FadeIn className="flex flex-col gap-5">
      <div className="grid gap-3.5 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile label={t('Workers')} value={String(workers.items.length)} animate note={`${active.length} active`} />
        <StatTile label={t('Contractors')} value={String(contractors.items.length)} animate note={`${direct} on direct labour`} />
        <StatTile
          label={t('Full-day cost')}
          value={money(dailyCost.toString())}
          note={t('If every active worker is present')}
        />
        <StatTile
          label={t('Work types')}
          value={String(new Set(active.map((w) => w.trade).filter(Boolean)).size)}
          animate
          note={t('Kinds of work your crew can do')}
        />
      </div>

      <div className="flex flex-wrap justify-end gap-2">
        <ExportMenu kind="workers" />
        {me.permissions.includes('workers.manage') && <ImportWizard kind="workers" />}
        <AddWorkerDialog contractors={contractors.items} projects={projects.items} />
      </div>

      <WorkersTable workers={workers.items} />
    </FadeIn>
  );
}
