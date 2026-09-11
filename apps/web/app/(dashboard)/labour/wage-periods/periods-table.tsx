'use client';

import { useRouter } from 'next/navigation';
import type { ColumnDef } from '@tanstack/react-table';
import { DataTable } from '@/components/data-table';
import { Badge, type Tone } from '@/components/ui/badge';
import { money, shortDate } from '@/lib/format';
import type { WagePeriod } from '@/lib/api-types';

const STATUS_TONE: Record<WagePeriod['status'], Tone> = {
  open: 'neutral',
  finalised: 'pending',
  paid: 'done',
};

const STATUS_LABEL: Record<WagePeriod['status'], string> = {
  open: 'Draft',
  finalised: 'To pay',
  paid: 'Paid',
};

const columns: ColumnDef<WagePeriod>[] = [
  {
    accessorKey: 'contractor_name',
    header: 'Contractor',
    cell: ({ row }) => <span className="font-medium">{row.original.contractor_name}</span>,
  },
  {
    id: 'period',
    header: 'Period',
    accessorFn: (row) => row.period_start,
    cell: ({ row }) => (
      <span className="font-mono text-[13px]">
        {shortDate(row.original.period_start)} – {shortDate(row.original.period_end)}
      </span>
    ),
  },
  {
    accessorKey: 'line_count',
    header: 'Workers',
    meta: { align: 'right' },
    cell: ({ row }) => <span className="font-mono">{row.original.line_count}</span>,
  },
  {
    accessorKey: 'total_earned',
    header: 'Gross',
    meta: { align: 'right' },
    sortingFn: (a, b) => Number(BigInt(a.original.total_earned) - BigInt(b.original.total_earned)),
    cell: ({ row }) => <span className="font-mono">{money(row.original.total_earned)}</span>,
  },
  {
    accessorKey: 'total_advances',
    header: 'Advances',
    meta: { align: 'right' },
    cell: ({ row }) => (
      <span className="font-mono text-ink-muted">{money(row.original.total_advances)}</span>
    ),
  },
  {
    id: 'outstanding',
    header: 'Outstanding',
    meta: { align: 'right' },
    accessorFn: (row) => Number(BigInt(row.total_earned) - BigInt(row.total_paid)),
    cell: ({ row }) => {
      const outstanding = BigInt(row.original.total_earned) - BigInt(row.original.total_paid);
      return (
        <span className={outstanding > 0n ? 'font-mono font-semibold' : 'font-mono text-ink-muted'}>
          {money(outstanding.toString())}
        </span>
      );
    },
  },
  {
    accessorKey: 'status',
    header: 'Status',
    cell: ({ row }) => (
      <Badge tone={STATUS_TONE[row.original.status]}>{STATUS_LABEL[row.original.status]}</Badge>
    ),
  },
  {
    id: 'source',
    header: '',
    enableSorting: false,
    cell: ({ row }) =>
      row.original.source === 'scheduled' ? (
        <span
          className="text-[11.5px] text-ink-faint"
          title="Drafted by the nightly job, not by a person. Settings → Automation explains what runs."
        >
          auto
        </span>
      ) : null,
  },
];

export function PeriodsTable({ periods }: { periods: WagePeriod[] }) {
  const router = useRouter();
  return (
    <DataTable
      columns={columns}
      data={periods}
      searchPlaceholder="Search contractors"
      pageSize={20}
      emptyMessage="No wage periods yet. Generate one from a week of attendance."
      onRowClick={(period) => router.push(`/labour/wage-periods/${period.id}`)}
    />
  );
}
