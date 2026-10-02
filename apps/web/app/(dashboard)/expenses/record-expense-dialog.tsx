'use client';

import { useRouter } from 'next/navigation';
import { useRef, useState, useTransition } from 'react';
import { Loader2, Receipt, ScanLine } from 'lucide-react';
import { toast } from 'sonner';
import { EXPENSE_CATEGORIES, expenseCategoryLabel } from '@sitebook/shared';
import { presignUpload, recordExpense, scanBill } from '@/lib/actions';
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
import { rupeesToPaiseString } from '@/lib/money-input';
import { todayIso } from '@/lib/format';
import type { ProjectSummary } from '@/lib/api-types';

export function RecordExpenseDialog({ projects }: { projects: ProjectSummary[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [projectId, setProjectId] = useState(projects[0]?.id ?? '');
  const [category, setCategory] = useState<string>('materials');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

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
        if (amount && draft.amount) amount.value = (Number(draft.amount) / 100).toFixed(2);
        if (spentOn && draft.spent_on) spentOn.value = draft.spent_on;
        if (note) {
          // The GSTIN only reaches here if its check digit validated, so it is worth keeping for
          // whoever reconciles the input credit. Expenses have no column for it; the note does.
          note.value = [
            draft.vendor,
            draft.summary,
            draft.gstin ? `GSTIN ${draft.gstin}` : null,
          ]
            .filter(Boolean)
            .join(' — ');
        }
      }
      if (draft.category) setCategory(draft.category);
      setUnread(draft.unread);
      setScanned(true);
    } finally {
      setScanning(false);
      if (fileInput.current) fileInput.current.value = '';
    }
  }

  function onSubmit(formData: FormData) {
    setError(null);
    if (!projectId) {
      setError('Choose a site');
      return;
    }
    start(async () => {
      const result = await recordExpense({
        project_id: projectId,
        amount: rupeesToPaiseString(String(formData.get('amount') ?? '0')),
        category,
        spent_on: String(formData.get('spent_on') ?? todayIso()),
        note: String(formData.get('note') ?? '').trim() || undefined,
        ...(billKey ? { bill_s3_key: billKey } : {}),
      });
      if (!result.ok) {
        setError(result.error ?? 'Could not record the expense');
        return;
      }
      toast.success('Expense recorded - waiting for approval');
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Receipt /> Record expense
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Record an expense</DialogTitle>
          <DialogDescription>
            Counts toward the site spend straight away; a project manager or the owner signs
            it off.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-2 rounded-card border border-line-soft bg-raised p-3.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-col">
              <span className="text-[13.5px] font-medium">Photograph of the bill</span>
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
              accept="image/*"
              capture="environment"
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
              Could not read the {unread.join(', ')} — fill {unread.length === 1 ? 'it' : 'them'} in
              yourself.
            </p>
          )}
        </div>

        <form ref={formRef} action={onSubmit} className="flex flex-col gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Site">
              <Select value={projectId} onValueChange={setProjectId}>
                <SelectTrigger>
                  <SelectValue placeholder="Choose a site" />
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
            <Field label="Amount (Rs)" htmlFor="amount">
              <Input id="amount" name="amount" required inputMode="decimal" placeholder="4200" />
            </Field>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Category">
              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {EXPENSE_CATEGORIES.map((value) => (
                    <SelectItem key={value} value={value}>
                      {expenseCategoryLabel(value)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Spent on" htmlFor="spent_on" hint="The day the money left">
              <Input id="spent_on" name="spent_on" type="date" defaultValue={todayIso()} required />
            </Field>
          </div>

          <Field label="Note" htmlFor="note">
            <Textarea id="note" name="note" placeholder="What it was for: lorry hire, diesel, repairs" />
          </Field>

          {error && (
            <p role="alert" className="rounded-btn bg-blocked-bg px-3 py-2 text-[13px] text-blocked-fg">
              {error}
            </p>
          )}

          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? 'Recording...' : 'Record'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
