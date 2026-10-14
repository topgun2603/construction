'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, useTransition } from 'react';
import { Loader2, Receipt, ScanLine } from 'lucide-react';
import { toast } from 'sonner';
import {
  COST_CODE_INDENT,
  EXPENSE_CATEGORIES,
  expenseCategoryLabel,
  taxIncluded,
  taxRule,
} from '@sitebook/shared';
import { presignUpload, recordExpense, scanBill } from '@/lib/actions';
import { costCodeOptions } from '@/lib/cost-code-actions';
import type { CostCode } from '@/lib/cost-code-types';
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { amountToMinorString, minorToAmountInput } from '@/lib/money-input';
import type { ProjectSummary } from '@/lib/api-types';
import { useLanguage } from '@/components/language-provider';
import { useFormat } from '@/components/format-provider';

export function RecordExpenseDialog({ projects }: { projects: ProjectSummary[] }) {
  const { t } = useLanguage();
  const { settings, currencySymbol, currencyDigits, todayIso } = useFormat();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [projectId, setProjectId] = useState(projects[0]?.id ?? '');
  const [category, setCategory] = useState<string>('materials');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  /*
   * The site's cost codes, read when the dialog opens or the site changes — a code belongs to one
   * site, so the list has to follow the site picker. Optional: a site nobody has broken down yet
   * shows no picker, and an uncoded expense is "Unallocated" on the budget report, not lost.
   */
  const [codes, setCodes] = useState<CostCode[]>([]);
  const [costCodeId, setCostCodeId] = useState('');
  useEffect(() => {
    setCostCodeId('');
    setCodes([]);
    if (!open || !projectId) return;
    let live = true;
    void costCodeOptions(projectId).then((result) => {
      if (live && result.ok && result.data) setCodes(result.data);
    });
    return () => {
      live = false;
    };
  }, [open, projectId]);

  // VAT or GST inside the amount, and who charged it. Only offered under a regime that has a tax;
  // the API checks the supplier's number against that regime and says plainly when it is not one.
  const rule = taxRule(settings.taxRegime ?? 'none');
  const [tax, setTax] = useState('');
  const [supplierTaxId, setSupplierTaxId] = useState('');

  // The bill, and what reading it produced. `billKey` is kept so the photograph is filed with the
  // expense: the scan is a convenience, the picture is the evidence.
  const fileInput = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const [scanning, setScanning] = useState(false);
  const [billKey, setBillKey] = useState<string | null>(null);
  const [unread, setUnread] = useState<string[]>([]);
  const [scanned, setScanned] = useState(false);

  /**
   * Upload the photo, read it, and fill in the form.
   *
   * Nothing here submits anything. The fields are populated and the person checks them — a model
   * reading ₹1,250 as ₹12.50 has to be a visible mistake somebody corrects, not a silent one.
   */
  async function onBillChosen(file: File) {
    setError(null);
    setScanning(true);
    try {
      const presigned = await presignUpload({
        kind: 'bill',
        content_type: file.type || 'image/jpeg',
        content_length: file.size,
        ...(projectId ? { project_id: projectId } : {}),
      });
      if (!presigned.ok || !presigned.data) {
        setError(presigned.error ?? 'Could not prepare the upload');
        return;
      }

      const put = await fetch(presigned.data.url, {
        method: 'PUT',
        headers: presigned.data.headers,
        body: file,
      });
      if (!put.ok) {
        setError('The upload failed');
        return;
      }
      setBillKey(presigned.data.s3_key);

      const read = await scanBill(presigned.data.s3_key);
      if (!read.ok || !read.data) {
        // The photograph is uploaded and attached either way — only the reading failed, and the
        // form still works by hand.
        setError(read.error ?? 'Could not read that bill. Fill it in by hand.');
        return;
      }

      const draft = read.data;
      const form = formRef.current;
      if (form) {
        const amount = form.elements.namedItem('amount') as HTMLInputElement | null;
        const spentOn = form.elements.namedItem('spent_on') as HTMLInputElement | null;
        const note = form.elements.namedItem('note') as HTMLTextAreaElement | null;
        // Rupees back out of paise for the field, which is what a person is reading.
        if (amount && draft.amount) {
          amount.value = (Number(draft.amount) / 10 ** currencyDigits).toFixed(currencyDigits);
        }
        if (spentOn && draft.spent_on) spentOn.value = draft.spent_on;
        if (note) note.value = [draft.vendor, draft.summary].filter(Boolean).join(' — ');
      }
      // The supplier's tax number only reaches here if it passed the regime's check, and it has
      // its own field now, so it is not repeated in the note.
      if (rule.taxName) {
        if (draft.tax_amount) setTax(minorToAmountInput(draft.tax_amount, currencyDigits));
        if (draft.tax_id) setSupplierTaxId(draft.tax_id);
      }
      if (draft.category) setCategory(draft.category);
      setUnread(draft.unread);
      setScanned(true);
    } finally {
      setScanning(false);
      if (fileInput.current) fileInput.current.value = '';
    }
  }

  /** The tax inside whatever is in the amount box, at the standard rate. A starting point only. */
  function workOutTax() {
    const field = formRef.current?.elements.namedItem('amount') as HTMLInputElement | null;
    if (!rule.standardRateBp || !field) return;
    let gross = 0n;
    try {
      gross = BigInt(amountToMinorString(field.value, currencyDigits, currencySymbol));
    } catch {
      // Not a number yet; handled below the same as an empty box.
    }
    if (gross <= 0n) {
      setError(t('Enter the amount first'));
      return;
    }
    setError(null);
    setTax(minorToAmountInput(taxIncluded(gross, rule.standardRateBp).toString(), currencyDigits));
  }

  function onSubmit(formData: FormData) {
    setError(null);
    if (!projectId) {
      setError('Choose a site');
      return;
    }
    let amount: string;
    try {
      amount = amountToMinorString(
        String(formData.get('amount') ?? '0'),
        currencyDigits,
        currencySymbol,
      );
    } catch {
      setError(t('Enter the amount as a number, like 4200'));
      return;
    }
    let taxMinor: string | undefined;
    if (rule.taxName && tax.trim()) {
      try {
        taxMinor = amountToMinorString(tax, currencyDigits, currencySymbol);
      } catch {
        setError(`${t('Enter the')} ${rule.taxName} ${t('as an amount, like 50')}`);
        return;
      }
      // The tax is part of the amount, so it cannot be more than it.
      if (BigInt(taxMinor) > BigInt(amount)) {
        setError(`${t('The')} ${rule.taxName} ${t('cannot be more than the amount')}`);
        return;
      }
      if (taxMinor === '0') taxMinor = undefined;
    }
    const taxId = rule.taxName ? supplierTaxId.trim() : '';
    start(async () => {
      const result = await recordExpense({
        project_id: projectId,
        amount,
        category,
        spent_on: String(formData.get('spent_on') ?? todayIso()),
        note: String(formData.get('note') ?? '').trim() || undefined,
        ...(billKey ? { bill_s3_key: billKey } : {}),
        ...(taxMinor ? { tax_amount: taxMinor } : {}),
        ...(taxId ? { supplier_tax_id: taxId } : {}),
        ...(costCodeId ? { cost_code_id: costCodeId } : {}),
      });
      if (!result.ok) {
        setError(result.error ?? 'Could not record the expense');
        return;
      }
      toast.success('Expense recorded - waiting for approval');
      setTax('');
      setSupplierTaxId('');
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Receipt /> {t('Record expense')}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('Record an expense')}</DialogTitle>
          <DialogDescription>
            {t('Counts toward the site spend straight away; a project manager or the owner signs it off.')}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-2 rounded-card border border-line-soft bg-raised p-3.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-col">
              <span className="text-[13.5px] font-medium">{t('Photograph of the bill')}</span>
              <span className="text-[12.5px] text-ink-muted">
                {scanned
                  ? 'Read from the photo — check it before recording.'
                  : 'Optional. We read the total, date and supplier off it.'}
              </span>
            </div>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              disabled={scanning || pending}
              onClick={() => fileInput.current?.click()}
            >
              {scanning ? <Loader2 className="size-4 animate-spin" /> : <ScanLine className="size-4" />}
              {scanning ? 'Reading…' : billKey ? 'Use another photo' : 'Scan a bill'}
            </Button>
            <input
              ref={fileInput}
              type="file"
              accept="image/*,application/pdf"
              hidden
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void onBillChosen(file);
              }}
            />
          </div>

          {scanned && unread.length > 0 && (
            // Saying what it could not read is the honest half of this feature. A form that looks
            // filled in but has a wrong date is worse than one with an obvious gap.
            <p className="text-[12.5px] text-pending-fg">
              {t('Could not read the')} {unread.join(', ')} — fill {unread.length === 1 ? 'it' : 'them'} in
              yourself.
            </p>
          )}
        </div>

        <form ref={formRef} action={onSubmit} className="flex flex-col gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t('Site')}>
              <Select value={projectId} onValueChange={setProjectId}>
                <SelectTrigger>
                  <SelectValue placeholder={t('Choose a site')} />
                </SelectTrigger>
                <SelectContent>
                  {projects.map((project) => (
                    <SelectItem key={project.id} value={project.id}>
                      {project.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field
              label={
                // Indian companies keep the "Rs" this label has always had; anyone else sees their sign.
                settings.currency === 'INR'
                  ? t('Amount (Rs)')
                  : t('Amount (Rs)').replace(/Rs|ரூ/, currencySymbol)
              }
              htmlFor="amount"
            >
              <Input id="amount" name="amount" required inputMode="decimal" placeholder="4200" />
            </Field>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t('Category')}>
              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {EXPENSE_CATEGORIES.map((value) => (
                    <SelectItem key={value} value={value}>
                      {t(expenseCategoryLabel(value))}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label={t('Spent on')} htmlFor="spent_on" hint={t('The day the money left')}>
              <Input id="spent_on" name="spent_on" type="date" defaultValue={todayIso()} required />
            </Field>
          </div>

          {codes.length > 0 && (
            <Field label={t('Cost code')} optional hint={t('The line of the site’s budget this belongs to')}>
              <Select
                value={costCodeId || 'none'}
                onValueChange={(value) => setCostCodeId(value === 'none' ? '' : value)}
              >
                <SelectTrigger aria-label={t('Cost code')}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">{t('Not coded')}</SelectItem>
                  {codes.map((code) => (
                    <SelectItem key={code.id} value={code.id}>
                      {COST_CODE_INDENT.repeat(code.depth)}
                      {code.code} {code.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          )}

          {rule.taxName && (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                label={`${rule.taxName} ${t('included')}`}
                htmlFor="tax_amount"
                optional
                hint={t('The tax already inside the amount, as printed on the bill')}
              >
                <div className="flex gap-2">
                  <Input
                    id="tax_amount"
                    value={tax}
                    onChange={(event) => setTax(event.target.value)}
                    inputMode="decimal"
                    placeholder="200"
                  />
                  {rule.standardRateBp !== null && (
                    <Button type="button" size="sm" variant="secondary" onClick={workOutTax}>
                      {t('Work out at')} {rule.standardRateBp / 100}%
                    </Button>
                  )}
                </div>
              </Field>
              <Field
                label={`${t('Supplier')} ${rule.idLabel ?? ''}`.trim()}
                htmlFor="supplier_tax_id"
                optional
              >
                <Input
                  id="supplier_tax_id"
                  value={supplierTaxId}
                  onChange={(event) => setSupplierTaxId(event.target.value)}
                  maxLength={30}
                  autoComplete="off"
                />
              </Field>
            </div>
          )}

          <Field label={t('Note')} htmlFor="note">
            <Textarea id="note" name="note" placeholder={t('What it was for: lorry hire, diesel, repairs')} />
          </Field>

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
              {pending ? 'Recording...' : t('Record')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
