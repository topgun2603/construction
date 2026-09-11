'use client';

import type { ReactNode } from 'react';

import { useRouter } from 'next/navigation';
import type { ColumnDef, Row } from '@tanstack/react-table';
import { DataTable } from '@/components/data-table';
import { DeleteRowButton } from '@/components/delete-row-button';
import { deleteProject } from '@/lib/actions';
import { Badge } from '@/components/ui/badge';
import { moneyShort, shortDate } from '@/lib/format';
import { schedule, statusLabel, statusTone } from '@/lib/projects';
import type { ProjectSummary } from '@/lib/api-types';

function buildColumns(canDelete: boolean): ColumnDef<ProjectSummary>[] {
  return [
  {
    accessorKey: 'name',
    header: 'Site',
    cell: ({ row }) => (
      <div className="flex flex-col">
        <span className="font-medium">{row.original.name}</span>
        {row.original.address && (
          <span className="text-[12.5px] text-ink-muted">{row.original.address}</span>
        )}
      </div>
    ),
  },
  {
    accessorKey: 'client_name',
    header: 'Client',
    cell: ({ row }) => row.original.client_name ?? '—',
  },
  {
    id: 'schedule',
    header: 'Schedule',
    // Sort on the raw number of days left, not the rendered label, so "9 days
    // past target" ranks below "2 days left" instead of alphabetically.
    accessorFn: (row) => schedule(row)?.daysRemaining ?? Number.MAX_SAFE_INTEGER,
    cell: ({ row }) => {
      const timeline = schedule(row.original);
      if (!timeline) return <span className="text-ink-faint">No dates</span>;
      return (
        <div className="flex items-center gap-2">
          <span className="font-mono text-[13px]">{timeline.elapsedPercent}%</span>
          <span className="text-[12.5px] text-ink-muted">{timeline.label}</span>
        </div>
      );
    },
  },
  {
    accessorKey: 'target_end_date',
    header: 'Handover',
    cell: ({ row }) => (
      <span className="font-mono text-[13px]">{shortDate(row.original.target_end_date)}</span>
    ),
  },
  {
    accessorKey: 'budget_amount',
    header: 'Budget',
    meta: { align: 'right' },
    cell: ({ row }) => (
      <span className="font-mono">
        {row.original.budget_amount ? moneyShort(row.original.budget_amount) : '—'}
      </span>
    ),
  },
  {
    accessorKey: 'status',
    header: 'Status',
    cell: ({ row }) => (
      <Badge tone={statusTone(row.original.status)}>{statusLabel(row.original.status)}</Badge>
    ),
  },
  // Owner only, matching the API's @Roles on DELETE /projects/:id.
  ...(canDelete
    ? [
        {
          id: 'actions',
          header: '',
          enableSorting: false,
          meta: { align: 'right' as const },
          cell: ({ row }: { row: Row<ProjectSummary> }) => (
            <DeleteRowButton
              what={row.original.name}
              title="Archive this site?"
              body={
                <>
                  <strong className="font-semibold text-ink">{row.original.name}</strong> comes off
                  the sites list. Its daily reports, attendance and wage history are kept — this
                  hides a site that is finished or was created by mistake.
                </>
              }
              confirmLabel="Archive site"
              successMessage={`${row.original.name} archived`}
              onConfirm={() => deleteProject(row.original.id)}
            />
          ),
        },
      ]
    : []),
  ];
}

export function ProjectsTable({
  projects,
  canDelete = false,
  toolbar,
}: {
  projects: ProjectSummary[];
  canDelete?: boolean;
  toolbar?: ReactNode;
}) {
  const router = useRouter();
  const columns = buildColumns(canDelete);
  return (
    <DataTable
      columns={columns}
      data={projects}
      searchPlaceholder="Search sites and clients"
      toolbar={toolbar}
      pageSize={20}
      emptyMessage="No sites match that search."
      onRowClick={(project) => router.push(`/projects/${project.id}`)}
    />
  );
}
