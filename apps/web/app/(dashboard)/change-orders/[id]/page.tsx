import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { CHANGE_ORDER_REASON_LABELS } from '@sitebook/shared';
import { ApiRequestError } from '@/lib/api';
import { serverFetch } from '@/lib/server-api';
import { emailsAbout, m365Status } from '@/lib/m365-status';
import { requireSelf } from '@/lib/session';
import { getFormat } from '@/lib/format-server';
import { getT } from '@/lib/i18n-server';
import type { SiteDocument } from '@/lib/api-types';
import type { ChangeOrderDetail } from '@/lib/change-order-types';
import { Badge } from '@/components/ui/badge';
import { FadeIn } from '@/components/motion';
import { EmailLog } from '@/components/email-log';
import { CHANGE_ORDER_STATUS, changeOrderDaysText } from '../labels';
import { ChangeOrderView } from './change-order-view';
import { EmailClientButton } from './email-client-button';

export const metadata = { title: 'Change order · BUILDR' };

/** One change order: its lines and figures, where it is in the workflow, and what it moved. */
export default async function ChangeOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const t = await getT();
  const { money, shortDate } = await getFormat();
  const { id } = await params;
  const me = await requireSelf();

  let changeOrder: ChangeOrderDetail;
  try {
    changeOrder = await serverFetch<ChangeOrderDetail>(`/change-orders/${id}`);
  } catch (error) {
    if (error instanceof ApiRequestError && (error.status === 404 || error.status === 403)) {
      notFound();
    }
    throw error;
  }

  const can = (permission: string) => me.permissions.includes(permission);
  const canManage = can('change_orders.manage');
  // Documents to attach, only for whoever can attach them and only while it is a draft.
  const documents =
    canManage &&
    changeOrder.status === 'draft' &&
    me.enabled_modules.includes('documents') &&
    can('documents.view')
      ? await serverFetch<{ items: SiteDocument[] }>(`/documents?project_id=${changeOrder.project.id}`)
          .then((page) => page.items)
          .catch(() => [] as SiteDocument[])
      : [];
  const status = CHANGE_ORDER_STATUS[changeOrder.status];
  // Waiting on the client, a mailbox connected: offer to tell them by email as well.
  const canEmail = changeOrder.status === 'sent' && (canManage || can('change_orders.approve'));
  const [m365, emails] = await Promise.all([
    canEmail ? m365Status() : Promise.resolve({ connected: false, mailbox: null }),
    emailsAbout(`/change-orders/${id}/emails`),
  ]);

  return (
    <FadeIn className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-5">
        <div className="flex flex-col gap-1.5">
          <Link
            href="/change-orders"
            className="inline-flex items-center gap-1 text-[12.5px] text-ink-faint hover:underline"
          >
            <ArrowLeft className="size-3 rtl:rotate-180" /> {t('Change orders')}
          </Link>
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="text-[21px] font-semibold leading-tight">{changeOrder.title}</h2>
            <Badge tone={status.tone}>{t(status.label)}</Badge>
          </div>
          <span className="text-[13px] text-ink-muted">
            <span className="font-mono" dir="ltr">
              {changeOrder.label}
            </span>{' '}
            · {t(CHANGE_ORDER_REASON_LABELS[changeOrder.reason])} ·{' '}
            <Link href={`/projects/${changeOrder.project.id}?tab=change-orders`} className="hover:underline">
              {changeOrder.project.name}
            </Link>{' '}
            · {shortDate(changeOrder.raised_on)}
          </span>
        </div>
        <dl className="flex gap-7 pb-1">
          <HeaderStat label={t('Cost impact')} value={money(changeOrder.cost_impact)} />
          <HeaderStat label={t('Client total')} value={money(changeOrder.client_total)} />
          <HeaderStat label={t('Time')} value={changeOrderDaysText(changeOrder.time_impact_days, t)} />
        </dl>
      </div>

      <ChangeOrderView
        changeOrder={changeOrder}
        documents={documents}
        can={{
          manage: canManage,
          approve: can('change_orders.approve'),
          decide: can('approvals.decide'),
          ownSubmission: changeOrder.submitted_by?.id === me.user.id && me.user.role !== 'owner',
        }}
      />
      {canEmail && m365.connected && (
        <div className="flex flex-wrap items-center gap-2">
          <EmailClientButton id={changeOrder.id} />
          <span className="text-[12.5px] text-ink-muted">
            {t('Tells the site’s client users by email that this is waiting in their approvals.')}
          </span>
        </div>
      )}
      <EmailLog deliveries={emails} />
    </FadeIn>
  );
}

function HeaderStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-[12.5px] leading-tight text-ink-muted">{label}</dt>
      <dd className="font-mono text-[18px] font-bold leading-[1.1]">{value}</dd>
    </div>
  );
}
