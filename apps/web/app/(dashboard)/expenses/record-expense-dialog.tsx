'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { Receipt } from 'lucide-react';
import { toast } from 'sonner';
import { EXPENSE_CATEGORIES, expenseCategoryLabel } from '@sitebook/shared';
import { recordExpense } from '@/lib/actions';
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

        <form action={onSubmit} className="flex flex-col gap-4">
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
