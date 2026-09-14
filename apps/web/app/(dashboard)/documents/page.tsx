import { FolderOpen } from 'lucide-react';
import { serverFetch } from '@/lib/server-api';
import { requireSelf } from '@/lib/session';
import type { SiteDocument } from '@/lib/api-types';
import { DocumentsList } from '@/components/documents-list';
import { EmptyState } from '@/components/ui/empty-state';
import { FadeIn } from '@/components/motion';

export const metadata = { title: 'Documents · BUILDR' };

/**
 * Every document across the sites this person is on.
 *
 * Uploading works here as well as on the per-site tab, and asks which site. It used to be
 * per-site only, on the reasoning that a drawing without a site is a drawing nobody can find —
 * but this is the page the navigation points at, so somebody looking for "how do I add a
 * document" arrived at an empty list with no way forward. Asking one more question is cheaper
 * than that.
 *
 * The API does the filtering. A client gets only what somebody deliberately shared, and only from
 * their own sites — this page passes no scope of its own and must not, or the day somebody adds a
 * query parameter here it becomes the place the rule was bypassed.
 */
export default async function DocumentsPage() {
  const me = await requireSelf();

  if (!me.enabled_modules.includes('documents') || !me.permissions.includes('documents.view')) {
    return (
      <EmptyState
        icon={<FolderOpen />}
        title="Documents are not switched on"
        body="Drawings, contracts and approvals come with the Pro plan."
      />
    );
  }

  const canManage = me.permissions.includes('documents.manage');

  // Only fetched for somebody who can actually file one — the picker is the only thing that
  // needs it, and a client has no business holding the site list for a dialog they never see.
  const [{ items }, sites] = await Promise.all([
    serverFetch<{ items: SiteDocument[] }>('/documents'),
    canManage
      ? serverFetch<{ items: { id: string; name: string }[] }>('/projects?limit=200')
      : Promise.resolve({ items: [] }),
  ]);

  return (
    <FadeIn className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <h2 className="text-[21px] font-semibold leading-tight">Documents</h2>
        <span className="text-[13px] text-ink-muted">
          The current revision of everything filed against your sites.
        </span>
      </div>

      <DocumentsList documents={items} canManage={canManage} showProject sites={sites.items} />
    </FadeIn>
  );
}
