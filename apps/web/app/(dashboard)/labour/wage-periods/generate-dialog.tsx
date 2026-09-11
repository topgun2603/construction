'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { CalendarRange } from 'lucide-react';
import { toast } from 'sonner';
import { generateWagePeriod } from '@/lib/actions';
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
import { addDaysIso, todayIso, weekStart } from '@/lib/format';
import type { Contractor } from '@/lib/api-types';

const DIRECT = 'direct';

export function GeneratePeriodDialog({ contractors }: { contractors: Contractor[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [contractorId, setContractorId] = useState<string>(DIRECT);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  // Default to the week just gone — the period accounts is about to settle.
  const lastMonday = addDaysIso(weekStart(todayIso()), -7);
  const lastSunday = addDaysIso(lastMonday, 6);

  function onSubmit(formData: FormData) {
    setError(null);
    start(async () => {
      const result = await generateWagePeriod({
        contractor_id: contractorId === DIRECT ? null : contractorId,
        period_start: String(formData.get('period_start') ?? ''),
        period_end: String(formData.get('period_end') ?? ''),
      });

      if (!result.ok) {
        setError(result.error ?? 'Could not generate the period');
        return;
      }
      toast.success(`${result.data?.line_count ?? 0} wage lines built from attendance`);
      setOpen(false);
      if (result.data?.id) router.push(`/labour/wage-periods/${result.data.id}`);
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <CalendarRange /> Generate period
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Generate a wage period</DialogTitle>
          <DialogDescription>
            Builds one line per worker from the attendance already recorded, and deducts any
            advance that has not yet been settled. Re-running an open period recomputes it.
          </DialogDescription>
        </DialogHeader>

        <form action={onSubmit} className="flex flex-col gap-4">
          <Field label="Contractor" hint="Direct labour is its own group">
            <Select value={contractorId} onValueChange={setContractorId}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={DIRECT}>Direct labour</SelectItem>
                {contractors.map((contractor) => (
                  <SelectItem key={contractor.id} value={contractor.id}>
                    {contractor.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="From" htmlFor="period_start">
              <Input id="period_start" name="period_start" type="date" defaultValue={lastMonday} required />
            </Field>
            <Field label="To" htmlFor="period_end">
              <Input id="period_end" name="period_end" type="date" defaultValue={lastSunday} required />
            </Field>
          </div>

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
              {pending ? 'Building…' : 'Generate'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
