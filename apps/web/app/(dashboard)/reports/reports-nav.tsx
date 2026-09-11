'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useRouter } from 'next/navigation';
import { CalendarRange, PieChart, UserCog, Warehouse, type LucideIcon } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

/**
 * The reports sub-nav and the date range, shared by every report.
 *
 * The range travels with you when you switch report: having picked last month on the
 * labour cost screen, you almost always want the register for last month too, and
 * re-entering two dates at every hop is the kind of friction that stops people using
 * reports at all.
 */
interface Tab {
  href: string;
  label: string;
  icon: LucideIcon;
  /** People is a judgement on individuals, so it is owner and accounts only. */
  ownerOnly?: boolean;
}

const TABS: Tab[] = [
  { href: '/reports', label: 'Labour cost', icon: PieChart },
  { href: '/reports/attendance', label: 'Attendance register', icon: CalendarRange },
  { href: '/reports/overrun', label: 'Material overrun', icon: Warehouse },
  { href: '/reports/people', label: 'People', icon: UserCog, ownerOnly: true },
];

export function ReportsNav({
  from,
  to,
  isOwnerOrAccounts,
  maxDays,
  extraParams,
}: {
  from: string;
  to: string;
  isOwnerOrAccounts: boolean;
  /** Params this report owns (the labour cost grouping) that must survive a range change. */
  extraParams?: Record<string, string>;
  /**
   * Longest span this report accepts. The attendance register is a grid with a column
   * per day, so it caps at a month; the others are aggregates and have no limit.
   */
  maxDays?: number;
}) {
  const pathname = usePathname();
  const router = useRouter();

  /**
   * Moving one end drags the other when the span would exceed the limit, rather than
   * refusing the change. Someone widening a range has told you which end they care
   * about — the one they just touched — so that is the end that stays put.
   */
  function setRange(next: { from?: string; to?: string }) {
    let nextFrom = next.from ?? from;
    let nextTo = next.to ?? to;

    if (maxDays && nextFrom && nextTo) {
      if (nextTo < nextFrom) {
        // Crossed over: collapse to a single day rather than send an invalid pair.
        if (next.from) nextTo = nextFrom;
        else nextFrom = nextTo;
      }
      if (spanDays(nextFrom, nextTo) > maxDays) {
        if (next.from) nextTo = addDays(nextFrom, maxDays - 1);
        else nextFrom = addDays(nextTo, -(maxDays - 1));
      }
    }

    const query = new URLSearchParams({ ...extraParams, from: nextFrom, to: nextTo });
    router.push(`${pathname}?${query.toString()}`);
  }

  // Bounds on the inputs themselves, so the out-of-range date is not offered in the
  // native picker at all. The clamp above is still needed for a typed or pasted date.
  const fromMin = maxDays ? addDays(to, -(maxDays - 1)) : undefined;
  const toMax = maxDays ? addDays(from, maxDays - 1) : undefined;

  const tabs = TABS.filter((tab) => !tab.ownerOnly || isOwnerOrAccounts);

  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <nav className="flex gap-1 rounded-btn bg-neutral-bg p-1">
        {tabs.map((tab) => {
          const active = pathname === tab.href;
          const Icon = tab.icon;
          return (
            <Link
              key={tab.href}
              href={`${tab.href}?from=${from}&to=${to}`}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'flex items-center gap-2 rounded-[7px] px-3 py-2 text-[13px] font-medium transition',
                active
                  ? 'bg-surface font-semibold text-ink shadow-seg'
                  : 'text-ink-soft hover:text-ink',
              )}
            >
              <Icon className="size-4" />
              {tab.label}
            </Link>
          );
        })}
      </nav>

      <div className="flex items-center gap-2">
        <Input
          type="date"
          value={from}
          max={to}
          {...(fromMin ? { min: fromMin } : {})}
          onChange={(event) => setRange({ from: event.target.value })}
          className="w-[165px]"
          aria-label="From date"
        />
        <span className="text-ink-muted">→</span>
        <Input
          type="date"
          value={to}
          min={from}
          {...(toMax ? { max: toMax } : {})}
          onChange={(event) => setRange({ to: event.target.value })}
          className="w-[165px]"
          aria-label="To date"
        />
        {maxDays && (
          <span className="text-[12px] text-ink-muted">
            {spanDays(from, to)} of {maxDays} days
          </span>
        )}
      </div>
    </div>
  );
}

/** Inclusive day count between two ISO dates. */
function spanDays(from: string, to: string): number {
  const start = Date.parse(`${from}T00:00:00.000Z`);
  const end = Date.parse(`${to}T00:00:00.000Z`);
  if (Number.isNaN(start) || Number.isNaN(end)) return 0;
  return Math.round((end - start) / 86_400_000) + 1;
}

/**
 * Shift an ISO date by whole days.
 *
 * Arithmetic in UTC on purpose: these are plain calendar dates with no zone, and adding
 * 24h to a local date would skip or repeat a day across a DST boundary in any zone that
 * has one.
 */
function addDays(iso: string, days: number): string {
  const date = new Date(`${iso}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
