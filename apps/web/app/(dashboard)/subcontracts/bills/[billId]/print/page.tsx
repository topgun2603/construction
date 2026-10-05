import { notFound } from 'next/navigation';
import { SUBCONTRACT_DEDUCTION_LABELS, taxRule } from '@sitebook/shared';
import { ApiRequestError } from '@/lib/api';
import { serverFetch } from '@/lib/server-api';
import { requireSelf } from '@/lib/session';
import { getFormat } from '@/lib/format-server';
import { getT } from '@/lib/i18n-server';
import type { RaBillDetail } from '@/lib/subcontract-types';
import { PrintButton } from '../../../../reports/wage-sheet/[id]/print-button';
import { percent } from '../../../labels';

export const metadata = { title: 'RA bill · BUILDR' };

/**
 * The running-account bill as paper: the measurement line by line, the abstract from gross to net
 * payable, and the signature blocks. Plain and black on white like the wage sheet, with `print:`
 * rules that drop the app chrome.
 */
export default async function RaBillPrintPage({ params }: { params: Promise<{ billId: string }> }) {
  const t = await getT();
  const { money, longDate, settings } = await getFormat();
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
  // Somebody who measures but cannot see the money has nothing to print.
  if (!bill.figures) notFound();
  const figures = bill.figures;
  const rule = taxRule(settings.taxRegime ?? 'none');
  const settled = bill.status === 'certified' || bill.status === 'paid';

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-5">
      <div className="flex items-start justify-between gap-4 print:hidden">
        <div>
          <h2 className="text-[21px] font-semibold">
            {t('RA bill')} {bill.number}
          </h2>
          <p className="text-[13.5px] text-ink-muted">
            {bill.subcontract.number} · {bill.subcontract.contractor.name}
          </p>
        </div>
        <PrintButton />
      </div>

      <div className="rounded-panel border border-line bg-surface p-6 print:rounded-none print:border-0 print:p-0">
        <header className="mb-5 flex items-start justify-between gap-4 border-b border-line pb-4">
          <div>
            <div className="text-[18px] font-semibold">{me.tenant.name}</div>
            <div className="text-[13.5px] text-ink-muted">
              {t('Running account bill')} RA-{bill.number} · {bill.subcontract.project.name}
            </div>
            <div className="mt-2 text-[13px]">
              <div className="font-medium">{bill.subcontract.contractor.name}</div>
              {bill.subcontract.contractor.address && <div>{bill.subcontract.contractor.address}</div>}
              {bill.subcontract.contractor.tax_id && (
                <div className="font-mono" dir="ltr">
                  {rule.idLabel ?? t('Tax number')}: {bill.subcontract.contractor.tax_id}
                </div>
              )}
            </div>
          </div>
          <div className="text-end text-[13px]">
            <div className="font-mono" dir="ltr">
              {bill.subcontract.number}
            </div>
            <div>{bill.subcontract.title}</div>
            <div className="mt-1 font-mono">
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
              <tr className="border-b border-line text-start">
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
              {bill.lines.map((line) => (
                <tr key={line.line_id} className="border-b border-line-soft">
                  <Td className="font-mono text-ink-muted">{line.item_code ?? ''}</Td>
                  <Td>
                    <div>{line.description}</div>
                    {line.cost_code && (
                      <div className="text-[11px] text-ink-muted">
                        {line.cost_code.code} {line.cost_code.name}
                      </div>
                    )}
                  </Td>
                  <Td className="text-end font-mono">
                    {line.contract_quantity} {line.unit}
                  </Td>
                  <Td className="text-end font-mono">{money(line.rate)}</Td>
                  <Td className="text-end font-mono">{line.previous_quantity}</Td>
                  <Td className="text-end font-mono">{line.certified_quantity ?? line.claimed_quantity}</Td>
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
              <Abstract
                label={`${t('Add')} ${rule.taxName ?? t('tax')} ${percent(figures.tax_rate_bp)}`}
                value={`+ ${money(figures.tax)}`}
              />
              <Abstract
                label={`${t('Less retention')} ${percent(bill.subcontract.retention_bp)}`}
                value={`− ${money(figures.retention)}`}
              />
              <Abstract label={t('Less advance recovery')} value={`− ${money(figures.advance_recovery)}`} />
              {bill.deductions.map((row) => (
                <Abstract
                  key={row.id}
                  label={`${t('Less')} ${t(SUBCONTRACT_DEDUCTION_LABELS[row.kind])}: ${row.description}`}
                  value={`− ${money(row.amount)}`}
                />
              ))}
              <Abstract label={t('Net payable')} value={money(figures.net_payable)} strong />
              <Abstract label={t('Retention held to date')} value={money(figures.retention_to_date)} />
            </tbody>
          </table>
        </div>

        {bill.certification_note && (
          <p className="mt-4 text-[12.5px]">
            {t('Certifier’s note')}: {bill.certification_note}
          </p>
        )}

        <footer className="mt-10 flex justify-between gap-8 text-[12.5px] text-ink-muted">
          <div className="border-t border-line pt-2">
            {t('Measured by')}
            {bill.submitted_by && <div className="text-ink">{bill.submitted_by.name}</div>}
          </div>
          <div className="border-t border-line pt-2">{t('Subcontractor signature')}</div>
          <div className="border-t border-line pt-2">
            {t('Certified by')}
            {bill.certified_by && <div className="text-ink">{bill.certified_by.name}</div>}
          </div>
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
