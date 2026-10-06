'use client';

import { useRouter } from 'next/navigation';
import type { ColumnDef } from '@tanstack/react-table';
import { RFI_DISCIPLINE_LABELS, RFI_PRIORITY_LABELS } from '@sitebook/shared';
import { DataTable } from '@/components/data-table';
import { Badge } from '@/components/ui/badge';
import { useFormat } from '@/components/format-provider';
import { useLanguage } from '@/components/language-provider';
import type { RfiSummary } from '@/lib/rfi-types';
import { PRIORITY_TONE, rfiBadge } from './labels';

/** The RFI log as a table, company-wide on /rfis and one site's on its Design tab. */
export function RfisTable({ items, showSite = true }: { items: RfiSummary[]; showSite?: boolean }) {
  const { t } = useLanguage();
  const { shortDate } = useFormat();
  const router = useRouter();
  const columns: ColumnDef<RfiSummary>[] = [
    {
      accessorKey: 'subject',
      header: t('RFI'),
      cell: ({ row }) => (
        <div className="flex flex-col">
          <span className="font-medium">{row.original.subject}</span>
          <span className="font-mono text-[12px] text-ink-muted" dir="ltr">
            {row.original.label}
          </span>
        </div>
      ),
    },
    ...(showSite
      ? [{ id: 'site', accessorFn: (row: RfiSummary) => row.project.name, header: t('Site') } as ColumnDef<RfiSummary>]
      : []),
    {
      accessorKey: 'discipline',
      header: t('Discipline'),
      cell: ({ row }) => (
        <div className="flex flex-col items-start gap-1">
          <span>{t(RFI_DISCIPLINE_LABELS[row.original.discipline])}</span>
          {row.original.priority !== 'normal' && (
            <Badge tone={PRIORITY_TONE[row.original.priority]} dot={false}>
              {t(RFI_PRIORITY_LABELS[row.original.priority])}
            </Badge>
          )}
        </div>
      ),
    },
    {
      id: 'party',
      accessorFn: (row) => row.addressed_to.company ?? row.addressed_to.name ?? '',
      header: t('Addressed to'),
      cell: ({ row }) => (
        <div className="flex flex-col text-[13px]">
          <span>{row.original.addressed_to.name ?? '—'}</span>
          {row.original.addressed_to.company && (
            <span className="text-ink-muted">{row.original.addressed_to.company}</span>
          )}
        </div>
      ),
    },
    {
      accessorKey: 'due_on',
      header: t('Due'),
      cell: ({ row }) => <span className="text-[13px]">{row.original.due_on ? shortDate(row.original.due_on) : '—'}</span>,
    },
    {
      accessorKey: 'status',
      header: t('Status'),
      cell: ({ row }) => {
        const badge = rfiBadge(row.original);
        return (
          <div className="flex flex-col items-start gap-1">
            <Badge tone={badge.tone}>{t(badge.label)}</Badge>
            {row.original.change_order && (
              <span className="font-mono text-[12px] text-ink-muted" dir="ltr">
                {row.original.change_order.label}
              </span>
            )}
          </div>
        );
      },
    },
  ];
  return (
    <DataTable
      columns={columns}
      data={items}
      searchPlaceholder={t('Search RFIs')}
      pageSize={25}
      emptyMessage={t('No RFIs yet.')}
      onRowClick={(row) => router.push(`/rfis/${row.id}`)}
    />
  );
}
