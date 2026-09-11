'use client';

import type { ColumnDef } from '@tanstack/react-table';
import type { PersonLedger } from '@/lib/api-types';
import { DataTable } from '@/components/data-table';
import { Avatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { money, titleCase } from '@/lib/format';

type Row = PersonLedger['people'][number];

/**
 * One row per person, sorted by what they committed.
 *
 * Rejected expenses get their own column rather than being folded into a total.
 * A supervisor who put through ₹2L of which ₹70k was turned down is a different
 * conversation from one whose ₹1.3L all cleared, and a single "expenses" figure
 * hides exactly the part worth asking about.
 */
export function PeopleTable({
  ledger,
  currentUserId,
}: {
  ledger: PersonLedger;
  currentUserId: string;
}) {
  const columns: ColumnDef<Row>[] = [
    {
      accessorKey: 'name',
      header: 'Person',
      cell: ({ row }) => (
        <div className="flex items-center gap-2.5">
          <Avatar name={row.original.name} size="sm" />
          <div className="flex min-w-0 flex-col">
            <span className="flex items-center gap-1.5 font-medium">
              {row.original.name}
              {row.original.user_id === currentUserId && (
                <span className="text-[11.5px] font-normal text-ink-faint">you</span>
              )}
            </span>
            <span className="font-mono text-[11.5px] text-ink-muted">
              {titleCase(row.original.role)}
            </span>
          </div>
        </div>
      ),
    },
    {
      accessorKey: 'expenses_approved',
      header: 'Approved',
      meta: { align: 'right' },
      sortingFn: (a, b) =>
        Number(BigInt(a.original.expenses_approved) - BigInt(b.original.expenses_approved)),
      cell: ({ row }) => (
        <span className="font-mono font-semibold">{money(row.original.expenses_approved)}</span>
      ),
    },
    {
      accessorKey: 'expenses_pending',
      header: 'Pending',
      meta: { align: 'right' },
      sortingFn: (a, b) =>
        Number(BigInt(a.original.expenses_pending) - BigInt(b.original.expenses_pending)),
      cell: ({ row }) => {
        const value = BigInt(row.original.expenses_pending);
        return (
          <span className={value > 0n ? 'font-mono text-pending-fg' : 'font-mono text-ink-faint'}>
            {value > 0n ? money(row.original.expenses_pending) : '—'}
          </span>
        );
      },
    },
    {
      accessorKey: 'expenses_rejected',
      header: 'Rejected',
      meta: { align: 'right' },
      sortingFn: (a, b) =>
        Number(BigInt(a.original.expenses_rejected) - BigInt(b.original.expenses_rejected)),
      cell: ({ row }) => {
        const value = BigInt(row.original.expenses_rejected);
        return (
          <span className={value > 0n ? 'font-mono text-blocked-fg' : 'font-mono text-ink-faint'}>
            {value > 0n ? money(row.original.expenses_rejected) : '—'}
          </span>
        );
      },
    },
    {
      accessorKey: 'labour_booked',
      header: 'Labour booked',
      meta: { align: 'right' },
      sortingFn: (a, b) =>
        Number(BigInt(a.original.labour_booked) - BigInt(b.original.labour_booked)),
      cell: ({ row }) => (
        <div className="flex flex-col items-end">
          <span className="font-mono">{money(row.original.labour_booked)}</span>
          <span className="font-mono text-[11.5px] text-ink-muted">
            {row.original.days_booked} worker-days
          </span>
        </div>
      ),
    },
    {
      accessorKey: 'indents_raised',
      header: 'Indents',
      meta: { align: 'right' },
      cell: ({ row }) =>
        row.original.indents_raised === 0 ? (
          <span className="text-ink-faint">—</span>
        ) : (
          <span className="font-mono">
            {row.original.indents_approved}
            <span className="text-ink-muted">/{row.original.indents_raised}</span>
          </span>
        ),
    },
    {
      accessorKey: 'reports_filed',
      header: 'Reports',
      meta: { align: 'right' },
      cell: ({ row }) =>
        row.original.reports_filed === 0 ? (
          <span className="text-ink-faint">—</span>
        ) : (
          <Badge tone="done" dot={false}>
            {row.original.reports_filed}
          </Badge>
        ),
    },
  ];

  return (
    <DataTable
      columns={columns}
      data={ledger.people}
      searchPlaceholder="Search people and roles"
      pageSize={25}
      emptyMessage="Nobody matches that search."
    />
  );
}
