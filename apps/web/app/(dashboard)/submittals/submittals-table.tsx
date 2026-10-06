'use client';

import { useRouter } from 'next/navigation';
import type { ColumnDef } from '@tanstack/react-table';
import { SUBMITTAL_TYPE_LABELS } from '@sitebook/shared';
import { DataTable } from '@/components/data-table';
import { Badge } from '@/components/ui/badge';
import { useFormat } from '@/components/format-provider';
import { useLanguage } from '@/components/language-provider';
import type { SubmittalSummary } from '@/lib/rfi-types';
import { submittalBadge } from '../rfis/labels';

/** The submittal log as a table, company-wide on /submittals and one site's on its Design tab. */
export function SubmittalsTable({ items, showSite = true }: { items: SubmittalSummary[]; showSite?: boolean }) {
  const { t } = useLanguage();
  const { shortDate } = useFormat();
  const router = useRouter();
  const columns: ColumnDef<SubmittalSummary>[] = [
    {
      accessorKey: 'title',
      header: t('Submittal'),
      cell: ({ row }) => (
        <div className="flex flex-col">
          <span className="font-medium">{row.original.title}</span>
          <span className="font-mono text-[12px] text-ink-muted" dir="ltr">
            {row.original.label}
            {row.original.spec_section ? ` · ${row.original.spec_section}` : ''}
          </span>
        </div>
      ),
    },
    ...(showSite
      ? [
          {
            id: 'site',
            accessorFn: (row: SubmittalSummary) => row.project.name,
            header: t('Site'),
          } as ColumnDef<SubmittalSummary>,
        ]
      : []),
    {
      accessorKey: 'type',
      header: t('Type'),
      cell: ({ row }) => <span className="text-[13px]">{t(SUBMITTAL_TYPE_LABELS[row.original.type])}</span>,
    },
    {
      id: 'party',
      accessorFn: (row) => row.submitted_by ?? '',
      header: t('From'),
      cell: ({ row }) => <span className="text-[13px]">{row.original.submitted_by ?? '—'}</span>,
    },
    {
      id: 'reviewer',
      accessorFn: (row) => row.reviewer.company ?? row.reviewer.name ?? '',
      header: t('Reviewer'),
      cell: ({ row }) => (
        <span className="text-[13px]">
          {row.original.reviewer.kind === 'client'
            ? t('Client')
            : (row.original.reviewer.company ?? row.original.reviewer.name ?? '—')}
        </span>
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
        const badge = submittalBadge(row.original);
        return <Badge tone={badge.tone}>{t(badge.label)}</Badge>;
      },
    },
  ];
  return (
    <DataTable
      columns={columns}
      data={items}
      searchPlaceholder={t('Search submittals')}
      pageSize={25}
      emptyMessage={t('No submittals yet.')}
      onRowClick={(row) => router.push(`/submittals/${row.id}`)}
    />
  );
}
