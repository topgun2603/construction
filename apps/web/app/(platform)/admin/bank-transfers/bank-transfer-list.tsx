'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Landmark } from 'lucide-react';
import { toast } from 'sonner';
import { formatMoney } from '@sitebook/shared';
import type { PlatformBankTransfer } from '@/lib/billing-types';
import { settleBankTransfer } from '@/lib/platform-billing-actions';
import { Badge, type Tone } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Input } from '@/components/ui/input';
import { useLanguage } from '@/components/language-provider';

const STATUS_TONE: Record<PlatformBankTransfer['status'], Tone> = {
  pending: 'pending',
  paid: 'done',
  cancelled: 'neutral',
};

/**
 * Each request, with "Mark paid" (applies the plan from today) and "Cancel" for the pending ones.
 * The bank's reference is asked for on paying, so the trail can say which transfer it was.
 */
export function BankTransferList({
  items,
  canSettle,
}: {
  items: PlatformBankTransfer[];
  canSettle: boolean;
}) {
  const { t } = useLanguage();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [references, setReferences] = useState<Record<string, string>>({});

  function settle(item: PlatformBankTransfer, status: 'paid' | 'cancelled') {
    start(async () => {
      const reference = references[item.id]?.trim();
      const result = await settleBankTransfer(item.id, {
        status,
        ...(status === 'paid' && reference ? { payment_reference: reference } : {}),
      });
      if (!result.ok) {
        toast.error(result.error ?? t('Could not save'));
        return;
      }
      toast.success(
        status === 'paid'
          ? `${item.number}: ${t('paid — the plan is active')}`
          : `${item.number}: ${t('cancelled')}`,
      );
      router.refresh();
    });
  }

  if (items.length === 0) {
    return (
      <EmptyState
        icon={<Landmark />}
        title={t('No bank-transfer requests')}
        body={t('Companies in Bangladesh and Nepal can ask for an invoice from their billing page.')}
      />
    );
  }

  return (
    <Card className="overflow-x-auto p-0">
      <table className="w-full min-w-[880px] text-[13px]">
        <thead>
          <tr className="border-b border-line text-[12px] text-ink-muted">
            <th className="px-4 py-2.5 text-start font-medium">{t('Invoice')}</th>
            <th className="px-3 py-2.5 text-start font-medium">{t('Company')}</th>
            <th className="px-3 py-2.5 text-start font-medium">{t('Plan')}</th>
            <th className="px-3 py-2.5 text-end font-medium">{t('Amount')}</th>
            <th className="px-3 py-2.5 text-start font-medium">{t('Status')}</th>
            <th className="px-4 py-2.5 text-end font-medium" />
          </tr>
        </thead>
        <tbody className="divide-y divide-line-soft">
          {items.map((item) => (
            <tr key={item.id} className="align-top">
              <td className="px-4 py-3">
                <div className="font-mono font-medium" dir="ltr">
                  {item.number}
                </div>
                <div className="text-[12px] text-ink-muted">{item.created_at.slice(0, 10)}</div>
                {item.note && <div className="mt-1 text-[12px] text-ink-muted">{item.note}</div>}
              </td>
              <td className="px-3 py-3">
                <Link href={`/admin/tenants/${item.tenant_id}`} className="font-medium hover:underline">
                  {item.tenant_name}
                </Link>
                <div className="text-[12px] text-ink-muted">{item.country}</div>
              </td>
              <td className="px-3 py-3">{item.plan}</td>
              <td className="px-3 py-3 text-end font-mono" dir="ltr">
                {formatMoney(BigInt(item.amount), { currency: item.currency, locale: 'en' })}
              </td>
              <td className="px-3 py-3">
                <Badge tone={STATUS_TONE[item.status]}>{t(item.status)}</Badge>
                {item.payment_reference && (
                  <div className="mt-1 font-mono text-[12px] text-ink-muted" dir="ltr">
                    {item.payment_reference}
                  </div>
                )}
              </td>
              <td className="px-4 py-3">
                {item.status === 'pending' && canSettle && (
                  <div className="flex flex-wrap items-center justify-end gap-2">
                    <Input
                      aria-label={t('Bank reference')}
                      placeholder={t('Bank reference')}
                      className="h-9 w-40"
                      value={references[item.id] ?? ''}
                      onChange={(event) =>
                        setReferences((current) => ({ ...current, [item.id]: event.target.value }))
                      }
                    />
                    <Button size="sm" disabled={pending} onClick={() => settle(item, 'paid')}>
                      {t('Mark paid')}
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={pending}
                      onClick={() => settle(item, 'cancelled')}
                    >
                      {t('Cancel')}
                    </Button>
                  </div>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}
