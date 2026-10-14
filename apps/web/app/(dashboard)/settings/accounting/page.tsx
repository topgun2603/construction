import { redirect } from 'next/navigation';
import { ACCOUNTING_SYSTEMS, type AccountingSystem } from '@sitebook/shared';
import { requireSelf } from '@/lib/session';
import { serverFetch } from '@/lib/server-api';
import { getT } from '@/lib/i18n-server';
import type { AccountingOverview } from '@/lib/accounting-types';
import { FadeIn } from '@/components/motion';
import { AccountingSettingsForm } from './accounting-settings-form';

export const metadata = { title: 'Accounting · BUILDR' };

/**
 * Settings → Accounting (roadmap Phase 3): which accounting system the books are kept in, and which
 * of its accounts each kind of SiteBook money posts to. The mapping is per system, so `?system=`
 * shows another system's grid without changing the company's choice.
 *
 * Anyone who exports may read it — they need to see why an export was refused; only
 * `accounting.manage` may change it, and the form says so.
 */
export default async function AccountingSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ system?: string }>;
}) {
  const me = await requireSelf();
  if (!me.permissions.includes('accounting.manage') && !me.permissions.includes('accounting.export')) {
    redirect('/settings/company');
  }
  const t = await getT();
  const params = await searchParams;
  const system = (ACCOUNTING_SYSTEMS as readonly string[]).includes(params.system ?? '')
    ? (params.system as AccountingSystem)
    : null;
  const overview = await serverFetch<AccountingOverview>(`/accounting/settings${system ? `?system=${system}` : ''}`);

  return (
    <FadeIn className="flex flex-col gap-6">
      <p className="max-w-2xl text-[13.5px] leading-relaxed text-ink-muted">
        {t('Choose your accounting system and the ledger account each kind of transaction goes to. Exports use exactly these accounts, and refuse to run while one they need is missing. Every change is recorded in the audit log.')}
      </p>
      {/* Keyed by system so switching systems starts the grid from that system's saved accounts. */}
      <AccountingSettingsForm key={overview.system} overview={overview} />
    </FadeIn>
  );
}
