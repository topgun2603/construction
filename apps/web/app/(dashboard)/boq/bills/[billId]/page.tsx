import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { ApiRequestError } from '@/lib/api';
import { serverFetch } from '@/lib/server-api';
import { requireSelf } from '@/lib/session';
import { getFormat } from '@/lib/format-server';
import { getT } from '@/lib/i18n-server';
import { BOQ_BILL_STATUS, BOQ_PAYMENT_STATUS, type BoqBillDetail } from '@/lib/boq-types';
import { Badge } from '@/components/ui/badge';
import { FadeIn } from '@/components/motion';
import { BoqBillEditor } from './bill-editor';

export const metadata = { title: 'Bill to client · BUILDR' };

/** One running bill to the client: claimed, certified, invoiced and followed to payment here. */
export default async function BoqBillPage({ params }: { params: Promise<{ billId: string }> }) {
  const t = await getT();
  const { shortDate } = await getFormat();
  const { billId } = await params;
  const me = await requireSelf();

  let bill: BoqBillDetail;
  try {
    bill = await serverFetch<BoqBillDetail>(`/boq-bills/${billId}`);
  } catch (error) {
    if (error instanceof ApiRequestError && (error.status === 404 || error.status === 403)) notFound();
    throw error;
  }
  const status = BOQ_BILL_STATUS[bill.status];
  const payment = BOQ_PAYMENT_STATUS[bill.payment_status];

  return (
    <FadeIn className="flex flex-col gap-5">
      <div className="flex flex-col gap-1.5">
        <Link
          href={`/projects/${bill.boq.project.id}?tab=boq`}
          className="inline-flex items-center gap-1 text-[12.5px] text-ink-faint hover:underline"
        >
          <ArrowLeft className="size-3 rtl:rotate-180" /> {bill.boq.project.name} · {bill.boq.title}
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="text-[21px] font-semibold leading-tight">RA-{bill.number}</h2>
          <Badge tone={status.tone}>{t(status.label)}</Badge>
          {bill.status === 'invoiced' && <Badge tone={payment.tone}>{t(payment.label)}</Badge>}
        </div>
        <span className="text-[13px] text-ink-muted">
          {bill.boq.project.client_name ? `${bill.boq.project.client_name} · ` : ''}
          {bill.period_from ? `${shortDate(bill.period_from)} – ` : `${t('to')} `}
          {shortDate(bill.period_to)}
          {bill.certified_by && ` · ${t('certificate recorded by')} ${bill.certified_by.name}`}
        </span>
      </div>

      <BoqBillEditor
        bill={bill}
        canBill={me.permissions.includes('boq.bill')}
        canSeePayments={me.permissions.includes('client_payments.view')}
      />
    </FadeIn>
  );
}
