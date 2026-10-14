'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { ChevronDown, ChevronRight, Download, FileSpreadsheet, TriangleAlert } from 'lucide-react';
import type { CostCode } from '@/lib/cost-code-types';
import {
  BOQ_BILL_STATUS,
  BOQ_PAYMENT_STATUS,
  boqPercent,
  type BoqItem,
  type BoqView,
} from '@/lib/boq-types';
import { useFormat } from '@/components/format-provider';
import { useLanguage } from '@/components/language-provider';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { ProgressBar } from '@/components/ui/meter';
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { cn } from '@/lib/utils';
import { BoqImportDialog } from './boq-import-dialog';
import { BoqMeasureDialog } from './boq-measure-dialog';
import { AutoMapDialog, BoqItemDialog, BoqTermsDialog, NewBoqBillDialog } from './boq-dialogs';

export interface BoqPermissions {
  view: boolean;
  manage: boolean;
  measure: boolean;
  bill: boolean;
}

/**
 * The site's bill of quantities (roadmap Phase 2, module 5): the items as a tree with what has been
 * measured and billed against each, the abstract in the summary, and the running bills to the client.
 *
 * One screen for the QS and the site: the supervisor sees the same tree with quantities and a
 * measure button, and none of the money — the API sends none.
 */
export function BoqTab({
  projectId,
  boq,
  costCodes,
  can,
}: {
  projectId: string;
  boq: BoqView;
  costCodes: CostCode[];
  can: BoqPermissions;
}) {
  const { t } = useLanguage();
  const format = useFormat();
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const sections = boq.items.filter((item) => item.kind === 'section');

  // A row is hidden when any section above it is folded.
  const visible = useMemo(() => {
    const parentOf = new Map(boq.items.map((item) => [item.id, item.parent_id]));
    return boq.items.filter((item) => {
      for (let at = item.parent_id; at; at = parentOf.get(at) ?? null) {
        if (collapsed.has(at)) return false;
      }
      return true;
    });
  }, [boq.items, collapsed]);

  function toggle(id: string) {
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const exportHref = (format: 'csv' | 'xlsx', report: 'items' | 'abstract' = 'items') =>
    `/boq/export?project_id=${projectId}&format=${format}&report=${report}`;

  if (boq.items.length === 0) {
    return (
      <Card className="p-4">
        <EmptyState
          icon={<FileSpreadsheet />}
          title={t('No bill of quantities on this site yet')}
          body={t(
            'Import the BOQ from the contract’s Excel sheet, then measure work against each item and bill the client on it.',
          )}
          action={
            can.manage ? (
              <div className="flex flex-wrap items-center justify-center gap-2">
                <BoqImportDialog projectId={projectId} canReplace />
                <BoqItemDialog projectId={projectId} sections={sections} costCodes={costCodes} />
              </div>
            ) : undefined
          }
        />
      </Card>
    );
  }

  const totals = boq.totals;
  const terms = boq.terms;

  return (
    <div className="flex flex-col gap-4">
      {totals && (
        <Card className="flex flex-col gap-4 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <span className="text-[12px] font-semibold uppercase tracking-[0.08em] text-ink-muted">{boq.title}</span>
              {totals.over_quantity > 0 && (
                <Badge tone="blocked">
                  {totals.over_quantity} {t('over contract quantity')}
                </Badge>
              )}
            </div>
            {terms && (
              <span className="text-[12px] text-ink-faint">
                {t('Retention')} {boqPercent(terms.retention_bp)} · {t('Advance recovery')}{' '}
                {boqPercent(terms.advance_recovery_bp)} · {boq.tax_name ?? t('Tax')} {boqPercent(terms.tax_rate_bp)}
              </span>
            )}
          </div>
          <dl className="grid grid-cols-2 gap-4 sm:grid-cols-5">
            <Figure label={t('Contract value')} value={format.moneyShort(totals.contract)} />
            <Figure label={t('Measured to date')} value={format.moneyShort(totals.measured)} />
            <Figure label={t('Billed to date')} value={format.moneyShort(totals.billed)} />
            <Figure label={t('Balance to bill')} value={format.moneyShort(totals.balance)} />
            <Figure label={t('Complete')} value={boqPercent(totals.percent_bp)} />
          </dl>
          <ProgressBar
            percent={Math.min(totals.percent_bp, 10_000) / 100}
            overflowPercent={0}
            className="h-[6px]"
          />
        </Card>
      )}

      <div className="flex flex-wrap items-center justify-end gap-2">
        {can.view && (
          <>
            <Button asChild variant="secondary" size="sm">
              <a href={exportHref('xlsx')}>
                <Download className="size-4" />
                {t('Excel')}
              </a>
            </Button>
            <Button asChild variant="secondary" size="sm">
              <a href={exportHref('csv')}>
                <Download className="size-4" />
                {t('CSV')}
              </a>
            </Button>
            <Button asChild variant="secondary" size="sm">
              <a href={exportHref('csv', 'abstract')}>
                <Download className="size-4" />
                {t('Abstract')}
              </a>
            </Button>
          </>
        )}
        {can.manage && (
          <>
            <BoqTermsDialog projectId={projectId} boq={boq} />
            <AutoMapDialog projectId={projectId} />
            <BoqImportDialog projectId={projectId} canReplace={boq.can_replace} />
            <BoqItemDialog projectId={projectId} sections={sections} costCodes={costCodes} />
          </>
        )}
        {can.bill && <NewBoqBillDialog projectId={projectId} />}
      </div>

      <Card className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="text-start">{t('Item')}</TableHead>
              <TableHead className="text-end">{t('Contract qty')}</TableHead>
              <TableHead className="min-w-[180px] text-start">{t('Measured')}</TableHead>
              <TableHead className="text-end">{t('Billed qty')}</TableHead>
              {boq.show_money && <TableHead className="text-end">{t('Rate')}</TableHead>}
              {boq.show_money && <TableHead className="text-end">{t('Amount')}</TableHead>}
              {boq.show_money && <TableHead className="text-end">{t('Billed')}</TableHead>}
              <TableHead className="w-[1%]" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {visible.map((item) => (
              <ItemRow
                key={item.id}
                item={item}
                projectId={projectId}
                showMoney={boq.show_money}
                can={can}
                folded={collapsed.has(item.id)}
                onToggle={() => toggle(item.id)}
                sections={sections}
                costCodes={costCodes}
              />
            ))}
          </TableBody>
          {totals && (
            <TableFooter>
              <TableRow className="hover:bg-transparent">
                <TableCell className="text-start">{t('Total')}</TableCell>
                <TableCell />
                <TableCell className="text-start font-mono">{format.money(totals.measured)}</TableCell>
                <TableCell />
                <TableCell />
                <TableCell className="text-end font-mono">{format.money(totals.contract)}</TableCell>
                <TableCell className="text-end font-mono">{format.money(totals.billed)}</TableCell>
                <TableCell />
              </TableRow>
            </TableFooter>
          )}
        </Table>
      </Card>

      {boq.show_money && (
        <Card className="flex flex-col gap-3 p-4">
          <span className="text-[12px] font-semibold uppercase tracking-[0.08em] text-ink-muted">
            {t('Running bills to the client')}
          </span>
          {boq.bills.length === 0 ? (
            <p className="text-[13.5px] text-ink-muted">
              {t('No bills yet. A bill claims what has been measured to date, item by item.')}
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="text-start">{t('Bill')}</TableHead>
                  <TableHead className="text-start">{t('Period to')}</TableHead>
                  <TableHead className="text-start">{t('Status')}</TableHead>
                  <TableHead className="text-end">{t('Claimed')}</TableHead>
                  <TableHead className="text-end">{t('Certified')}</TableHead>
                  <TableHead className="text-end">{t('Net receivable')}</TableHead>
                  <TableHead className="text-end">{t('Received')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {boq.bills.map((bill) => {
                  const status = BOQ_BILL_STATUS[bill.status];
                  const payment = BOQ_PAYMENT_STATUS[bill.payment_status];
                  const settled = bill.status === 'certified' || bill.status === 'invoiced';
                  return (
                    <TableRow key={bill.id}>
                      <TableCell className="text-start">
                        <Link href={`/boq/bills/${bill.id}`} className="font-medium text-accent hover:underline">
                          RA-{bill.number}
                        </Link>
                      </TableCell>
                      <TableCell className="text-start">{format.shortDate(bill.period_to)}</TableCell>
                      <TableCell className="text-start">
                        <div className="flex flex-wrap gap-1.5">
                          <Badge tone={status.tone}>{t(status.label)}</Badge>
                          {bill.status === 'invoiced' && <Badge tone={payment.tone}>{t(payment.label)}</Badge>}
                        </div>
                      </TableCell>
                      <TableCell className="text-end font-mono">
                        {format.money(bill.status === 'draft' ? bill.gross : bill.claimed_gross)}
                      </TableCell>
                      <TableCell className="text-end font-mono">{settled ? format.money(bill.gross) : '—'}</TableCell>
                      <TableCell className="text-end font-mono">{format.money(bill.net_payable)}</TableCell>
                      <TableCell className="text-end font-mono">
                        {bill.status === 'invoiced' ? format.money(bill.paid) : '—'}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </Card>
      )}
    </div>
  );
}

function ItemRow({
  item,
  projectId,
  showMoney,
  can,
  folded,
  onToggle,
  sections,
  costCodes,
}: {
  item: BoqItem;
  projectId: string;
  showMoney: boolean;
  can: BoqPermissions;
  folded: boolean;
  onToggle: () => void;
  sections: BoqItem[];
  costCodes: CostCode[];
}) {
  const { t } = useLanguage();
  const format = useFormat();
  const section = item.kind === 'section';
  const percent = item.percent_bp / 100;

  return (
    <TableRow className={cn(section && item.depth === 0 && 'bg-raised')}>
      <TableCell className="text-start">
        <div className="flex items-start gap-1.5" style={{ paddingInlineStart: item.depth * 18 }}>
          {section ? (
            <button
              type="button"
              onClick={onToggle}
              className="mt-0.5 flex size-5 flex-none items-center justify-center rounded text-ink-muted hover:bg-raised rtl:-scale-x-100"
              aria-label={folded ? `${t('Show items under')} ${item.item_no}` : `${t('Hide items under')} ${item.item_no}`}
              aria-expanded={!folded}
            >
              {folded ? <ChevronRight className="size-4" /> : <ChevronDown className="size-4" />}
            </button>
          ) : (
            <span className="size-5 flex-none" />
          )}
          <div className="flex min-w-0 flex-col">
            <span className={cn('leading-snug', section && 'font-semibold')}>
              <span className="me-1.5 font-mono text-[12.5px] text-ink-muted" dir="ltr">
                {item.item_no}
              </span>
              {item.description}
            </span>
            {item.cost_code && (
              <span className="text-[12px] text-ink-faint">
                {item.cost_code.code} {item.cost_code.name}
              </span>
            )}
          </div>
        </div>
      </TableCell>
      <TableCell className="whitespace-nowrap text-end font-mono text-[13px]">
        {section ? '' : `${item.quantity} ${item.unit ?? ''}`}
      </TableCell>
      <TableCell className="text-start">
        <div className="flex flex-col gap-1">
          <div className="flex items-center justify-between gap-2 text-[12.5px]">
            <span className="font-mono">
              {section ? (showMoney ? format.money(item.measured_value) : '') : item.measured_quantity}
            </span>
            <span className={cn('font-mono', item.over ? 'text-blocked-fg' : 'text-ink-muted')}>
              {boqPercent(item.percent_bp)}
            </span>
          </div>
          <ProgressBar
            percent={Math.min(percent, 100)}
            overflowPercent={item.over ? Math.min(percent - 100, 100) : 0}
            className="h-[5px]"
          />
          {item.over && (
            <span className="inline-flex items-center gap-1 text-[11.5px] text-blocked-fg">
              <TriangleAlert className="size-3" />
              {item.excess_quantity} {item.unit} {t('over the contract quantity')}
            </span>
          )}
        </div>
      </TableCell>
      <TableCell className="text-end font-mono text-[13px]">{section ? '' : item.billed_quantity}</TableCell>
      {showMoney && <TableCell className="text-end font-mono text-[13px]">{section ? '' : format.money(item.rate)}</TableCell>}
      {showMoney && (
        <TableCell className={cn('text-end font-mono text-[13px]', section && 'font-semibold')}>
          {format.money(item.amount)}
        </TableCell>
      )}
      {showMoney && <TableCell className="text-end font-mono text-[13px]">{format.money(item.billed_value)}</TableCell>}
      <TableCell>
        <div className="flex items-center justify-end gap-0.5">
          {!section && (can.measure || can.manage) && <BoqMeasureDialog projectId={projectId} item={item} canManage={can.manage} />}
          {can.manage && <BoqItemDialog projectId={projectId} sections={sections} costCodes={costCodes} editing={item} />}
        </div>
      </TableCell>
    </TableRow>
  );
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="text-[12px] text-ink-muted">{label}</dt>
      <dd className="font-mono text-[17px] font-semibold">{value}</dd>
    </div>
  );
}
