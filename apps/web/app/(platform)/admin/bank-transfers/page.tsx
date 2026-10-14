import { platformFetch } from '@/lib/platform-session';
import type { PlatformBankTransfer } from '@/lib/billing-types';
import { FadeIn } from '@/components/motion';
import { getT } from '@/lib/i18n-server';
import { BankTransferList } from './bank-transfer-list';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Bank transfers · BUILDR platform' };

/**
 * Bank-transfer invoice requests (Bangladesh and Nepal, where paying abroad by card is hard).
 *
 * The platform team issues the invoice, waits for the money, and marks it paid here — the only
 * thing that applies the plan. Pending requests come first, because those are somebody waiting.
 */
export default async function BankTransfersPage() {
  const t = await getT();
  const [{ items, pending }, me] = await Promise.all([
    platformFetch<{ items: PlatformBankTransfer[]; pending: number }>('/bank-transfers'),
    platformFetch<{ phone: string; root: boolean }>('/me'),
  ]);
  const ordered = [
    ...items.filter((item) => item.status === 'pending'),
    ...items.filter((item) => item.status !== 'pending'),
  ];

  return (
    <FadeIn className="mx-auto flex max-w-[1400px] flex-col gap-5 px-6 pb-12 pt-5">
      <div className="flex flex-col gap-1">
        <h1 className="text-[22px] font-semibold leading-tight">{t('Bank transfers')}</h1>
        <p className="text-[13.5px] text-ink-muted">
          {pending === 1
            ? t('1 invoice is waiting for payment.')
            : `${pending} ${t('invoices are waiting for payment.')}`}{' '}
          {t('Marking one paid starts the plan from today.')}
        </p>
      </div>
      <BankTransferList items={ordered} canSettle={me.root} />
    </FadeIn>
  );
}
