import Link from 'next/link';
import { ArrowRight, ShoppingCart } from 'lucide-react';
import type { PurchaseOrderSummary } from '@/lib/procurement-types';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { getT } from '@/lib/i18n-server';
import { OrdersTable } from '../../procurement/orders-table';

/**
 * A site's purchase orders (roadmap Phase 2, module 2). The list only: raising, approving and
 * receiving all live in Procurement, which this links into already filtered to the site.
 */
export async function SitePurchases({
  projectId,
  orders,
}: {
  projectId: string;
  orders: PurchaseOrderSummary[];
}) {
  const t = await getT();
  return (
    <div className="flex flex-col gap-3">
      <div className="flex justify-end">
        <Button asChild variant="secondary" size="sm">
          <Link href={`/procurement?project_id=${projectId}`}>
            {t('Open in Procurement')} <ArrowRight className="size-4 rtl:rotate-180" />
          </Link>
        </Button>
      </div>
      {orders.length === 0 ? (
        <EmptyState
          icon={<ShoppingCart />}
          title={t('No purchase orders for this site')}
          body={t('Orders raised for this site, and what has arrived against them, show here.')}
        />
      ) : (
        <OrdersTable orders={orders} showSite={false} />
      )}
    </div>
  );
}
