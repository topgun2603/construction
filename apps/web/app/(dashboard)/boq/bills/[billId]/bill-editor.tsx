'use client';

import { useMemo, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Loader2, Printer, TriangleAlert } from 'lucide-react';
import { toast } from 'sonner';
import { boqComputeBill, boqInvoiceSplit, quantityToThousandths, thousandthsToQuantity } from '@sitebook/shared';
import {
  certifyBoqBill,
  deleteBoqBill,
  invoiceBoqBill,
  returnBoqBill,
  submitBoqBill,
  updateBoqBill,
} from '@/lib/boq-actions';
import { boqPercent, type BoqBillDetail } from '@/lib/boq-types';
import { useFormat } from '@/components/format-provider';
import { useLanguage } from '@/components/language-provider';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { cn } from '@/lib/utils';

const tryQuantity = (value: string): bigint | null => {
  try {
    return quantityToThousandths(value.trim());
  } catch {
    return null;
  }
};

/**
 * The client bill editor.
 *
 * A draft is claimed here — quantity to date per item, starting from the measurement book — and the
 * client's certificate is recorded here, item by item, for at most what was claimed. Amounts and the
 * totals down to net receivable are worked out as the numbers are typed, with the same
 * `boqComputeBill` the API stores, from the previous certified bill's cumulative figures.
 */
export function BoqBillEditor({
  bill,
  canBill,
  canSeePayments,
}: {
  bill: BoqBillDetail;
  canBill: boolean;
  canSeePayments: boolean;
}) {
  const { t } = useLanguage();
  const format = useFormat();
  const router = useRouter();
  const [pending, start] = useTransition();

  const claiming = canBill && bill.status === 'draft';
  const certifying = canBill && bill.status === 'submitted';
  const editable = claiming || certifying;

  const [quantities, setQuantities] = useState<Record<string, string>>(() =>
    Object.fromEntries(bill.lines.map((line) => [line.item_id, line.certified_quantity ?? line.claimed_quantity])),
  );
  const [note, setNote] = useState('');
  const [returnNote, setReturnNote] = useState('');
  const [dueDate, setDueDate] = useState('');

  const problems = useMemo(() => {
    const out = new Map<string, string>();
    if (!editable) return out;
    for (const line of bill.lines) {
      const qty = tryQuantity(quantities[line.item_id] ?? '');
      if (qty === null) out.set(line.item_id, t('Not a number'));
      else if (qty < quantityToThousandths(line.previous_quantity)) out.set(line.item_id, t('Below the last certificate'));
      else if (claiming && qty > quantityToThousandths(line.measured_quantity)) out.set(line.item_id, t('More than measured'));
      else if (certifying && qty > quantityToThousandths(line.claimed_quantity)) out.set(line.item_id, t('More than claimed'));
    }
    return out;
  }, [bill.lines, quantities, editable, claiming, certifying, t]);

  const live = useMemo(() => {
    const lines = bill.lines.map((line) => {
      const typed = editable ? tryQuantity(quantities[line.item_id] ?? '') : null;
      const stored = quantityToThousandths(line.certified_quantity ?? line.claimed_quantity);
      return {
        id: line.item_id,
        rate: BigInt(line.rate),
        contractQuantity: quantityToThousandths(line.contract_quantity),
        previousQuantity: quantityToThousandths(line.previous_quantity),
        quantityToDate: typed ?? stored,
      };
    });
    return boqComputeBill({
      lines,
      previous: {
        retentionToDate: BigInt(bill.previous.retention_to_date),
        advanceRecoveredToDate: BigInt(bill.previous.advance_recovered_to_date),
      },
      retentionBp: bill.boq.retention_bp,
      advanceRecoveryBp: bill.boq.advance_recovery_bp,
      advanceAmount: BigInt(bill.boq.advance_amount),
      taxRateBp: bill.figures.tax_rate_bp,
    });
  }, [bill, quantities, editable]);
  const lineFigures = new Map(live.lines.map((line) => [line.id, line]));
  // A certified bill shows what was certified; the stored figures are the record, not a recomputation.
  const figures = editable
    ? live
    : {
        grossToDate: BigInt(bill.figures.gross_to_date),
        previousGross: BigInt(bill.figures.previous_gross),
        gross: BigInt(bill.figures.gross),
        retention: BigInt(bill.figures.retention),
        retentionToDate: BigInt(bill.figures.retention_to_date),
        advanceRecovery: BigInt(bill.figures.advance_recovery),
        tax: BigInt(bill.figures.tax),
        netPayable: BigInt(bill.figures.net_payable),
      };
  const split = boqInvoiceSplit(figures);
  const claimedGross = BigInt(bill.figures.claimed_gross);
  const cut = bill.status !== 'draft' && claimedGross > figures.gross ? claimedGross - figures.gross : 0n;

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

  function typedLines(): Array<{ item_id: string; quantity: string }> | null {
    if (problems.size > 0) {
      toast.error(t('Fix the marked items first'));
      return null;
    }
    return bill.lines.map((line) => ({
      item_id: line.item_id,
      quantity: thousandthsToQuantity(tryQuantity(quantities[line.item_id] ?? '')!),
    }));
  }

  const projectId = bill.boq.project.id;

  function save(andSubmit: boolean) {
    const lines = typedLines();
    if (!lines) return;
    run(
      async () => {
        const saved = await updateBoqBill(projectId, bill.id, {
          lines: lines.map((line) => ({ item_id: line.item_id, quantity_to_date: line.quantity })),
        });
        if (!saved.ok || !andSubmit) return saved;
        return submitBoqBill(projectId, bill.id);
      },
      andSubmit ? t('Marked as sent to the client') : t('Saved'),
    );
  }

  function certify() {
    const lines = typedLines();
    if (!lines) return;
    run(
      () =>
        certifyBoqBill(projectId, bill.id, {
          lines: lines.map((line) => ({ item_id: line.item_id, certified_quantity_to_date: line.quantity })),
          ...(note.trim() ? { note: note.trim() } : {}),
        }),
      t('Certificate recorded'),
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-end gap-2">
        {pending && <Loader2 className="size-4 animate-spin text-ink-faint" />}
        <Button asChild variant="secondary" size="sm">
          <Link href={`/boq/bills/${bill.id}/print`}>
            <Printer className="size-4" />
            {t('Print')}
          </Link>
        </Button>
        {claiming && (
          <>
            <Button
              size="sm"
              variant="destructive"
              disabled={pending}
              onClick={() =>
                run(() => deleteBoqBill(projectId, bill.id), t('Draft deleted'), () =>
                  router.push(`/projects/${projectId}?tab=boq`),
                )
              }
            >
              {t('Delete draft')}
            </Button>
            <Button size="sm" variant="secondary" disabled={pending} onClick={() => save(false)}>
              {t('Save')}
            </Button>
            <Button size="sm" disabled={pending} onClick={() => save(true)}>
              {t('Send to the client')}
            </Button>
          </>
        )}
        {certifying && (
          <Button size="sm" variant="approve" disabled={pending} onClick={certify}>
            {t('Record the client’s certificate')}
          </Button>
        )}
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
              <TableHead className="text-end">{t('Measured')}</TableHead>
              <TableHead className="text-end">{t('Previous')}</TableHead>
              <TableHead className="text-end">{t('Claimed to date')}</TableHead>
              {bill.status !== 'draft' && <TableHead className="text-end">{t('Certified to date')}</TableHead>}
              <TableHead className="text-end">{t('Rate')}</TableHead>
              <TableHead className="text-end">{t('This bill')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {bill.lines.map((line) => {
              const problem = problems.get(line.item_id);
              const typed = editable ? tryQuantity(quantities[line.item_id] ?? '') : null;
              const over = typed === null ? line.over_contract : typed > quantityToThousandths(line.contract_quantity);
              const input = (
                <div className="flex flex-col items-end gap-0.5">
                  <Input
                    aria-label={`${line.item_no} ${t('to date')}`}
                    value={quantities[line.item_id] ?? ''}
                    inputMode="decimal"
                    dir="ltr"
                    className={cn('h-9 w-28 text-end font-mono', problem && 'border-blocked')}
                    onChange={(event) => setQuantities((current) => ({ ...current, [line.item_id]: event.target.value }))}
                  />
                  {problem && <span className="text-[11.5px] text-blocked-fg">{problem}</span>}
                </div>
              );
              const thisBill = editable ? lineFigures.get(line.item_id)?.thisBill.toString() : line.this_bill;
              return (
                <TableRow key={line.item_id}>
                  <TableCell className="text-start">
                    <div className="flex flex-col">
                      <span className="font-medium">
                        <span className="me-1.5 font-mono text-ink-muted" dir="ltr">
                          {line.item_no}
                        </span>
                        {line.description}
                      </span>
                      {line.section && <span className="text-[12px] text-ink-faint">{line.section}</span>}
                      {over && (
                        <span className="inline-flex items-center gap-1 text-[11.5px] text-blocked-fg">
                          <TriangleAlert className="size-3" />
                          {t('Beyond the contract quantity')}
                        </span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-end font-mono text-[13px]">
                    {line.contract_quantity} {line.unit}
                  </TableCell>
                  <TableCell className="text-end font-mono text-[13px]">{line.measured_quantity}</TableCell>
                  <TableCell className="text-end font-mono text-[13px]">{line.previous_quantity}</TableCell>
                  <TableCell className="text-end font-mono text-[13px]">{claiming ? input : line.claimed_quantity}</TableCell>
                  {bill.status !== 'draft' && (
                    <TableCell className="text-end font-mono text-[13px]">
                      {certifying ? input : (line.certified_quantity ?? '—')}
                    </TableCell>
                  )}
                  <TableCell className="text-end font-mono text-[13px]">{format.money(line.rate)}</TableCell>
                  <TableCell className="text-end font-mono text-[13px]">{format.money(thisBill ?? '0')}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </Card>

      <div className="grid gap-4 lg:grid-cols-[1fr_380px]">
        <Card className="flex flex-col gap-3 p-4">
          {certifying && (
            <>
              <Field label={t('Certificate number or remark')} optional>
                <Input value={note} maxLength={1000} onChange={(event) => setNote(event.target.value)} />
              </Field>
              <p className="text-[12.5px] text-ink-muted">
                {t('Enter what the client certified to date on each item. It can be less than claimed, never more.')}
              </p>
              <div className="mt-2 flex flex-col gap-2 border-t border-line-soft pt-3">
                <Input
                  aria-label={t('Why it goes back')}
                  placeholder={t('Why it goes back to draft')}
                  value={returnNote}
                  maxLength={1000}
                  onChange={(event) => setReturnNote(event.target.value)}
                />
                <div className="flex justify-end">
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={pending || !returnNote.trim()}
                    onClick={() => run(() => returnBoqBill(projectId, bill.id, returnNote.trim()), t('Back to draft'))}
                  >
                    {t('Return to draft')}
                  </Button>
                </div>
              </div>
            </>
          )}
          {claiming && (
            <p className="text-[12.5px] text-ink-muted">
              {t('Each item is claimed up to what the measurement book shows. Record a measurement to claim more.')}
            </p>
          )}
          {canBill && bill.status === 'certified' && (
            <div className="flex flex-col gap-3">
              <span className="text-[12px] font-semibold uppercase tracking-[0.08em] text-ink-muted">
                {t('Invoice the client')}
              </span>
              <p className="text-[13px] text-ink-muted">
                {t('Adds this bill to the site’s payment schedule as an instalment the client owes, marked as asked for today. Receipts are recorded against it there.')}
              </p>
              <div className="flex flex-wrap items-end gap-2">
                <Field label={t('Due on')} optional>
                  <Input type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} />
                </Field>
                <Button
                  disabled={pending}
                  onClick={() =>
                    run(() => invoiceBoqBill(projectId, bill.id, dueDate ? { due_date: dueDate } : {}), t('Invoiced'))
                  }
                >
                  {t('Invoice')} {format.money((split.amount + split.taxAmount).toString())}
                </Button>
              </div>
            </div>
          )}
          {bill.invoice && (
            <div className="flex flex-col gap-1.5 text-[13.5px]">
              <span className="text-[12px] font-semibold uppercase tracking-[0.08em] text-ink-muted">
                {t('In the payment schedule')}
              </span>
              <Row label={bill.invoice.label} value={format.money((BigInt(bill.invoice.amount) + BigInt(bill.invoice.tax_amount)).toString())} />
              {bill.invoice.due_date && <Row label={t('Due')} value={format.shortDate(bill.invoice.due_date)} />}
              <Row label={t('Received')} value={format.money(bill.invoice.paid)} />
              <Row label={t('Outstanding')} value={format.money(bill.invoice.outstanding)} strong />
              {canSeePayments && (
                <Link href={`/projects/${projectId}?tab=payments`} className="text-[13px] text-accent hover:underline">
                  {t('Record a receipt in Payments')}
                </Link>
              )}
            </div>
          )}
        </Card>

        <Card className="flex flex-col gap-1.5 p-4 text-[13.5px]">
          <Row label={t('Value of work to date')} value={format.money(figures.grossToDate.toString())} />
          <Row label={t('Less previously certified')} value={`− ${format.money(figures.previousGross.toString())}`} />
          <Row label={t('This bill')} value={format.money(figures.gross.toString())} strong />
          {cut > 0n && (
            <Row label={t('Claimed, not certified')} value={`${format.money(claimedGross.toString())} − ${format.money(cut.toString())}`} />
          )}
          <Row
            label={`${t('Retention')} ${boqPercent(bill.boq.retention_bp)}`}
            value={`− ${format.money(figures.retention.toString())}`}
          />
          <Row
            label={`${t('Advance recovery')} ${boqPercent(bill.boq.advance_recovery_bp)}`}
            value={`− ${format.money(figures.advanceRecovery.toString())}`}
          />
          <Row
            label={`${bill.boq.tax_name ?? t('Tax')} ${boqPercent(bill.figures.tax_rate_bp)}`}
            value={`+ ${format.money(figures.tax.toString())}`}
          />
          <div className="my-1 border-t border-line" />
          <Row label={t('Net receivable')} value={format.money(figures.netPayable.toString())} strong />
          <Row label={t('Retention held to date')} value={format.money(figures.retentionToDate.toString())} />
        </Card>
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
