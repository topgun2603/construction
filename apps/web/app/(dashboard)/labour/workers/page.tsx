import { serverFetch } from '@/lib/server-api';
import type { Contractor, Page, ProjectSummary, Worker } from '@/lib/api-types';
import { FadeIn } from '@/components/motion';
import { StatTile } from '@/components/stat-tile';
import { money } from '@/lib/format';
import { AddWorkerDialog } from './add-worker-dialog';
import { WorkersTable } from './workers-table';

export const metadata = { title: 'Workers · BUILDR' };

export default async function WorkersPage() {
  const [workers, contractors, projects] = await Promise.all([
    serverFetch<Page<Worker>>('/workers?limit=500'),
    serverFetch<Page<Contractor>>('/contractors?limit=200'),
    serverFetch<Page<ProjectSummary>>('/projects?limit=200'),
  ]);

  const active = workers.items.filter((worker) => worker.status === 'active');
  const dailyCost = active.reduce((sum, worker) => sum + BigInt(worker.daily_wage), 0n);
  const direct = active.filter((worker) => !worker.contractor_id).length;

  return (
    <FadeIn className="flex flex-col gap-5">
      <div className="grid gap-3.5 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile label="Workers" value={String(workers.items.length)} animate note={`${active.length} active`} />
        <StatTile label="Contractors" value={String(contractors.items.length)} animate note={`${direct} on direct labour`} />
        <StatTile
          label="Full-day cost"
          value={money(dailyCost.toString())}
          note="If every active worker is present"
        />
        <StatTile
          label="Work types"
          value={String(new Set(active.map((w) => w.trade).filter(Boolean)).size)}
          animate
          note="Kinds of work your crew can do"
        />
      </div>

      <div className="flex justify-end">
        <AddWorkerDialog contractors={contractors.items} projects={projects.items} />
      </div>

      <WorkersTable workers={workers.items} />
    </FadeIn>
  );
}
