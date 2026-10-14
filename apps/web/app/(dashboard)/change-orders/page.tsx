import { FilePlus2 } from 'lucide-react';
import { serverFetch } from '@/lib/server-api';
import { requireSelf } from '@/lib/session';
import { getFormat } from '@/lib/format-server';
import { getT } from '@/lib/i18n-server';
import type { Page, ProjectSummary } from '@/lib/api-types';
import type { ChangeOrderRegister, ChangeOrderSuggestion } from '@/lib/change-order-types';
import { FadeIn } from '@/components/motion';
import { StatTile } from '@/components/stat-tile';
import { ExportMenu } from '@/components/export-menu';
import { EmptyState } from '@/components/ui/empty-state';
import { ChangeOrderDialog } from './change-order-dialog';
import { ChangeOrdersTable } from './change-orders-table';
import { SuggestionsList } from './suggestions-list';
import { changeOrderDaysText } from './labels';

export const metadata = { title: 'Change orders · BUILDR' };

/**
 * Every change order the caller can see, across their sites (roadmap Phase 2, module 4).
 *
 * The tiles answer what an owner opens this page to ask: how much the contracts have grown by,
 * what is still waiting — on us or on the client — and how many days the changes have added. The
 * scope-creep catcher's suggestions sit above the register, because unpriced extra work is the
 * money that leaks.
 */
export default async function ChangeOrdersPage() {
  const t = await getT();
  const { money, moneyShort } = await getFormat();
  const me = await requireSelf();
  const canManage = me.permissions.includes('change_orders.manage');

  const [register, sites, suggestions] = await Promise.all([
    serverFetch<ChangeOrderRegister>('/change-orders'),
    canManage ? serverFetch<Page<ProjectSummary>>('/projects?limit=200') : null,
    canManage ? serverFetch<{ items: ChangeOrderSuggestion[] }>('/change-order-suggestions') : null,
  ]);
  const { items, totals } = register;
  const waiting = totals.awaiting_approval + totals.awaiting_client;

  return (
    <FadeIn className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h2 className="text-[21px] font-semibold leading-tight">{t('Change orders')}</h2>
          <p className="text-[13.5px] text-ink-muted">
            {t('Variations to the client’s contract: what each costs, what the client pays, and the days it adds.')}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {items.length > 0 && <ExportMenu kind="change_orders" csvHref="/change-orders/export" />}
          {canManage && (
            <ChangeOrderDialog sites={(sites?.items ?? []).map((site) => ({ id: site.id, name: site.name }))} />
          )}
        </div>
      </div>

      {items.length > 0 && (
        <div className="grid gap-3.5 sm:grid-cols-2 xl:grid-cols-4">
          <StatTile
            label={t('Approved, charged to clients')}
            value={moneyShort(totals.approved_price)}
            note={`${totals.approved_count} ${t('change orders')} · ${t('cost')} ${money(totals.approved_cost)}`}
            noteTone="done"
          />
          <StatTile
            label={t('Still to agree')}
            value={moneyShort(totals.pending_price)}
            note={`${totals.pending_count} ${t('open')}`}
          />
          <StatTile
            label={t('Waiting on a decision')}
            value={String(waiting)}
            animate
            noteTone={waiting > 0 ? 'pending' : 'done'}
            note={
              waiting > 0
                ? `${totals.awaiting_approval} ${t('internal')} · ${totals.awaiting_client} ${t('with the client')}`
                : t('Nothing waiting')
            }
          />
          <StatTile label={t('Time added')} value={changeOrderDaysText(totals.approved_days, t)} note={t('By approved change orders')} />
        </div>
      )}

      {suggestions && <SuggestionsList suggestions={suggestions.items} />}

      {items.length === 0 ? (
        <EmptyState
          icon={<FilePlus2 />}
          title={t('No change orders yet')}
          body={t(
            'When the client asks for something extra, the design changes or the ground surprises you, price it here and get the client’s yes before the work is done.',
          )}
        />
      ) : (
        <ChangeOrdersTable changeOrders={items} />
      )}
    </FadeIn>
  );
}
