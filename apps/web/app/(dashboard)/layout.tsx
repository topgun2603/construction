import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { LANGUAGE_COOKIE } from '@/lib/i18n';
import { LanguageProvider } from '@/components/language-provider';
import { ApiRequestError } from '@/lib/api';
import { serverFetch } from '@/lib/server-api';
import { loadSelf } from '@/lib/session';
import { SideNav } from '@/components/side-nav';
import { TopBar } from '@/components/top-bar';
import type { NotificationRow } from '@/components/notification-bell';
import { Toaster } from '@/components/ui/toaster';
import type { Indent, Page, ProjectSummary } from '@/lib/api-types';
import { TRANSLATED_LANGUAGES } from '@/lib/i18n';
import type { LanguageCode } from '@sitebook/shared';

/**
 * Shell for every signed-in page (design artboard 3a).
 *
 * `/me` is loaded once here and its module list drives the navigation, so a tenant
 * on Starter never sees a link to a Pro screen that would 403.
 */
export default async function DashboardLayout({ children }: { children: ReactNode }) {
  const self = await loadSelf();
  if (!self) redirect('/login');

  /*
   * The language, from the cookie, on the server.
   *
   * Read here rather than in the browser so the first paint is already in the right language. A
   * rail that renders in English and flips to Tamil a moment later is worse than one that never
   * flipped — and on a 3G connection in a site office that moment is a visible second.
   */
  const stored = (await cookies()).get(LANGUAGE_COOKIE)?.value;
  const language: LanguageCode = TRANSLATED_LANGUAGES.includes(stored as LanguageCode)
    ? (stored as LanguageCode)
    : 'en';

  const [projects, pendingApprovals, notifications] = await Promise.all([
    serverFetch<Page<ProjectSummary>>('/projects?limit=200'),
    countPendingIndents(),
    // The bell's contents, fetched with the shell so it is populated on first paint rather than a
    // beat later. Twelve is what the dropdown can show without becoming a page of its own.
    serverFetch<{ items: NotificationRow[] }>('/notifications?limit=12').catch(() => ({
      items: [] as NotificationRow[],
    })),
  ]);

  const activeSiteCount = projects.items.filter((project) => project.status === 'active').length;

  return (
    /*
      The shell is exactly one viewport tall and never scrolls itself; only <main>
      below does. Otherwise a long table makes the whole document grow, the rail
      stretches to the document's height rather than the screen's, and scrolling
      down carries the navigation off the top of the window.
    */
    <LanguageProvider initial={language}>
    <div className="flex h-dvh overflow-hidden">
      <SideNav
        tenantName={self.tenant.name}
        logoUrl={self.tenant.logo_url}
        plan={self.tenant.plan_name ?? self.tenant.plan}
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
          notifications={notifications.items}
        />
        {/* The one scrolling region. pb-12 keeps the last card off the bottom edge. */}
        <main className="min-h-0 flex-1 overflow-y-auto px-6 pb-12 pt-5">{children}</main>
      </div>
      <Toaster />
    </div>
    </LanguageProvider>
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
