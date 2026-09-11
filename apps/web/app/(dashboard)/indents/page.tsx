import { serverFetch } from '@/lib/server-api';
import { ClipboardCheck } from 'lucide-react';
import { requireSelf } from '@/lib/session';
import type { Indent, Page } from '@/lib/api-types';
import { FadeIn, Stagger, StaggerItem } from '@/components/motion';
import { StatTile } from '@/components/stat-tile';
import { EmptyState } from '@/components/ui/empty-state';
import { IndentCard } from './indent-card';

export const metadata = { title: 'Approvals · BUILDR' };

/**
 * The approval queue (design artboard 3c).
 *
 * Indents can be cleared inline here so an owner never has to open a second screen
 * to unblock a site — that is the whole point of the queue.
 */
export default async function IndentsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const { status } = await searchParams;
  const indents = await serverFetch<Page<Indent>>(
    `/indents?limit=100${status ? `&status=${status}` : ''}`,
  );
  const me = await requireSelf();
  const canApprove = ['owner', 'project_manager'].includes(me.user.role);

  const waiting = indents.items.filter((indent) => indent.status === 'requested');
  const urgent = waiting.filter((indent) => indent.urgency === 'high');
  const approved = indents.items.filter((indent) =>
    ['approved', 'ordered'].includes(indent.status),
  );

  return (
    <FadeIn className="flex flex-col gap-5">
      <div className="grid gap-3.5 sm:grid-cols-3">
        <StatTile
          label="Waiting on you"
          value={String(waiting.length)}
          animate
          note={urgent.length > 0 ? `${urgent.length} urgent` : 'Nothing urgent'}
          noteTone={urgent.length > 0 ? 'blocked' : 'done'}
        />
        <StatTile label="Approved, not delivered" value={String(approved.length)} animate note="Ordered or awaiting delivery" />
        <StatTile
          label="Sites affected"
          value={String(new Set(waiting.map((indent) => indent.project_id)).size)}
          animate
          note="With something pending"
        />
      </div>

      {indents.items.length === 0 ? (
        <EmptyState
          icon={<ClipboardCheck />}
          title="Nothing to approve"
          body="Material indents raised by supervisors land here for a project manager or owner to clear."
        />
      ) : (
        <Stagger className="grid gap-4 lg:grid-cols-2">
          {indents.items.map((indent) => (
            <StaggerItem key={indent.id}>
              <IndentCard indent={indent} canApprove={canApprove} />
            </StaggerItem>
          ))}
        </Stagger>
      )}
    </FadeIn>
  );
}
