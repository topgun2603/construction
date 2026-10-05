import { notFound } from 'next/navigation';
import { ApiRequestError } from '@/lib/api';
import { serverFetch } from '@/lib/server-api';
import { requireSelf } from '@/lib/session';
import { getFormat } from '@/lib/format-server';
import { getT } from '@/lib/i18n-server';
import { boqPercent, type BoqBillDetail } from '@/lib/boq-types';
import { PrintButton } from '../../../../reports/wage-sheet/[id]/print-button';

export const metadata = { title: 'Bill to client · BUILDR' };

/**
 * The running bill to the client as paper: the measurement abstract item by item, the figures from
 * gross down to net receivable, and the signature blocks. Plain and black on white like the wage
 * sheet and the subcontract RA bill, with `print:` rules that drop the app chrome.
 */
export default async function BoqBillPrintPage({ params }: { params: Promise<{ billId: string }> }) {
  const t = await getT();
  const { money, longDate } = await getFormat();
  const { billId } = await params;
  const me = await requireSelf();

  let bill: BoqBillDetail;
  try {
    bill = await serverFetch<BoqBillDetail>(`/boq-bills/${billId}`);
  } catch (error) {
    if (error instanceof ApiRequestError && (error.status === 404 || error.status === 403)) notFound();
    throw error;
  }
  const figures = bill.figures;
  const settled = bill.status === 'certified' || bill.status === 'invoiced';
  // Items nothing has been done on yet are noise on paper; the bill is about what moved.
  const lines = bill.lines.filter((line) => line.value_to_date !== '0');
  const qty = (line: BoqBillDetail['lines'][number]) => line.certified_quantity ?? line.claimed_quantity;

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-5">
      <div className="flex items-start justify-between gap-4 print:hidden">
        <div>
          <h2 className="text-[21px] font-semibold">
            {t('Running account bill')} RA-{bill.number}
          </h2>
          <p className="text-[13.5px] text-ink-muted">
            {bill.boq.project.name} · {bill.boq.title}
          </p>
        </div>
        <PrintButton />
      </div>

      <div className="rounded-panel border border-line bg-surface p-6 print:rounded-none print:border-0 print:p-0">
        <header className="mb-5 flex items-start justify-between gap-4 border-b border-line pb-4">
          <div>
            <div className="text-[18px] font-semibold">{me.tenant.name}</div>
            <div className="text-[13.5px] text-ink-muted">
              {t('Running account bill')} RA-{bill.number} · {bill.boq.title}
            </div>
            <div className="mt-2 text-[13px]">
              <div className="text-ink-muted">{t('To')}</div>
              <div className="font-medium">{bill.boq.project.client_name ?? t('The client')}</div>
              <div>{bill.boq.project.name}</div>
              {bill.boq.project.address && <div>{bill.boq.project.address}</div>}
            </div>
          </div>
          <div className="text-end text-[13px]">
            <div className="font-mono">
              {bill.period_from ? `${longDate(bill.period_from)} – ` : `${t('to')} `}
              {longDate(bill.period_to)}
            </div>
            <div>
              {t('Bill date')} {longDate(bill.bill_date)}
            </div>
            {!settled && <div className="mt-1 font-semibold">{t('Not yet certified')}</div>}
          </div>
        </header>

        <div className="overflow-x-auto">
          <table className="w-full text-[12.5px]">
            <thead>
              <tr className="border-b border-line">
                <Th>{t('Item')}</Th>
                <Th>{t('Description')}</Th>
                <Th className="text-end">{t('Contract qty')}</Th>
                <Th className="text-end">{t('Rate')}</Th>
                <Th className="text-end">{t('Previous qty')}</Th>
                <Th className="text-end">{t('Qty to date')}</Th>
                <Th className="text-end">{t('Value to date')}</Th>
                <Th className="text-end">{t('This bill')}</Th>
              </tr>
            </thead>
            <tbody>
              {lines.map((line) => (
                <tr key={line.item_id} className="border-b border-line-soft">
                  <Td className="font-mono text-ink-muted">{line.item_no}</Td>
                  <Td>
                    <div>{line.description}</div>
                    {line.section && <div className="text-[11px] text-ink-muted">{line.section}</div>}
                  </Td>
                  <Td className="text-end font-mono">
                    {line.contract_quantity} {line.unit}
                  </Td>
                  <Td className="text-end font-mono">{money(line.rate)}</Td>
                  <Td className="text-end font-mono">{line.previous_quantity}</Td>
                  <Td className="text-end font-mono">{qty(line)}</Td>
                  <Td className="text-end font-mono">{money(line.value_to_date)}</Td>
                  <Td className="text-end font-mono font-semibold">{money(line.this_bill)}</Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="mt-5 flex justify-end">
          <table className="w-full max-w-sm text-[13px]">
            <tbody>
              <Abstract label={t('Gross value of work to date')} value={money(figures.gross_to_date)} />
              <Abstract label={t('Less previously certified')} value={`− ${money(figures.previous_gross)}`} />
              <Abstract label={t('Gross this bill')} value={money(figures.gross)} strong />
              {bill.status !== 'draft' && figures.claimed_gross !== figures.gross && (
                <Abstract label={t('As claimed')} value={money(figures.claimed_gross)} />
              )}
              <Abstract
                label={`${t('Less retention')} ${boqPercent(bill.boq.retention_bp)}`}
                value={`− ${money(figures.retention)}`}
              />
              <Abstract
                label={`${t('Less advance recovery')} ${boqPercent(bill.boq.advance_recovery_bp)}`}
                value={`− ${money(figures.advance_recovery)}`}
              />
              <Abstract
                label={`${t('Add')} ${bill.boq.tax_name ?? t('tax')} ${boqPercent(figures.tax_rate_bp)}`}
                value={`+ ${money(figures.tax)}`}
              />
              <Abstract label={t('Net receivable')} value={money(figures.net_payable)} strong />
              <Abstract label={t('Retention held to date')} value={money(figures.retention_to_date)} />
              <Abstract label={t('Advance recovered to date')} value={money(figures.advance_recovered_to_date)} />
            </tbody>
          </table>
        </div>

        {bill.certification_note && (
          <p className="mt-4 text-[12.5px]">
            {t('Certificate')}: {bill.certification_note}
          </p>
        )}

        <footer className="mt-10 flex justify-between gap-8 text-[12.5px] text-ink-muted">
          <div className="border-t border-line pt-2">
            {t('Prepared by')}
            {bill.submitted_by && <div className="text-ink">{bill.submitted_by.name}</div>}
          </div>
          <div className="border-t border-line pt-2">{t('Engineer-in-charge')}</div>
          <div className="border-t border-line pt-2">{t('Certified by the client')}</div>
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
