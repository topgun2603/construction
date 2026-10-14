import { notFound } from 'next/navigation';
import { serverFetch } from '@/lib/server-api';
import type { BankTransferInvoice, BillingCatalogue } from '@/lib/billing-types';
import { FadeIn } from '@/components/motion';
import { requireSelf } from '@/lib/session';
import { getT } from '@/lib/i18n-server';
import { PlanPicker } from './plan-picker';

export const metadata = { title: 'Billing · BUILDR' };

/**
 * Paying for the plan (roadmap: lower-priced plans in local currency or USD).
 *
 * Each plan is quoted in the company's own currency when the catalogue has a price in it, in US
 * dollars when it has one of those, and otherwise as "contact us" — never an exchange rate picked
 * here. Companies in Bangladesh and Nepal, where paying abroad by card is hard, can ask for an
 * invoice to pay by bank transfer instead; the plan applies once the platform team sees the money.
 *
 * For whoever can change company details (`tenant.manage`), as the API requires.
 */
export default async function BillingPage() {
  const t = await getT();
  const me = await requireSelf();
  if (!me.permissions.includes('tenant.manage')) notFound();

  const [catalogue, transfers] = await Promise.all([
    serverFetch<BillingCatalogue>('/billing/plans'),
    serverFetch<{ items: BankTransferInvoice[] }>('/billing/bank-transfers'),
  ]);

  return (
    <FadeIn className="flex flex-col gap-4">
      <p className="max-w-xl text-[13.5px] leading-relaxed text-ink-muted">
        {t(
          'Every plan includes everything; what differs is how long it runs. Prices are in your currency where we have one, otherwise in US dollars.',
        )}
      </p>
      <PlanPicker catalogue={catalogue} transfers={transfers.items} />
    </FadeIn>
  );
}
