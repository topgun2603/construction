'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import {
  Banknote,
  Receipt,
  Building2,
  FolderOpen,
  CalendarCheck,
  ClipboardCheck,
  HardHat,
  LayoutDashboard,
  PanelLeftClose,
  PanelLeftOpen,
  PieChart,
  Settings,
  Wallet,
  Warehouse,
  type LucideIcon,
} from 'lucide-react';
import type { ModuleName, Permission } from '@sitebook/shared';
import { cn } from '@/lib/utils';

/*
 * The navigation rail (design artboard 3a).
 *
 * Collapses to icons only, because the labour tables are wide — a wage sheet has
 * eight columns and the rail is 236px of them. The choice is remembered per
 * browser so it survives a reload; it is a per-viewer convenience, not shared state.
 *
 * The label always sits beside the icon, never inside it, so Tamil and Hindi
 * strings can grow ~40% without breaking the row.
 */

const STORAGE_KEY = 'sb.nav.collapsed';

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  module?: ModuleName;
  roles?: string[];
  /**
   * Any one of these is enough, matching how the API reads a `@RequiresPermission` list.
   *
   * Modules alone were never sufficient: they say what the tenant bought, not what this person may
   * open. A client is on a Pro account and so passes every module check in this file — and may
   * open almost none of these screens.
   */
  permission?: Permission | Permission[];
}

interface NavGroup {
  label?: string;
  items: NavItem[];
}

const GROUPS: NavGroup[] = [
  {
    items: [
      {
        href: '/overview',
        label: 'Overview',
        icon: LayoutDashboard,
        module: 'dashboard',
        // What the screen shows is cost and approvals; the API gates it the same way.
        permission: 'expenses.view',
      },
      {
        href: '/projects',
        label: 'Sites',
        icon: Building2,
        module: 'projects',
        permission: 'projects.view',
      },
      {
        href: '/documents',
        label: 'Documents',
        icon: FolderOpen,
        module: 'documents',
        permission: 'documents.view',
      },
    ],
  },
  {
    label: 'Labour',
    items: [
      {
        href: '/labour/workers',
        label: 'Workers',
        icon: HardHat,
        module: 'labour',
        permission: 'workers.view',
      },
      {
        href: '/labour/attendance',
        label: 'Attendance',
        icon: CalendarCheck,
        module: 'attendance',
        permission: ['attendance.view', 'attendance.record'],
      },
      {
        href: '/labour/wage-periods',
        label: 'Wage periods',
        icon: Banknote,
        module: 'labour',
        roles: ['owner', 'accounts'],
        permission: 'wages.view',
      },
      {
        href: '/labour/payments',
        label: 'Payments',
        icon: Wallet,
        module: 'labour',
        roles: ['owner', 'accounts'],
        permission: 'payments.view',
      },
    ],
  },
  {
    items: [
      {
        href: '/indents',
        label: 'Approvals',
        icon: ClipboardCheck,
        module: 'indents',
        permission: ['indents.raise', 'indents.approve'],
      },
      {
        href: '/expenses',
        label: 'Expenses',
        icon: Receipt,
        module: 'expenses',
        permission: 'expenses.view',
      },
      { href: '/stock', label: 'Stock', icon: Warehouse, module: 'stock', permission: 'stock.view' },
      // Gated on `labour`, not `reports`: labour cost is core to Starter (spec §3
      // item 8), and the API gates it the same way.
      {
        href: '/reports',
        label: 'Reports',
        icon: PieChart,
        module: 'labour',
        permission: ['reports.view', 'wages.view'],
      },
      { href: '/settings/team', label: 'Settings', icon: Settings, roles: ['owner'] },
    ],
  },
];

export function SideNav({
  tenantName,
  logoUrl,
  plan,
  role,
  enabledModules,
  permissions,
  activeSiteCount,
  pendingApprovals,
}: {
  tenantName: string;
  logoUrl: string | null;
  plan: string;
  role: string;
  enabledModules: string[];
  permissions: string[];
  activeSiteCount: number;
  pendingApprovals: number;
}) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);

  // Read after mount, never during render: the server has no localStorage, and
  // reading it in the first paint would hydrate mismatched.
  useEffect(() => {
    try {
      setCollapsed(window.localStorage.getItem(STORAGE_KEY) === '1');
    } catch {
      /* private mode, blocked storage — the default is fine */
    }
  }, []);

  function toggle() {
    setCollapsed((current) => {
      const next = !current;
      try {
        window.localStorage.setItem(STORAGE_KEY, next ? '1' : '0');
      } catch {
        /* ignore */
      }
      return next;
    });
  }

  const groups = GROUPS.map((group) => ({
    ...group,
    items: group.items.filter(
      (item) =>
        (!item.module || enabledModules.includes(item.module)) &&
        (!item.roles || item.roles.includes(role)) &&
        (!item.permission ||
          [item.permission].flat().some((needed) => permissions.includes(needed))),
    ),
  })).filter((group) => group.items.length > 0);

  return (
    <nav
      aria-label="Main"
      className={cn(
        'hidden shrink-0 flex-col bg-nav transition-[width] duration-200 md:flex',
        collapsed ? 'w-[72px]' : 'w-[244px]',
      )}
    >
      {/* Header — matches the 56px top bar so the two align across the seam. */}
      <div
        className={cn(
          'flex h-14 flex-none items-center gap-2.5 border-b border-white/[0.06] px-4',
          collapsed && 'justify-center px-0',
        )}
      >
        {logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={logoUrl}
            alt=""
            className="h-8 w-8 flex-none rounded-control bg-white object-contain"
          />
        ) : (
          <span className="flex h-8 w-8 flex-none items-center justify-center rounded-control bg-white text-[12px] font-bold text-ink">
            {initials(tenantName)}
          </span>
        )}
        {!collapsed && (
          <span className="flex min-w-0 flex-col">
            <span
              title={tenantName}
              className="truncate text-[13.5px] font-semibold leading-tight text-white"
            >
              {tenantName}
            </span>
            <span className="text-[11.5px] leading-tight text-ink-faint">
              {activeSiteCount} active {activeSiteCount === 1 ? 'site' : 'sites'}
            </span>
          </span>
        )}
      </div>

      {/* Scrolls independently, so a long nav never pushes the footer off-screen. */}
      <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-3 py-5">
        {groups.map((group, index) => (
          <div key={group.label ?? index} className="flex flex-col gap-1">
            {group.label && !collapsed && (
              <span className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-[0.09em] text-ink-faint">
                {group.label}
              </span>
            )}
            {group.label && collapsed && <span className="mx-3 mb-1 h-px bg-white/[0.08]" />}

            {group.items.map((item) => {
              const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
              const Icon = item.icon;
              const badge = item.href === '/indents' && pendingApprovals > 0;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? 'page' : undefined}
                  title={collapsed ? item.label : undefined}
                  className={cn(
                    'group relative flex items-center gap-3 rounded-control py-2.5 transition',
                    collapsed ? 'justify-center px-0' : 'px-3',
                    active ? 'bg-nav-active' : 'hover:bg-nav-active/60',
                  )}
                >
                  <Icon
                    className={cn(
                      'size-[18px] flex-none transition',
                      active ? 'text-accent-onDark' : 'text-ink-faint group-hover:text-[#CFCCE2]',
                    )}
                    strokeWidth={active ? 2.25 : 2}
                  />
                  {!collapsed && (
                    <span
                      className={cn(
                        'flex-1 truncate text-[13.5px] leading-tight',
                        active ? 'font-semibold text-white' : 'font-medium text-[#CFCCE2]',
                      )}
                    >
                      {item.label}
                    </span>
                  )}
                  {badge &&
                    (collapsed ? (
                      // A dot, not a number: at 72px a two-digit count would overlap
                      // the icon.
                      <span className="absolute right-3 top-2 size-2 rounded-full bg-accent ring-2 ring-nav" />
                    ) : (
                      <span className="flex-none rounded-full bg-accent px-1.5 font-mono text-[11.5px] font-semibold leading-[1.5] text-white">
                        {pendingApprovals}
                      </span>
                    ))}
                </Link>
              );
            })}
          </div>
        ))}
      </div>

      <div className="flex flex-none flex-col gap-3 border-t border-white/[0.06] p-3">
        {!collapsed && (
          <div className="flex flex-col gap-1 rounded-[10px] bg-nav-card px-3 py-2.5">
            <span className="text-[12.5px] font-semibold capitalize leading-tight text-accent-onDark">
              {plan} plan
            </span>
            <span className="text-[11.5px] leading-snug text-ink-faint">
              {enabledModules.length} modules on
            </span>
          </div>
        )}
        <button
          type="button"
          onClick={toggle}
          aria-expanded={!collapsed}
          aria-label={collapsed ? 'Expand navigation' : 'Collapse navigation'}
          title={collapsed ? 'Expand' : 'Collapse'}
          className={cn(
            'flex min-h-0 items-center gap-2.5 rounded-control py-2 text-[13px] font-medium text-ink-faint transition hover:bg-nav-active/60 hover:text-[#CFCCE2]',
            collapsed ? 'justify-center px-0' : 'px-3',
          )}
        >
          {collapsed ? (
            <PanelLeftOpen className="size-[18px]" />
          ) : (
            <>
              <PanelLeftClose className="size-[18px]" />
              <span>Collapse</span>
            </>
          )}
        </button>
      </div>
    </nav>
  );
}

function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '··';
  if (words.length === 1) return (words[0] ?? '').slice(0, 2).toUpperCase();
  return `${words[0]?.[0] ?? ''}${words[1]?.[0] ?? ''}`.toUpperCase();
}
