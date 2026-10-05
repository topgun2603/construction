'use client';

import { useEffect, useState, useTransition, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import {
  CHANGE_ORDER_REASONS,
  CHANGE_ORDER_REASON_LABELS,
  COST_CODE_INDENT,
  basisPointsToPercent,
  changeOrderFigures,
  changeOrderLineCost,
  percentToBasisPoints,
  taxRule,
  type ChangeOrderReason,
} from '@sitebook/shared';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input, Textarea } from '@/components/ui/input';
import { Field } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useFormat } from '@/components/format-provider';
import { useLanguage } from '@/components/language-provider';
import { costCodeOptions } from '@/lib/cost-code-actions';
import type { CostCode } from '@/lib/cost-code-types';
import { createChangeOrder, updateChangeOrder } from '@/lib/change-order-actions';
import type { ChangeOrderDetail, ChangeOrderLineInput } from '@/lib/change-order-types';
import { amountToMinorString, minorToAmountInput } from '@/lib/money-input';

/** A line as it is being typed, money in major units. Quantity filled means measured; empty, lump sum. */
interface DraftLine {
  key: string;
  description: string;
  unit: string;
  quantity: string;
  rate: string;
  amount: string;
  cost_code_id: string;
}

let seq = 0;
function blankLine(): DraftLine {
  seq += 1;
  return { key: `co${seq}`, description: '', unit: '', quantity: '', rate: '', amount: '', cost_code_id: '' };
}

function isBlank(line: DraftLine): boolean {
  return !line.description.trim() && !line.quantity.trim() && !line.rate.trim() && !line.amount.trim();
}

/** The line's cost in minor units, or null while it is not a number yet. */
function costOf(line: DraftLine, digits: number, symbol: string): bigint | null {
  try {
    if (line.quantity.trim()) {
      if (!line.rate.trim()) return null;
      return changeOrderLineCost({ quantity: line.quantity, rate: amountToMinorString(line.rate, digits, symbol) });
    }
    if (!line.amount.trim()) return null;
    return changeOrderLineCost({ amount: amountToMinorString(line.amount, digits, symbol) });
  } catch {
    return null;
  }
}

/**
 * Raise a change order, or edit a draft: what changed, why, the lines with their cost codes, the
 * price to the client, and the days it adds. The cost, price, tax and total are worked out as it
 * is typed with the same arithmetic the API stores.
 */
export function ChangeOrderDialog({
  sites,
  fixedSiteId,
  existing,
  suggestion,
  trigger,
}: {
  sites: Array<{ id: string; name: string }>;
  fixedSiteId?: string;
  /** Editing a draft. */
  existing?: ChangeOrderDetail;
  /** Raising one from the scope-creep catcher's suggestion. */
  suggestion?: { id: string; projectId: string; title: string; description: string };
  trigger?: ReactNode;
}) {
  const { t } = useLanguage();
  const format = useFormat();
  const router = useRouter();
  const rule = taxRule(format.settings.taxRegime ?? 'none');
  const digits = format.currencyDigits;
  const symbol = format.currencySymbol;

  const initialLines = (): DraftLine[] =>
    existing && existing.lines.length > 0
      ? existing.lines.map((line) => ({
          ...blankLine(),
          description: line.description,
          unit: line.unit ?? '',
          quantity: line.quantity ?? '',
          rate: line.rate ? minorToAmountInput(line.rate, digits) : '',
          amount: line.quantity ? '' : minorToAmountInput(line.amount, digits),
          cost_code_id: line.cost_code?.id ?? '',
        }))
      : [blankLine()];

  const [open, setOpen] = useState(false);
  const [siteId, setSiteId] = useState(existing?.project.id ?? suggestion?.projectId ?? fixedSiteId ?? '');
  const [reason, setReason] = useState<ChangeOrderReason>(existing?.reason ?? 'client_request');
  const [codes, setCodes] = useState<CostCode[]>([]);
  const [lines, setLines] = useState<DraftLine[]>(initialLines);
  const [pricing, setPricing] = useState<'markup' | 'fixed'>(existing?.entered_price ? 'fixed' : 'markup');
  const [markup, setMarkup] = useState(existing ? basisPointsToPercent(existing.markup_bp) : '15');
  const [fixedPrice, setFixedPrice] = useState(existing?.entered_price ? minorToAmountInput(existing.entered_price, digits) : '');
  const [tax, setTax] = useState(
    existing
      ? basisPointsToPercent(existing.tax_rate_bp)
      : rule.standardRateBp !== null
        ? basisPointsToPercent(rule.standardRateBp)
        : '0',
  );
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  // The cost codes belong to the site, so they follow it.
  useEffect(() => {
    if (!open || !siteId) {
      setCodes([]);
      return;
    }
    let live = true;
    void costCodeOptions(siteId).then((result) => {
      if (live) setCodes(result.ok ? (result.data ?? []) : []);
    });
    return () => {
      live = false;
    };
  }, [open, siteId]);

  const set = (key: string, patch: Partial<DraftLine>) =>
    setLines((rows) => rows.map((line) => (line.key === key ? { ...line, ...patch } : line)));

  // --- live totals ---------------------------------------------------------------------------------
  const lineCosts = lines.map((line) => costOf(line, digits, symbol) ?? 0n);
  const markupBp = percentToBasisPoints(markup || '0');
  const taxBp = percentToBasisPoints(tax || '0');
  let entered: bigint | null = null;
  try {
    entered = pricing === 'fixed' && fixedPrice.trim() ? BigInt(amountToMinorString(fixedPrice, digits, symbol)) : null;
  } catch {
    entered = null;
  }
  const figures = changeOrderFigures({
    lineCosts,
    markupBp: markupBp ?? 0,
    enteredPrice: entered,
    taxRateBp: taxBp ?? 0,
  });

  function linesForApi(): { lines: ChangeOrderLineInput[] } | { error: string } {
    const out: ChangeOrderLineInput[] = [];
    for (const line of lines) {
      if (isBlank(line)) continue;
      if (!line.description.trim()) return { error: t('Every line needs a description') };
      const base = {
        description: line.description.trim(),
        unit: line.unit.trim() || null,
        cost_code_id: line.cost_code_id || null,
      };
      try {
        if (line.quantity.trim()) {
          if (!/^-?\d+(?:\.\d{1,3})?$/.test(line.quantity.trim()) || Number(line.quantity) === 0) {
            return { error: `${t('Enter the quantity as a number, like 12.5, for')} “${line.description}”` };
          }
          const rate = amountToMinorString(line.rate, digits, symbol);
          if (rate.startsWith('-') || !line.rate.trim()) {
            return { error: `${t('Enter the rate for')} “${line.description}”` };
          }
          out.push({ ...base, quantity: line.quantity.trim(), rate });
        } else {
          if (!line.amount.trim()) return { error: `${t('Enter a quantity and rate, or a lump sum, for')} “${line.description}”` };
          out.push({ ...base, amount: amountToMinorString(line.amount, digits, symbol) });
        }
      } catch {
        return { error: `${t('Enter amounts as numbers, like 2500, for')} “${line.description}”` };
      }
    }
    return { lines: out };
  }

  function submit(formData: FormData) {
    setError(null);
    const read = (name: string) => String(formData.get(name) ?? '').trim();
    if (!siteId) {
      setError(t('Choose the site'));
      return;
    }
    if (markupBp === null || taxBp === null) {
      setError(t('Enter percentages as numbers between 0 and 100'));
      return;
    }
    if (pricing === 'fixed' && entered === null) {
      setError(t('Enter the price to the client as a number'));
      return;
    }
    const days = Number(read('days') || '0');
    if (!Number.isInteger(days)) {
      setError(t('Enter the time impact as whole days'));
      return;
    }
    const parsed = linesForApi();
    if ('error' in parsed) {
      setError(parsed.error);
      return;
    }
    const body = {
      title: read('title'),
      description: read('description') || null,
      reason,
      ...(read('raised_on') ? { raised_on: read('raised_on') } : {}),
      markup_bp: markupBp,
      client_price: pricing === 'fixed' ? entered!.toString() : null,
      tax_rate_bp: taxBp,
      time_impact_days: days,
      lines: parsed.lines,
    };
    start(async () => {
      const result = existing
        ? await updateChangeOrder(existing.id, body)
        : await createChangeOrder({
            ...body,
            project_id: siteId,
            ...(suggestion ? { suggestion_id: suggestion.id } : {}),
          });
      if (!result.ok || !result.data) {
        setError(result.error ?? t('Could not save the change order'));
        return;
      }
      toast.success(`${result.data.label} ${existing ? t('saved') : t('saved as a draft')}`);
      setOpen(false);
      if (existing) router.refresh();
      else {
        setLines([blankLine()]);
        router.push(`/change-orders/${result.data.id}`);
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button size="sm">
            <Plus className="size-4" />
            {t('New change order')}
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{existing ? `${t('Edit')} ${existing.label}` : t('New change order')}</DialogTitle>
          <DialogDescription>
            {t('Extra or changed work, what it costs, what the client pays for it and how many days it adds. It stays a draft until it is submitted for approval.')}
          </DialogDescription>
        </DialogHeader>
        <form action={submit} className="flex flex-col gap-4">
          {!fixedSiteId && !existing && !suggestion && (
            <Field label={t('Site')}>
              <Select value={siteId} onValueChange={setSiteId}>
                <SelectTrigger>
                  <SelectValue placeholder={t('Choose a site')} />
                </SelectTrigger>
                <SelectContent>
                  {sites.map((site) => (
                    <SelectItem key={site.id} value={site.id}>
                      {site.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          )}
          <div className="grid gap-4 sm:grid-cols-[1fr_200px]">
            <Field label={t('Title')} htmlFor="co-title">
              <Input
                id="co-title"
                name="title"
                required
                maxLength={160}
                defaultValue={existing?.title ?? suggestion?.title ?? ''}
                placeholder={t('Extra window in the master bedroom')}
              />
            </Field>
            <Field label={t('Reason')}>
              <Select value={reason} onValueChange={(value) => setReason(value as ChangeOrderReason)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CHANGE_ORDER_REASONS.map((value) => (
                    <SelectItem key={value} value={value}>
                      {t(CHANGE_ORDER_REASON_LABELS[value])}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </div>
          <Field label={t('What changed, and why')} htmlFor="co-description" optional>
            <Textarea
              id="co-description"
              name="description"
              maxLength={4000}
              className="min-h-[64px]"
              defaultValue={existing?.description ?? suggestion?.description ?? ''}
            />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t('Raised on')} htmlFor="co-raised">
              <Input id="co-raised" name="raised_on" type="date" defaultValue={existing?.raised_on ?? format.todayIso()} />
            </Field>
            <Field label={t('Time impact (days)')} htmlFor="co-days" hint={t('Negative brings the handover forward')}>
              <Input
                id="co-days"
                name="days"
                inputMode="numeric"
                defaultValue={String(existing?.time_impact_days ?? 0)}
                dir="ltr"
                className="font-mono"
              />
            </Field>
          </div>

          <div className="flex flex-col gap-2">
            <span className="text-[13.5px] font-semibold">{t('Lines')}</span>
            <p className="text-[12.5px] text-ink-muted">
              {t('A quantity and rate, or a lump sum. A negative amount is an omission and credits the budget.')}
            </p>
            {lines.map((line, index) => {
              const cost = costOf(line, digits, symbol);
              return (
                <div key={line.key} className="flex flex-col gap-2 rounded-btn border border-line p-2.5">
                  <div className="grid gap-2 sm:grid-cols-[1fr_88px]">
                    <Input
                      aria-label={t('Description')}
                      placeholder={t('Brick partition, 115 mm')}
                      value={line.description}
                      maxLength={500}
                      onChange={(event) => set(line.key, { description: event.target.value })}
                    />
                    <Input
                      aria-label={t('Unit')}
                      placeholder="m2"
                      value={line.unit}
                      maxLength={20}
                      onChange={(event) => set(line.key, { unit: event.target.value })}
                    />
                  </div>
                  <div className="grid items-center gap-2 sm:grid-cols-[96px_120px_120px_1fr_auto_auto]">
                    <Input
                      aria-label={t('Quantity')}
                      placeholder={t('Qty')}
                      inputMode="decimal"
                      value={line.quantity}
                      dir="ltr"
                      className="text-end font-mono"
                      onChange={(event) => set(line.key, { quantity: event.target.value, ...(event.target.value ? { amount: '' } : {}) })}
                    />
                    <Input
                      aria-label={`${t('Rate')} (${symbol})`}
                      placeholder={`${t('Rate')} (${symbol})`}
                      inputMode="decimal"
                      value={line.rate}
                      disabled={!line.quantity.trim()}
                      dir="ltr"
                      className="text-end font-mono"
                      onChange={(event) => set(line.key, { rate: event.target.value })}
                    />
                    <Input
                      aria-label={`${t('Lump sum')} (${symbol})`}
                      placeholder={`${t('Lump sum')} (${symbol})`}
                      inputMode="decimal"
                      value={line.amount}
                      disabled={Boolean(line.quantity.trim())}
                      dir="ltr"
                      className="text-end font-mono"
                      onChange={(event) => set(line.key, { amount: event.target.value })}
                    />
                    <Select
                      value={line.cost_code_id || 'none'}
                      onValueChange={(value) => set(line.key, { cost_code_id: value === 'none' ? '' : value })}
                    >
                      <SelectTrigger aria-label={t('Cost code')}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">{t('No cost code')}</SelectItem>
                        {codes.map((code) => (
                          <SelectItem key={code.id} value={code.id}>
                            {COST_CODE_INDENT.repeat(code.depth)}
                            {code.code} {code.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <span className="min-w-[96px] text-end font-mono text-[13px] text-ink-muted">
                      {cost === null ? '—' : format.money(cost.toString())}
                    </span>
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      className="size-8 text-ink-faint"
                      aria-label={`${t('Remove line')} ${index + 1}`}
                      onClick={() => setLines((rows) => rows.filter((row) => row.key !== line.key))}
                      disabled={lines.length === 1}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                </div>
              );
            })}
            <div>
              <Button type="button" variant="secondary" size="sm" onClick={() => setLines((rows) => [...rows, blankLine()])}>
                <Plus className="size-4" />
                {t('Add line')}
              </Button>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <Field label={t('Price to the client')}>
              <Select value={pricing} onValueChange={(value) => setPricing(value as 'markup' | 'fixed')}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="markup">{t('Cost plus markup')}</SelectItem>
                  <SelectItem value="fixed">{t('Agreed price')}</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            {pricing === 'markup' ? (
              <Field label={t('Markup %')} htmlFor="co-markup">
                <Input id="co-markup" inputMode="decimal" value={markup} onChange={(event) => setMarkup(event.target.value)} dir="ltr" />
              </Field>
            ) : (
              <Field label={`${t('Agreed price')} (${symbol})`} htmlFor="co-price">
                <Input id="co-price" inputMode="decimal" value={fixedPrice} onChange={(event) => setFixedPrice(event.target.value)} dir="ltr" />
              </Field>
            )}
            <Field
              label={`${rule.taxName ?? t('Tax')} %`}
              htmlFor="co-tax"
              hint={rule.standardRateBp === null && rule.taxName ? t('Depends on the work; ask your accountant') : undefined}
            >
              <Input id="co-tax" inputMode="decimal" value={tax} onChange={(event) => setTax(event.target.value)} dir="ltr" />
            </Field>
          </div>

          <dl className="grid grid-cols-2 gap-3 rounded-btn bg-raised p-3 text-[13px] sm:grid-cols-4">
            <Figure label={t('Cost impact')} value={format.money(figures.cost.toString())} />
            <Figure label={t('Client price')} value={format.money(figures.price.toString())} />
            <Figure label={rule.taxName ?? t('Tax')} value={format.money(figures.tax.toString())} />
            <Figure label={t('Client total')} value={format.money(figures.total.toString())} strong />
          </dl>

          {error && (
            <p role="alert" className="rounded-btn bg-blocked-bg px-3 py-2 text-[13px] text-blocked-fg">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              {t('Cancel')}
            </Button>
            <Button type="submit" disabled={pending}>
              {pending && <Loader2 className="size-4 animate-spin" />}
              {existing ? t('Save') : t('Save draft')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function Figure({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-[12px] text-ink-muted">{label}</dt>
      <dd className={`font-mono ${strong ? 'font-bold text-ink' : 'text-ink-soft'}`}>{value}</dd>
    </div>
  );
}
