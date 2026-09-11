'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { CalendarRange, PieChart, UserCog, Warehouse } from 'lucide-react';
import type { ProjectSummary } from '@/lib/api-types';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';

/**
 * The reports tab row, plus this report's own filters.
 *
 * Does not reuse `ReportsNav`: that component owns a date range, and an overrun is cumulative —
 * a slab 20 bags over is 20 bags over whichever month you look at. Offering a range here would
 * invite people to slice a number that does not divide.
 */
const TABS = [
  { href: '/reports', label: 'Labour cost', icon: PieChart },
  { href: '/reports/attendance', label: 'Attendance register', icon: CalendarRange },
  { href: '/reports/overrun', label: 'Material overrun', icon: Warehouse },
  { href: '/reports/people', label: 'People', icon: UserCog, ownerOnly: true },
];

export function OverrunFilters({
  projects,
  projectId,
  showAll,
  isOwnerOrAccounts,
}: {
  projects: ProjectSummary[];
  projectId: string;
  showAll: boolean;
  isOwnerOrAccounts: boolean;
}) {
  const router = useRouter();

  function push(next: { project_id?: string; all?: boolean }) {
    const query = new URLSearchParams();
    const project = next.project_id ?? projectId;
    const all = next.all ?? showAll;
    if (project) query.set('project_id', project);
    if (all) query.set('all', 'true');
    const suffix = query.toString() ? `?${query.toString()}` : '';
    router.push(`/reports/overrun${suffix}`);
  }

  const tabs = TABS.filter((tab) => !tab.ownerOnly || isOwnerOrAccounts);

  return (
    <div className="flex flex-col gap-3">
      <nav className="flex gap-1 rounded-btn bg-neutral-bg p-1" aria-label="Reports">
        {tabs.map((tab) => {
          const active = tab.href === '/reports/overrun';
          const Icon = tab.icon;
          return (
            <Link
              key={tab.href}
              href={tab.href}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'flex items-center gap-2 rounded-[7px] px-3 py-2 text-[13px] font-medium transition',
                active
                  ? 'bg-surface font-semibold text-ink shadow-seg'
                  : 'text-ink-soft hover:text-ink',
              )}
            >
              <Icon className="size-4" />
              {tab.label}
            </Link>
          );
        })}
      </nav>

      <div className="flex flex-wrap items-center gap-3">
        <Select
          value={projectId || 'all'}
          onValueChange={(value) => push({ project_id: value === 'all' ? '' : value })}
        >
          <SelectTrigger className="w-[260px]" aria-label="Site">
            <SelectValue placeholder="All sites" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All sites</SelectItem>
            {projects.map((project) => (
              <SelectItem key={project.id} value={project.id}>
                {project.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <label className="flex cursor-pointer items-center gap-2 text-[13px]">
          <input
            type="checkbox"
            checked={showAll}
            onChange={(event) => push({ all: event.target.checked })}
            className="size-4 accent-accent"
          />
          {/* Off by default: a material with no estimate has nothing to exceed, and listing it
              turns a report you act on into an inventory you scroll. */}
          Include materials with no estimate
        </label>
      </div>
    </div>
  );
}
