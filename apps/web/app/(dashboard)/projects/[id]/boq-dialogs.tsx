'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Link2, Pencil, Plus, ReceiptText, Settings2 } from 'lucide-react';
import { toast } from 'sonner';
import { COST_CODE_INDENT, basisPointsToPercent, percentToBasisPoints } from '@sitebook/shared';
import {
  addBoqItem,
  autoMapBoqCostCodes,
  createBoqBill,
  removeBoqItem,
  updateBoqItem,
  updateBoqTerms,
} from '@/lib/boq-actions';
import type { BoqItem, BoqView } from '@/lib/boq-types';
import type { CostCode } from '@/lib/cost-code-types';
import { amountToMinorString, minorToAmountInput } from '@/lib/money-input';
import { useFormat } from '@/components/format-provider';
import { useLanguage } from '@/components/language-provider';
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
import { Input } from '@/components/ui/input';
import { Field } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

/** The client's billing terms on this BOQ: retention, mobilisation advance and its recovery, tax. */
export function BoqTermsDialog({ projectId, boq }: { projectId: string; boq: BoqView }) {
  const { t } = useLanguage();
  const format = useFormat();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const terms = boq.terms;
  const [title, setTitle] = useState(boq.title);
  const [retention, setRetention] = useState(basisPointsToPercent(terms?.retention_bp ?? 0));
  const [advance, setAdvance] = useState(minorToAmountInput(terms?.advance_amount ?? '0', format.currencyDigits));
  const [recovery, setRecovery] = useState(basisPointsToPercent(terms?.advance_recovery_bp ?? 0));
  const [tax, setTax] = useState(basisPointsToPercent(terms?.tax_rate_bp ?? 0));

  function save() {
    const retentionBp = percentToBasisPoints(retention);
    const recoveryBp = percentToBasisPoints(recovery);
    const taxBp = percentToBasisPoints(tax);
    if (retentionBp === null || recoveryBp === null || taxBp === null) {
      toast.error(t('Enter each percentage as a number from 0 to 100'));
      return;
    }
    let advanceMinor: string;
    try {
      advanceMinor = amountToMinorString(advance, format.currencyDigits, format.currencySymbol);
    } catch {
      toast.error(t('Enter the advance as a number'));
      return;
    }
    start(async () => {
      const result = await updateBoqTerms(projectId, {
        title: title.trim() || undefined,
        retention_bp: retentionBp,
        advance_amount: advanceMinor,
        advance_recovery_bp: recoveryBp,
        tax_rate_bp: taxBp,
      });
      if (!result.ok) {
        toast.error(result.error ?? t('Could not save that'));
        return;
      }
      toast.success(t('Billing terms saved'));
      setOpen(false);
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="secondary" size="sm">
          <Settings2 className="size-4" />
          {t('Billing terms')}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('Billing terms with the client')}</DialogTitle>
          <DialogDescription>
            {t('Applied to every running bill on this BOQ. A certified bill keeps the figures it was certified with.')}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('Title')} className="sm:col-span-2">
            <Input value={title} maxLength={160} onChange={(event) => setTitle(event.target.value)} />
          </Field>
          <Field label={t('Retention %')} hint={t('Held back by the client from every bill')}>
            <Input value={retention} inputMode="decimal" dir="ltr" onChange={(event) => setRetention(event.target.value)} />
          </Field>
          <Field label={`${boq.tax_name ?? t('Tax')} %`}>
            <Input value={tax} inputMode="decimal" dir="ltr" onChange={(event) => setTax(event.target.value)} />
          </Field>
          <Field label={`${t('Mobilisation advance received')} (${format.currencySymbol})`}>
            <Input value={advance} inputMode="decimal" dir="ltr" onChange={(event) => setAdvance(event.target.value)} />
          </Field>
          <Field label={t('Advance recovery %')} hint={t('Of the work billed, until the advance is back')}>
            <Input value={recovery} inputMode="decimal" dir="ltr" onChange={(event) => setRecovery(event.target.value)} />
          </Field>
        </div>
        <DialogFooter>
          <Button variant="secondary" onClick={() => setOpen(false)}>
            {t('Cancel')}
          </Button>
          <Button onClick={save} disabled={pending}>
            {t('Save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Propose a cost code for each item, show the list, and apply it in one go. */
export function AutoMapDialog({ projectId }: { projectId: string }) {
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [proposals, setProposals] = useState<
    Array<{ item_id: string; item_no: string; description: string; cost_code: { code: string; name: string } }> | null
  >(null);

  function propose(next: boolean) {
    setOpen(next);
    if (!next) return;
    setProposals(null);
    start(async () => {
      const result = await autoMapBoqCostCodes(projectId, false);
      if (!result.ok || !result.data) {
        toast.error(result.error ?? t('Could not work that out'));
        setOpen(false);
        return;
      }
      setProposals(result.data.proposals);
    });
  }

  function apply() {
    start(async () => {
      const result = await autoMapBoqCostCodes(projectId, true);
      if (!result.ok || !result.data) {
        toast.error(result.error ?? t('Could not save that'));
        return;
      }
      toast.success(`${result.data.applied} ${t('items linked to cost codes')}`);
      setOpen(false);
    });
  }

  return (
    <Dialog open={open} onOpenChange={propose}>
      <DialogTrigger asChild>
        <Button variant="secondary" size="sm">
          <Link2 className="size-4" />
          {t('Link cost codes')}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t('Link items to cost codes')}</DialogTitle>
          <DialogDescription>
            {t('Matched by code, then by name, then by words in the description; an item nothing matches takes its section’s code. Items already linked keep theirs.')}
          </DialogDescription>
        </DialogHeader>
        {proposals === null ? (
          <p className="text-[13.5px] text-ink-muted">{t('Working it out…')}</p>
        ) : proposals.length === 0 ? (
          <p className="text-[13.5px] text-ink-muted">{t('Nothing new to link. Add cost codes to the site, or link items by hand.')}</p>
        ) : (
          <ul className="flex flex-col divide-y divide-line-soft text-[13.5px]">
            {proposals.map((proposal) => (
              <li key={proposal.item_id} className="flex items-center justify-between gap-3 py-1.5">
                <span className="min-w-0 truncate">
                  <span className="me-1.5 font-mono text-ink-muted" dir="ltr">
                    {proposal.item_no}
                  </span>
                  {proposal.description}
                </span>
                <span className="flex-none font-mono text-[12.5px]">
                  {proposal.cost_code.code} {proposal.cost_code.name}
                </span>
              </li>
            ))}
          </ul>
        )}
        <DialogFooter>
          <Button variant="secondary" onClick={() => setOpen(false)}>
            {t('Cancel')}
          </Button>
          <Button onClick={apply} disabled={pending || !proposals || proposals.length === 0}>
            {t('Link these')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Add a section or an item by hand, or edit one. */
export function BoqItemDialog({
  projectId,
  sections,
  costCodes,
  editing,
}: {
  projectId: string;
  sections: BoqItem[];
  costCodes: CostCode[];
  editing?: BoqItem;
}) {
  const { t } = useLanguage();
  const format = useFormat();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [kind, setKind] = useState<'section' | 'item'>(editing?.kind ?? 'item');
  const [itemNo, setItemNo] = useState(editing?.item_no ?? '');
  const [description, setDescription] = useState(editing?.description ?? '');
  const [parentId, setParentId] = useState(editing?.parent_id ?? '');
  const [unit, setUnit] = useState(editing?.unit ?? '');
  const [quantity, setQuantity] = useState(editing?.quantity ?? '');
  const [rate, setRate] = useState(editing?.rate ? minorToAmountInput(editing.rate, format.currencyDigits) : '');
  const [costCodeId, setCostCodeId] = useState(editing?.cost_code?.id ?? '');

  function save() {
    let rateMinor: string | undefined;
    if (kind === 'item' && rate.trim()) {
      try {
        rateMinor = amountToMinorString(rate, format.currencyDigits, format.currencySymbol);
      } catch {
        toast.error(t('Enter the rate as a number'));
        return;
      }
    }
    start(async () => {
      const figures =
        kind === 'item'
          ? { unit: unit.trim() || undefined, quantity: quantity.trim() || undefined, ...(rateMinor ? { rate: rateMinor } : {}) }
          : {};
      const result = editing
        ? await updateBoqItem(projectId, editing.id, {
            item_no: itemNo.trim(),
            description: description.trim(),
            cost_code_id: costCodeId || null,
            ...figures,
          })
        : await addBoqItem(projectId, {
            kind,
            item_no: itemNo.trim(),
            description: description.trim(),
            parent_id: parentId || null,
            cost_code_id: costCodeId || null,
            ...figures,
          });
      if (!result.ok) {
        toast.error(result.error ?? t('Could not save that'));
        return;
      }
      toast.success(editing ? t('Item saved') : t('Item added'));
      setOpen(false);
    });
  }

  function remove() {
    if (!editing) return;
    start(async () => {
      const result = await removeBoqItem(projectId, editing.id);
      if (!result.ok) {
        toast.error(result.error ?? t('Could not remove that'));
        return;
      }
      toast.success(t('Item removed'));
      setOpen(false);
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {editing ? (
          <Button size="icon" variant="ghost" className="size-8 text-ink-faint" aria-label={`${t('Edit')} ${editing.item_no}`}>
            <Pencil className="size-4" />
          </Button>
        ) : (
          <Button variant="secondary" size="sm">
            <Plus className="size-4" />
            {t('Add item')}
          </Button>
        )}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{editing ? `${t('Edit')} ${editing.item_no}` : t('Add to the BOQ')}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          {!editing && (
            <Field label={t('Kind')}>
              <Select value={kind} onValueChange={(value) => setKind(value as 'section' | 'item')}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="item">{t('Item')}</SelectItem>
                  <SelectItem value="section">{t('Section heading')}</SelectItem>
                </SelectContent>
              </Select>
            </Field>
          )}
          <Field label={t('Item no.')}>
            <Input value={itemNo} maxLength={30} dir="ltr" placeholder="2.1.3" onChange={(event) => setItemNo(event.target.value)} />
          </Field>
          <Field label={t('Description')} className="sm:col-span-2">
            <Input value={description} maxLength={1000} onChange={(event) => setDescription(event.target.value)} />
          </Field>
          {!editing && sections.length > 0 && (
            <Field label={t('Under section')} optional>
              <Select value={parentId || 'none'} onValueChange={(value) => setParentId(value === 'none' ? '' : value)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">{t('Top level')}</SelectItem>
                  {sections.map((section) => (
                    <SelectItem key={section.id} value={section.id}>
                      {COST_CODE_INDENT.repeat(section.depth)}
                      {section.item_no} {section.description}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          )}
          <Field label={t('Cost code')} optional>
            <Select value={costCodeId || 'none'} onValueChange={(value) => setCostCodeId(value === 'none' ? '' : value)}>
              <SelectTrigger>
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
          </Field>
          {kind === 'item' && (
            <>
              <Field label={t('Unit')}>
                <Input value={unit} maxLength={20} placeholder="m3" onChange={(event) => setUnit(event.target.value)} />
              </Field>
              <Field label={t('Contract quantity')}>
                <Input value={quantity} inputMode="decimal" dir="ltr" onChange={(event) => setQuantity(event.target.value)} />
              </Field>
              <Field label={`${t('Rate')} (${format.currencySymbol})`}>
                <Input value={rate} inputMode="decimal" dir="ltr" onChange={(event) => setRate(event.target.value)} />
              </Field>
            </>
          )}
        </div>
        <DialogFooter>
          {editing && (
            <Button variant="destructive" onClick={remove} disabled={pending} className="sm:me-auto">
              {t('Remove')}
            </Button>
          )}
          <Button variant="secondary" onClick={() => setOpen(false)}>
            {t('Cancel')}
          </Button>
          <Button onClick={save} disabled={pending || !itemNo.trim() || !description.trim()}>
            {t('Save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Draft the next running bill: it claims what is measured to date, and opens in the editor. */
export function NewBoqBillDialog({ projectId }: { projectId: string }) {
  const { t } = useLanguage();
  const format = useFormat();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [periodFrom, setPeriodFrom] = useState('');
  const [periodTo, setPeriodTo] = useState(format.todayIso());

  function create() {
    start(async () => {
      const result = await createBoqBill(projectId, {
        period_to: periodTo,
        ...(periodFrom ? { period_from: periodFrom } : {}),
      });
      if (!result.ok || !result.data) {
        toast.error(result.error ?? t('Could not draft the bill'));
        return;
      }
      setOpen(false);
      router.push(`/boq/bills/${result.data.id}`);
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <ReceiptText className="size-4" />
          {t('New bill to client')}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('New running bill')}</DialogTitle>
          <DialogDescription>
            {t('Each item is claimed at what has been measured to date. Adjust the claim in the bill before sending it.')}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('Period from')} optional>
            <Input type="date" value={periodFrom} onChange={(event) => setPeriodFrom(event.target.value)} />
          </Field>
          <Field label={t('Period to')}>
            <Input type="date" value={periodTo} onChange={(event) => setPeriodTo(event.target.value)} />
          </Field>
        </div>
        <DialogFooter>
          <Button variant="secondary" onClick={() => setOpen(false)}>
            {t('Cancel')}
          </Button>
          <Button onClick={create} disabled={pending || !periodTo}>
            {t('Draft the bill')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
