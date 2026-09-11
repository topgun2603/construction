import { serverFetch } from '@/lib/server-api';
import { requireSelf } from '@/lib/session';
import { addDaysIso, money, todayIso } from '@/lib/format';
import type { Expense, ExpenseSummary, Page, ProjectSummary } from '@/lib/api-types';
import { FadeIn } from '@/components/motion';
import { StatTile } from '@/components/stat-tile';
import { RecordExpenseDialog } from './record-expense-dialog';
import { ExpensesTable } from './expenses-table';

export const metadata = { title: 'Expenses · BUILDR' };

/**
 * Site expenses and petty cash (spec §3 item 9).
 *
 * The default view is the approval queue — pending first — because that is the
 * only part of the screen anybody is blocked on.
 */
export default async function ExpensesPage() {
  const to = todayIso();
  const from = addDaysIso(to, -29);

  const [expenses, summary, projects, me] = await Promise.all([
    serverFetch<Page<Expense>>('/expenses?limit=200'),
    serverFetch<ExpenseSummary>(`/expenses/summary?group_by=category&from=${from}&to=${to}`),
    serverFetch<Page<ProjectSummary>>('/projects?limit=200'),
    requireSelf(),
  ]);

  const canApprove = ['owner', 'project_manager'].includes(me.user.role);
  const pending = expenses.items.filter((expense) => expense.status === 'pending');
  const pendingTotal = pending.reduce((sum, expense) => sum + BigInt(expense.amount), 0n);
  const topCategory = summary.groups[0];

  return (
    <FadeIn className="flex flex-col gap-5">
      <div className="grid gap-3.5 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile
          label="Spent, last 30 days"
          value={money(summary.total)}
          note={`${summary.groups.length} categories`}
        />
        <StatTile
          label="Awaiting approval"
          value={String(pending.length)}
          animate
          note={pending.length > 0 ? money(pendingTotal.toString()) : 'Nothing waiting'}
          noteTone={pending.length > 0 ? 'pending' : 'done'}
        />
        <StatTile
          label="Biggest category"
          value={topCategory ? money(topCategory.amount) : '—'}
          note={topCategory ? categoryLabel(topCategory.label) : 'No spend recorded'}
        />
        <StatTile
          label="Bills recorded"
          value={String(expenses.items.length)}
          animate
          note="All time"
        />
      </div>

      <div className="flex justify-end">
        <RecordExpenseDialog projects={projects.items} />
      </div>

      <ExpensesTable expenses={expenses.items} canApprove={canApprove} currentUserId={me.user.id} />
    </FadeIn>
  );
}

function categoryLabel(value: string): string {
  return value
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}
