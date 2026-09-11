'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { LayoutGrid, Rows3 } from 'lucide-react';
import type { ProjectListItem } from '@/lib/api-types';
import { SiteCardGrid } from './site-card-grid';
import { ProjectsTable } from './projects-table';
import { cn } from '@/lib/utils';

const STORAGE_KEY = 'sb.sites.view';

/**
 * Cards or table.
 *
 * Cards are the default because a builder recognises a site by what it looks like. The table stays
 * because it is the only view that sorts by budget or handover date, which is what somebody planning
 * a month actually needs — dropping it to make the page prettier would have taken away the one thing
 * it was good at.
 *
 * The choice is remembered per browser: a per-viewer convenience, not shared state.
 */
export function SitesView({
  projects,
  canDelete,
  action,
}: {
  projects: ProjectListItem[];
  canDelete: boolean;
  /** Rendered by the server page — the New site dialog, for whoever may create one. */
  action?: ReactNode;
}) {
  const [view, setView] = useState<'cards' | 'table'>('cards');

  // Read after mount, never during render: the server has no localStorage and reading it in the
  // first paint would hydrate mismatched.
  useEffect(() => {
    try {
      if (window.localStorage.getItem(STORAGE_KEY) === 'table') setView('table');
    } catch {
      /* private mode, blocked storage — the default is fine */
    }
  }, []);

  function choose(next: 'cards' | 'table') {
    setView(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* ignore */
    }
  }

  /*
   * The toggle and the New site button ride in the view's own toolbar, beside its search box,
   * rather than stacking above it. Three right-aligned rows above a left-aligned search box is what
   * made the page look unaligned; one row reads as a toolbar.
   */
  const controls = (
    <div className="ml-auto flex items-center gap-2">
      <div className="flex gap-1 rounded-btn bg-neutral-bg p-1" role="group" aria-label="View">
        {(
          [
            { value: 'cards', label: 'Cards', icon: LayoutGrid },
            { value: 'table', label: 'Table', icon: Rows3 },
          ] as const
        ).map((option) => {
          const Icon = option.icon;
          return (
            <button
              key={option.value}
              type="button"
              aria-pressed={view === option.value}
              onClick={() => choose(option.value)}
              className={cn(
                'flex min-h-0 items-center gap-2 rounded-[7px] px-3 py-1.5 text-[12.5px] font-medium transition',
                view === option.value
                  ? 'bg-surface font-semibold text-ink shadow-seg'
                  : 'text-ink-soft hover:text-ink',
              )}
            >
              <Icon className="size-4" />
              {option.label}
            </button>
          );
        })}
      </div>
      {action}
    </div>
  );

  return view === 'cards' ? (
    <SiteCardGrid projects={projects} toolbar={controls} />
  ) : (
    <ProjectsTable projects={projects} canDelete={canDelete} toolbar={controls} />
  );
}
