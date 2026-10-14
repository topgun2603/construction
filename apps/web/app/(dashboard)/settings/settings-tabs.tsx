'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import { useLanguage } from '@/components/language-provider';

/**
 * A tab with a `permission` is shown only to people who hold it; one marked `ownerOnly` only to
 * owners, for settings no permission can hand to somebody else.
 */
const TABS: Array<{ href: string; label: string; permission?: string; ownerOnly?: boolean }> = [
  { href: '/settings/company', label: 'Company' },
  { href: '/settings/team', label: 'Team' },
  { href: '/settings/roles', label: 'Roles' },
  { href: '/settings/contractors', label: 'Contractors' },
  { href: '/settings/materials', label: 'Materials' },
  { href: '/settings/cost-codes', label: 'Cost codes' },
  { href: '/settings/quality', label: 'Quality checklists', permission: 'quality.manage' },
  { href: '/settings/automation', label: 'Automation' },
  // Not permission-gated: tenant roles say nothing about groups. The page itself shows each person
  // only what being the owner or a group admin allows.
  { href: '/settings/group', label: 'Company group' },
  // Which ledger each kind of money posts to (exports read it; the page itself says who may change it).
  { href: '/settings/accounting', label: 'Accounting', permission: 'accounting.manage' },
  { href: '/settings/audit', label: 'Audit log', permission: 'audit.view' },
  // Single sign-on today; two-factor, sessions and IP rules join it as sections of the same page.
  { href: '/settings/security', label: 'Security', ownerOnly: true },
];

export function SettingsTabs({ permissions = [], role }: { permissions?: string[]; role?: string }) {
  const { t } = useLanguage();
  const pathname = usePathname();
  const visible = TABS.filter(
    (tab) =>
      (!tab.permission || permissions.includes(tab.permission)) && (!tab.ownerOnly || role === 'owner'),
  );
  return (
    <nav className="flex gap-1 overflow-x-auto border-b border-line">
      {visible.map((tab) => {
        const active = pathname.startsWith(tab.href);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={active ? 'page' : undefined}
            className={cn(
              '-mb-px border-b-[2.5px] px-3.5 py-2.5 text-[13.5px] leading-tight transition',
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
