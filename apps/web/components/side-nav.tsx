'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import {
  Banknote,
  ChevronRight,
  Crown,
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
    ],
  },
  {
    // Money, in one place. Payments used to sit under Labour and Stock under nothing, which meant
    // the three screens an accounts person lives in were spread across the whole rail.
    label: 'Finance',
    items: [
      {
        href: '/labour/payments',
        label: 'Payments',
        icon: Wallet,
        module: 'labour',
        roles: ['owner', 'accounts'],
        permission: 'payments.view',
      },
      {
        href: '/expenses',
        label: 'Expenses',
        icon: Receipt,
        module: 'expenses',
        permission: 'expenses.view',
      },
      { href: '/stock', label: 'Stock', icon: Warehouse, module: 'stock', permission: 'stock.view' },
    ],
  },
  {
    label: 'Operations',
    items: [
      {
        href: '/indents',
        label: 'Approvals',
        icon: ClipboardCheck,
        module: 'indents',
        permission: ['indents.raise', 'indents.approve'],
      },
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
        'relative isolate hidden shrink-0 flex-col overflow-hidden bg-gradient-to-b from-nav via-[#282150] to-[#3A2A72] transition-[width] duration-200 md:flex',
        collapsed ? 'w-[76px]' : 'w-[260px]',
      )}
    >
      {/*
       * The site, barely there, at the foot of the rail.
       *
       * Desaturated and down at 9%: it is a texture, not a picture. Anything stronger competes
       * with the plan card sitting on top of it, and the rail's job is to be read past.
       */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 bottom-0 -z-10 h-64 bg-[url('/bg.jpg')] bg-cover bg-bottom opacity-[0.09] grayscale"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 bottom-0 -z-10 h-64 bg-gradient-to-t from-[#3A2A72] via-[#3A2A72]/70 to-transparent"
      />
      {/*
       * Header. Taller than the 56px top bar on purpose — the two columns are no longer trying to
       * align across the seam now that the rail has its own ground.
       *
       * The company's name rather than the product's: this is a multi-tenant product and which
       * account you are in is the one thing a rail can tell you that no page can.
       */}
      <div
        className={cn(
          'flex flex-none items-center gap-3 px-4 pb-3 pt-5',
          collapsed && 'justify-center px-0',
        )}
      >
        {logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={logoUrl}
            alt=""
            className="size-10 flex-none rounded-[12px] bg-white object-contain"
          />
        ) : (
          <span className="flex size-10 flex-none items-center justify-center rounded-[12px] bg-accent text-[14px] font-bold text-white shadow-[0_6px_16px_rgba(108,76,224,0.5)]">
            {initials(tenantName)}
          </span>
        )}
        {!collapsed && (
          <>
            <span className="flex min-w-0 flex-1 flex-col">
              <span
                title={tenantName}
                className="truncate text-[15px] font-bold leading-tight tracking-[-0.01em] text-white"
              >
                {tenantName}
              </span>
              <span className="text-[11.5px] leading-tight text-white/45">
                {activeSiteCount} active {activeSiteCount === 1 ? 'site' : 'sites'}
              </span>
            </span>
            <button
              type="button"
              onClick={toggle}
              aria-expanded
              aria-label="Collapse navigation"
              title="Collapse"
              className="flex size-8 min-h-0 flex-none items-center justify-center rounded-control text-white/40 transition hover:bg-white/10 hover:text-white"
            >
              <PanelLeftClose className="size-[17px]" />
            </button>
          </>
        )}
      </div>

      {/* Scrolls independently, so a long nav never pushes the footer off-screen. */}
      <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-3 py-5">
        {groups.map((group, index) => (
          <div key={group.label ?? index} className="flex flex-col gap-1">
            {group.label && !collapsed && (
              <span className="px-3 pb-1.5 text-[10.5px] font-bold uppercase tracking-[0.14em] text-white/35">
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
                    // The current page is a filled pill in the action colour, not a slightly
                    // lighter patch of navy: on a gradient, "slightly lighter" stops being legible
                    // halfway down the rail.
                    'group relative flex items-center gap-3 rounded-[12px] py-2.5 transition',
                    collapsed ? 'justify-center px-0' : 'px-3',
                    active
                      ? 'bg-accent shadow-[0_8px_20px_-6px_rgba(108,76,224,0.8)]'
                      : 'hover:bg-white/[0.07]',
                  )}
                >
                  <Icon
                    className={cn(
                      'size-[18px] flex-none transition',
                      active ? 'text-white' : 'text-white/45 group-hover:text-white/85',
                    )}
                    strokeWidth={active ? 2.25 : 2}
                  />
                  {!collapsed && (
                    <span
                      className={cn(
                        'flex-1 truncate text-[13.5px] leading-tight',
                        active ? 'font-semibold text-white' : 'font-medium text-white/70',
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

      <div className="flex flex-none flex-col gap-2 p-3">
        {!collapsed && (
          // A link, not a label. It was the one thing in the rail that looked like a button and
          // did nothing; what somebody wants after reading "3 months plan" is the plan page.
          <Link
            href="/settings/plan"
            className="flex items-center gap-3 rounded-[13px] border border-white/10 bg-white/[0.07] px-3 py-2.5 backdrop-blur-sm transition hover:bg-white/[0.12]"
          >
            <span className="flex size-8 flex-none items-center justify-center rounded-[10px] bg-accent/90">
              <Crown className="size-4 text-white" />
            </span>
            <span className="flex min-w-0 flex-1 flex-col">
              {/* No `capitalize`: the catalogue decides how a plan is written — "3 months",
                  not "3 Months" — and the rail should not restyle somebody's wording. */}
              <span className="truncate text-[12.5px] font-semibold leading-tight text-white">
                {plan} plan
              </span>
              <span className="text-[11px] leading-snug text-white/45">
                {enabledModules.length} modules on
              </span>
            </span>
            <ChevronRight className="size-4 flex-none text-white/40" />
          </Link>
        )}
        {collapsed && (
          <button
            type="button"
            onClick={toggle}
            aria-expanded={false}
            aria-label="Expand navigation"
            title="Expand"
            className="flex min-h-0 items-center justify-center rounded-control py-2 text-white/45 transition hover:bg-white/[0.07] hover:text-white"
          >
            <PanelLeftOpen className="size-[18px]" />
          </button>
        )}
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
