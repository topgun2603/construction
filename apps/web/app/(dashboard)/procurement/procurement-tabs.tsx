'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import { useLanguage } from '@/components/language-provider';

/** A tab is shown to anybody holding one of its permissions. */
const TABS: Array<{ href: string; label: string; anyOf: string[] }> = [
  {
    href: '/procurement',
    label: 'Purchase orders',
    anyOf: ['procurement.view', 'procurement.manage', 'procurement.receive'],
  },
  { href: '/procurement/rfqs', label: 'Quotes', anyOf: ['procurement.view', 'procurement.manage'] },
  {
    href: '/procurement/invoices',
    label: 'Supplier invoices',
    anyOf: ['procurement.view', 'procurement.invoices'],
  },
  { href: '/procurement/vendors', label: 'Suppliers', anyOf: ['procurement.view', 'vendors.manage'] },
  {
    href: '/procurement/settings',
    label: 'Approval limits',
    anyOf: ['procurement.view', 'procurement.approve', 'tenant.manage'],
  },
];

export function ProcurementTabs({ permissions }: { permissions: string[] }) {
  const { t } = useLanguage();
  const pathname = usePathname();
  const visible = TABS.filter((tab) => tab.anyOf.some((p) => permissions.includes(p)));
  return (
    <nav className="flex gap-1 overflow-x-auto border-b border-line print:hidden">
      {visible.map((tab) => {
        // Orders own the section root and their own detail pages.
        const active =
          tab.href === '/procurement'
            ? pathname === '/procurement' || pathname.startsWith('/procurement/orders')
            : pathname.startsWith(tab.href);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={active ? 'page' : undefined}
            className={cn(
              '-mb-px whitespace-nowrap border-b-[2.5px] px-3.5 py-2.5 text-[13.5px] leading-tight transition',
              active
                ? 'border-accent font-semibold text-ink'
                : 'border-transparent font-medium text-ink-muted hover:text-ink',
            )}
          >
            {t(tab.label)}
          </Link>
        );
      })}
    </nav>
  );
}
