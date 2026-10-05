import { notFound } from 'next/navigation';
import type { SnagView } from '@sitebook/shared';
import { ApiRequestError } from '@/lib/api';
import { serverFetch } from '@/lib/server-api';
import { requireSelf } from '@/lib/session';
import type { Contractor, Page, ProjectMember } from '@/lib/api-types';
import { FadeIn } from '@/components/motion';
import { SnagDetail } from './snag-detail';

export const metadata = { title: 'Snag · BUILDR' };

/**
 * One snag, with everything needed to move it on. Who it can be given to is the site's own people
 * and the company's contractors, fetched only for somebody who can change it.
 */
export default async function SnagPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const me = await requireSelf();

  let snag: SnagView;
  try {
    snag = await serverFetch<SnagView>(`/quality/snags/${id}`);
  } catch (error) {
    if (error instanceof ApiRequestError && (error.status === 404 || error.status === 403)) {
      notFound();
    }
    throw error;
  }

  const canEdit = me.permissions.includes('quality.inspect');
  const [members, contractors] = canEdit
    ? await Promise.all([
        serverFetch<ProjectMember[]>(`/projects/${snag.project.id}/members`).catch(() => [] as ProjectMember[]),
        // Contractors live behind the labour module; without it there is nobody to pick.
        serverFetch<Page<Contractor>>('/contractors?limit=200').catch(() => null),
      ])
    : [[] as ProjectMember[], null];

  return (
    <FadeIn>
      <SnagDetail
        initial={snag}
        canEdit={canEdit}
        canVerify={me.permissions.includes('quality.verify')}
        people={members
          .filter((member) => member.user.role !== 'client' && member.user.status === 'active')
          .map((member) => ({ id: member.user.id, name: member.user.name }))}
        contractors={(contractors?.items ?? []).map((contractor) => ({ id: contractor.id, name: contractor.name }))}
      />
    </FadeIn>
  );
}
