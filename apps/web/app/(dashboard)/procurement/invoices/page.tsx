import Link from 'next/link';
import { FileText } from 'lucide-react';
import { serverFetch } from '@/lib/server-api';
import type { PurchaseInvoice } from '@/lib/procurement-types';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { FadeIn } from '@/components/motion';
import { ExportMenu } from '@/components/export-menu';
import { getT } from '@/lib/i18n-server';
import { getFormat } from '@/lib/format-server';
import { FLAG_LABEL, INVOICE_STATUS } from '../status';

export const metadata = { title: 'Supplier invoices · BUILDR' };

/**
 * Supplier invoices, the ones waiting for a decision first. Each shows what the three-way match
 * found, so accounts can work the mismatches without opening every one.
 */
export default async function PurchaseInvoicesPage() {
  const t = await getT();
  const { money, shortDate } = await getFormat();
  const invoices = await serverFetch<PurchaseInvoice[]>('/purchase-invoices');

  return (
    <FadeIn className="flex flex-col gap-5">
      <div className="flex justify-end">
        <ExportMenu kind="purchase_invoices" />
      </div>
      {invoices.length === 0 ? (
        <EmptyState
          icon={<FileText />}
          title={t('No supplier invoices yet')}
          body={t(
            'Record an invoice from its purchase order. It is matched against the order and what was received, and approving it books the expense.',
          )}
        />
      ) : (
        <div className="overflow-x-auto rounded-panel border border-line bg-surface">
          <table className="w-full text-[13.5px]">
            <thead>
              <tr className="border-b border-line-soft text-[12px] uppercase tracking-[0.06em] text-ink-muted">
                <th className="px-4 py-2.5 text-start font-semibold">{t('Invoice')}</th>
                <th className="px-3 py-2.5 text-start font-semibold">{t('Supplier')}</th>
                <th className="px-3 py-2.5 text-start font-semibold">{t('Order')}</th>
                <th className="px-3 py-2.5 text-start font-semibold">{t('Date')}</th>
                <th className="px-3 py-2.5 text-start font-semibold">{t('Match')}</th>
                <th className="px-4 py-2.5 text-end font-semibold">{t('Total')}</th>
              </tr>
            </thead>
            <tbody>
              {invoices.map((invoice) => {
                const status = INVOICE_STATUS[invoice.status];
                const kinds = [...new Set(invoice.flags.map((flag) => flag.type))];
                return (
                  <tr key={invoice.id} className="border-b border-line-soft last:border-0 hover:bg-raised">
                    <td className="px-4 py-2.5">
                      <Link href={`/procurement/invoices/${invoice.id}`} className="font-mono font-semibold hover:underline">
                        {invoice.invoice_number}
                      </Link>
                    </td>
                    <td className="px-3 py-2.5">{invoice.vendor.name}</td>
                    <td className="px-3 py-2.5">
                      <Link href={`/procurement/orders/${invoice.purchase_order_id}`} className="font-mono text-ink-muted hover:underline">
                        {invoice.purchase_order_number}
                      </Link>
                    </td>
                    <td className="px-3 py-2.5 text-ink-muted">{shortDate(invoice.invoice_date)}</td>
                    <td className="px-3 py-2.5">
                      <div className="flex flex-wrap gap-1.5">
                        <Badge tone={status.tone}>{t(status.label)}</Badge>
                        {invoice.status !== 'approved' &&
                          kinds.map((kind) => (
                            <Badge key={kind} tone="blocked" dot={false}>
                              {t(FLAG_LABEL[kind])}
                            </Badge>
                          ))}
                      </div>
                    </td>
                    <td className="px-4 py-2.5 text-end font-mono">{money(invoice.total)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </FadeIn>
  );
}
