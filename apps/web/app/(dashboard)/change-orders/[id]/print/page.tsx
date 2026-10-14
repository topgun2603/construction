import { notFound } from 'next/navigation';
import { CHANGE_ORDER_REASON_LABELS, basisPointsToPercent, taxRule } from '@sitebook/shared';
import { ApiRequestError } from '@/lib/api';
import { serverFetch } from '@/lib/server-api';
import { requireSelf } from '@/lib/session';
import { getFormat } from '@/lib/format-server';
import { getT } from '@/lib/i18n-server';
import type { ChangeOrderDetail } from '@/lib/change-order-types';
import { PrintButton } from '../../../reports/wage-sheet/[id]/print-button';
import { CHANGE_ORDER_STATUS, changeOrderDaysText } from '../../labels';

export const metadata = { title: 'Change order · BUILDR' };

/**
 * The change order as paper, for the client to sign or for the file: what changed and why, the
 * work line by line with the client's price, the time it adds, and the signature blocks. Plain and
 * black on white like the wage sheet and the RA bill, with `print:` rules that drop the app chrome.
 *
 * The lines print as work and quantities, and the money as the client's price only: this is the
 * document that goes to the client, and a line's amount is the builder's cost — their business.
 */
export default async function ChangeOrderPrintPage({ params }: { params: Promise<{ id: string }> }) {
  const t = await getT();
  const { money, longDate, settings } = await getFormat();
  const { id } = await params;
  const me = await requireSelf();

  let co: ChangeOrderDetail;
  try {
    co = await serverFetch<ChangeOrderDetail>(`/change-orders/${id}`);
  } catch (error) {
    if (error instanceof ApiRequestError && (error.status === 404 || error.status === 403)) {
      notFound();
    }
    throw error;
  }
  const rule = taxRule(settings.taxRegime ?? 'none');
  const status = CHANGE_ORDER_STATUS[co.status];

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-5">
      <div className="flex items-start justify-between gap-4 print:hidden">
        <div>
          <h2 className="text-[21px] font-semibold">{co.label}</h2>
          <p className="text-[13.5px] text-ink-muted">
            {co.title} · {co.project.name}
          </p>
        </div>
        <PrintButton />
      </div>

      <div className="rounded-panel border border-line bg-surface p-6 print:rounded-none print:border-0 print:p-0">
        <header className="mb-5 flex items-start justify-between gap-4 border-b border-line pb-4">
          <div>
            <div className="text-[18px] font-semibold">{me.tenant.name}</div>
            <div className="text-[13.5px] text-ink-muted">
              {t('Change order')} · {co.project.name}
            </div>
          </div>
          <div className="text-end text-[13px]">
            <div className="font-mono text-[15px] font-semibold" dir="ltr">
              {co.label}
            </div>
            <div>
              {t('Raised on')} {longDate(co.raised_on)}
            </div>
            <div>{t(status.label)}</div>
          </div>
        </header>

        <section className="mb-5 flex flex-col gap-1.5 text-[13.5px]">
          <div className="text-[16px] font-semibold">{co.title}</div>
          <div>
            <span className="text-ink-muted">{t('Reason')}:</span> {t(CHANGE_ORDER_REASON_LABELS[co.reason])}
          </div>
          {co.description && <p className="whitespace-pre-wrap leading-relaxed">{co.description}</p>}
        </section>

        <table className="w-full text-[12.5px]">
          <thead>
            <tr className="border-b border-line">
              <Th>#</Th>
              <Th>{t('Description of the work')}</Th>
              <Th className="text-end">{t('Quantity')}</Th>
            </tr>
          </thead>
          <tbody>
            {co.lines.map((line, index) => (
              <tr key={line.id} className="border-b border-line-soft">
                <Td className="font-mono text-ink-muted">{index + 1}</Td>
                <Td>{line.description}</Td>
                <Td className="text-end font-mono">{line.quantity ? `${line.quantity} ${line.unit ?? ''}` : t('Lump sum')}</Td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="mt-5 flex justify-end">
          <table className="w-full max-w-sm text-[13px]">
            <tbody>
              <Abstract label={t('Price of this change')} value={money(co.client_price)} />
              <Abstract
                label={`${rule.taxName ?? t('Tax')} ${basisPointsToPercent(co.tax_rate_bp)}%`}
                value={money(co.tax)}
              />
              <Abstract label={t('Total')} value={money(co.client_total)} strong />
              <Abstract label={t('Effect on the handover date')} value={changeOrderDaysText(co.time_impact_days, t)} />
            </tbody>
          </table>
        </div>

        {co.client_decided_by && (
          <p className="mt-4 text-[12.5px]">
            {co.status === 'rejected' ? t('Rejected by') : t('Approved by')} {co.client_decided_by.name}
            {co.client_note && ` — “${co.client_note}”`}
          </p>
        )}

        <footer className="mt-12 flex justify-between gap-8 text-[12.5px] text-ink-muted">
          <div className="border-t border-line pt-2">
            {t('Prepared by')}
            {co.raised_by && <div className="text-ink">{co.raised_by.name}</div>}
          </div>
          <div className="border-t border-line pt-2">
            {t('Approved for the builder')}
            {co.approved_by && <div className="text-ink">{co.approved_by.name}</div>}
          </div>
          <div className="border-t border-line pt-2">{t('Client signature')}</div>
        </footer>
      </div>
    </div>
  );
}

function Th({ children, className = '' }: { children?: React.ReactNode; className?: string }) {
  return (
    <th className={`px-2 py-2 text-[11px] font-semibold uppercase tracking-[0.06em] ${className || 'text-start'}`}>
      {children}
    </th>
  );
}

function Td({ children, className = '' }: { children?: React.ReactNode; className?: string }) {
  return <td className={`px-2 py-2 align-top ${className}`}>{children}</td>;
}

function Abstract({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <tr className={strong ? 'border-t border-line font-semibold' : undefined}>
      <td className="py-1 pe-4">{label}</td>
      <td className="py-1 text-end font-mono">{value}</td>
    </tr>
  );
}
