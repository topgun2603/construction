import { UserCog } from 'lucide-react';
import { serverFetch } from '@/lib/server-api';
import { requireSelf } from '@/lib/session';
import type { PersonLedger } from '@/lib/api-types';
import { addDaysIso, moneyShort, todayIso } from '@/lib/format';
import { EmptyState } from '@/components/ui/empty-state';
import { FadeIn } from '@/components/motion';
import { StatTile } from '@/components/stat-tile';
import { ReportsNav } from '../reports-nav';
import { PeopleTable } from './people-table';

export const metadata = { title: 'People · BUILDR' };

/**
 * What each person committed on the company's behalf over a period.
 *
 * Deliberately not called a profit and loss per person. A supervisor does not earn the
 * company money in any figure this system holds, and a column implying otherwise would
 * be read as a verdict on them. What it does show is the money that passed through
 * their hands — expenses recorded, indents raised, labour booked — which is the
 * question an owner is actually asking when they ask for this.
 */
export default async function PeopleReportPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const params = await searchParams;
  const to = params.to ?? todayIso();
  const from = params.from ?? addDaysIso(to, -29);

  const [ledger, me] = await Promise.all([
    serverFetch<PersonLedger>(`/reports/person-ledger?from=${from}&to=${to}`),
    requireSelf(),
  ]);

  const pending = BigInt(ledger.totals.expenses_pending);

  return (
    <FadeIn className="flex flex-col gap-5">
      <ReportsNav from={from} to={to} isOwnerOrAccounts />

      <div className="grid gap-3.5 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile
          label="Expenses approved"
          value={moneyShort(ledger.totals.expenses_approved)}
          note="Signed off in this range"
          noteTone="done"
        />
        <StatTile
          label="Expenses pending"
          value={moneyShort(ledger.totals.expenses_pending)}
          note={pending > 0n ? 'Still waiting on a decision' : 'Nothing waiting'}
          noteTone={pending > 0n ? 'pending' : 'neutral'}
        />
        <StatTile
          label="Labour booked"
          value={moneyShort(ledger.totals.labour_booked)}
          note="Through their roll calls"
        />
        <StatTile
          label="Indents raised"
          value={String(ledger.totals.indents_raised)}
          note={`${ledger.totals.reports_filed} reports filed`}
        />
      </div>

      {ledger.people.length === 0 ? (
        <EmptyState
          icon={<UserCog />}
          title="Nobody recorded anything in this period"
          body="Once supervisors start filing reports, taking roll calls and recording expenses, their activity shows up here."
        />
      ) : (
        <PeopleTable ledger={ledger} currentUserId={me.user.id} />
      )}
    </FadeIn>
  );
}
