'use client';

import { useRouter } from 'next/navigation';
import type { ColumnDef } from '@tanstack/react-table';
import { CHANGE_ORDER_REASON_LABELS } from '@sitebook/shared';
import { DataTable } from '@/components/data-table';
import { Badge } from '@/components/ui/badge';
import { useFormat } from '@/components/format-provider';
import { useLanguage } from '@/components/language-provider';
import type { ChangeOrderSummary } from '@/lib/change-order-types';
import { CHANGE_ORDER_STATUS, changeOrderDaysText } from './labels';

/**
 * The change order register as a table: company-wide on /change-orders, one site's on its tab.
 * Cost and client price side by side, because the gap between them is what the change earns.
 */
export function ChangeOrdersTable({
  changeOrders,
  showSite = true,
}: {
  changeOrders: ChangeOrderSummary[];
  showSite?: boolean;
}) {
  const { t } = useLanguage();
  const { money, shortDate } = useFormat();
  const router = useRouter();

  const amount = (value: string) => <span className="font-mono text-[13px]">{money(value)}</span>;

  const columns: ColumnDef<ChangeOrderSummary>[] = [
    {
      accessorKey: 'label',
      header: t('Change order'),
      cell: ({ row }) => (
        <div className="flex flex-col">
          <span className="font-medium">{row.original.title}</span>
          <span className="text-[12px] text-ink-muted">
            <span className="font-mono" dir="ltr">
              {row.original.label}
            </span>{' '}
            · {t(CHANGE_ORDER_REASON_LABELS[row.original.reason])} · {shortDate(row.original.raised_on)}
          </span>
        </div>
      ),
    },
    ...(showSite
      ? [
          {
            id: 'site',
            accessorFn: (row: ChangeOrderSummary) => row.project.name,
            header: t('Site'),
          } satisfies ColumnDef<ChangeOrderSummary>,
        ]
      : []),
    {
      accessorKey: 'status',
      header: t('Status'),
      cell: ({ row }) => {
        const status = CHANGE_ORDER_STATUS[row.original.status];
        return <Badge tone={status.tone}>{t(status.label)}</Badge>;
      },
    },
    {
      id: 'cost',
      accessorFn: (row) => Number(row.cost_impact),
      header: () => <span className="block text-end">{t('Cost impact')}</span>,
      cell: ({ row }) => <div className="text-end">{amount(row.original.cost_impact)}</div>,
    },
    {
      id: 'price',
      accessorFn: (row) => Number(row.client_price),
      header: () => <span className="block text-end">{t('Client price')}</span>,
      cell: ({ row }) => <div className="text-end">{amount(row.original.client_price)}</div>,
    },
    {
      id: 'days',
      accessorFn: (row) => row.time_impact_days,
      header: () => <span className="block text-end">{t('Time')}</span>,
      cell: ({ row }) => (
        <div className="text-end font-mono text-[13px]">{changeOrderDaysText(row.original.time_impact_days, t)}</div>
      ),
    },
  ];

  return (
    <DataTable
      columns={columns}
      data={changeOrders}
      searchPlaceholder={t('Search change orders')}
      emptyMessage={t('No change orders yet.')}
      onRowClick={(row) => router.push(`/change-orders/${row.id}`)}
    />
  );
}
