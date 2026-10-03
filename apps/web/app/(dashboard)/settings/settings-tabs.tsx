'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import { useLanguage } from '@/components/language-provider';

const TABS = [
  { href: '/settings/team', label: 'Team' },
  { href: '/settings/roles', label: 'Roles' },
  { href: '/settings/contractors', label: 'Contractors' },
  { href: '/settings/materials', label: 'Materials' },
  { href: '/settings/automation', label: 'Automation' },
];

export function SettingsTabs() {
  const { t } = useLanguage();
  const pathname = usePathname();
  return (
    <nav className="flex gap-1 border-b border-line">
      {TABS.map((tab) => {
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
