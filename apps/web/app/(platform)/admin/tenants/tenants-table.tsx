'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import type { ColumnDef } from '@tanstack/react-table';
import type { PlatformTenantRow } from '@/lib/platform-session';
import { DataTable } from '@/components/data-table';
import { Badge, type Tone } from '@/components/ui/badge';
import { shortDate, titleCase } from '@/lib/format';

const STATUS_TONE: Record<string, Tone> = {
  active: 'done',
  suspended: 'blocked',
  cancelled: 'neutral',
};

/**
 * Every tenant, newest first.
 *
 * "Last seen" is the most recent sign-in by anyone in the tenant, and it is the column
 * that actually tells you whether an account is alive — a builder with four sites and
 * nobody signing in for three weeks is a churn conversation, and no plan or status field
 * would have told you that.
 */
/**
 * How many days until a date, floored. Negative once it has passed.
 *
 * Day granularity on purpose: a term that ends tonight and one that ended this morning are the
 * same conversation with the customer, and an hours-precise countdown in a table invites nobody to
 * act sooner.
 */
function daysUntil(iso: string): number {
  const end = new Date(`${iso.slice(0, 10)}T00:00:00Z`).getTime();
  const today = new Date();
  const start = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  return Math.round((end - start) / 86_400_000);
}

const columnsFor = (planNames: Record<string, string>): ColumnDef<PlatformTenantRow>[] => [
  {
    accessorKey: 'name',
    header: 'Tenant',
    cell: ({ row }) => (
      <div className="flex flex-col">
        <Link
          href={`/admin/tenants/${row.original.id}`}
          className="font-medium hover:underline"
          onClick={(event) => event.stopPropagation()}
        >
          {row.original.name}
        </Link>
        <span className="text-[12px] text-ink-muted">
          {row.original.owner_name ?? 'No owner'}
          {row.original.owner_phone && (
            <span className="font-mono"> · +{row.original.owner_phone}</span>
          )}
        </span>
      </div>
    ),
  },
  {
    accessorKey: 'plan',
    header: 'Plan',
    // The catalogue's own name where there is one. A retired or deleted plan falls back to the
    // code title-cased, which still says something rather than going blank.
    cell: ({ row }) => (
      <Badge tone={row.original.plan_expires_on === null ? 'accent' : 'neutral'} dot={false}>
        {planNames[row.original.plan] ?? titleCase(row.original.plan)}
      </Badge>
    ),
  },
  {
    accessorKey: 'plan_expires_on',
    header: 'Term ends',
    meta: { align: 'right' },
    /*
     * The column an operator renews from.
     *
     * Sortable by date, so "who lapses next" is one click on the header rather than a query
     * somebody writes against the database. A term inside a month is coloured: past that, it is
     * not yet anybody's problem and colouring it would make the whole table look urgent.
     */
    cell: ({ row }) => {
      const { plan_expires_on: expiresOn, plan_standing: standing } = row.original;
      if (!expiresOn) return <span className="text-[12.5px] text-ink-faint">Never ends</span>;

      const days = daysUntil(expiresOn);
      const date = shortDate(expiresOn.slice(0, 10));

      if (standing === 'expired') {
        return <span className="text-[12.5px] font-medium text-blocked-fg">Read-only</span>;
      }
      if (standing === 'grace') {
        return <span className="text-[12.5px] font-medium text-pending-fg">In grace</span>;
      }
      return (
        <span
          className={`font-mono text-[12.5px] ${days <= 30 ? 'text-pending-fg' : 'text-ink-muted'}`}
        >
          {date}
          {days <= 30 && (
            <span className="ml-1 font-sans">({days === 0 ? 'today' : `${days}d`})</span>
          )}
        </span>
      );
    },
  },
  {
    accessorKey: 'status',
    header: 'Status',
    cell: ({ row }) => (
      <Badge tone={STATUS_TONE[row.original.status] ?? 'neutral'}>
        {titleCase(row.original.status)}
      </Badge>
    ),
  },
  {
    accessorKey: 'user_count',
    header: 'People',
    meta: { align: 'right' },
    cell: ({ row }) => <span className="font-mono">{row.original.user_count}</span>,
  },
  {
    accessorKey: 'project_count',
    header: 'Sites',
    meta: { align: 'right' },
    cell: ({ row }) => <span className="font-mono">{row.original.project_count}</span>,
  },
  {
    accessorKey: 'worker_count',
    header: 'Workers',
    meta: { align: 'right' },
    cell: ({ row }) => (
      <span className="font-mono text-ink-muted">{row.original.worker_count}</span>
    ),
  },
  {
    accessorKey: 'last_activity',
    header: 'Last seen',
    meta: { align: 'right' },
    cell: ({ row }) =>
      row.original.last_activity ? (
        <span className="font-mono text-[12.5px] text-ink-muted">
          {shortDate(row.original.last_activity.slice(0, 10))}
        </span>
      ) : (
        // Signed up and never came back, which is the signal worth colouring.
        <span className="text-[12.5px] text-pending-fg">Never</span>
      ),
  },
  {
    accessorKey: 'created_at',
    header: 'Joined',
    meta: { align: 'right' },
    cell: ({ row }) => (
      <span className="font-mono text-[12.5px] text-ink-muted">
        {shortDate(row.original.created_at.slice(0, 10))}
      </span>
    ),
  },
];

export function TenantsTable({
  tenants,
  planNames,
}: {
  tenants: PlatformTenantRow[];
  planNames: Record<string, string>;
}) {
  // Rebuilt only when the catalogue changes, which is never within a page's life.
  const columns = useMemo(() => columnsFor(planNames), [planNames]);

  return (
    <DataTable
      columns={columns}
      data={tenants}
      searchPlaceholder="Search tenants and owner numbers"
      pageSize={25}
      emptyMessage="No tenants match that search."
    />
  );
}
