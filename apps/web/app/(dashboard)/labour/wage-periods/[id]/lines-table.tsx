'use client';

import type { ColumnDef } from '@tanstack/react-table';
import { DataTable } from '@/components/data-table';
import { Badge } from '@/components/ui/badge';
import { money } from '@/lib/format';
import type { WageLine } from '@/lib/api-types';

const columns: ColumnDef<WageLine>[] = [
  {
    accessorKey: 'worker_name',
    header: 'Worker',
    cell: ({ row }) => (
      <div className="flex flex-col">
        <span className="font-medium">{row.original.worker_name}</span>
        <span className="text-[12.5px] text-ink-muted">{row.original.trade ?? 'No trade'}</span>
      </div>
    ),
  },
  {
    accessorKey: 'days_present',
    header: 'Days',
    meta: { align: 'right' },
    sortingFn: (a, b) => Number(a.original.days_present) - Number(b.original.days_present),
    cell: ({ row }) => <span className="font-mono">{row.original.days_present}</span>,
  },
  {
    accessorKey: 'overtime_hours',
    header: 'OT hrs',
    meta: { align: 'right' },
    cell: ({ row }) => (
      <span className="font-mono text-ink-muted">{row.original.overtime_hours}</span>
    ),
  },
  {
    accessorKey: 'gross_amount',
    header: 'Gross',
    meta: { align: 'right' },
    sortingFn: (a, b) => Number(BigInt(a.original.gross_amount) - BigInt(b.original.gross_amount)),
    cell: ({ row }) => <span className="font-mono">{money(row.original.gross_amount)}</span>,
  },
  {
    accessorKey: 'advances_deducted',
    header: 'Advance',
    meta: { align: 'right' },
    cell: ({ row }) => {
      const value = BigInt(row.original.advances_deducted);
      return (
        <span className={value > 0n ? 'font-mono text-pending-fg' : 'font-mono text-ink-faint'}>
          {value > 0n ? `− ${money(row.original.advances_deducted)}` : '—'}
        </span>
      );
    },
  },
  {
    accessorKey: 'net_payable',
    header: 'Net',
    meta: { align: 'right' },
    cell: ({ row }) => (
      <span className="font-mono font-semibold">{money(row.original.net_payable)}</span>
    ),
  },
  {
    id: 'settled',
    header: 'Settled',
    cell: ({ row }) => {
      const outstanding = BigInt(row.original.outstanding);
      if (outstanding === 0n) return <Badge tone="done">Paid</Badge>;
      if (BigInt(row.original.paid_amount) > 0n) {
        return <Badge tone="pending">{money(row.original.outstanding)} left</Badge>;
      }
      return <Badge tone="neutral">Unpaid</Badge>;
    },
  },
];

export function LinesTable({ lines }: { lines: WageLine[] }) {
  return (
    <DataTable
      columns={columns}
      data={lines}
      searchPlaceholder="Search workers"
      emptyMessage="No attendance in this range — nothing to pay."
    />
  );
}
