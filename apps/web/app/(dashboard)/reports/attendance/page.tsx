import { CalendarRange } from 'lucide-react';
import { serverFetch } from '@/lib/server-api';
import { requireSelf } from '@/lib/session';
import type { AttendanceRegister } from '@/lib/api-types';
import { ATTENDANCE_REGISTER_MAX_DAYS } from '@sitebook/shared';
import { addDaysIso, moneyShort, shortDate, todayIso } from '@/lib/format';
import { EmptyState } from '@/components/ui/empty-state';
import { FadeIn } from '@/components/motion';
import { StatTile } from '@/components/stat-tile';
import { ReportsNav } from '../reports-nav';
import { RegisterGrid } from './register-grid';

export const metadata = { title: 'Attendance register · BUILDR' };

/**
 * The attendance register for a period — the muster roll (spec §8A).
 *
 * This is the sheet you put in front of a contractor who disputes a wage payment, so
 * it shows the individual days rather than only the total. Every figure comes from the
 * wage snapshot frozen on the attendance row, so it agrees with the wage sheet to the
 * paisa and does not move if somebody later edits a worker's daily rate.
 */
export default async function AttendanceRegisterPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const params = await searchParams;
  const to = params.to ?? todayIso();

  /*
   * A month by default, and a month at most.
   *
   * The range is shared across the report tabs, so arriving here from a six-month labour
   * cost view would otherwise send a range the API rejects. Clamping beats a 422: the
   * reader asked for this report, not for an error about the range they set on a
   * different one. `to` is kept and `from` pulled forward, because the recent end is the
   * one people are looking at.
   */
  const requestedFrom = params.from ?? addDaysIso(to, -(ATTENDANCE_REGISTER_MAX_DAYS - 1));
  const earliest = addDaysIso(to, -(ATTENDANCE_REGISTER_MAX_DAYS - 1));
  const from = requestedFrom < earliest ? earliest : requestedFrom;
  const clamped = from !== requestedFrom;

  const [register, me] = await Promise.all([
    serverFetch<AttendanceRegister>(`/reports/attendance-register?from=${from}&to=${to}`),
    requireSelf(),
  ]);

  const isOwnerOrAccounts = ['owner', 'accounts'].includes(me.user.role);

  return (
    <FadeIn className="flex flex-col gap-5">
      <ReportsNav
        from={from}
        to={to}
        isOwnerOrAccounts={isOwnerOrAccounts}
        maxDays={ATTENDANCE_REGISTER_MAX_DAYS}
      />

      {clamped && (
        <p className="rounded-btn bg-pending-bg px-3 py-2 text-[13px] leading-snug text-pending-fg">
          The register shows at most {ATTENDANCE_REGISTER_MAX_DAYS} days at a time, so this
          is {shortDate(from)} to {shortDate(to)}. A wider range needs the labour cost
          report, which totals rather than listing each day.
        </p>
      )}

      <div className="grid gap-3.5 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile
          label="Workers on the roll"
          value={String(register.totals.worker_count)}
          note={`${register.dates.length} days · ${shortDate(from)} – ${shortDate(to)}`}
        />
        <StatTile
          label="Worker-days"
          value={register.totals.days_present}
          note="Half days count as 0.5"
        />
        <StatTile
          label="Overtime hours"
          value={register.totals.overtime_hours}
          note="Paid on top of the day rate"
        />
        <StatTile
          label="Earned in range"
          value={moneyShort(register.totals.earned)}
          note="From the frozen wage snapshots"
        />
      </div>

      {register.workers.length === 0 ? (
        <EmptyState
          icon={<CalendarRange />}
          title="No attendance in this period"
          body="Pick a wider range, or take a roll call to start building the register."
        />
      ) : (
        <RegisterGrid register={register} />
      )}
    </FadeIn>
  );
}
