'use client';

import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { CalendarDays } from 'lucide-react';
import { APP_TIMEZONE } from '@sitebook/shared';
import { SearchCommand } from '@/components/search-command';
import { NotificationBell, type NotificationRow } from '@/components/notification-bell';
import { UserMenu } from '@/components/user-menu';

/*
 * The header bar: who is here, what they are looking at, when it is, and the three controls that
 * belong to the whole app rather than to a page — search, the bell, and the account menu.
 *
 * The greeting above the title is not decoration. Every page in this product is a table of
 * somebody else's work, and the one line that says "you" is worth the 16px.
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
  notifications,
}: {
  userName: string;
  userPhone: string;
  userRole: string;
  notifications: NotificationRow[];
}) {
  const pathname = usePathname();
  const title = TITLES.find(([prefix]) => pathname.startsWith(prefix))?.[1] ?? 'BUILDR';
  const firstName = userName.trim().split(/\s+/)[0] ?? '';

  return (
    <header className="sticky top-0 z-30 flex flex-none items-center gap-4 border-b border-line bg-surface px-6 py-3.5">
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-[12.5px] leading-tight text-ink-muted">
          Welcome back{firstName ? `, ${firstName}` : ''}!
        </span>
        <div className="flex min-w-0 flex-wrap items-center gap-3">
          <h1 className="truncate text-[21px] font-bold leading-tight tracking-[-0.02em]">
            {title}
          </h1>
          <Clock />
        </div>
      </div>

      <SearchCommand />
      <NotificationBell items={notifications} />
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

  // Nothing at all until it has mounted: an empty pill with a calendar icon in it reads as a
  // control that failed to load.
  if (!now) return null;

  return (
    <span
      suppressHydrationWarning
      className="hidden items-center gap-2 whitespace-nowrap rounded-full bg-neutral-bg px-3 py-1 font-mono text-[12.5px] leading-tight text-ink-soft sm:inline-flex"
    >
      <CalendarDays className="size-3.5 text-ink-faint" />
      {now}
    </span>
  );
}
