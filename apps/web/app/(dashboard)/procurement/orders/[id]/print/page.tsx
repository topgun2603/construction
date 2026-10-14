import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { taxRule } from '@sitebook/shared';
import { ApiRequestError } from '@/lib/api';
import { serverFetch } from '@/lib/server-api';
import { requireSelf } from '@/lib/session';
import type { PurchaseOrder } from '@/lib/procurement-types';
import { getT } from '@/lib/i18n-server';
import { getFormat } from '@/lib/format-server';
import { percent } from '../../../status';
import { PrintButton } from './print-button';

export const metadata = { title: 'Purchase order · Print · BUILDR' };

/**
 * The order as it goes to the supplier, printed or saved as a PDF from the browser.
 *
 * Plain on purpose, like the wage sheet: black on white under `print:`, the app's chrome dropped
 * by the global print rules, and a signature line — a supplier who receives an unsigned order
 * from a builder they do not know rings to check it.
 */
export default async function PrintPurchaseOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const t = await getT();
  const { money, shortDate } = await getFormat();
  const { id } = await params;
  const me = await requireSelf();

  let order: PurchaseOrder;
  try {
    order = await serverFetch<PurchaseOrder>(`/purchase-orders/${id}`);
  } catch (error) {
    if (error instanceof ApiRequestError && (error.status === 404 || error.status === 403)) notFound();
    throw error;
  }
  if (order.total === null) notFound();

  const rule = taxRule(me.tenant.tax_regime);
  const draft = order.status === 'draft' || order.status === 'pending_approval';

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-4 print:hidden">
        <Link
          href={`/procurement/orders/${order.id}`}
          className="inline-flex items-center gap-1 text-[12.5px] text-ink-faint hover:underline"
        >
          <ArrowLeft className="size-3 rtl:rotate-180" /> {order.number}
        </Link>
        <PrintButton />
      </div>

      <article className="flex flex-col gap-6 rounded-panel border border-line bg-surface p-8 text-[13px] print:rounded-none print:border-0 print:p-0">
        <header className="flex flex-wrap items-start justify-between gap-6">
          <div className="flex flex-col gap-1">
            <span className="text-[20px] font-semibold">{me.tenant.name}</span>
            <span className="text-ink-muted">{t('Purchase order')}</span>
          </div>
          <dl className="grid grid-cols-[auto_auto] gap-x-4 gap-y-1">
            <dt className="text-ink-muted">{t('Order number')}</dt>
            <dd className="font-mono font-semibold">{order.number}</dd>
            <dt className="text-ink-muted">{t('Date')}</dt>
            <dd>{shortDate((order.approved_at ?? order.created_at).slice(0, 10))}</dd>
            {order.expected_on && (
              <>
                <dt className="text-ink-muted">{t('Deliver by')}</dt>
                <dd>{shortDate(order.expected_on)}</dd>
              </>
            )}
          </dl>
        </header>

        {draft && (
          <p className="rounded-btn border border-line-strong px-3 py-2 font-semibold">
            {t('DRAFT — not yet approved. Do not supply against this copy.')}
          </p>
        )}

        <section className="grid gap-6 sm:grid-cols-2">
          <div className="flex flex-col gap-0.5">
            <span className="text-[11.5px] font-semibold uppercase tracking-[0.08em] text-ink-muted">{t('Supplier')}</span>
            <span className="font-semibold">{order.vendor.name}</span>
            {order.vendor.contact_name && <span>{order.vendor.contact_name}</span>}
            {order.vendor.address && <span className="whitespace-pre-line">{order.vendor.address}</span>}
            {order.vendor.phone && <span>+{order.vendor.phone}</span>}
            {order.vendor.email && <span>{order.vendor.email}</span>}
            {order.vendor.tax_id && rule.idLabel && (
              <span>
                {rule.idLabel}: <span className="font-mono">{order.vendor.tax_id}</span>
              </span>
            )}
          </div>
          <div className="flex flex-col gap-0.5">
            <span className="text-[11.5px] font-semibold uppercase tracking-[0.08em] text-ink-muted">{t('Deliver to')}</span>
            <span className="font-semibold">{order.project_name}</span>
            <span className="whitespace-pre-line">{order.delivery_address ?? order.project_address ?? ''}</span>
          </div>
        </section>

        <table className="w-full">
          <thead>
            <tr className="border-b border-ink text-[11.5px] uppercase tracking-[0.06em]">
              <th className="py-2 pe-2 text-start font-semibold">#</th>
              <th className="py-2 pe-2 text-start font-semibold">{t('Item')}</th>
              <th className="py-2 pe-2 text-end font-semibold">{t('Qty')}</th>
              <th className="py-2 pe-2 text-start font-semibold">{t('Unit')}</th>
              <th className="py-2 pe-2 text-end font-semibold">{t('Rate')}</th>
              <th className="py-2 pe-2 text-end font-semibold">{rule.taxName ?? t('Tax')}</th>
              <th className="py-2 text-end font-semibold">{t('Amount')}</th>
            </tr>
          </thead>
          <tbody>
            {order.lines.map((line, index) => (
              <tr key={line.id} className="border-b border-line-soft">
                <td className="py-2 pe-2">{index + 1}</td>
                <td className="py-2 pe-2">{line.description}</td>
                <td className="py-2 pe-2 text-end font-mono">{line.quantity}</td>
                <td className="py-2 pe-2">{line.unit}</td>
                <td className="py-2 pe-2 text-end font-mono">{money(line.unit_rate)}</td>
                <td className="py-2 pe-2 text-end font-mono">
                  {percent(line.tax_rate_bp)} · {money(line.tax_amount)}
                </td>
                <td className="py-2 text-end font-mono">{money(line.total)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={6} className="pt-3 pe-2 text-end">
                {t('Subtotal')}
              </td>
              <td className="pt-3 text-end font-mono">{money(order.subtotal)}</td>
            </tr>
            <tr>
              <td colSpan={6} className="pe-2 text-end">
                {rule.taxName ?? t('Tax')}
              </td>
              <td className="text-end font-mono">{money(order.tax_total)}</td>
            </tr>
            <tr>
              <td colSpan={6} className="pb-2 pe-2 text-end font-semibold">
                {t('Total')}
              </td>
              <td className="pb-2 text-end font-mono font-semibold">{money(order.total)}</td>
            </tr>
          </tfoot>
        </table>

        {(order.notes || order.vendor.payment_terms_days !== null) && (
          <section className="flex flex-col gap-1">
            {order.vendor.payment_terms_days !== null && (
              <span>
                {t('Payment terms')}: {order.vendor.payment_terms_days} {t('days from invoice')}
              </span>
            )}
            {order.notes && <span className="whitespace-pre-line">{order.notes}</span>}
            <span>{t('Please quote the order number on your delivery note and invoice.')}</span>
          </section>
        )}

        <footer className="mt-8 flex flex-wrap justify-between gap-8">
          <div className="flex flex-col gap-1">
            <span className="text-ink-muted">{t('Raised by')}</span>
            <span>{order.created_by.name}</span>
          </div>
          <div className="flex min-w-[220px] flex-col gap-1">
            <span className="h-10 border-b border-ink" />
            <span className="text-ink-muted">
              {t('Approved by')} {order.approved_by?.name ?? ''}
            </span>
          </div>
        </footer>
      </article>
    </div>
  );
}
