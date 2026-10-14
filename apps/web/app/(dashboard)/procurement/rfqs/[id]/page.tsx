import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, Trophy } from 'lucide-react';
import { ApiRequestError } from '@/lib/api';
import { serverFetch } from '@/lib/server-api';
import { requireSelf } from '@/lib/session';
import type { Rfq, Vendor } from '@/lib/procurement-types';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { FadeIn } from '@/components/motion';
import { cn } from '@/lib/utils';
import { getT } from '@/lib/i18n-server';
import { getFormat } from '@/lib/format-server';
import { ORDER_STATUS, RFQ_STATUS, percent } from '../../status';
import { QuoteDialog } from './quote-dialog';
import { AwardButton, CancelRfqButton, RemoveQuoteButton } from './rfq-buttons';

export const metadata = { title: 'Quote comparison · BUILDR' };

/**
 * The comparison: items down the side, suppliers across the top, the cheapest price per item
 * marked and the cheapest complete quote called out. Prices are compared with tax included —
 * what the site would actually pay.
 */
export default async function RfqPage({ params }: { params: Promise<{ id: string }> }) {
  const t = await getT();
  const { money, shortDate } = await getFormat();
  const { id } = await params;
  const me = await requireSelf();

  let rfq: Rfq;
  try {
    rfq = await serverFetch<Rfq>(`/rfqs/${id}`);
  } catch (error) {
    if (error instanceof ApiRequestError && (error.status === 404 || error.status === 403)) notFound();
    throw error;
  }
  const canManage = me.permissions.includes('procurement.manage');
  const open = rfq.status === 'open';
  const vendors = canManage && open ? await serverFetch<Vendor[]>('/vendors?active=true') : [];

  const summary = new Map(rfq.comparison.quotes.map((quote) => [quote.quote_id, quote]));
  const cells = new Map(
    rfq.comparison.items.map((item) => [item.rfq_item_id, item] as const),
  );
  const lowest = rfq.comparison.lowest_quote_id;
  const lowestQuote = rfq.quotes.find((quote) => quote.id === lowest);

  return (
    <FadeIn className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-1.5">
          <Link
            href="/procurement/rfqs"
            className="inline-flex items-center gap-1 text-[12.5px] text-ink-faint hover:underline"
          >
            <ArrowLeft className="size-3 rtl:rotate-180" /> {t('Quotes')}
          </Link>
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="text-[21px] font-semibold leading-tight">
              <span className="font-mono">{rfq.number}</span> · {rfq.title}
            </h2>
            <Badge tone={RFQ_STATUS[rfq.status].tone}>{t(RFQ_STATUS[rfq.status].label)}</Badge>
          </div>
          <span className="text-[13px] text-ink-muted">
            {rfq.project_name}
            {rfq.required_by && ` · ${t('needed by')} ${shortDate(rfq.required_by)}`}
            {rfq.indent_id && ` · ${t('from an indent')}`}
          </span>
        </div>
        {canManage && open && (
          <div className="flex flex-wrap gap-2">
            <QuoteDialog rfq={rfq} vendors={vendors} />
            <CancelRfqButton rfqId={rfq.id} />
          </div>
        )}
      </div>

      {rfq.purchase_orders.length > 0 && (
        <Card className="flex flex-wrap items-center gap-3 p-4 text-[13px]">
          <span className="font-semibold">{t('Ordered')}:</span>
          {rfq.purchase_orders.map((order) => (
            <Link key={order.id} href={`/procurement/orders/${order.id}`} className="inline-flex items-center gap-2 hover:underline">
              <span className="font-mono">{order.number}</span>
              <Badge tone={ORDER_STATUS[order.status].tone}>{t(ORDER_STATUS[order.status].label)}</Badge>
            </Link>
          ))}
        </Card>
      )}

      {lowestQuote && (
        <Card className="flex flex-wrap items-center gap-3 p-4 text-[13.5px]">
          <Trophy className="size-5 text-done" />
          <span>
            <span className="font-semibold">{lowestQuote.vendor.name}</span> {t('is the cheapest complete quote')}:{' '}
            <span className="font-mono font-semibold">{money(summary.get(lowestQuote.id)?.total)}</span>
          </span>
          {rfq.comparison.best_split_total && rfq.comparison.best_split_total !== summary.get(lowestQuote.id)?.total && (
            <span className="text-ink-muted">
              · {t('buying each item from its cheapest supplier would be')}{' '}
              <span className="font-mono">{money(rfq.comparison.best_split_total)}</span>
            </span>
          )}
        </Card>
      )}

      {rfq.quotes.length === 0 ? (
        <Card className="p-6 text-[13.5px] text-ink-muted">
          {t('No quotes yet. Enter each supplier’s prices as they come in; the comparison fills in as you go.')}
          <ul className="mt-3 flex flex-col gap-1 text-ink">
            {rfq.items.map((item) => (
              <li key={item.id}>
                {item.description} — <span className="font-mono">{item.quantity}</span> {item.unit}
              </li>
            ))}
          </ul>
        </Card>
      ) : (
        <div className="overflow-x-auto rounded-panel border border-line bg-surface">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-line-soft align-bottom">
                <th className="px-4 py-3 text-start text-[12px] font-semibold uppercase tracking-[0.06em] text-ink-muted">
                  {t('Item')}
                </th>
                {rfq.quotes.map((quote) => (
                  <th
                    key={quote.id}
                    className={cn('min-w-[170px] px-3 py-3 text-end', quote.id === lowest && 'bg-done-bg')}
                  >
                    <div className="flex flex-col items-end gap-0.5">
                      <span className="font-semibold">{quote.vendor.name}</span>
                      <span className="text-[11.5px] font-normal text-ink-muted">
                        {quote.delivery_days === null ? '' : `${quote.delivery_days} ${t('days')}`}
                        {quote.valid_until && ` · ${t('valid to')} ${shortDate(quote.valid_until)}`}
                      </span>
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rfq.items.map((item) => {
                const row = cells.get(item.id);
                return (
                  <tr key={item.id} className="border-b border-line-soft">
                    <td className="px-4 py-2.5">
                      <div className="flex flex-col">
                        <span className="font-medium">{item.description}</span>
                        <span className="text-[12px] text-ink-muted">
                          {item.quantity} {item.unit}
                          {item.cost_code && ` · ${item.cost_code.code}`}
                        </span>
                      </div>
                    </td>
                    {rfq.quotes.map((quote) => {
                      const cell = row?.cells.find((candidate) => candidate.quote_id === quote.id);
                      const line = quote.lines.find((candidate) => candidate.rfq_item_id === item.id);
                      const best = row?.lowest_quote_id === quote.id;
                      return (
                        <td
                          key={quote.id}
                          className={cn('px-3 py-2.5 text-end', quote.id === lowest && 'bg-done-bg/50')}
                        >
                          {cell && line ? (
                            <div className="flex flex-col items-end">
                              <span className={cn('font-mono', best && 'font-semibold text-done-fg')}>
                                {money(cell.total)}
                              </span>
                              <span className="text-[11.5px] text-ink-muted">
                                {money(line.unit_rate)} + {percent(line.tax_rate_bp)}
                              </span>
                              {best && <Badge tone="done" className="mt-1">{t('Lowest')}</Badge>}
                            </div>
                          ) : (
                            <span className="text-ink-faint">{t('Not quoted')}</span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr>
                <td className="px-4 py-3 font-semibold">{t('Total with tax')}</td>
                {rfq.quotes.map((quote) => {
                  const totals = summary.get(quote.id);
                  return (
                    <td key={quote.id} className={cn('px-3 py-3 text-end', quote.id === lowest && 'bg-done-bg')}>
                      <div className="flex flex-col items-end gap-1.5">
                        <span className="font-mono font-semibold">{money(totals?.total)}</span>
                        {totals && !totals.complete && (
                          <span className="text-[11.5px] text-pending-fg">
                            {totals.quoted_items}/{rfq.items.length} {t('items quoted')}
                          </span>
                        )}
                        {quote.notes && <span className="text-[11.5px] text-ink-muted">{quote.notes}</span>}
                        {canManage && open && (
                          <div className="flex items-center gap-1">
                            <RemoveQuoteButton rfqId={rfq.id} quoteId={quote.id} />
                            <AwardButton rfqId={rfq.id} quoteId={quote.id} lowest={quote.id === lowest} />
                          </div>
                        )}
                        {rfq.awarded_quote_id === quote.id && <Badge tone="done">{t('Awarded')}</Badge>}
                      </div>
                    </td>
                  );
                })}
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </FadeIn>
  );
}
