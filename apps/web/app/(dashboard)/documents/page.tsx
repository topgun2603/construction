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
 * The per-site tab is where documents are uploaded, because a drawing without a site is a drawing
 * nobody can find. This page is the other half of that: a client on two flats, or a project manager
 * running six, should not have to remember which site the contract was filed against.
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

  const { items } = await serverFetch<{ items: SiteDocument[] }>('/documents');

  return (
    <FadeIn className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <h2 className="text-[21px] font-semibold leading-tight">Documents</h2>
        <span className="text-[13px] text-ink-muted">
          The current revision of everything filed against your sites.
        </span>
      </div>

      <DocumentsList
        documents={items}
        canManage={me.permissions.includes('documents.manage')}
        showProject
      />
    </FadeIn>
  );
}
