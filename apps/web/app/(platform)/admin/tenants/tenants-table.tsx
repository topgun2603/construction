'use client';

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
const columns: ColumnDef<PlatformTenantRow>[] = [
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
    cell: ({ row }) => (
      <Badge tone={row.original.plan === 'lifetime' ? 'accent' : 'neutral'} dot={false}>
        {titleCase(row.original.plan)}
      </Badge>
    ),
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

export function TenantsTable({ tenants }: { tenants: PlatformTenantRow[] }) {
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
