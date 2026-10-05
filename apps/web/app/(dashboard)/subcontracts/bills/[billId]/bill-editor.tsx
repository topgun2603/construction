'use client';

import { useMemo, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Loader2, Plus, Printer, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import {
  COST_CODE_INDENT,
  SUBCONTRACT_DEDUCTION_KINDS,
  SUBCONTRACT_DEDUCTION_LABELS,
  basisPointsOf,
  computeRaBill,
  percentOfQuantity,
  percentToBasisPoints,
  quantityToThousandths,
  thousandthsToQuantity,
  type SubcontractDeductionKind,
} from '@sitebook/shared';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useFormat } from '@/components/format-provider';
import { useLanguage } from '@/components/language-provider';
import type { CostCode } from '@/lib/cost-code-types';
import { amountToMinorString, minorToAmountInput } from '@/lib/money-input';
import {
  certifyRaBill,
  deleteRaBill,
  payRaBill,
  returnRaBill,
  submitRaBill,
  updateRaBill,
} from '@/lib/subcontract-actions';
import type { RaBillDetail, RaDeductionInput } from '@/lib/subcontract-types';
import { cn } from '@/lib/utils';
import { percent } from '../../labels';
import { AmountDialog } from '../../payment-dialog';

interface DraftDeduction {
  key: string;
  kind: SubcontractDeductionKind;
  description: string;
  amount: string;
  cost_code_id: string;
}

const tryQuantity = (value: string): bigint | null => {
  try {
    return quantityToThousandths(value);
  } catch {
    return null;
  }
};

/**
 * The RA bill editor.
 *
 * A draft is measured here — work done to date on each line, as a quantity or as a percentage of the
 * line — and a submitted bill is certified here, line by line, for at most what was claimed. The
 * amounts beside each line and the bill's totals are worked out as the numbers are typed, with the
 * same `computeRaBill` the API stores; advance recovery is capped by what has actually been paid,
 * which only the API knows, so it is shown as last saved until the bill is saved again.
 */
export function BillEditor({
  bill,
  costCodes,
  can,
}: {
  bill: RaBillDetail;
  costCodes: CostCode[];
  can: { measure: boolean; certify: boolean; pay: boolean };
}) {
  const { t } = useLanguage();
  const format = useFormat();
  const router = useRouter();
  const [pending, start] = useTransition();
  const showMoney = bill.figures !== null;

  const measuring = bill.status === 'draft' && can.measure;
  const certifying = bill.status === 'submitted' && can.certify;
  const editable = measuring || certifying;

  const [byPercent, setByPercent] = useState(false);
  const [quantities, setQuantities] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      // A certifier starts from the claim and cuts it where the work is not there.
      bill.lines.map((line) => [line.line_id, line.certified_quantity ?? line.claimed_quantity]),
    ),
  );
  const [deductions, setDeductions] = useState<DraftDeduction[]>(() =>
    bill.deductions.map((row) => ({
      key: row.id,
      kind: row.kind,
      description: row.description,
      amount: minorToAmountInput(row.amount, format.currencyDigits),
      cost_code_id: row.cost_code?.id ?? '',
    })),
  );
  const [returnNote, setReturnNote] = useState('');

  /** What is typed in a line's box, as a cumulative quantity in thousandths. */
  function typedQuantity(lineId: string, contract: bigint): bigint | null {
    const raw = (quantities[lineId] ?? '').trim();
    if (!byPercent) return tryQuantity(raw);
    const bp = percentToBasisPoints(raw);
    return bp === null ? null : percentOfQuantity(contract, bp);
  }

  function switchMode(next: boolean) {
    if (next === byPercent) return;
    // Convert what is typed so switching never loses a measurement.
    setQuantities((current) =>
      Object.fromEntries(
        bill.lines.map((line) => {
          const contract = quantityToThousandths(line.contract_quantity);
          const raw = (current[line.line_id] ?? '').trim();
          if (next) {
            const qty = tryQuantity(raw);
            const bp = qty === null || contract === 0n ? 0n : (qty * 10_000n) / contract;
            return [line.line_id, (Number(bp) / 100).toString()];
          }
          const bp = percentToBasisPoints(raw);
          return [line.line_id, bp === null ? raw : thousandthsToQuantity(percentOfQuantity(contract, bp))];
        }),
      ),
    );
    setByPercent(next);
  }

  const deductionTotal = deductions.reduce((sum, row) => {
    try {
      return sum + BigInt(amountToMinorString(row.amount, format.currencyDigits, format.currencySymbol));
    } catch {
      return sum;
    }
  }, 0n);

  const live = useMemo(() => {
    if (!showMoney || !bill.figures) return null;
    const lines = bill.lines.map((line) => {
      const contract = quantityToThousandths(line.contract_quantity);
      const previous = quantityToThousandths(line.previous_quantity);
      const typed = editable ? typedQuantity(line.line_id, contract) : null;
      const used = line.certified_quantity ?? line.claimed_quantity;
      return {
        id: line.line_id,
        rate: BigInt(line.rate ?? '0'),
        contractQuantity: contract,
        previousQuantity: previous,
        quantityToDate: typed ?? quantityToThousandths(used),
      };
    });
    const figures = bill.figures;
    const previousRetention = BigInt(figures.retention_to_date) - BigInt(figures.retention);
    const previousAdvance = BigInt(figures.advance_recovered_to_date) - BigInt(figures.advance_recovery);
    const computed = computeRaBill({
      lines,
      previous: { retentionToDate: previousRetention, advanceRecoveredToDate: previousAdvance },
      retentionBp: bill.subcontract.retention_bp,
      advanceRecoveryBp: 0,
      advancePaid: 0n,
      taxRateBp: figures.tax_rate_bp,
      deductions: editable ? deductionTotal : BigInt(figures.deductions),
    });
    // Recovery as last saved: see the component's note.
    const advance = BigInt(figures.advance_recovery);
    return { ...computed, advanceRecovery: advance, netPayable: computed.netPayable - advance };
  }, [bill, quantities, byPercent, deductions, editable, showMoney]);

  const problems = useMemo(() => {
    const out = new Map<string, string>();
    if (!editable) return out;
    for (const line of bill.lines) {
      const contract = quantityToThousandths(line.contract_quantity);
      const qty = typedQuantity(line.line_id, contract);
      if (qty === null) out.set(line.line_id, t('Not a number'));
      else if (qty < quantityToThousandths(line.previous_quantity)) out.set(line.line_id, t('Below the last bill'));
      else if (qty > contract) out.set(line.line_id, t('More than the contract'));
      else if (certifying && qty > quantityToThousandths(line.claimed_quantity)) out.set(line.line_id, t('More than claimed'));
    }
    return out;
  }, [bill.lines, quantities, byPercent, editable, certifying]);

  function payload(): {
    lines: Array<{ line_id: string; quantity: string }>;
    deductions: RaDeductionInput[];
  } | null {
    if (problems.size > 0) {
      toast.error(t('Fix the marked lines first'));
      return null;
    }
    const lines = bill.lines.map((line) => ({
      line_id: line.line_id,
      quantity: thousandthsToQuantity(typedQuantity(line.line_id, quantityToThousandths(line.contract_quantity))!),
    }));
    const out: RaDeductionInput[] = [];
    for (const row of deductions) {
      if (!row.description.trim() && !row.amount.trim()) continue;
      let amount: string;
      try {
        amount = amountToMinorString(row.amount, format.currencyDigits, format.currencySymbol);
      } catch {
        toast.error(t('Enter each back-charge as a number'));
        return null;
      }
      if (!row.description.trim() || BigInt(amount) <= 0n) {
        toast.error(t('Each back-charge needs a description and an amount'));
        return null;
      }
      out.push({
        kind: row.kind,
        description: row.description.trim(),
        amount,
        cost_code_id: row.cost_code_id || null,
      });
    }
    return { lines, deductions: out };
  }

  function run(work: () => Promise<{ ok: boolean; error?: string }>, done: string, then?: () => void) {
    start(async () => {
      const result = await work();
      if (!result.ok) {
        toast.error(result.error ?? t('Could not save that'));
        return;
      }
      toast.success(done);
      if (then) then();
      else router.refresh();
    });
  }

  function save(andSubmit: boolean) {
    const body = payload();
    if (!body) return;
    run(async () => {
      const saved = await updateRaBill(bill.subcontract.id, bill.id, {
        lines: body.lines.map((line) => ({ line_id: line.line_id, quantity_to_date: line.quantity })),
        deductions: body.deductions,
      });
      if (!saved.ok || !andSubmit) return saved;
      return submitRaBill(bill.subcontract.id, bill.id);
    }, andSubmit ? t('Sent for certification') : t('Saved'));
  }

  function certify() {
    const body = payload();
    if (!body) return;
    run(
      () =>
        certifyRaBill(bill.subcontract.id, bill.id, {
          lines: body.lines.map((line) => ({ line_id: line.line_id, certified_quantity_to_date: line.quantity })),
          deductions: body.deductions,
        }),
      t('Bill certified'),
    );
  }

  const owed = bill.figures && bill.paid !== null ? BigInt(bill.figures.net_payable) - BigInt(bill.paid) : 0n;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        {editable ? (
          <div className="flex rounded-btn border border-line p-0.5 text-[13px]">
            {[false, true].map((mode) => (
              <button
                key={String(mode)}
                type="button"
                onClick={() => switchMode(mode)}
                className={cn(
                  'rounded-[7px] px-3 py-1.5 font-medium',
                  byPercent === mode ? 'bg-accent-soft text-accent' : 'text-ink-muted hover:text-ink',
                )}
              >
                {mode ? t('% complete') : t('Quantity to date')}
              </button>
            ))}
          </div>
        ) : (
          <span />
        )}
        <div className="flex flex-wrap items-center gap-2">
          {pending && <Loader2 className="size-4 animate-spin text-ink-faint" />}
          {showMoney && (
            <Button asChild variant="secondary" size="sm">
              <Link href={`/subcontracts/bills/${bill.id}/print`}>
                <Printer className="size-4" />
                {t('Print')}
              </Link>
            </Button>
          )}
          {measuring && (
            <>
              <Button
                size="sm"
                variant="destructive"
                disabled={pending}
                onClick={() =>
                  run(() => deleteRaBill(bill.subcontract.id, bill.id), t('Draft deleted'), () =>
                    router.push(`/subcontracts/${bill.subcontract.id}`),
                  )
                }
              >
                {t('Delete draft')}
              </Button>
              <Button size="sm" variant="secondary" disabled={pending} onClick={() => save(false)}>
                {t('Save')}
              </Button>
              <Button size="sm" disabled={pending} onClick={() => save(true)}>
                {t('Submit for certification')}
              </Button>
            </>
          )}
          {certifying && (
            <Button size="sm" variant="approve" disabled={pending} onClick={certify}>
              {t('Certify')}
            </Button>
          )}
          {can.pay && bill.status === 'certified' && owed > 0n && (
            <AmountDialog
              trigger={<Button size="sm">{t('Record payment')}</Button>}
              title={`${t('Pay')} RA-${bill.number}`}
              description={t('Money handed over against this certified bill.')}
              suggested={owed.toString()}
              max={owed.toString()}
              confirmLabel={t('Record payment')}
              onSubmit={(input) => payRaBill(bill.subcontract.id, bill.id, input)}
            />
          )}
        </div>
      </div>

      {bill.certification_note && (
        <p className="rounded-btn bg-pending-bg px-3 py-2 text-[13px] text-pending-fg">{bill.certification_note}</p>
      )}

      <Card className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="text-start">{t('Item')}</TableHead>
              <TableHead className="text-end">{t('Contract')}</TableHead>
              <TableHead className="text-end">{t('Previous')}</TableHead>
              <TableHead className="text-end">{t('Claimed to date')}</TableHead>
              {(bill.status !== 'draft' || certifying) && <TableHead className="text-end">{t('Certified to date')}</TableHead>}
              {showMoney && <TableHead className="text-end">{t('Rate')}</TableHead>}
              {showMoney && <TableHead className="text-end">{t('This bill')}</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {bill.lines.map((line) => {
              const figure = live?.lines.find((row) => row.id === line.line_id);
              const problem = problems.get(line.line_id);
              const input = (
                <div className="flex flex-col items-end gap-0.5">
                  <Input
                    aria-label={`${line.description} ${t('to date')}`}
                    value={quantities[line.line_id] ?? ''}
                    inputMode="decimal"
                    dir="ltr"
                    className={cn('h-9 w-28 text-end font-mono', problem && 'border-blocked')}
                    onChange={(event) => setQuantities((current) => ({ ...current, [line.line_id]: event.target.value }))}
                  />
                  {problem && <span className="text-[11.5px] text-blocked-fg">{problem}</span>}
                </div>
              );
              return (
                <TableRow key={line.line_id}>
                  <TableCell className="text-start">
                    <div className="flex flex-col">
                      <span className="font-medium">
                        {line.item_code && (
                          <span className="me-1.5 font-mono text-ink-muted" dir="ltr">
                            {line.item_code}
                          </span>
                        )}
                        {line.description}
                      </span>
                      <span className="text-[12px] text-ink-muted">
                        {line.cost_code ? `${line.cost_code.code} ${line.cost_code.name}` : t('Unallocated')}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell className="text-end font-mono text-[13px]">
                    {line.contract_quantity} {line.unit}
                  </TableCell>
                  <TableCell className="text-end font-mono text-[13px]">{line.previous_quantity}</TableCell>
                  <TableCell className="text-end font-mono text-[13px]">
                    {measuring ? input : line.claimed_quantity}
                  </TableCell>
                  {(bill.status !== 'draft' || certifying) && (
                    <TableCell className="text-end font-mono text-[13px]">
                      {certifying ? input : (line.certified_quantity ?? '—')}
                    </TableCell>
                  )}
                  {showMoney && <TableCell className="text-end font-mono text-[13px]">{format.money(line.rate)}</TableCell>}
                  {showMoney && (
                    <TableCell className="text-end font-mono text-[13px]">
                      {figure ? format.money(figure.thisBill.toString()) : format.money(line.this_bill)}
                    </TableCell>
                  )}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </Card>

      <div className="grid gap-4 lg:grid-cols-[1fr_380px]">
        <Card className="flex flex-col gap-3 p-4">
          <div className="flex items-center justify-between gap-3">
            <span className="text-[12px] font-semibold uppercase tracking-[0.08em] text-ink-muted">
              {t('Deductions and back-charges')}
            </span>
            {editable && (
              <Button
                size="sm"
                variant="secondary"
                onClick={() =>
                  setDeductions((rows) => [
                    ...rows,
                    { key: `d${Date.now()}`, kind: 'material', description: '', amount: '', cost_code_id: '' },
                  ])
                }
              >
                <Plus className="size-4" />
                {t('Add')}
              </Button>
            )}
          </div>
          {deductions.length === 0 ? (
            <p className="text-[13.5px] text-ink-muted">{t('None on this bill.')}</p>
          ) : (
            deductions.map((row) =>
              editable ? (
                <div key={row.key} className="grid gap-2 sm:grid-cols-[150px_1fr_120px_auto]">
                  <Select
                    value={row.kind}
                    onValueChange={(value) =>
                      setDeductions((rows) => rows.map((r) => (r.key === row.key ? { ...r, kind: value as SubcontractDeductionKind } : r)))
                    }
                  >
                    <SelectTrigger aria-label={t('Kind')}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {SUBCONTRACT_DEDUCTION_KINDS.map((kind) => (
                        <SelectItem key={kind} value={kind}>
                          {t(SUBCONTRACT_DEDUCTION_LABELS[kind])}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <div className="flex flex-col gap-2">
                    <Input
                      aria-label={t('Description')}
                      placeholder={t('Cement issued from our store')}
                      value={row.description}
                      maxLength={300}
                      onChange={(event) =>
                        setDeductions((rows) => rows.map((r) => (r.key === row.key ? { ...r, description: event.target.value } : r)))
                      }
                    />
                    <Select
                      value={row.cost_code_id || 'none'}
                      onValueChange={(value) =>
                        setDeductions((rows) =>
                          rows.map((r) => (r.key === row.key ? { ...r, cost_code_id: value === 'none' ? '' : value } : r)),
                        )
                      }
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
                  </div>
                  <Input
                    aria-label={`${t('Amount')} (${format.currencySymbol})`}
                    placeholder={format.currencySymbol}
                    value={row.amount}
                    inputMode="decimal"
                    dir="ltr"
                    className="text-end font-mono"
                    onChange={(event) =>
                      setDeductions((rows) => rows.map((r) => (r.key === row.key ? { ...r, amount: event.target.value } : r)))
                    }
                  />
                  <Button
                    size="icon"
                    variant="ghost"
                    className="size-8 text-ink-faint"
                    aria-label={t('Remove')}
                    onClick={() => setDeductions((rows) => rows.filter((r) => r.key !== row.key))}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              ) : (
                <div key={row.key} className="flex items-center justify-between gap-3 text-[13.5px]">
                  <span>
                    {t(SUBCONTRACT_DEDUCTION_LABELS[row.kind])} · {row.description}
                  </span>
                  <span className="font-mono">− {format.money(amountToMinorString(row.amount, format.currencyDigits))}</span>
                </div>
              ),
            )
          )}
          {certifying && (
            <div className="mt-2 flex flex-col gap-2 border-t border-line-soft pt-3">
              <Input
                aria-label={t('Why it goes back')}
                placeholder={t('Why it goes back to the site')}
                value={returnNote}
                maxLength={1000}
                onChange={(event) => setReturnNote(event.target.value)}
              />
              <div className="flex justify-end">
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={pending || !returnNote.trim()}
                  onClick={() => run(() => returnRaBill(bill.subcontract.id, bill.id, returnNote.trim()), t('Sent back to the site'))}
                >
                  {t('Return for re-measurement')}
                </Button>
              </div>
            </div>
          )}
        </Card>

        {live && bill.figures && (
          <Card className="flex flex-col gap-1.5 p-4 text-[13.5px]">
            <Row label={t('Gross to date')} value={format.money(live.grossToDate.toString())} />
            <Row label={t('Less previous bills')} value={`− ${format.money(live.previousGross.toString())}`} />
            <Row label={t('This bill')} value={format.money(live.gross.toString())} strong />
            <Row
              label={`${t('Tax')} ${percent(bill.figures.tax_rate_bp)}`}
              value={`+ ${format.money(live.tax.toString())}`}
            />
            <Row
              label={`${t('Retention')} ${percent(bill.subcontract.retention_bp)}`}
              value={`− ${format.money(live.retention.toString())}`}
            />
            <Row
              label={`${t('Advance recovery')} ${percent(bill.subcontract.advance_recovery_bp)}`}
              value={`− ${format.money(live.advanceRecovery.toString())}`}
            />
            <Row label={t('Deductions')} value={`− ${format.money(live.deductions.toString())}`} />
            <div className="my-1 border-t border-line" />
            <Row label={t('Net payable')} value={format.money(live.netPayable.toString())} strong />
            {bill.paid !== null && bill.status !== 'draft' && bill.status !== 'submitted' && (
              <Row label={t('Paid')} value={format.money(bill.paid)} />
            )}
            {editable && bill.subcontract.advance_recovery_bp > 0 && (
              <span className="mt-1 text-[12px] text-ink-faint">
                {t('Advance recovery is worked out again when the bill is saved, against what has actually been advanced.')}
                {' '}
                {t('Approximately')} {format.money(basisPointsOf(live.grossToDate, bill.subcontract.advance_recovery_bp).toString())}{' '}
                {t('to date')}.
              </span>
            )}
          </Card>
        )}
      </div>
    </div>
  );
}

function Row({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={cn('flex items-center justify-between gap-3', strong && 'font-semibold')}>
      <span className={strong ? 'text-ink' : 'text-ink-muted'}>{label}</span>
      <span className="font-mono">{value}</span>
    </div>
  );
}
