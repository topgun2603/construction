import { notFound } from 'next/navigation';
import type { QualityInspectionView } from '@sitebook/shared';
import { ApiRequestError } from '@/lib/api';
import { serverFetch } from '@/lib/server-api';
import { requireSelf } from '@/lib/session';
import { FadeIn } from '@/components/motion';
import { InspectionRunner } from './inspection-runner';

export const metadata = { title: 'Inspection · BUILDR' };

/**
 * One inspection: the runner while it is in progress, the signed record once it is not.
 *
 * Clients reach this too, for an inspection shared with them — the API lets them read it on the
 * strength of seeing the site, and lets them countersign with `approvals.decide`. Who may answer
 * lines is decided here from permissions, never from the role's name.
 */
export default async function InspectionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const me = await requireSelf();

  let inspection: QualityInspectionView;
  try {
    inspection = await serverFetch<QualityInspectionView>(`/quality/inspections/${id}`);
  } catch (error) {
    if (error instanceof ApiRequestError && (error.status === 404 || error.status === 403)) {
      notFound();
    }
    throw error;
  }

  const can = (permission: string) => me.permissions.includes(permission);
  return (
    <FadeIn>
      <InspectionRunner
        initial={inspection}
        canInspect={can('quality.inspect')}
        canCountersign={can('quality.verify') || can('approvals.decide')}
        signerName={me.user.name}
      />
    </FadeIn>
  );
}
