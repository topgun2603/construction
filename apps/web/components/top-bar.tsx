'use client';

import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { APP_TIMEZONE } from '@sitebook/shared';
import { SearchCommand } from '@/components/search-command';
import { UserMenu } from '@/components/user-menu';

/*
 * The 56px header bar (design artboard 3a): page title, the current time in the
 * app's own timezone, search, and the account menu.
 */

const TITLES: Array<[prefix: string, title: string]> = [
  ['/overview', 'Today across all sites'],
  ['/projects', 'Sites'],
  ['/labour/workers', 'Workers'],
  ['/labour/attendance', 'Attendance'],
  ['/labour/wage-periods', 'Wage periods'],
  ['/labour/payments', 'Labour payments'],
  ['/indents', 'Approvals'],
  ['/expenses', 'Expenses'],
  ['/stock/movements', 'Stock ledger'],
  ['/stock', 'Stock'],
  // Longest prefix first: `/reports` would otherwise swallow its own sub-pages.
  ['/reports/attendance', 'Attendance register'],
  ['/reports/people', 'People'],
  ['/reports/overrun', 'Material overrun'],
  ['/reports/wage-sheet', 'Wage sheet'],
  ['/reports', 'Reports'],
  ['/settings', 'Settings'],
];

export function TopBar({
  userName,
  userPhone,
  userRole,
}: {
  userName: string;
  userPhone: string;
  userRole: string;
}) {
  const pathname = usePathname();
  const title = TITLES.find(([prefix]) => pathname.startsWith(prefix))?.[1] ?? 'BUILDR';

  return (
    <header className="sticky top-0 z-30 flex h-14 flex-none items-center gap-3 border-b border-line bg-surface px-6">
      <div className="flex min-w-0 flex-1 items-baseline gap-3">
        <h1 className="truncate text-[18px] font-semibold leading-tight">{title}</h1>
        <Clock />
      </div>

      <SearchCommand />
      <UserMenu
        name={userName}
        phone={userPhone}
        role={userRole}
        isOwner={userRole === 'owner'}
      />
    </header>
  );
}

/**
 * Rendered after mount, not on the server: the site clock must read in
 * Asia/Kolkata regardless of where the app is deployed, and a server-rendered
 * timestamp would hydrate stale and mismatch.
 */
function Clock() {
  const [now, setNow] = useState<string | null>(null);

  useEffect(() => {
    const format = () =>
      new Intl.DateTimeFormat('en-IN', {
        weekday: 'short',
        day: 'numeric',
        month: 'short',
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
        timeZone: APP_TIMEZONE,
      })
        .format(new Date())
        .replace(',', ' ·');

    setNow(format());
    const timer = setInterval(() => setNow(format()), 30_000);
    return () => clearInterval(timer);
  }, []);

  return (
    <span
      suppressHydrationWarning
      className="hidden whitespace-nowrap font-mono text-[13px] leading-tight text-ink-muted sm:inline"
    >
      {now ?? ''}
    </span>
  );
}
