import Link from 'next/link';
import type { PurchaseOrderSummary } from '@/lib/procurement-types';
import { Badge } from '@/components/ui/badge';
import { getT } from '@/lib/i18n-server';
import { getFormat } from '@/lib/format-server';
import { ORDER_STATUS } from './status';

/**
 * The purchase order list, shared by the procurement section and a site's Purchases tab. The site
 * column is dropped on a site's own tab, where every row would say the same thing.
 */
export async function OrdersTable({
  orders,
  showSite = true,
}: {
  orders: PurchaseOrderSummary[];
  showSite?: boolean;
}) {
  const t = await getT();
  const { money, shortDate } = await getFormat();
  return (
    <div className="overflow-x-auto rounded-panel border border-line bg-surface">
      <table className="w-full text-[13.5px]">
        <thead>
          <tr className="border-b border-line-soft text-[12px] uppercase tracking-[0.06em] text-ink-muted">
            <th className="px-4 py-2.5 text-start font-semibold">{t('Order')}</th>
            {showSite && <th className="px-3 py-2.5 text-start font-semibold">{t('Site')}</th>}
            <th className="px-3 py-2.5 text-start font-semibold">{t('Supplier')}</th>
            <th className="px-3 py-2.5 text-start font-semibold">{t('Status')}</th>
            <th className="px-3 py-2.5 text-start font-semibold">{t('Raised')}</th>
            <th className="px-4 py-2.5 text-end font-semibold">{t('Total')}</th>
          </tr>
        </thead>
        <tbody>
          {orders.map((order) => {
            const status = ORDER_STATUS[order.status];
            return (
              <tr key={order.id} className="border-b border-line-soft last:border-0 hover:bg-raised">
                <td className="px-4 py-2.5">
                  <Link href={`/procurement/orders/${order.id}`} className="font-mono font-semibold hover:underline">
                    {order.number}
                  </Link>
                </td>
                {showSite && <td className="px-3 py-2.5">{order.project_name}</td>}
                <td className="px-3 py-2.5">{order.vendor_name}</td>
                <td className="px-3 py-2.5">
                  <Badge tone={status.tone}>{t(status.label)}</Badge>
                </td>
                <td className="px-3 py-2.5 text-ink-muted">
                  {shortDate(order.created_at.slice(0, 10))} · {order.created_by.name}
                </td>
                <td className="px-4 py-2.5 text-end font-mono">
                  {order.total === null ? '—' : money(order.total)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
