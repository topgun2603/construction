'use client';

import { useRouter } from 'next/navigation';
import type { ColumnDef } from '@tanstack/react-table';
import { DataTable } from '@/components/data-table';
import { Badge } from '@/components/ui/badge';
import { useFormat } from '@/components/format-provider';
import { useLanguage } from '@/components/language-provider';
import type { SubcontractSummary } from '@/lib/subcontract-types';
import { BILL_STATUS, SUBCONTRACT_STATUS } from './labels';

/**
 * Subcontracts as a table: company-wide on /subcontracts, one site's on its Subcontracts tab. The
 * money columns are left out for somebody who measures work but cannot see what it is worth.
 */
export function SubcontractsTable({
  subcontracts,
  showSite = true,
}: {
  subcontracts: SubcontractSummary[];
  showSite?: boolean;
}) {
  const { t } = useLanguage();
  const { money } = useFormat();
  const router = useRouter();
  const showMoney = subcontracts.some((row) => row.current_value !== null);

  const amount = (value: string | null) => (
    <span className="font-mono text-[13px]">{value === null ? '—' : money(value)}</span>
  );

  const columns: ColumnDef<SubcontractSummary>[] = [
    {
      accessorKey: 'number',
      header: t('Subcontract'),
      cell: ({ row }) => (
        <div className="flex flex-col">
          <span className="font-medium">{row.original.title}</span>
          <span className="font-mono text-[12px] text-ink-muted" dir="ltr">
            {row.original.number}
          </span>
        </div>
      ),
    },
    {
      id: 'contractor',
      accessorFn: (row) => row.contractor.name,
      header: t('Subcontractor'),
    },
    ...(showSite
      ? [
          {
            id: 'site',
            accessorFn: (row: SubcontractSummary) => row.project.name,
            header: t('Site'),
          } satisfies ColumnDef<SubcontractSummary>,
        ]
      : []),
    {
      accessorKey: 'status',
      header: t('Status'),
      cell: ({ row }) => {
        const status = SUBCONTRACT_STATUS[row.original.status];
        const bill = row.original.open_bill;
        return (
          <div className="flex flex-col items-start gap-1">
            <Badge tone={status.tone}>{t(status.label)}</Badge>
            {bill && (
              <span className="text-[12px] text-ink-muted">
                RA-{bill.number} · {t(BILL_STATUS[bill.status].label)}
              </span>
            )}
          </div>
        );
      },
    },
    ...(showMoney
      ? ([
          {
            id: 'value',
            accessorFn: (row) => Number(row.current_value ?? 0),
            header: () => <span className="block text-end">{t('Contract value')}</span>,
            cell: ({ row }) => <div className="text-end">{amount(row.original.current_value)}</div>,
          },
          {
            id: 'certified',
            accessorFn: (row) => Number(row.certified ?? 0),
            header: () => <span className="block text-end">{t('Certified')}</span>,
            cell: ({ row }) => <div className="text-end">{amount(row.original.certified)}</div>,
          },
          {
            id: 'due',
            accessorFn: (row) => Number(row.balance_due ?? 0),
            header: () => <span className="block text-end">{t('Balance due')}</span>,
            cell: ({ row }) => <div className="text-end">{amount(row.original.balance_due)}</div>,
          },
        ] satisfies ColumnDef<SubcontractSummary>[])
      : []),
  ];

  return (
    <DataTable
      columns={columns}
      data={subcontracts}
      searchPlaceholder={t('Search subcontracts')}
      emptyMessage={t('No subcontracts yet.')}
      onRowClick={(row) => router.push(`/subcontracts/${row.id}`)}
    />
  );
}
