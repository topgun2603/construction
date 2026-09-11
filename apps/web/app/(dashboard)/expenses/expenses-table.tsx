'use client';

import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import { Check, X } from 'lucide-react';
import { toast } from 'sonner';
import { expenseCategoryLabel } from '@sitebook/shared';
import { decideExpense, discardExpense } from '@/lib/actions';
import { DataTable } from '@/components/data-table';
import { DeleteRowButton } from '@/components/delete-row-button';
import { Badge, type Tone } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { money, shortDate, titleCase } from '@/lib/format';
import type { Expense } from '@/lib/api-types';

const STATUS_TONE: Record<Expense['status'], Tone> = {
  pending: 'pending',
  approved: 'done',
  rejected: 'blocked',
};

export function ExpensesTable({
  expenses,
  canApprove,
  currentUserId,
}: {
  expenses: Expense[];
  canApprove: boolean;
  currentUserId: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();

  function decide(id: string, status: 'approved' | 'rejected') {
    start(async () => {
      const result = await decideExpense(id, status);
      if (!result.ok) {
        toast.error(result.error ?? 'Could not update the expense');
        return;
      }
      toast.success(status === 'approved' ? 'Expense approved' : 'Expense rejected');
      router.refresh();
    });
  }

  const columns: ColumnDef<Expense>[] = [
    {
      accessorKey: 'spent_on',
      header: 'Spent on',
      cell: ({ row }) => (
        <span className="font-mono text-[13px]">{shortDate(row.original.spent_on)}</span>
      ),
    },
    {
      accessorKey: 'project_name',
      header: 'Site',
      cell: ({ row }) => <span className="font-medium">{row.original.project_name}</span>,
    },
    {
      accessorKey: 'category',
      header: 'Category',
      cell: ({ row }) => (
        <Badge tone="neutral" dot={false}>
          {expenseCategoryLabel(row.original.category)}
        </Badge>
      ),
    },
    {
      accessorKey: 'note',
      header: 'Note',
      cell: ({ row }) => (
        <span className="line-clamp-1 max-w-[280px] text-ink-soft">
          {row.original.note ?? '—'}
        </span>
      ),
    },
    {
      id: 'submitted_by',
      header: 'Recorded by',
      accessorFn: (row) => row.submitted_by.name,
      cell: ({ row }) => (
        <span className="text-ink-muted">{row.original.submitted_by.name}</span>
      ),
    },
    {
      accessorKey: 'amount',
      header: 'Amount',
      meta: { align: 'right' },
      // Sort on the paise integer; the rendered string would sort lexically.
      sortingFn: (a, b) => Number(BigInt(a.original.amount) - BigInt(b.original.amount)),
      cell: ({ row }) => (
        <span className="font-mono font-semibold">{money(row.original.amount)}</span>
      ),
    },
    {
      accessorKey: 'status',
      header: 'Status',
      cell: ({ row }) => (
        <Badge tone={STATUS_TONE[row.original.status]}>{titleCase(row.original.status)}</Badge>
      ),
    },
    {
      id: 'decision',
      header: '',
      cell: ({ row }) => {
        const expense = row.original;
        if (expense.status !== 'pending') return null;
        // Nobody signs off their own spend — the API refuses it, so the buttons
        // should not be there to click.
        if (!canApprove || expense.submitted_by.id === currentUserId) {
          return <span className="text-[12.5px] text-ink-faint">Awaiting approval</span>;
        }
        return (
          <div className="flex justify-end gap-1.5">
            <Button
              variant="approve"
              size="sm"
              disabled={pending}
              onClick={() => decide(expense.id, 'approved')}
            >
              <Check /> Approve
            </Button>
            <Button
              variant="secondary"
              size="sm"
              disabled={pending}
              onClick={() => decide(expense.id, 'rejected')}
            >
              <X />
            </Button>
          </div>
        );
      },
      meta: { align: 'right' },
    },
    {
      id: 'actions',
      header: '',
      enableSorting: false,
      meta: { align: 'right' },
      cell: ({ row }) => {
        const expense = row.original;
        // An approved expense is settled money; the API refuses to delete it and
        // points you at rejection instead, so there is nothing to offer here.
        if (expense.status === 'approved') return null;
        return (
          <DeleteRowButton
            what={`this ${expenseCategoryLabel(expense.category).toLowerCase()} expense`}
            title="Discard this expense?"
            body={
              <>
                <strong className="font-semibold text-ink">{money(expense.amount)}</strong> on{' '}
                {expenseCategoryLabel(expense.category).toLowerCase()} at {expense.project_name}{' '}
                will be removed from the books.
              </>
            }
            confirmLabel="Discard expense"
            successMessage="Expense discarded"
            onConfirm={() => discardExpense(expense.id)}
          />
        );
      },
    },
  ];

  return (
    <DataTable
      columns={columns}
      data={expenses}
      searchPlaceholder="Search sites, categories, notes"
      pageSize={25}
      emptyMessage="No expenses recorded yet."
    />
  );
}
