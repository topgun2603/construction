import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, HardHat } from 'lucide-react';
import { ApiRequestError } from '@/lib/api';
import { serverFetch } from '@/lib/server-api';
import type { WorkerLedger } from '@/lib/api-types';
import { money, shortDate, titleCase } from '@/lib/format';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { FadeIn } from '@/components/motion';
import { StatTile } from '@/components/stat-tile';
import { LedgerRange } from './ledger-range';
import { SelfServiceLink } from './self-service-link';

export const metadata = { title: 'Worker · BUILDR' };

/**
 * One worker's account: what they have earned, what they have been paid, and what is
 * still owed (spec §3 item 8).
 *
 * Earnings come from the wage snapshot frozen on each attendance row, never from the
 * worker's current daily wage — so a rate change today does not quietly rewrite what
 * last month's work was worth.
 *
 * Bonus sits on the earned side and everything else on the paid side, which is why the
 * running balance is the number that matters rather than a simple sum of payments.
 */
export default async function WorkerPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const { id } = await params;
  const { from, to } = await searchParams;

  const query = new URLSearchParams();
  if (from) query.set('from', from);
  if (to) query.set('to', to);
  const suffix = query.toString() ? `?${query.toString()}` : '';

  let ledger: WorkerLedger;
  try {
    ledger = await serverFetch<WorkerLedger>(`/workers/${id}/ledger${suffix}`);
  } catch (error) {
    if (error instanceof ApiRequestError && (error.status === 404 || error.status === 403)) {
      notFound();
    }
    throw error;
  }

  const { worker } = ledger;
  const outstanding = BigInt(ledger.outstanding);

  return (
    <FadeIn className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-1.5">
          <Link
            href="/labour/workers"
            className="flex items-center gap-1.5 text-[13px] text-ink-muted hover:text-ink"
          >
            <ArrowLeft className="size-3.5" />
            Workers
          </Link>
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="text-[22px] font-semibold leading-tight">{worker.name}</h2>
            <Badge tone={worker.status === 'active' ? 'done' : 'neutral'}>
              {titleCase(worker.status)}
            </Badge>
          </div>
          <span className="text-[13.5px] text-ink-muted">
            {[
              worker.trade,
              worker.skill_level ? titleCase(worker.skill_level) : null,
              worker.contractor_name ?? 'Direct labour',
              worker.phone ? `+${worker.phone}` : null,
            ]
              .filter(Boolean)
              .join(' · ')}
          </span>
        </div>
        <LedgerRange from={from ?? null} to={to ?? null} workerId={id} />
      </div>

      <SelfServiceLink
        workerId={id}
        workerName={worker.name}
        phone={worker.phone ?? null}
      />

      <div className="grid gap-3.5 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile
          label="Earned"
          value={money(ledger.total_earned)}
          note="Attendance plus bonus"
        />
        <StatTile label="Paid" value={money(ledger.total_paid)} note="Wages, advances, deductions" />
        <StatTile
          label={outstanding >= 0n ? 'Still owed' : 'Paid ahead'}
          value={money((outstanding < 0n ? -outstanding : outstanding).toString())}
          note={
            outstanding > 0n
              ? 'Due to this worker'
              : outstanding === 0n
                ? 'Settled'
                : 'Advance not yet worked off'
          }
          noteTone={outstanding > 0n ? 'pending' : outstanding === 0n ? 'done' : 'blocked'}
        />
        <StatTile
          label="Day rate"
          value={money(worker.daily_wage)}
          note={`${money(worker.overtime_rate_per_hour)} per OT hour`}
        />
      </div>

      {ledger.entries.length === 0 ? (
        <EmptyState
          icon={<HardHat />}
          title="Nothing on this worker's account yet"
          body="Attendance and payments appear here as they are recorded. Widen the date range if you were expecting history."
        />
      ) : (
        <LedgerTable ledger={ledger} />
      )}
    </FadeIn>
  );
}

/**
 * The running account, oldest first.
 *
 * Oldest first rather than newest: this is read to follow how a balance got to where
 * it is, and a running total that counts backwards from the answer is unreadable.
 */
function LedgerTable({ ledger }: { ledger: WorkerLedger }) {
  return (
    <Card className="flex flex-col">
      <div className="flex items-center justify-between gap-3 border-b border-line-soft px-4 py-3">
        <span className="text-[12px] font-semibold uppercase tracking-[0.08em] text-ink-muted">
          Account
        </span>
        <span className="font-mono text-[13px] text-ink-muted">
          {ledger.entries.length} {ledger.entries.length === 1 ? 'entry' : 'entries'}
        </span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-[13.5px]">
          <thead>
            <tr className="border-b border-line-soft text-[12px] uppercase tracking-[0.06em] text-ink-muted">
              <th className="px-4 py-2.5 text-left font-semibold">Date</th>
              <th className="px-3 py-2.5 text-left font-semibold">Entry</th>
              <th className="px-3 py-2.5 text-right font-semibold">Earned</th>
              <th className="px-3 py-2.5 text-right font-semibold">Paid</th>
              <th className="px-4 py-2.5 text-right font-semibold">Balance</th>
            </tr>
          </thead>
          <tbody>
            {ledger.entries.map((entry) => {
              const earned = BigInt(entry.earned);
              const paid = BigInt(entry.paid);
              const balance = BigInt(entry.balance);
              return (
                <tr key={`${entry.kind}-${entry.id}`} className="border-b border-line-soft last:border-0 hover:bg-raised">
                  <td className="whitespace-nowrap px-4 py-2.5 font-mono text-ink-muted">
                    {shortDate(entry.date)}
                  </td>
                  <td className="px-3 py-2.5">
                    <span className="flex items-center gap-2">
                      <Badge
                        tone={entry.kind === 'attendance' ? 'neutral' : 'accent'}
                        dot={false}
                      >
                        {entry.kind === 'attendance' ? 'Work' : 'Cash'}
                      </Badge>
                      <span className="capitalize">{entry.label}</span>
                      {typeof entry.detail['overtime_hours'] === 'string' &&
                        Number(entry.detail['overtime_hours']) > 0 && (
                          <span className="font-mono text-[12px] text-accent">
                            +{entry.detail['overtime_hours']}h OT
                          </span>
                        )}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-right font-mono">
                    {earned > 0n ? money(entry.earned) : <span className="text-ink-faint">—</span>}
                  </td>
                  <td className="px-3 py-2.5 text-right font-mono">
                    {paid > 0n ? money(entry.paid) : <span className="text-ink-faint">—</span>}
                  </td>
                  <td
                    className={`px-4 py-2.5 text-right font-mono font-semibold ${
                      balance < 0n ? 'text-blocked-fg' : ''
                    }`}
                  >
                    {money(entry.balance)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
