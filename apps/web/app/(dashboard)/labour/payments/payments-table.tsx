'use client';

import type { ColumnDef } from '@tanstack/react-table';
import { DataTable } from '@/components/data-table';
import { DeleteRowButton } from '@/components/delete-row-button';
import { deletePayment } from '@/lib/actions';
import { Badge, type Tone } from '@/components/ui/badge';
import { money, shortDate, titleCase } from '@/lib/format';
import type { LabourPayment } from '@/lib/api-types';

const TYPE_TONE: Record<LabourPayment['type'], Tone> = {
  wage: 'done',
  advance: 'pending',
  bonus: 'accent',
  deduction: 'blocked',
};

const columns: ColumnDef<LabourPayment>[] = [
  {
    accessorKey: 'paid_on',
    header: 'Date',
    cell: ({ row }) => <span className="font-mono text-[13px]">{shortDate(row.original.paid_on)}</span>,
  },
  {
    id: 'payee',
    header: 'Paid to',
    accessorFn: (row) => row.worker_name ?? row.contractor_name ?? '',
    cell: ({ row }) => (
      <div className="flex flex-col">
        <span className="font-medium">
          {row.original.worker_name ?? row.original.contractor_name ?? '—'}
        </span>
        {row.original.worker_name && row.original.contractor_name && (
          <span className="text-[12.5px] text-ink-muted">{row.original.contractor_name}</span>
        )}
      </div>
    ),
  },
  {
    accessorKey: 'type',
    header: 'Type',
    cell: ({ row }) => (
      <Badge tone={TYPE_TONE[row.original.type]}>{titleCase(row.original.type)}</Badge>
    ),
  },
  {
    accessorKey: 'mode',
    header: 'Mode',
    cell: ({ row }) => (
      <span className="text-ink-muted">{row.original.mode.toUpperCase()}</span>
    ),
  },
  {
    accessorKey: 'reference',
    header: 'Reference',
    cell: ({ row }) => (
      <span className="font-mono text-[12.5px] text-ink-muted">
        {row.original.reference ?? '—'}
      </span>
    ),
  },
  {
    accessorKey: 'amount',
    header: 'Amount',
    meta: { align: 'right' },
    sortingFn: (a, b) => Number(BigInt(a.original.amount) - BigInt(b.original.amount)),
    cell: ({ row }) => (
      <span className="font-mono font-semibold">{money(row.original.amount)}</span>
    ),
  },
  {
    id: 'actions',
    header: '',
    enableSorting: false,
    meta: { align: 'right' },
    cell: ({ row }) => {
      const payment = row.original;
      // Anything a wage sheet has consumed is part of that sheet's arithmetic, so the
      // API refuses to delete it — there is no button to offer.
      if (payment.wage_period_id) return null;
      const who = payment.worker_name ?? payment.contractor_name ?? 'this entry';
      return (
        <DeleteRowButton
          what={`the ${money(payment.amount)} ${payment.type}`}
          title="Delete this entry?"
          body={
            <>
              <strong className="font-semibold text-ink">{money(payment.amount)}</strong>{' '}
              {payment.type} for {who} is removed. Nothing has been deducted against it yet.
            </>
          }
          confirmLabel="Delete entry"
          successMessage="Entry deleted"
          onConfirm={() => deletePayment(payment.id)}
        />
      );
    },
  },
];

export function PaymentsTable({ payments }: { payments: LabourPayment[] }) {
  return (
    <DataTable
      columns={columns}
      data={payments}
      searchPlaceholder="Search people, references"
      pageSize={25}
      emptyMessage="No payments recorded yet."
    />
  );
}
