import { ClipboardCheck, Download, Hourglass, ShoppingCart } from 'lucide-react';
import { serverFetch } from '@/lib/server-api';
import { requireSelf } from '@/lib/session';
import type { Material, Page, ProjectSummary } from '@/lib/api-types';
import type { PurchaseOrderSummary, Vendor } from '@/lib/procurement-types';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { FadeIn } from '@/components/motion';
import { StatTile } from '@/components/stat-tile';
import { getT } from '@/lib/i18n-server';
import { getFormat } from '@/lib/format-server';
import { OrderFilters } from './order-filters';
import { OrderFormDialog } from './order-form-dialog';
import { OrdersTable } from './orders-table';

export const metadata = { title: 'Purchase orders · BUILDR' };

/**
 * Purchase orders across the company, newest first, filtered by site and status.
 *
 * The tiles answer the two questions an approver opens this screen with: is anything waiting, and
 * is any of it waiting for me.
 */
export default async function PurchaseOrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ project_id?: string; status?: string }>;
}) {
  const t = await getT();
  const { money } = await getFormat();
  const params = await searchParams;
  const me = await requireSelf();
  const canManage = me.permissions.includes('procurement.manage');
  const canSeeMoney = me.permissions.includes('procurement.view');
  const canApprove = me.permissions.includes('procurement.approve');

  const query = new URLSearchParams();
  if (params.project_id) query.set('project_id', params.project_id);
  if (params.status) query.set('status', params.status);

  const [orders, projects, waiting, mine, vendors, materials] = await Promise.all([
    serverFetch<PurchaseOrderSummary[]>(`/purchase-orders?${query.toString()}`),
    serverFetch<Page<ProjectSummary>>('/projects?limit=200'),
    serverFetch<PurchaseOrderSummary[]>('/purchase-orders?status=pending_approval'),
    canApprove
      ? serverFetch<PurchaseOrderSummary[]>('/purchase-orders?awaiting_me=true')
      : Promise.resolve([] as PurchaseOrderSummary[]),
    canManage ? serverFetch<Vendor[]>('/vendors?active=true') : Promise.resolve([] as Vendor[]),
    canManage ? serverFetch<Page<Material>>('/materials?limit=500') : Promise.resolve(null),
  ]);

  // Committed and still to arrive: approved and sent orders, and the part-delivered ones.
  const open = orders.filter((order) =>
    ['approved', 'sent', 'partially_received'].includes(order.status),
  );
  const openValue = open.reduce((sum, order) => sum + BigInt(order.total ?? '0'), 0n);

  const newOrder =
    canManage && projects.items.length > 0 ? (
      <OrderFormDialog
        projects={projects.items}
        vendors={vendors}
        materials={materials?.items ?? []}
        {...(params.project_id ? { projectId: params.project_id } : {})}
      />
    ) : null;

  return (
    <FadeIn className="flex flex-col gap-5">
      <div className="grid gap-3.5 sm:grid-cols-3">
        <StatTile
          label={t('Waiting for approval')}
          value={String(waiting.length)}
          note={waiting.length === 0 ? t('Nothing waiting') : t('Orders not yet agreed')}
          noteTone={waiting.length === 0 ? 'done' : 'pending'}
          icon={<Hourglass className="size-4" />}
        />
        <StatTile
          label={t('Waiting for you')}
          value={canApprove ? String(mine.length) : '—'}
          note={canApprove ? t('Within your approval limit') : t('You do not approve orders')}
          noteTone={mine.length > 0 ? 'pending' : 'neutral'}
          icon={<ClipboardCheck className="size-4" />}
        />
        <StatTile
          label={t('Open orders')}
          value={canSeeMoney ? money(openValue.toString()) : String(open.length)}
          note={`${open.length} ${t('approved and still to arrive')}`}
          icon={<ShoppingCart className="size-4" />}
        />
      </div>

      <div className="flex flex-wrap items-end justify-between gap-3">
        <OrderFilters projects={projects.items} />
        <div className="flex gap-2">
          {canSeeMoney && (
            <Button asChild variant="secondary" size="sm">
              <a href={`/procurement/export?${query.toString()}`} download>
                <Download className="size-4" /> {t('Export CSV')}
              </a>
            </Button>
          )}
          {newOrder}
        </div>
      </div>

      {orders.length === 0 ? (
        <EmptyState
          icon={<ShoppingCart />}
          title={t('No purchase orders yet')}
          body={t(
            'Raise an order to a supplier, or ask several for quotes first and award the best one. Approved orders show as committed on the site’s cost report.',
          )}
          action={newOrder ?? undefined}
        />
      ) : (
        <OrdersTable orders={orders} />
      )}
    </FadeIn>
  );
}
