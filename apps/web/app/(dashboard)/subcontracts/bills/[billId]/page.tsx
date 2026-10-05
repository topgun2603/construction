import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { ApiRequestError } from '@/lib/api';
import { serverFetch } from '@/lib/server-api';
import { requireSelf } from '@/lib/session';
import { getFormat } from '@/lib/format-server';
import { getT } from '@/lib/i18n-server';
import type { CostCode } from '@/lib/cost-code-types';
import type { RaBillDetail } from '@/lib/subcontract-types';
import { Badge } from '@/components/ui/badge';
import { FadeIn } from '@/components/motion';
import { BILL_STATUS } from '../../labels';
import { BillEditor } from './bill-editor';

export const metadata = { title: 'RA bill · BUILDR' };

/** One running-account bill: measured, certified and paid here. */
export default async function RaBillPage({ params }: { params: Promise<{ billId: string }> }) {
  const t = await getT();
  const { shortDate } = await getFormat();
  const { billId } = await params;
  const me = await requireSelf();

  let bill: RaBillDetail;
  try {
    bill = await serverFetch<RaBillDetail>(`/subcontract-bills/${billId}`);
  } catch (error) {
    if (error instanceof ApiRequestError && (error.status === 404 || error.status === 403)) {
      notFound();
    }
    throw error;
  }
  const can = (permission: string) => me.permissions.includes(permission);
  const measure = can('subcontracts.manage') || can('subcontracts.measure');
  // Back-charges are booked to a line; whoever can enter one gets the site's codes to pick from.
  const costCodes =
    measure || can('subcontracts.certify')
      ? await serverFetch<CostCode[]>(`/projects/${bill.subcontract.project.id}/cost-codes`).catch(
          () => [] as CostCode[],
        )
      : [];
  const status = BILL_STATUS[bill.status];

  return (
    <FadeIn className="flex flex-col gap-5">
      <div className="flex flex-col gap-1.5">
        <Link
          href={`/subcontracts/${bill.subcontract.id}`}
          className="inline-flex items-center gap-1 text-[12.5px] text-ink-faint hover:underline"
        >
          <ArrowLeft className="size-3 rtl:rotate-180" /> {bill.subcontract.number} · {bill.subcontract.title}
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="text-[21px] font-semibold leading-tight">RA-{bill.number}</h2>
          <Badge tone={status.tone}>{t(status.label)}</Badge>
        </div>
        <span className="text-[13px] text-ink-muted">
          {bill.subcontract.contractor.name} · {bill.subcontract.project.name} ·{' '}
          {bill.period_from ? `${shortDate(bill.period_from)} – ` : `${t('to')} `}
          {shortDate(bill.period_to)}
          {bill.certified_by && ` · ${t('certified by')} ${bill.certified_by.name}`}
        </span>
      </div>

      <BillEditor
        bill={bill}
        costCodes={costCodes}
        can={{
          measure,
          certify: can('subcontracts.certify'),
          pay: can('subcontracts.pay'),
        }}
      />
    </FadeIn>
  );
}
