'use client';

import { Plus, Trash2 } from 'lucide-react';
import { COST_CODE_INDENT, lineAmount, quantityToThousandths } from '@sitebook/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useFormat } from '@/components/format-provider';
import { useLanguage } from '@/components/language-provider';
import type { CostCode } from '@/lib/cost-code-types';
import { amountToMinorString } from '@/lib/money-input';
import type { SubcontractLineInput } from '@/lib/subcontract-types';

/** A line as it is being typed: the rate in major units, the way a person writes it. */
export interface DraftLine {
  key: string;
  item_code: string;
  description: string;
  unit: string;
  quantity: string;
  rate: string;
  cost_code_id: string;
}

let seq = 0;
export function blankLine(): DraftLine {
  seq += 1;
  return { key: `l${seq}`, item_code: '', description: '', unit: '', quantity: '', rate: '', cost_code_id: '' };
}

/** `qty × rate` in minor units, or null while either is not a number yet. */
function amountOf(line: DraftLine, digits: number, symbol: string): bigint | null {
  try {
    if (!line.quantity.trim() || !line.rate.trim()) return null;
    return lineAmount(quantityToThousandths(line.quantity), BigInt(amountToMinorString(line.rate, digits, symbol)));
  } catch {
    return null;
  }
}

/**
 * The typed lines as the API wants them, or the first problem found. Blank rows are skipped, so the
 * editor can always end on an empty one.
 */
export function linesForApi(
  lines: readonly DraftLine[],
  digits: number,
  symbol: string,
): { lines: SubcontractLineInput[] } | { error: string } {
  const out: SubcontractLineInput[] = [];
  for (const line of lines) {
    if (!line.description.trim() && !line.quantity.trim() && !line.rate.trim()) continue;
    if (!line.description.trim() || !line.unit.trim()) {
      return { error: 'Every line needs a description and a unit' };
    }
    if (!/^\d+(?:\.\d{1,3})?$/.test(line.quantity.trim()) || Number(line.quantity) <= 0) {
      return { error: `Enter the quantity for “${line.description}” as a number, like 120.5` };
    }
    let rate: string;
    try {
      rate = amountToMinorString(line.rate, digits, symbol);
    } catch {
      return { error: `Enter the rate for “${line.description}” as a number, like 250` };
    }
    if (rate.startsWith('-')) return { error: 'A rate cannot be negative' };
    out.push({
      description: line.description.trim(),
      unit: line.unit.trim(),
      quantity: line.quantity.trim(),
      rate,
      cost_code_id: line.cost_code_id || null,
      ...(line.item_code.trim() ? { item_code: line.item_code.trim() } : {}),
    });
  }
  return { lines: out };
}

/**
 * Rows of a schedule of rates — item, description, unit, quantity, rate, cost code — with the
 * amount worked out as it is typed.
 */
export function LinesEditor({
  lines,
  onChange,
  costCodes,
}: {
  lines: DraftLine[];
  onChange: (lines: DraftLine[]) => void;
  costCodes: CostCode[];
}) {
  const { t } = useLanguage();
  const format = useFormat();

  const set = (key: string, patch: Partial<DraftLine>) =>
    onChange(lines.map((line) => (line.key === key ? { ...line, ...patch } : line)));

  const total = lines.reduce(
    (sum, line) => sum + (amountOf(line, format.currencyDigits, format.currencySymbol) ?? 0n),
    0n,
  );

  return (
    <div className="flex flex-col gap-2">
      {lines.map((line, index) => {
        const amount = amountOf(line, format.currencyDigits, format.currencySymbol);
        return (
          <div key={line.key} className="flex flex-col gap-2 rounded-btn border border-line p-2.5">
            <div className="grid gap-2 sm:grid-cols-[72px_1fr_88px]">
              <Input
                aria-label={t('Item')}
                placeholder="1.1"
                value={line.item_code}
                maxLength={30}
                dir="ltr"
                className="font-mono"
                onChange={(event) => set(line.key, { item_code: event.target.value })}
              />
              <Input
                aria-label={t('Description')}
                placeholder={t('Internal plaster, 12 mm')}
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
            <div className="grid items-center gap-2 sm:grid-cols-[110px_130px_1fr_auto_auto]">
              <Input
                aria-label={t('Quantity')}
                placeholder={t('Qty')}
                inputMode="decimal"
                value={line.quantity}
                dir="ltr"
                className="text-end font-mono"
                onChange={(event) => set(line.key, { quantity: event.target.value })}
              />
              <Input
                aria-label={`${t('Rate')} (${format.currencySymbol})`}
                placeholder={`${t('Rate')} (${format.currencySymbol})`}
                inputMode="decimal"
                value={line.rate}
                dir="ltr"
                className="text-end font-mono"
                onChange={(event) => set(line.key, { rate: event.target.value })}
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
                  {costCodes.map((code) => (
                    <SelectItem key={code.id} value={code.id}>
                      {COST_CODE_INDENT.repeat(code.depth)}
                      {code.code} {code.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <span className="min-w-[96px] text-end font-mono text-[13px] text-ink-muted">
                {amount === null ? '—' : format.money(amount.toString())}
              </span>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="size-8 text-ink-faint"
                aria-label={`${t('Remove line')} ${index + 1}`}
                onClick={() => onChange(lines.filter((row) => row.key !== line.key))}
                disabled={lines.length === 1}
              >
                <Trash2 className="size-4" />
              </Button>
            </div>
          </div>
        );
      })}
      <div className="flex items-center justify-between gap-3">
        <Button type="button" variant="secondary" size="sm" onClick={() => onChange([...lines, blankLine()])}>
          <Plus className="size-4" />
          {t('Add line')}
        </Button>
        <span className="text-[13px] text-ink-muted">
          {t('Total')}: <span className="font-mono font-semibold text-ink">{format.money(total.toString())}</span>
        </span>
      </div>
    </div>
  );
}
