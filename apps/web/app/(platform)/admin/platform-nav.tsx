'use client';

import Link from 'next/link';
import { useTransition } from 'react';
import { usePathname } from 'next/navigation';
import { BarChart3, Building2, LogOut, ShieldCheck, Tag } from 'lucide-react';
import { platformSignOut } from '@/lib/platform-actions';
import { BlockingOverlay } from '@/components/ui/blocking-overlay';
import { cn } from '@/lib/utils';

/**
 * The console's tabs and its sign-out.
 *
 * `/admin/tenants/<id>` highlights Tenants rather than nothing, so a detail page still
 * says where you are in the console — hence the prefix match on everything but the root.
 */
const TABS = [
  { href: '/admin', label: 'Overview', icon: BarChart3, exact: true },
  { href: '/admin/tenants', label: 'Tenants', icon: Building2, exact: false },
  { href: '/admin/plans', label: 'Plans', icon: Tag, exact: false },
  { href: '/admin/operators', label: 'Operators', icon: ShieldCheck, exact: false },
];

export function PlatformNav() {
  const pathname = usePathname();
  const [signingOut, startSignOut] = useTransition();

  return (
    <div className="flex min-w-0 flex-1 items-center justify-between gap-4">
      {/* Cheaper than the dashboard's sign-out — there is no token to revoke — but the
          round trip and the redirect still take a moment on a bad connection, and the
          curtain is what says so rather than a nav bar that looks ignored. */}
      <BlockingOverlay open={signingOut} label="Signing out…" />
      <nav className="flex items-center gap-1" aria-label="Console">
        {TABS.map((tab) => {
          const active = tab.exact ? pathname === tab.href : pathname.startsWith(tab.href);
          const Icon = tab.icon;
          return (
            <Link
              key={tab.href}
              href={tab.href}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'flex items-center gap-2 rounded-control px-3 py-2 text-[13.5px] transition',
                active
                  ? 'bg-nav-active font-semibold text-white'
                  : 'font-medium text-[#CFCCE2] hover:bg-nav-active/60',
              )}
            >
              <Icon className="size-4" />
              {tab.label}
            </Link>
          );
        })}
      </nav>

      <button
        type="button"
        disabled={signingOut}
        onClick={() =>
          startSignOut(() => {
            void platformSignOut();
          })
        }
        className="flex min-h-0 items-center gap-2 rounded-control px-3 py-2 text-[13px] font-medium text-ink-faint transition hover:bg-nav-active/60 hover:text-[#CFCCE2] disabled:opacity-60"
      >
        <LogOut className="size-4" />
        {signingOut ? 'Signing out…' : 'Sign out'}
      </button>
    </div>
  );
}
