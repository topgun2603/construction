import Link from 'next/link';
import { notFound } from 'next/navigation';
import { AlertTriangle, ArrowLeft, CheckCircle2 } from 'lucide-react';
import { ApiRequestError } from '@/lib/api';
import { serverFetch } from '@/lib/server-api';
import { requireSelf } from '@/lib/session';
import type { PurchaseInvoice } from '@/lib/procurement-types';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { FadeIn } from '@/components/motion';
import { cn } from '@/lib/utils';
import { getT } from '@/lib/i18n-server';
import { getFormat } from '@/lib/format-server';
import { FLAG_LABEL, INVOICE_STATUS, percent } from '../../status';
import { InvoiceDecision } from './invoice-decision';

export const metadata = { title: 'Supplier invoice · BUILDR' };

/**
 * The matching screen: for every line, what was ordered, what was received and what is billed,
 * side by side, with whatever the three-way match flagged marked on the line it is about.
 */
export default async function PurchaseInvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const t = await getT();
  const { money, shortDate, instantDate } = await getFormat();
  const { id } = await params;
  const me = await requireSelf();

  let invoice: PurchaseInvoice;
  try {
    invoice = await serverFetch<PurchaseInvoice>(`/purchase-invoices/${id}`);
  } catch (error) {
    if (error instanceof ApiRequestError && (error.status === 404 || error.status === 403)) notFound();
    throw error;
  }
  const status = INVOICE_STATUS[invoice.status];
  const flagged = (lineId: string, type: string) =>
    invoice.flags.some((flag) => flag.po_line_id === lineId && flag.type === type);
  const flaggedCell = (on: boolean) => (on ? 'bg-blocked-bg text-blocked-fg font-semibold' : '');

  return (
    <FadeIn className="flex flex-col gap-5">
      <div className="flex flex-col gap-1.5">
        <Link
          href="/procurement/invoices"
          className="inline-flex items-center gap-1 text-[12.5px] text-ink-faint hover:underline"
        >
          <ArrowLeft className="size-3 rtl:rotate-180" /> {t('Supplier invoices')}
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="text-[21px] font-semibold leading-tight">
            {invoice.vendor.name} · <span className="font-mono">{invoice.invoice_number}</span>
          </h2>
          <Badge tone={status.tone}>{t(status.label)}</Badge>
        </div>
        <span className="text-[13px] text-ink-muted">
          {shortDate(invoice.invoice_date)}
          {invoice.due_date && ` · ${t('due')} ${shortDate(invoice.due_date)}`} ·{' '}
          <Link href={`/procurement/orders/${invoice.purchase_order_id}`} className="font-mono hover:underline">
            {invoice.purchase_order_number}
          </Link>{' '}
          · {invoice.project_name} · {t('recorded by')} {invoice.recorded_by.name}
        </span>
      </div>

      {invoice.flags.length > 0 && invoice.status !== 'rejected' ? (
        <Card className="flex items-start gap-3 p-4">
          <AlertTriangle className="mt-0.5 size-5 flex-none text-blocked-fg" />
          <div className="flex flex-col gap-1 text-[13px]">
            <span className="text-[14px] font-semibold">
              {t('This invoice does not match the order and the deliveries')}
            </span>
            <ul className="flex flex-col gap-0.5">
              {invoice.flags.map((flag, index) => {
                const line = invoice.lines.find((row) => row.po_line_id === flag.po_line_id);
                const money_ = flag.type === 'price_variance' || flag.type === 'tax_variance';
                return (
                  <li key={index}>
                    <span className="font-medium">{t(FLAG_LABEL[flag.type])}</span> — {line?.description}:{' '}
                    {t('expected')} {money_ ? money(flag.expected) : `${flag.expected} ${line?.unit ?? ''}`},{' '}
                    {t('invoice says')} {money_ ? money(flag.actual) : `${flag.actual} ${line?.unit ?? ''}`}
                  </li>
                );
              })}
            </ul>
            <span className="text-ink-muted">
              {t('Tolerance')}: {percent(invoice.tolerance_bp)}
            </span>
          </div>
        </Card>
      ) : invoice.status !== 'rejected' ? (
        <Card className="flex items-center gap-3 p-4 text-[13.5px]">
          <CheckCircle2 className="size-5 text-done" />
          {t('Matches the order’s rates and tax, and nothing is billed beyond what was received.')}
        </Card>
      ) : null}

      <Card className="flex flex-col">
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-line-soft text-[11.5px] uppercase tracking-[0.06em] text-ink-muted">
                <th className="px-4 py-2.5 text-start font-semibold">{t('Item')}</th>
                <th className="px-3 py-2.5 text-end font-semibold">{t('Ordered')}</th>
                <th className="px-3 py-2.5 text-end font-semibold">{t('Received')}</th>
                <th className="px-3 py-2.5 text-end font-semibold">{t('Billed')}</th>
                <th className="px-3 py-2.5 text-end font-semibold">{t('Order rate')}</th>
                <th className="px-3 py-2.5 text-end font-semibold">{t('Invoice rate')}</th>
                <th className="px-3 py-2.5 text-end font-semibold">{t('Tax')}</th>
                <th className="px-4 py-2.5 text-end font-semibold">{t('Amount')}</th>
              </tr>
            </thead>
            <tbody>
              {invoice.lines.map((line) => (
                <tr key={line.id} className="border-b border-line-soft last:border-0">
                  <td className="px-4 py-2.5">
                    <div className="flex flex-col">
                      <span className="font-medium">{line.description}</span>
                      <span className="text-[11.5px] text-ink-muted">
                        {line.cost_code ? `${line.cost_code.code} · ${line.cost_code.name}` : t('Unallocated')}
                      </span>
                    </div>
                  </td>
                  <td className="px-3 py-2.5 text-end font-mono">
                    {line.ordered_quantity} <span className="text-[11.5px] text-ink-muted">{line.unit}</span>
                  </td>
                  <td className="px-3 py-2.5 text-end font-mono">{line.received_quantity}</td>
                  <td
                    className={cn(
                      'px-3 py-2.5 text-end font-mono',
                      flaggedCell(
                        flagged(line.po_line_id, 'over_billed_qty') || flagged(line.po_line_id, 'billed_not_received'),
                      ),
                    )}
                  >
                    {line.quantity}
                  </td>
                  <td className="px-3 py-2.5 text-end font-mono text-ink-muted">{money(line.ordered_unit_rate)}</td>
                  <td className={cn('px-3 py-2.5 text-end font-mono', flaggedCell(flagged(line.po_line_id, 'price_variance')))}>
                    {money(line.unit_rate)}
                  </td>
                  <td className={cn('px-3 py-2.5 text-end font-mono', flaggedCell(flagged(line.po_line_id, 'tax_variance')))}>
                    {money(line.tax_amount)}
                    <span className="block text-[11px] font-normal text-ink-muted">
                      {t('order')} {percent(line.ordered_tax_rate_bp)}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-end font-mono">{money(line.amount)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot className="text-[13px]">
              <tr className="border-t border-line-soft">
                <td colSpan={7} className="px-4 pt-2.5 text-end text-ink-muted">{t('Subtotal')}</td>
                <td className="px-4 pt-2.5 text-end font-mono">{money(invoice.subtotal)}</td>
              </tr>
              <tr>
                <td colSpan={7} className="px-4 text-end text-ink-muted">{t('Tax')}</td>
                <td className="px-4 text-end font-mono">{money(invoice.tax_total)}</td>
              </tr>
              <tr>
                <td colSpan={7} className="px-4 pb-3 text-end font-semibold">{t('Total')}</td>
                <td className="px-4 pb-3 text-end font-mono font-semibold">{money(invoice.total)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="flex flex-col gap-2 p-4 text-[13px]">
          {invoice.status === 'approved' && invoice.approved_by && invoice.approved_at && (
            <span>
              {t('Approved by')} {invoice.approved_by.name}, {instantDate(invoice.approved_at)}.{' '}
              {t('Booked as expenses on the site, against each line’s cost code.')}
            </span>
          )}
          {invoice.status === 'rejected' && invoice.approved_by && (
            <span>
              {t('Rejected by')} {invoice.approved_by.name}
            </span>
          )}
          {invoice.decision_note && (
            <span>
              <span className="text-ink-muted">{t('Decision note')}:</span> {invoice.decision_note}
            </span>
          )}
          {invoice.note && (
            <span>
              <span className="text-ink-muted">{t('Note')}:</span> {invoice.note}
            </span>
          )}
          <InvoiceDecision
            invoice={invoice}
            canRecord={me.permissions.includes('procurement.invoices')}
            canApproveOrders={me.permissions.includes('procurement.approve')}
          />
        </Card>
      </div>
    </FadeIn>
  );
}
