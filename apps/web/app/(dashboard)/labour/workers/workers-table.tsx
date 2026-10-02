'use client';

import Link from 'next/link';
import type { ColumnDef } from '@tanstack/react-table';
import { DataTable } from '@/components/data-table';
import { DeleteRowButton } from '@/components/delete-row-button';
import { deleteWorker } from '@/lib/actions';
import { Avatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { money } from '@/lib/format';
import { titleCase } from '@/lib/format';
import type { Worker } from '@/lib/api-types';
import type { Translator } from '@/lib/i18n';
import { useLanguage } from '@/components/language-provider';

function buildColumns(t: Translator): ColumnDef<Worker>[] {
  return [
  {
    accessorKey: 'name',
    header: t('Worker'),
    cell: ({ row }) => (
      <div className="flex items-center gap-2.5">
        <Avatar name={row.original.name} size="sm" />
        <div className="flex flex-col">
          <Link
            href={`/labour/workers/${row.original.id}`}
            className="font-medium hover:underline"
            onClick={(event) => event.stopPropagation()}
          >
            {row.original.name}
          </Link>
          {row.original.phone && (
            <span className="font-mono text-[12px] text-ink-muted">+{row.original.phone}</span>
          )}
        </div>
      </div>
    ),
  },
  { accessorKey: 'trade', header: 'Trade', cell: ({ row }) => row.original.trade ?? '—' },
  {
    accessorKey: 'contractor_name',
    header: t('Contractor'),
    // Direct labour is a real group, not a blank — the wage sheet pays them too.
    cell: ({ row }) =>
      row.original.contractor_name ?? <span className="text-ink-muted">{t('Direct labour')}</span>,
  },
  {
    accessorKey: 'skill_level',
    header: 'Skill',
    cell: ({ row }) => titleCase(row.original.skill_level),
  },
  {
    accessorKey: 'daily_wage',
    header: 'Daily wage',
    meta: { align: 'right' },
    // Sort numerically on paise; the rendered string would sort lexically.
    sortingFn: (a, b) =>
      Number(BigInt(a.original.daily_wage) - BigInt(b.original.daily_wage)),
    cell: ({ row }) => <span className="font-mono">{money(row.original.daily_wage)}</span>,
  },
  {
    accessorKey: 'overtime_rate_per_hour',
    header: 'OT / hr',
    meta: { align: 'right' },
    cell: ({ row }) => (
      <span className="font-mono text-ink-muted">{money(row.original.overtime_rate_per_hour)}</span>
    ),
  },
  {
    accessorKey: 'status',
    header: t('Status'),
    cell: ({ row }) => (
      <Badge tone={row.original.status === 'active' ? 'done' : 'neutral'}>
        {t(titleCase(row.original.status))}
      </Badge>
    ),
  },
  {
    id: 'actions',
    header: '',
    enableSorting: false,
    meta: { align: 'right' },
    cell: ({ row }) => (
      <DeleteRowButton
        what={row.original.name}
        title={t('Delete this worker?')}
        body={
          <>
            <strong className="font-semibold text-ink">{row.original.name}</strong> comes off the
            roster. Past attendance and wage sheets keep their record. If they have simply left,
            mark them inactive instead — that keeps them searchable.
          </>
        }
        successMessage={`${row.original.name} deleted`}
        onConfirm={() => deleteWorker(row.original.id)}
      />
    ),
  },
];
}

export function WorkersTable({ workers }: { workers: Worker[] }) {
  const { t } = useLanguage();
  return (
    <DataTable
      columns={buildColumns(t)}
      data={workers}
      searchPlaceholder="Search workers, trades, contractors"
      pageSize={25}
      emptyMessage="No workers on the roster yet."
    />
  );
}
