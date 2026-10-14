import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, Pencil, Printer } from 'lucide-react';
import { RECEIVABLE_PO_STATUSES, INVOICEABLE_PO_STATUSES } from '@sitebook/shared';
import { ApiRequestError } from '@/lib/api';
import { serverFetch } from '@/lib/server-api';
import { requireSelf } from '@/lib/session';
import type { Material, Page, ProjectSummary } from '@/lib/api-types';
import type { PurchaseOrder, Vendor } from '@/lib/procurement-types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { FadeIn } from '@/components/motion';
import { getT } from '@/lib/i18n-server';
import { getFormat } from '@/lib/format-server';
import { INVOICE_STATUS, ORDER_STATUS, percent } from '../../status';
import { OrderFormDialog } from '../../order-form-dialog';
import { OrderActions } from './order-actions';
import { ReceiveGoodsDialog } from './receive-goods-dialog';
import { RecordInvoiceDialog } from './record-invoice-dialog';

export const metadata = { title: 'Purchase order · BUILDR' };

/**
 * One purchase order: its lines with what has been received and billed on each, the deliveries,
 * the invoices, and the actions its status allows. Prices are hidden from somebody who only signs
 * for deliveries.
 */
export default async function PurchaseOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const t = await getT();
  const { money, shortDate, instantDate } = await getFormat();
  const { id } = await params;
  const me = await requireSelf();

  let order: PurchaseOrder;
  try {
    order = await serverFetch<PurchaseOrder>(`/purchase-orders/${id}`);
  } catch (error) {
    if (error instanceof ApiRequestError && (error.status === 404 || error.status === 403)) notFound();
    throw error;
  }

  const can = (permission: string) => me.permissions.includes(permission);
  const canManage = can('procurement.manage');
  const showMoney = order.total !== null;
  const status = ORDER_STATUS[order.status];

  const [projects, vendors, materials] =
    canManage && order.status === 'draft'
      ? await Promise.all([
          serverFetch<Page<ProjectSummary>>('/projects?limit=200'),
          serverFetch<Vendor[]>('/vendors'),
          serverFetch<Page<Material>>('/materials?limit=500'),
        ])
      : [null, [] as Vendor[], null];

  return (
    <FadeIn className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-1.5">
          <Link
            href="/procurement"
            className="inline-flex items-center gap-1 text-[12.5px] text-ink-faint hover:underline"
          >
            <ArrowLeft className="size-3 rtl:rotate-180" /> {t('Purchase orders')}
          </Link>
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="font-mono text-[21px] font-semibold leading-tight">{order.number}</h2>
            <Badge tone={status.tone}>{t(status.label)}</Badge>
          </div>
          <span className="text-[13px] text-ink-muted">
            <Link href={`/procurement/vendors/${order.vendor.id}`} className="hover:underline">
              {order.vendor.name}
            </Link>{' '}
            ·{' '}
            <Link href={`/projects/${order.project_id}?tab=purchases`} className="hover:underline">
              {order.project_name}
            </Link>{' '}
            · {t('raised by')} {order.created_by.name} {shortDate(order.created_at.slice(0, 10))}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {canManage && order.status === 'draft' && projects && (
            <OrderFormDialog
              projects={projects.items}
              vendors={vendors}
              materials={materials?.items ?? []}
              order={order}
              trigger={
                <Button size="sm" variant="secondary">
                  <Pencil className="size-4" /> {t('Edit')}
                </Button>
              }
            />
          )}
          {showMoney && (
            <Button asChild size="sm" variant="secondary">
              <Link href={`/procurement/orders/${order.id}/print`}>
                <Printer className="size-4" /> {t('Print')}
              </Link>
            </Button>
          )}
          {can('procurement.receive') && RECEIVABLE_PO_STATUSES.includes(order.status) && (
            <ReceiveGoodsDialog order={order} />
          )}
          {can('procurement.invoices') && showMoney && INVOICEABLE_PO_STATUSES.includes(order.status) && (
            <RecordInvoiceDialog order={order} />
          )}
        </div>
      </div>

      <OrderActions order={order} canManage={canManage} canApprove={can('procurement.approve')} />

      {order.status === 'pending_approval' && order.approval && (
        <Card className="flex flex-col gap-1 p-4">
          <span className="text-[14px] font-semibold">{t('Waiting for approval')}</span>
          <span className="text-[13px] text-ink-muted">
            {order.approval.approvers.length > 0
              ? `${t('Can approve it')}: ${order.approval.approvers.map((person) => person.name).join(', ')}`
              : t('Nobody but the owner has a limit that covers this order.')}
            {can('procurement.approve') && !order.approval.can_approve && (
              <>
                {' '}
                · {t('Your limit')}:{' '}
                {order.approval.my_limit === null ? t('unlimited') : money(order.approval.my_limit)}
              </>
            )}
          </span>
        </Card>
      )}
      {order.decision_note && (
        <Card className="p-4 text-[13px]">
          <span className="font-semibold">
            {order.status === 'draft' ? t('Sent back') : t('Approval note')}:
          </span>{' '}
          {order.decision_note}
          {order.approved_by && order.approved_at && (
            <span className="text-ink-muted">
              {' '}
              — {order.approved_by.name}, {instantDate(order.approved_at)}
            </span>
          )}
        </Card>
      )}

      <Card className="flex flex-col">
        <div className="overflow-x-auto">
          <table className="w-full text-[13.5px]">
            <thead>
              <tr className="border-b border-line-soft text-[12px] uppercase tracking-[0.06em] text-ink-muted">
                <th className="px-4 py-2.5 text-start font-semibold">{t('Item')}</th>
                <th className="px-3 py-2.5 text-start font-semibold">{t('Cost code')}</th>
                <th className="px-3 py-2.5 text-end font-semibold">{t('Ordered')}</th>
                <th className="px-3 py-2.5 text-end font-semibold">{t('Received')}</th>
                <th className="px-3 py-2.5 text-end font-semibold">{t('Billed')}</th>
                {showMoney && (
                  <>
                    <th className="px-3 py-2.5 text-end font-semibold">{t('Rate')}</th>
                    <th className="px-3 py-2.5 text-end font-semibold">{t('Tax')}</th>
                    <th className="px-4 py-2.5 text-end font-semibold">{t('Total')}</th>
                  </>
                )}
              </tr>
            </thead>
            <tbody>
              {order.lines.map((line) => (
                <tr key={line.id} className="border-b border-line-soft last:border-0">
                  <td className="px-4 py-2.5 font-medium">{line.description}</td>
                  <td className="px-3 py-2.5 text-ink-muted">
                    {line.cost_code ? `${line.cost_code.code} · ${line.cost_code.name}` : t('Unallocated')}
                  </td>
                  <td className="px-3 py-2.5 text-end font-mono">
                    {line.quantity} <span className="text-[12px] text-ink-muted">{line.unit}</span>
                  </td>
                  <td className="px-3 py-2.5 text-end font-mono">{line.received_quantity}</td>
                  <td className="px-3 py-2.5 text-end font-mono">{line.billed_quantity}</td>
                  {showMoney && (
                    <>
                      <td className="px-3 py-2.5 text-end font-mono">{money(line.unit_rate)}</td>
                      <td className="px-3 py-2.5 text-end font-mono text-ink-muted">
                        {percent(line.tax_rate_bp)}
                      </td>
                      <td className="px-4 py-2.5 text-end font-mono">{money(line.total)}</td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
            {showMoney && (
              <tfoot className="text-[13px]">
                <tr className="border-t border-line-soft">
                  <td colSpan={7} className="px-4 pt-2.5 text-end text-ink-muted">
                    {t('Subtotal')}
                  </td>
                  <td className="px-4 pt-2.5 text-end font-mono">{money(order.subtotal)}</td>
                </tr>
                <tr>
                  <td colSpan={7} className="px-4 text-end text-ink-muted">
                    {t('Tax')}
                  </td>
                  <td className="px-4 text-end font-mono">{money(order.tax_total)}</td>
                </tr>
                <tr>
                  <td colSpan={7} className="px-4 pb-2.5 text-end font-semibold">
                    {t('Total')}
                  </td>
                  <td className="px-4 pb-2.5 text-end font-mono font-semibold">{money(order.total)}</td>
                </tr>
                <tr>
                  <td colSpan={7} className="px-4 pb-3 text-end text-ink-muted">
                    {t('Billed so far')}
                  </td>
                  <td className="px-4 pb-3 text-end font-mono">{money(order.billed_total)}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="flex flex-col gap-2 p-4">
          <span className="text-[12px] font-semibold uppercase tracking-[0.08em] text-ink-muted">
            {t('Deliveries')}
          </span>
          {order.receipts.length === 0 ? (
            <span className="text-[13px] text-ink-muted">{t('Nothing received yet.')}</span>
          ) : (
            <ul className="flex flex-col gap-2">
              {order.receipts.map((receipt) => (
                <li key={receipt.id} className="flex flex-col text-[13px]">
                  <span className="font-medium">
                    {shortDate(receipt.received_on)}
                    {receipt.ref && <span className="font-mono text-ink-muted"> · {receipt.ref}</span>}
                    <span className="text-ink-muted"> · {receipt.received_by.name}</span>
                  </span>
                  <span className="text-ink-muted">
                    {receipt.lines
                      .map((row) => {
                        const line = order.lines.find((candidate) => candidate.id === row.po_line_id);
                        return `${row.quantity} ${line?.unit ?? ''} ${line?.description ?? ''}`.trim();
                      })
                      .join(' · ')}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
        {showMoney && (
          <Card className="flex flex-col gap-2 p-4">
            <span className="text-[12px] font-semibold uppercase tracking-[0.08em] text-ink-muted">
              {t('Supplier invoices')}
            </span>
            {order.invoices.length === 0 ? (
              <span className="text-[13px] text-ink-muted">{t('No invoices yet.')}</span>
            ) : (
              <ul className="flex flex-col gap-2">
                {order.invoices.map((invoice) => (
                  <li key={invoice.id} className="flex items-center justify-between gap-3 text-[13px]">
                    <Link href={`/procurement/invoices/${invoice.id}`} className="font-mono font-medium hover:underline">
                      {invoice.invoice_number}
                    </Link>
                    <span className="text-ink-muted">{shortDate(invoice.invoice_date)}</span>
                    <Badge tone={INVOICE_STATUS[invoice.status].tone}>{t(INVOICE_STATUS[invoice.status].label)}</Badge>
                    <span className="font-mono">{money(invoice.total)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        )}
      </div>

      {(order.notes || order.delivery_address || order.expected_on) && (
        <Card className="flex flex-col gap-1 p-4 text-[13px]">
          {order.expected_on && (
            <span>
              <span className="text-ink-muted">{t('Expected on')}:</span> {shortDate(order.expected_on)}
            </span>
          )}
          {order.delivery_address && (
            <span>
              <span className="text-ink-muted">{t('Deliver to')}:</span> {order.delivery_address}
            </span>
          )}
          {order.notes && (
            <span>
              <span className="text-ink-muted">{t('Notes')}:</span> {order.notes}
            </span>
          )}
        </Card>
      )}
    </FadeIn>
  );
}
