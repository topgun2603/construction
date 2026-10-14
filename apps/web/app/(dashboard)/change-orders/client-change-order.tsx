'use client';

import Link from 'next/link';
import { FilePlus2 } from 'lucide-react';
import { CHANGE_ORDER_REASON_LABELS } from '@sitebook/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { useFormat } from '@/components/format-provider';
import { useLanguage } from '@/components/language-provider';
import type { Approval } from '@/lib/api-types';
import type { ClientChangeOrder } from '@/lib/change-order-types';
import { changeOrderDaysText } from './labels';

/**
 * A change order as the client sees it, inside its approval: the work, the price, the tax and the
 * days — never the cost, which the API does not send them.
 */
export function ChangeOrderApprovalDetails({ changeOrder }: { changeOrder: ClientChangeOrder }) {
  const { t } = useLanguage();
  const { money } = useFormat();
  return (
    <div className="flex flex-col gap-2 rounded-btn border border-line bg-raised p-3">
      <span className="text-[12px] text-ink-muted">
        <span className="font-mono" dir="ltr">
          {changeOrder.label}
        </span>{' '}
        · {t(CHANGE_ORDER_REASON_LABELS[changeOrder.reason])}
      </span>
      {changeOrder.description && (
        <p className="whitespace-pre-wrap text-[13.5px] leading-relaxed text-ink-soft">{changeOrder.description}</p>
      )}
      {changeOrder.items.length > 0 && (
        <ul className="list-disc ps-5 text-[13.5px]">
          {changeOrder.items.map((item, index) => (
            <li key={index}>
              {item.description}
              {item.quantity && (
                <span className="ms-1.5 font-mono text-ink-muted">
                  {item.quantity} {item.unit ?? ''}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      <dl className="grid grid-cols-2 gap-3 text-[13px] sm:grid-cols-4">
        <Figure label={t('Price')} value={money(changeOrder.client_price)} />
        <Figure label={t('Tax')} value={money(changeOrder.tax)} />
        <Figure label={t('Total')} value={money(changeOrder.client_total)} strong />
        <Figure label={t('Handover date')} value={changeOrderDaysText(changeOrder.time_impact_days, t)} />
      </dl>
    </div>
  );
}

/**
 * The Change orders tab for somebody who sees a site through the client portal: the change orders
 * they have been asked to decide, and the ones they already did. Deciding happens on the approval
 * itself, so there is one place a decision is recorded.
 */
export function ClientChangeOrders({ projectId, approvals }: { projectId: string; approvals: Approval[] }) {
  const { t } = useLanguage();
  const rows = approvals.filter((approval) => approval.change_order);
  if (rows.length === 0) {
    return (
      <EmptyState
        icon={<FilePlus2 />}
        title={t('No change orders')}
        body={t('When the builder prices extra or changed work, it appears here for your decision.')}
      />
    );
  }
  const waiting = rows.filter((approval) => approval.status === 'pending');
  const decided = rows.filter((approval) => approval.status !== 'pending');
  return (
    <div className="flex flex-col gap-4">
      {[
        { title: t('Waiting for your decision'), items: waiting },
        { title: t('Decided'), items: decided },
      ]
        .filter((group) => group.items.length > 0)
        .map((group) => (
          <div key={group.title} className="flex flex-col gap-2">
            <span className="text-[12px] font-semibold uppercase tracking-[0.08em] text-ink-muted">{group.title}</span>
            {group.items.map((approval) => (
              <Card key={approval.id} className="flex flex-col gap-3 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-[15px] font-medium">{approval.change_order!.title}</span>
                  <Badge tone={approval.status === 'pending' ? 'pending' : approval.status === 'approved' ? 'done' : 'blocked'}>
                    {approval.status === 'pending' ? t('Waiting') : approval.status === 'approved' ? t('Approved') : t('Rejected')}
                  </Badge>
                </div>
                <ChangeOrderApprovalDetails changeOrder={approval.change_order!} />
                {approval.status === 'pending' && (
                  <div className="flex justify-end">
                    <Button asChild size="sm">
                      <Link href={`/projects/${projectId}?tab=approvals`}>{t('Approve or reject')}</Link>
                    </Button>
                  </div>
                )}
              </Card>
            ))}
          </div>
        ))}
    </div>
  );
}

function Figure({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-[12px] text-ink-muted">{label}</dt>
      <dd className={`font-mono ${strong ? 'font-bold' : ''}`}>{value}</dd>
    </div>
  );
}
