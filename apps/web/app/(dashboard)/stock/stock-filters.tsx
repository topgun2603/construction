'use client';

import { useRouter } from 'next/navigation';
import type { ProjectSummary } from '@/lib/api-types';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

/**
 * Which site's store you are looking at.
 *
 * Defaults to one site rather than all of them: cement at Lake View is not available to Hill
 * Road, and a combined total would imply it is. "All sites" stays available for the owner asking
 * what the company holds, which is a different question from what a storekeeper can issue today.
 */
export function StockFilters({
  projects,
  projectId,
}: {
  projects: ProjectSummary[];
  projectId: string;
}) {
  const router = useRouter();

  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[12px] font-semibold uppercase tracking-[0.08em] text-ink-muted">
        Site
      </span>
      <Select
        value={projectId || 'all'}
        onValueChange={(value) =>
          router.push(value === 'all' ? '/stock' : `/stock?project_id=${value}`)
        }
      >
        <SelectTrigger className="w-[260px]" aria-label="Site">
          <SelectValue placeholder="Pick a site" />
        </SelectTrigger>
        <SelectContent>
          {projects.map((project) => (
            <SelectItem key={project.id} value={project.id}>
              {project.name}
            </SelectItem>
          ))}
          <SelectItem value="all">All sites (combined)</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}
