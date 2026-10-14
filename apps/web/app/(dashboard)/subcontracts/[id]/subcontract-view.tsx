'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Check, Download, FileText, Loader2, Plus, X } from 'lucide-react';
import { toast } from 'sonner';
import { CSV_BOM, subcontractStatementCsv, type SubcontractStatementView } from '@sitebook/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { Input, Textarea } from '@/components/ui/input';
import { Field } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useFormat } from '@/components/format-provider';
import { useLanguage } from '@/components/language-provider';
import type { SiteDocument } from '@/lib/api-types';
import type { CostCode } from '@/lib/cost-code-types';
import {
  attachSubcontractDocument,
  createRaBill,
  decideVariation,
  deleteSubcontract,
  detachSubcontractDocument,
  paySubcontract,
  proposeVariation,
  releaseRetention,
  removeSubcontractLine,
  setSubcontractStatus,
} from '@/lib/subcontract-actions';
import type { SubcontractDetail, SubcontractLine, SubcontractStatus } from '@/lib/subcontract-types';
import { BILL_STATUS, percent } from '../labels';
import { LinesEditor, blankLine, linesForApi, type DraftLine } from '../lines-editor';
import { AmountDialog } from '../payment-dialog';

export interface SubcontractAbilities {
  manage: boolean;
  measure: boolean;
  certify: boolean;
  pay: boolean;
  seeMoney: boolean;
}

/**
 * The tabs of one subcontract. Every control appears only for whoever the API would let use it, so
 * nothing on the page opens onto a refusal.
 */
export function SubcontractView({
  subcontract,
  costCodes,
  documents,
  can,
}: {
  subcontract: SubcontractDetail;
  costCodes: CostCode[];
  documents: SiteDocument[];
  can: SubcontractAbilities;
}) {
  const { t } = useLanguage();
  const pendingVariations = subcontract.variations.filter((row) => row.status === 'pending').length;

  return (
    <div className="flex flex-col gap-4">
      <ActionsBar subcontract={subcontract} can={can} />
      <Tabs defaultValue="lines">
        <TabsList className="overflow-x-auto">
          <TabsTrigger value="lines">{t('Schedule')}</TabsTrigger>
          <TabsTrigger value="variations">
            {t('Variations')}
            {pendingVariations > 0 && ` (${pendingVariations})`}
          </TabsTrigger>
          <TabsTrigger value="bills">{t('RA bills')}</TabsTrigger>
          {can.seeMoney && <TabsTrigger value="retention">{t('Retention & payments')}</TabsTrigger>}
          {can.seeMoney && <TabsTrigger value="statement">{t('Statement')}</TabsTrigger>}
          <TabsTrigger value="terms">{t('Terms & documents')}</TabsTrigger>
        </TabsList>
        <TabsContent value="lines" className="pt-4">
          <LinesTable subcontract={subcontract} lines={subcontract.lines} canEdit={can.manage && subcontract.status === 'draft'} />
        </TabsContent>
        <TabsContent value="variations" className="pt-4">
          <VariationsTab subcontract={subcontract} costCodes={costCodes} can={can} />
        </TabsContent>
        <TabsContent value="bills" className="pt-4">
          <BillsTab subcontract={subcontract} />
        </TabsContent>
        {can.seeMoney && (
          <TabsContent value="retention" className="pt-4">
            <RetentionTab subcontract={subcontract} can={can} />
          </TabsContent>
        )}
        {can.seeMoney && subcontract.statement && (
          <TabsContent value="statement" className="pt-4">
            <StatementTab subcontract={subcontract} statement={subcontract.statement} />
          </TabsContent>
        )}
        <TabsContent value="terms" className="pt-4">
          <TermsTab subcontract={subcontract} documents={documents} canManage={can.manage} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// --- the header's actions ------------------------------------------------------------------------

function ActionsBar({ subcontract, can }: { subcontract: SubcontractDetail; can: SubcontractAbilities }) {
  const { t } = useLanguage();
  const { todayIso } = useFormat();
  const router = useRouter();
  const [pending, start] = useTransition();
  const open = subcontract.open_bill;

  function run(work: () => Promise<{ ok: boolean; error?: string }>, done: string, then?: () => void) {
    start(async () => {
      const result = await work();
      if (!result.ok) {
        toast.error(result.error ?? t('Could not do that'));
        return;
      }
      toast.success(done);
      if (then) then();
      else router.refresh();
    });
  }

  const move = (status: SubcontractStatus, done: string) =>
    run(() => setSubcontractStatus(subcontract.id, status, status === 'completed' ? todayIso() : undefined), done);

  function newBill() {
    start(async () => {
      const result = await createRaBill(subcontract.id, { period_to: todayIso() });
      if (!result.ok || !result.data) {
        toast.error(result.error ?? t('Could not start the bill'));
        return;
      }
      router.push(`/subcontracts/bills/${result.data.id}`);
    });
  }

  const canBill = can.measure && (subcontract.status === 'active' || subcontract.status === 'completed');

  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      {pending && <Loader2 className="size-4 animate-spin text-ink-faint" />}
      {open && (
        <Button asChild variant="secondary" size="sm">
          <Link href={`/subcontracts/bills/${open.id}`}>
            RA-{open.number} · {t(BILL_STATUS[open.status].label)}
          </Link>
        </Button>
      )}
      {canBill && !open && (
        <Button size="sm" onClick={newBill} disabled={pending}>
          <Plus className="size-4" />
          {t('New RA bill')}
        </Button>
      )}
      {can.manage && subcontract.status === 'draft' && (
        <>
          <Button
            size="sm"
            variant="destructive"
            disabled={pending}
            onClick={() => run(() => deleteSubcontract(subcontract.id), t('Draft deleted'), () => router.push('/subcontracts'))}
          >
            {t('Delete draft')}
          </Button>
          <Button size="sm" variant="approve" disabled={pending} onClick={() => move('active', t('Subcontract let'))}>
            {t('Let the subcontract')}
          </Button>
        </>
      )}
      {can.manage && subcontract.status === 'active' && (
        <Button size="sm" variant="secondary" disabled={pending} onClick={() => move('completed', t('Marked complete'))}>
          {t('Mark work complete')}
        </Button>
      )}
      {can.manage && subcontract.status === 'completed' && (
        <Button size="sm" variant="secondary" disabled={pending} onClick={() => move('closed', t('Account closed'))}>
          {t('Close the account')}
        </Button>
      )}
      {can.manage && (subcontract.status === 'active' || subcontract.status === 'completed') && (
        <Button size="sm" variant="destructive" disabled={pending} onClick={() => move('terminated', t('Subcontract terminated'))}>
          {t('Terminate')}
        </Button>
      )}
    </div>
  );
}

// --- schedule ------------------------------------------------------------------------------------

function LinesTable({
  subcontract,
  lines,
  canEdit,
}: {
  subcontract: SubcontractDetail;
  lines: SubcontractLine[];
  canEdit: boolean;
}) {
  const { t } = useLanguage();
  const { money } = useFormat();
  const router = useRouter();
  const [pending, start] = useTransition();
  const showMoney = lines.some((line) => line.rate !== null);

  if (lines.length === 0) {
    return (
      <EmptyState
        icon={<FileText />}
        title={t('No lines yet')}
        body={t('The schedule of rates is what every bill is measured against.')}
      />
    );
  }

  return (
    <Card className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className="text-start">{t('Item')}</TableHead>
            <TableHead className="text-start">{t('Cost code')}</TableHead>
            <TableHead className="text-end">{t('Quantity')}</TableHead>
            {showMoney && <TableHead className="text-end">{t('Rate')}</TableHead>}
            {showMoney && <TableHead className="text-end">{t('Amount')}</TableHead>}
            <TableHead className="text-end">{t('Certified to date')}</TableHead>
            {canEdit && <TableHead className="w-[1%]" />}
          </TableRow>
        </TableHeader>
        <TableBody>
          {lines.map((line) => (
            <TableRow key={line.id}>
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
                  {line.variation_id && (
                    <span className="text-[12px] text-ink-muted">{t('Added by a variation')}</span>
                  )}
                </div>
              </TableCell>
              <TableCell className="text-start text-[13px] text-ink-muted">
                {line.cost_code ? `${line.cost_code.code} ${line.cost_code.name}` : t('Unallocated')}
              </TableCell>
              <TableCell className="text-end font-mono text-[13px]">
                {line.quantity} {line.unit}
              </TableCell>
              {showMoney && <TableCell className="text-end font-mono text-[13px]">{money(line.rate)}</TableCell>}
              {showMoney && <TableCell className="text-end font-mono text-[13px]">{money(line.amount)}</TableCell>}
              <TableCell className="text-end font-mono text-[13px]">
                {line.certified_quantity} {line.unit}
                {line.certified_value !== null && (
                  <div className="text-[12px] text-ink-muted">{money(line.certified_value)}</div>
                )}
              </TableCell>
              {canEdit && (
                <TableCell>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="size-8 text-ink-faint"
                    aria-label={`${t('Remove')} ${line.description}`}
                    disabled={pending}
                    onClick={() =>
                      start(async () => {
                        const result = await removeSubcontractLine(subcontract.id, line.id);
                        if (!result.ok) toast.error(result.error ?? t('Could not remove that line'));
                        else router.refresh();
                      })
                    }
                  >
                    <X className="size-4" />
                  </Button>
                </TableCell>
              )}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Card>
  );
}

// --- variations ----------------------------------------------------------------------------------

function VariationsTab({
  subcontract,
  costCodes,
  can,
}: {
  subcontract: SubcontractDetail;
  costCodes: CostCode[];
  can: SubcontractAbilities;
}) {
  const { t } = useLanguage();
  const { money, instantDate } = useFormat();
  const router = useRouter();
  const [pending, start] = useTransition();

  function decide(variationId: string, status: 'approved' | 'rejected') {
    start(async () => {
      const result = await decideVariation(subcontract.id, variationId, status);
      if (!result.ok) {
        toast.error(result.error ?? t('Could not record the decision'));
        return;
      }
      toast.success(status === 'approved' ? t('Variation approved') : t('Variation rejected'));
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-3">
      {can.manage && subcontract.status === 'active' && (
        <div className="flex justify-end">
          <VariationDialog subcontractId={subcontract.id} costCodes={costCodes} />
        </div>
      )}
      {subcontract.variations.length === 0 ? (
        <EmptyState
          icon={<FileText />}
          title={t('No variations')}
          body={t('Extra work on a let subcontract is recorded here, and raises its value once approved.')}
        />
      ) : (
        subcontract.variations.map((variation) => (
          <Card key={variation.id} className="flex flex-col gap-3 p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="flex flex-col">
                <span className="font-semibold">
                  V-{variation.number} · {variation.title}
                </span>
                <span className="text-[12.5px] text-ink-muted">
                  {variation.requested_by?.name} · {instantDate(variation.created_at)}
                  {variation.decided_by && ` · ${t('decided by')} ${variation.decided_by.name}`}
                </span>
                {variation.reason && <p className="mt-1 text-[13.5px]">{variation.reason}</p>}
              </div>
              <div className="flex items-center gap-2">
                {variation.value !== null && <span className="font-mono text-[14px] font-semibold">{money(variation.value)}</span>}
                <Badge tone={variation.status === 'approved' ? 'done' : variation.status === 'rejected' ? 'blocked' : 'pending'}>
                  {t(variation.status === 'approved' ? 'Approved' : variation.status === 'rejected' ? 'Rejected' : 'Pending')}
                </Badge>
              </div>
            </div>
            <LinesTable subcontract={subcontract} lines={variation.lines} canEdit={false} />
            {can.certify && variation.status === 'pending' && (
              <div className="flex justify-end gap-2">
                <Button size="sm" variant="destructive" disabled={pending} onClick={() => decide(variation.id, 'rejected')}>
                  <X className="size-4" />
                  {t('Reject')}
                </Button>
                <Button size="sm" variant="approve" disabled={pending} onClick={() => decide(variation.id, 'approved')}>
                  <Check className="size-4" />
                  {t('Approve')}
                </Button>
              </div>
            )}
          </Card>
        ))
      )}
    </div>
  );
}

function VariationDialog({ subcontractId, costCodes }: { subcontractId: string; costCodes: CostCode[] }) {
  const { t } = useLanguage();
  const format = useFormat();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [lines, setLines] = useState<DraftLine[]>([blankLine()]);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function submit(formData: FormData) {
    setError(null);
    const parsed = linesForApi(lines, format.currencyDigits, format.currencySymbol);
    if ('error' in parsed) {
      setError(t(parsed.error));
      return;
    }
    if (parsed.lines.length === 0) {
      setError(t('A variation needs at least one line'));
      return;
    }
    const reason = String(formData.get('reason') ?? '').trim();
    start(async () => {
      const result = await proposeVariation(subcontractId, {
        title: String(formData.get('title') ?? '').trim(),
        ...(reason ? { reason } : {}),
        lines: parsed.lines,
      });
      if (!result.ok) {
        setError(result.error ?? t('Could not save the variation'));
        return;
      }
      toast.success(t('Variation sent for approval'));
      setOpen(false);
      setLines([blankLine()]);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus className="size-4" />
          {t('Propose a variation')}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t('Propose a variation')}</DialogTitle>
          <DialogDescription>
            {t('Extra lines on the subcontract. They count towards its value, and can be billed, once somebody who certifies approves them.')}
          </DialogDescription>
        </DialogHeader>
        <form action={submit} className="flex flex-col gap-4">
          <Field label={t('Title')} htmlFor="var-title">
            <Input id="var-title" name="title" required maxLength={160} />
          </Field>
          <Field label={t('Reason')} htmlFor="var-reason" optional>
            <Textarea id="var-reason" name="reason" maxLength={2000} className="min-h-[64px]" />
          </Field>
          <LinesEditor lines={lines} onChange={setLines} costCodes={costCodes} />
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
              {t('Send for approval')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// --- bills ---------------------------------------------------------------------------------------

function BillsTab({ subcontract }: { subcontract: SubcontractDetail }) {
  const { t } = useLanguage();
  const { money, shortDate } = useFormat();
  const router = useRouter();

  if (subcontract.bills.length === 0) {
    return (
      <EmptyState
        icon={<FileText />}
        title={t('No bills yet')}
        body={t('Each running bill claims the work done to date; it pays the increment since the last one.')}
      />
    );
  }
  return (
    <Card className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className="text-start">{t('Bill')}</TableHead>
            <TableHead className="text-start">{t('Status')}</TableHead>
            <TableHead className="text-end">{t('This bill')}</TableHead>
            <TableHead className="text-end">{t('Net payable')}</TableHead>
            <TableHead className="text-end">{t('Paid')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {subcontract.bills.map((bill) => (
            <TableRow key={bill.id} className="cursor-pointer" onClick={() => router.push(`/subcontracts/bills/${bill.id}`)}>
              <TableCell className="text-start">
                <div className="flex flex-col">
                  <span className="font-medium">RA-{bill.number}</span>
                  <span className="text-[12px] text-ink-muted">
                    {t('to')} {shortDate(bill.period_to)}
                  </span>
                </div>
              </TableCell>
              <TableCell className="text-start">
                <Badge tone={BILL_STATUS[bill.status].tone}>{t(BILL_STATUS[bill.status].label)}</Badge>
              </TableCell>
              <TableCell className="text-end font-mono text-[13px]">{bill.figures ? money(bill.figures.gross) : '—'}</TableCell>
              <TableCell className="text-end font-mono text-[13px]">{bill.figures ? money(bill.figures.net_payable) : '—'}</TableCell>
              <TableCell className="text-end font-mono text-[13px]">{bill.paid === null ? '—' : money(bill.paid)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Card>
  );
}

// --- retention and payments ----------------------------------------------------------------------

function RetentionTab({ subcontract, can }: { subcontract: SubcontractDetail; can: SubcontractAbilities }) {
  const { t } = useLanguage();
  const { money, shortDate } = useFormat();
  const statement = subcontract.statement;
  if (!statement) return null;
  const advanceLeft = BigInt(subcontract.advance_amount ?? '0') - BigInt(statement.advancePaid);
  const running = subcontract.status === 'active' || subcontract.status === 'completed';

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3.5 sm:grid-cols-3">
        <Figure label={t('Retention held')} value={money(statement.retentionBalance)} note={`${percent(subcontract.retention_bp)} ${t('of each bill')}`} />
        <Figure
          label={t('Due at completion')}
          value={money(subcontract.retention_tranches?.at_completion)}
          note={`${percent(subcontract.retention_release_at_completion_bp)} ${t('of retention')}`}
        />
        <Figure
          label={t('Due after the defects period')}
          value={money(subcontract.retention_tranches?.after_defects)}
          note={
            subcontract.defects_liability_ends
              ? `${t('Ends')} ${shortDate(subcontract.defects_liability_ends)}`
              : `${subcontract.defects_liability_months} ${t('months from completion')}`
          }
        />
      </div>
      <div className="flex flex-wrap justify-end gap-2">
        {can.pay && running && advanceLeft > 0n && (
          <AmountDialog
            trigger={<Button size="sm" variant="secondary">{t('Pay the advance')}</Button>}
            title={t('Pay the advance')}
            description={t('Recovered from each bill as agreed, until it is all back.')}
            suggested={advanceLeft.toString()}
            max={advanceLeft.toString()}
            confirmLabel={t('Record payment')}
            onSubmit={(input) => paySubcontract(subcontract.id, { ...input, kind: 'advance' })}
          />
        )}
        {can.certify && running && BigInt(statement.retentionBalance) > 0n && (
          <AmountDialog
            trigger={<Button size="sm">{t('Release retention')}</Button>}
            title={t('Release retention')}
            description={t('What is released becomes owed to the subcontractor. The decision is recorded in your name.')}
            suggested={subcontract.retention_tranches?.at_completion}
            max={statement.retentionBalance}
            withMode={false}
            confirmLabel={t('Release')}
            onSubmit={(input) =>
              releaseRetention(subcontract.id, { amount: input.amount, released_on: input.paid_on })
            }
          />
        )}
      </div>

      {subcontract.retention_releases.length > 0 && (
        <Card className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="text-start">{t('Released')}</TableHead>
                <TableHead className="text-start">{t('Approved by')}</TableHead>
                <TableHead className="text-end">{t('Amount')}</TableHead>
                <TableHead className="text-end">{t('Paid')}</TableHead>
                {can.pay && <TableHead className="w-[1%]" />}
              </TableRow>
            </TableHeader>
            <TableBody>
              {subcontract.retention_releases.map((release) => {
                const owed = BigInt(release.amount) - BigInt(release.paid);
                return (
                  <TableRow key={release.id}>
                    <TableCell className="text-start">{shortDate(release.released_on)}</TableCell>
                    <TableCell className="text-start text-ink-muted">{release.approved_by?.name}</TableCell>
                    <TableCell className="text-end font-mono text-[13px]">{money(release.amount)}</TableCell>
                    <TableCell className="text-end font-mono text-[13px]">{money(release.paid)}</TableCell>
                    {can.pay && (
                      <TableCell>
                        {owed > 0n && (
                          <AmountDialog
                            trigger={<Button size="sm" variant="secondary">{t('Pay')}</Button>}
                            title={t('Pay released retention')}
                            description={t('Money handed over against this release.')}
                            suggested={owed.toString()}
                            max={owed.toString()}
                            confirmLabel={t('Record payment')}
                            onSubmit={(input) =>
                              paySubcontract(subcontract.id, { ...input, kind: 'retention', retention_release_id: release.id })
                            }
                          />
                        )}
                      </TableCell>
                    )}
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </Card>
      )}

      <Card className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="text-start">{t('Paid on')}</TableHead>
              <TableHead className="text-start">{t('For')}</TableHead>
              <TableHead className="text-start">{t('Reference')}</TableHead>
              <TableHead className="text-end">{t('Amount')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {subcontract.payments.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="text-center text-ink-muted">
                  {t('Nothing paid yet.')}
                </TableCell>
              </TableRow>
            ) : (
              subcontract.payments.map((payment) => (
                <TableRow key={payment.id}>
                  <TableCell className="text-start">{shortDate(payment.paid_on)}</TableCell>
                  <TableCell className="text-start">
                    {payment.kind === 'bill' ? `RA-${payment.bill_number}` : payment.kind === 'advance' ? t('Advance') : t('Retention')}
                  </TableCell>
                  <TableCell className="text-start text-ink-muted">{payment.reference ?? '—'}</TableCell>
                  <TableCell className="text-end font-mono text-[13px]">{money(payment.amount)}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}

function Figure({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <Card className="flex flex-col gap-1 p-4">
      <span className="text-[12.5px] text-ink-muted">{label}</span>
      <span className="font-mono text-[18px] font-bold">{value}</span>
      {note && <span className="text-[12px] text-ink-faint">{note}</span>}
    </Card>
  );
}

// --- statement -----------------------------------------------------------------------------------

const STATEMENT: ReadonlyArray<[keyof SubcontractStatementView, string, boolean?]> = [
  ['originalValue', 'Original contract value'],
  ['variationsValue', 'Approved variations'],
  ['currentValue', 'Current contract value', true],
  ['certifiedGross', 'Work certified to date'],
  ['remainingValue', 'Value still to certify'],
  ['tax', 'Tax on certified work'],
  ['retentionHeld', 'Retention held'],
  ['retentionReleased', 'Retention released'],
  ['retentionBalance', 'Retention still held'],
  ['advancePaid', 'Advance paid'],
  ['advanceRecovered', 'Advance recovered'],
  ['advanceOutstanding', 'Advance still to recover'],
  ['deductions', 'Deductions and back-charges'],
  ['netCertified', 'Net certified payable'],
  ['paidOnBills', 'Paid against bills'],
  ['retentionPaid', 'Retention paid'],
  ['totalPaid', 'Total paid'],
  ['balanceDue', 'Balance due', true],
];

function StatementTab({ subcontract, statement }: { subcontract: SubcontractDetail; statement: SubcontractStatementView }) {
  const { t } = useLanguage();
  const format = useFormat();

  function exportCsv() {
    const csv = subcontractStatementCsv(
      { number: subcontract.number, title: subcontract.title, contractor: subcontract.contractor.name },
      statement,
      subcontract.bills
        .filter((bill) => bill.figures && (bill.status === 'certified' || bill.status === 'paid'))
        .map((bill) => ({
          number: bill.number,
          period_to: bill.period_to,
          status: bill.status,
          gross: bill.figures!.gross,
          tax: bill.figures!.tax,
          retention: bill.figures!.retention,
          advance_recovery: bill.figures!.advance_recovery,
          deductions: bill.figures!.deductions,
          net_payable: bill.figures!.net_payable,
          paid: bill.paid ?? '0',
        })),
      format.currencyDigits,
    );
    const blob = new Blob([CSV_BOM + csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${subcontract.number}-statement-${format.todayIso()}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex justify-end">
        <Button variant="secondary" size="sm" onClick={exportCsv}>
          <Download className="size-4" />
          {t('Export CSV')}
        </Button>
      </div>
      <Card className="overflow-hidden">
        <Table>
          <TableBody>
            {STATEMENT.map(([key, label, strong]) => (
              <TableRow key={key} className={strong ? 'font-semibold' : undefined}>
                <TableCell className="text-start">{t(label)}</TableCell>
                <TableCell className="text-end font-mono">{format.money(statement[key])}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}

// --- terms and documents -------------------------------------------------------------------------

function TermsTab({
  subcontract,
  documents,
  canManage,
}: {
  subcontract: SubcontractDetail;
  documents: SiteDocument[];
  canManage: boolean;
}) {
  const { t } = useLanguage();
  const { money } = useFormat();
  const router = useRouter();
  const [choice, setChoice] = useState('');
  const [pending, start] = useTransition();
  const linked = new Set(subcontract.documents.map((document) => document.id));

  function run(work: () => Promise<{ ok: boolean; error?: string }>) {
    start(async () => {
      const result = await work();
      if (!result.ok) toast.error(result.error ?? t('Could not do that'));
      else {
        setChoice('');
        router.refresh();
      }
    });
  }

  const rows: Array<[string, string]> = [
    [t('Subcontractor'), subcontract.contractor.name],
    [t('Tax number'), subcontract.contractor.tax_id ?? '—'],
    [t('Retention'), percent(subcontract.retention_bp)],
    [t('Released at completion'), percent(subcontract.retention_release_at_completion_bp)],
    [t('Defects period'), `${subcontract.defects_liability_months} ${t('months')}`],
    ...(subcontract.advance_amount !== null
      ? ([[t('Advance'), `${money(subcontract.advance_amount)} · ${percent(subcontract.advance_recovery_bp)} ${t('recovered per bill')}`]] as Array<[string, string]>)
      : []),
    [t('Tax on bills'), percent(subcontract.tax_rate_bp)],
    [t('Payment terms'), subcontract.payment_terms ?? '—'],
  ];

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card className="flex flex-col gap-3 p-4">
        <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-[13.5px]">
          {rows.map(([label, value]) => (
            <div key={label} className="contents">
              <dt className="text-ink-muted">{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
        {subcontract.scope && <p className="whitespace-pre-line border-t border-line-soft pt-3 text-[13.5px]">{subcontract.scope}</p>}
      </Card>
      <Card className="flex flex-col gap-3 p-4">
        <span className="text-[12px] font-semibold uppercase tracking-[0.08em] text-ink-muted">{t('Documents')}</span>
        {subcontract.documents.length === 0 ? (
          <p className="text-[13.5px] text-ink-muted">{t('Nothing linked. Upload the signed subcontract under Documents, then link it here.')}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {subcontract.documents.map((document) => (
              <li key={document.id} className="flex items-center justify-between gap-3 text-[13.5px]">
                <Link href={`/projects/${subcontract.project.id}?tab=documents`} className="hover:underline">
                  {document.title} <span className="text-ink-faint">v{document.version}</span>
                </Link>
                {canManage && (
                  <Button
                    size="icon"
                    variant="ghost"
                    className="size-8 text-ink-faint"
                    aria-label={`${t('Unlink')} ${document.title}`}
                    disabled={pending}
                    onClick={() => run(() => detachSubcontractDocument(subcontract.id, document.id))}
                  >
                    <X className="size-4" />
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
        {canManage && documents.some((document) => !linked.has(document.id)) && (
          <div className="flex gap-2">
            <Select value={choice} onValueChange={setChoice}>
              <SelectTrigger className="flex-1">
                <SelectValue placeholder={t('Link a document')} />
              </SelectTrigger>
              <SelectContent>
                {documents
                  .filter((document) => !linked.has(document.id))
                  .map((document) => (
                    <SelectItem key={document.id} value={document.id}>
                      {document.title}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
            <Button
              size="sm"
              variant="secondary"
              disabled={!choice || pending}
              onClick={() => run(() => attachSubcontractDocument(subcontract.id, choice))}
            >
              {t('Link')}
            </Button>
          </div>
        )}
      </Card>
    </div>
  );
}
