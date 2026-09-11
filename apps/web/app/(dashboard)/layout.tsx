import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { ApiRequestError } from '@/lib/api';
import { serverFetch } from '@/lib/server-api';
import { loadSelf } from '@/lib/session';
import { SideNav } from '@/components/side-nav';
import { TopBar } from '@/components/top-bar';
import { Toaster } from '@/components/ui/toaster';
import type { Indent, Page, ProjectSummary } from '@/lib/api-types';

/**
 * Shell for every signed-in page (design artboard 3a).
 *
 * `/me` is loaded once here and its module list drives the navigation, so a tenant
 * on Starter never sees a link to a Pro screen that would 403.
 */
export default async function DashboardLayout({ children }: { children: ReactNode }) {
  const self = await loadSelf();
  if (!self) redirect('/login');

  const [projects, pendingApprovals] = await Promise.all([
    serverFetch<Page<ProjectSummary>>('/projects?limit=200'),
    countPendingIndents(),
  ]);

  const activeSiteCount = projects.items.filter((project) => project.status === 'active').length;

  return (
    /*
      The shell is exactly one viewport tall and never scrolls itself; only <main>
      below does. Otherwise a long table makes the whole document grow, the rail
      stretches to the document's height rather than the screen's, and scrolling
      down carries the navigation off the top of the window.
    */
    <div className="flex h-dvh overflow-hidden">
      <SideNav
        tenantName={self.tenant.name}
        logoUrl={self.tenant.logo_url}
        plan={self.tenant.plan}
        role={self.user.role}
        permissions={self.permissions}
        enabledModules={self.enabled_modules}
        activeSiteCount={activeSiteCount}
        pendingApprovals={pendingApprovals}
      />
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <TopBar
          userName={self.user.name}
          userPhone={self.user.phone}
          userRole={self.user.role}
        />
        {/* The one scrolling region. pb-12 keeps the last card off the bottom edge. */}
        <main className="min-h-0 flex-1 overflow-y-auto px-6 pb-12 pt-5">{children}</main>
      </div>
      <Toaster />
    </div>
  );
}

/**
 * The nav badge. A tenant without the indents module gets a 403 here, which is not
 * an error — it just means there is nothing to badge, so the shell must not fail.
 */
async function countPendingIndents(): Promise<number> {
  try {
    const indents = await serverFetch<Page<Indent>>('/indents?status=requested&limit=100');
    return indents.items.length;
  } catch (error) {
    if (error instanceof ApiRequestError && error.status === 403) return 0;
    throw error;
  }
}
