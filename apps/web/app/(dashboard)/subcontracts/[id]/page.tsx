import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { ApiRequestError } from '@/lib/api';
import { serverFetch } from '@/lib/server-api';
import { requireSelf } from '@/lib/session';
import { getFormat } from '@/lib/format-server';
import { getT } from '@/lib/i18n-server';
import type { SiteDocument } from '@/lib/api-types';
import type { CostCode } from '@/lib/cost-code-types';
import type { SubcontractDetail } from '@/lib/subcontract-types';
import { Badge } from '@/components/ui/badge';
import { FadeIn } from '@/components/motion';
import { SUBCONTRACT_STATUS } from '../labels';
import { SubcontractView } from './subcontract-view';

export const metadata = { title: 'Subcontract · BUILDR' };

/** One subcontract: its schedule, variations, RA bills, retention and statement. */
export default async function SubcontractPage({ params }: { params: Promise<{ id: string }> }) {
  const t = await getT();
  const { money, shortDate } = await getFormat();
  const { id } = await params;
  const me = await requireSelf();

  let subcontract: SubcontractDetail;
  try {
    subcontract = await serverFetch<SubcontractDetail>(`/subcontracts/${id}`);
  } catch (error) {
    if (error instanceof ApiRequestError && (error.status === 404 || error.status === 403)) {
      notFound();
    }
    throw error;
  }

  const can = (permission: string) => me.permissions.includes(permission);
  const canManage = can('subcontracts.manage');
  const hasDocuments = me.enabled_modules.includes('documents') && can('documents.view');
  // What a variation's lines can be coded to, and what can be linked: only for whoever can use them.
  const [costCodes, documents] = await Promise.all([
    canManage
      ? serverFetch<CostCode[]>(`/projects/${subcontract.project.id}/cost-codes`).catch(() => [])
      : ([] as CostCode[]),
    canManage && hasDocuments
      ? serverFetch<{ items: SiteDocument[] }>(`/documents?project_id=${subcontract.project.id}`)
          .then((page) => page.items)
          .catch(() => [] as SiteDocument[])
      : ([] as SiteDocument[]),
  ]);
  const status = SUBCONTRACT_STATUS[subcontract.status];

  return (
    <FadeIn className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-5">
        <div className="flex flex-col gap-1.5">
          <Link
            href="/subcontracts"
            className="inline-flex items-center gap-1 text-[12.5px] text-ink-faint hover:underline"
          >
            <ArrowLeft className="size-3 rtl:rotate-180" /> {t('Subcontracts')}
          </Link>
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="text-[21px] font-semibold leading-tight">{subcontract.title}</h2>
            <Badge tone={status.tone}>{t(status.label)}</Badge>
          </div>
          <span className="text-[13px] text-ink-muted">
            <span className="font-mono" dir="ltr">
              {subcontract.number}
            </span>{' '}
            · {subcontract.contractor.name} ·{' '}
            <Link href={`/projects/${subcontract.project.id}?tab=subcontracts`} className="hover:underline">
              {subcontract.project.name}
            </Link>
            {subcontract.start_date && ` · ${shortDate(subcontract.start_date)} – ${shortDate(subcontract.end_date)}`}
          </span>
        </div>
        {subcontract.current_value !== null && (
          <dl className="flex gap-7 pb-1">
            <HeaderStat label={t('Contract value')} value={money(subcontract.current_value)} />
            <HeaderStat label={t('Certified')} value={money(subcontract.certified)} />
            <HeaderStat label={t('Balance due')} value={money(subcontract.balance_due)} />
          </dl>
        )}
      </div>

      <SubcontractView
        subcontract={subcontract}
        costCodes={costCodes}
        documents={documents}
        can={{
          manage: canManage,
          measure: canManage || can('subcontracts.measure'),
          certify: can('subcontracts.certify'),
          pay: can('subcontracts.pay'),
          seeMoney: can('subcontracts.view'),
        }}
      />
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
