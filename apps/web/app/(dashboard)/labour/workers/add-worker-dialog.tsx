'use client';

import { useState, useTransition } from 'react';
import { UserPlus } from 'lucide-react';
import { toast } from 'sonner';
import { createWorker } from '@/lib/actions';
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
import { rupeesToPaiseString } from '@/lib/money-input';
import { todayIso } from '@/lib/format';
import type { Contractor, ProjectSummary } from '@/lib/api-types';

const DIRECT = 'direct';

export function AddWorkerDialog({
  contractors,
  projects,
}: {
  contractors: Contractor[];
  projects: ProjectSummary[];
}) {
  const [open, setOpen] = useState(false);
  const [contractorId, setContractorId] = useState<string>(DIRECT);
  const [projectId, setProjectId] = useState<string>('');
  const [skill, setSkill] = useState('unskilled');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function onSubmit(formData: FormData) {
    setError(null);
    start(async () => {
      const result = await createWorker({
        name: String(formData.get('name') ?? ''),
        trade: optional(formData.get('trade')),
        phone: optional(formData.get('phone')),
        // "Direct labour" is an explicit choice in the UI and a null in the API.
        contractor_id: contractorId === DIRECT ? null : contractorId,
        skill_level: skill,
        daily_wage: rupeesToPaiseString(String(formData.get('daily_wage') ?? '0')),
        overtime_rate_per_hour: rupeesToPaiseString(String(formData.get('ot_rate') ?? '0')),
        ...(projectId ? { project_id: projectId, from_date: todayIso() } : {}),
      });

      if (!result.ok) {
        setError(result.error ?? 'Could not add the worker');
        return;
      }
      toast.success(`${result.data?.name ?? 'Worker'} added to the roster`);
      setOpen(false);
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <UserPlus /> Add worker
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add a worker</DialogTitle>
          <DialogDescription>
            The wage set here is frozen onto each day’s attendance, so changing it later
            never alters what has already been earned.
          </DialogDescription>
        </DialogHeader>

        <form action={onSubmit} className="flex flex-col gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Name" htmlFor="name">
              <Input id="name" name="name" required placeholder="Raju M" />
            </Field>
            <Field label="Phone" htmlFor="phone">
              <Input id="phone" name="phone" inputMode="numeric" placeholder="Optional" />
            </Field>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Trade" htmlFor="trade">
              <Input id="trade" name="trade" placeholder="Mason" />
            </Field>
            <Field label="Skill level">
              <Select value={skill} onValueChange={setSkill}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="unskilled">Unskilled</SelectItem>
                  <SelectItem value="semi">Semi-skilled</SelectItem>
                  <SelectItem value="skilled">Skilled</SelectItem>
                </SelectContent>
              </Select>
            </Field>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Daily wage (₹)" htmlFor="daily_wage">
              <Input id="daily_wage" name="daily_wage" required inputMode="decimal" placeholder="850" />
            </Field>
            <Field label="Overtime per hour (₹)" htmlFor="ot_rate">
              <Input id="ot_rate" name="ot_rate" inputMode="decimal" defaultValue="0" />
            </Field>
          </div>

          <Field label="Contractor">
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

          <Field label="Assign to site" hint="Optional — they appear in that site’s roll call from today">
            <Select value={projectId} onValueChange={setProjectId}>
              <SelectTrigger>
                <SelectValue placeholder="No site yet" />
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
              {pending ? 'Adding…' : 'Add worker'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function optional(value: FormDataEntryValue | null): string | undefined {
  const text = String(value ?? '').trim();
  return text.length > 0 ? text : undefined;
}
