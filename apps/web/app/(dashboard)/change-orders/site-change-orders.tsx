'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Loader2, Pencil } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { useFormat } from '@/components/format-provider';
import { useLanguage } from '@/components/language-provider';
import { setContractValue } from '@/lib/change-order-actions';
import type {
  ChangeOrderSiteSummary,
  ChangeOrderSuggestion,
  ChangeOrderSummary,
} from '@/lib/change-order-types';
import { amountToMinorString, minorToAmountInput } from '@/lib/money-input';
import { ChangeOrderDialog } from './change-order-dialog';
import { ChangeOrdersTable } from './change-orders-table';
import { SuggestionsList } from './suggestions-list';
import { changeOrderDaysText } from './labels';

/**
 * A site's Change orders tab: the contract and handover as signed and as revised, the extra work
 * spotted on this site, and its register.
 */
export function SiteChangeOrders({
  project,
  summary,
  changeOrders,
  suggestions,
  canManage,
}: {
  project: { id: string; name: string };
  summary: ChangeOrderSiteSummary;
  changeOrders: ChangeOrderSummary[];
  suggestions: ChangeOrderSuggestion[];
  canManage: boolean;
}) {
  const { t } = useLanguage();
  return (
    <div className="flex flex-col gap-4">
      <ContractCard summary={summary} canManage={canManage} />
      <SuggestionsList suggestions={suggestions} showSite={false} />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="text-[12px] font-semibold uppercase tracking-[0.08em] text-ink-muted">{t('Change orders')}</span>
        <div className="flex items-center gap-2">
          {changeOrders.length > 0 && (
            <Button asChild variant="secondary" size="sm">
              <a href={`/change-orders/export?project_id=${project.id}`} download>
                {t('Export CSV')}
              </a>
            </Button>
          )}
          {canManage && <ChangeOrderDialog sites={[project]} fixedSiteId={project.id} />}
        </div>
      </div>
      <ChangeOrdersTable changeOrders={changeOrders} showSite={false} />
    </div>
  );
}

/**
 * The contract value and the handover date, each as signed and as change orders have revised it.
 * Revised figures are worked out from the approved change orders, never typed, so they cannot
 * drift from the register.
 */
function ContractCard({ summary, canManage }: { summary: ChangeOrderSiteSummary; canManage: boolean }) {
  const { t } = useLanguage();
  const format = useFormat();
  const { money, shortDate } = format;
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(
    summary.contract_value ? minorToAmountInput(summary.contract_value, format.currencyDigits) : '',
  );
  const [pending, start] = useTransition();

  function save() {
    let minor: string | null = null;
    try {
      minor = value.trim() ? amountToMinorString(value, format.currencyDigits, format.currencySymbol) : null;
    } catch {
      toast.error(t('Enter the contract value as a number'));
      return;
    }
    if (minor?.startsWith('-')) {
      toast.error(t('A contract value cannot be negative'));
      return;
    }
    start(async () => {
      const result = await setContractValue(summary.project_id, minor);
      if (!result.ok) {
        toast.error(result.error ?? t('Could not save the contract value'));
        return;
      }
      setEditing(false);
      router.refresh();
    });
  }

  return (
    <Card className="flex flex-col gap-4 p-4">
      <div className="grid gap-5 md:grid-cols-2">
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[12px] font-semibold uppercase tracking-[0.08em] text-ink-muted">
              {t('Contract value')}
            </span>
            {canManage && !editing && (
              <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
                <Pencil className="size-4" />
                {summary.contract_value ? t('Edit') : t('Set')}
              </Button>
            )}
          </div>
          {editing ? (
            <div className="flex items-center gap-2">
              <Input
                aria-label={`${t('Contract value as signed')} (${format.currencySymbol})`}
                inputMode="decimal"
                value={value}
                onChange={(event) => setValue(event.target.value)}
                dir="ltr"
                className="max-w-[220px] font-mono"
              />
              <Button size="sm" onClick={save} disabled={pending}>
                {pending && <Loader2 className="size-4 animate-spin" />}
                {t('Save')}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
                {t('Cancel')}
              </Button>
            </div>
          ) : (
            <dl className="grid grid-cols-3 gap-3">
              <Figure label={t('As signed')} value={summary.contract_value ? money(summary.contract_value) : '—'} />
              <Figure label={t('Approved changes')} value={money(summary.approved_changes)} />
              <Figure
                label={t('Revised')}
                value={summary.revised_contract_value ? money(summary.revised_contract_value) : '—'}
                strong
              />
            </dl>
          )}
          {!summary.contract_value && !editing && (
            <p className="text-[12.5px] text-ink-muted">
              {t('Set the contract as signed, and approved change orders are added to it as the client agrees them.')}
            </p>
          )}
        </div>
        <div className="flex flex-col gap-2">
          <span className="text-[12px] font-semibold uppercase tracking-[0.08em] text-ink-muted">{t('Handover')}</span>
          <dl className="grid grid-cols-3 gap-3">
            <Figure label={t('Originally')} value={summary.original_handover ? shortDate(summary.original_handover) : '—'} />
            <Figure label={t('Extended by')} value={changeOrderDaysText(summary.extension_days, t)} />
            <Figure label={t('Now')} value={summary.handover ? shortDate(summary.handover) : '—'} strong />
          </dl>
        </div>
      </div>
      {summary.awaiting_count > 0 && (
        <p className="rounded-btn bg-pending-bg px-3 py-2 text-[13px] text-pending-fg">
          {summary.awaiting_count} {t('change orders waiting on a decision')}: {money(summary.awaiting_price)} ·{' '}
          {changeOrderDaysText(summary.awaiting_days, t)}
        </p>
      )}
      {summary.history.length > 0 && (
        <ol className="flex flex-col gap-1 text-[12.5px] text-ink-muted">
          {summary.history.map((row) => (
            <li key={row.change_order.id}>
              <Link href={`/change-orders/${row.change_order.id}`} className="font-mono hover:underline" dir="ltr">
                {row.change_order.label}
              </Link>{' '}
              {row.change_order.title}
              {row.contract_after && ` · ${t('contract')} ${money(row.contract_after)}`}
              {row.time_impact_days !== 0 && row.handover_after && ` · ${t('handover')} ${shortDate(row.handover_after)}`}
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}

function Figure({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-[12px] text-ink-muted">{label}</dt>
      <dd className={`font-mono text-[14.5px] ${strong ? 'font-bold' : ''}`}>{value}</dd>
    </div>
  );
}
