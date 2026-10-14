import { redirect } from 'next/navigation';
import { requireSelf } from '@/lib/session';
import { serverFetch } from '@/lib/server-api';
import { getT } from '@/lib/i18n-server';
import type { M365Overview } from '@/lib/m365-types';
import { FadeIn } from '@/components/motion';
import { M365Card } from './m365-card';

export const metadata = { title: 'Integrations · BUILDR' };

/**
 * Settings → Integrations. Microsoft 365 today: the company's own mailbox for RFIs, submittals,
 * change orders and meeting minutes, and its calendar for meetings and due dates. Needs
 * `integrations.manage` — an owner's by default, since whoever holds it chooses the address every
 * email goes out from.
 */
export default async function IntegrationsPage({
  searchParams,
}: {
  searchParams: Promise<{ connected?: string }>;
}) {
  const me = await requireSelf();
  if (!me.permissions.includes('integrations.manage')) redirect('/settings/company');
  const t = await getT();
  const { connected } = await searchParams;
  const overview = await serverFetch<M365Overview>('/integrations/m365');

  return (
    <FadeIn className="flex flex-col gap-6">
      <p className="max-w-2xl text-[13.5px] leading-relaxed text-ink-muted">
        {t('Connect the tools your company already uses. Every connection and every email sent through it is recorded in the audit log.')}
      </p>
      <M365Card overview={overview} justConnected={connected === '1'} />
    </FadeIn>
  );
}
